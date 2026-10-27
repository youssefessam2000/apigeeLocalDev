# Petstore Proxy: Implementation Guide

This document explains the `petstore-v1` API proxy, the `common-envelope` shared flow, and the changes made to the `oauth2-token` proxy: what each part does, how a request moves through them, and how to test and deploy.

> **Status:** lint-clean (`apigeelint`, 0 errors) and tested on the local Apigee Emulator (1.9.2): all test cases pass (section 10). Not yet deployed to Apigee X.

---

## 1. Overview

```
                 (1) POST /oauth2/token                (2) GET /petstore/v1/pets/{petId}
                     client_id, client_secret,             Authorization: Bearer <JWT>
                     grant_type, scope=pet:read
  Client  ───────────────────────────►  oauth2-token        Client ─────────────────────► petstore-v1 ─────► petstore.swagger.io
          ◄───────────────────────────  (issues JWT)               ◄───────────────────── (verifies JWT,     /v2/pet/{petId}
                 { access_token: <JWT> }                           { header, data }        maps response)
```

| Component | Type | Purpose |
|-----------|------|---------|
| `oauth2-token` | API proxy | Issues a signed JWT (HS256) for valid client credentials (OAuth2 client-credentials grant). |
| `petstore-v1` | API proxy | `GET /petstore/v1/pets/{petId}`. Verifies the JWT, applies traffic limits, calls Petstore, returns the standard response. |
| `common-envelope` | Shared flow | Single definition of the response format (`header`, `data`, `error`) and the global error handler. Reusable by every proxy. |
| `oauth-config` | Key Value Map (environment) | Holds `jwt-signing-key`, the secret both proxies use to sign / verify tokens. |

**Why only one OAuth API?** The token protects the hop *client → our proxy*. The hop *our proxy → Petstore* needs no token: Petstore does not enforce authentication, and its OAuth flow (implicit, browser login) cannot be run from a proxy. A second token call inside the flow is only needed when a backend itself requires OAuth (then: ServiceCallout + cache).

---

## 2. Response format

All responses, success or error, share the same `header` object.

**Success (200)**
```json
{
  "header": { "timestamp": "2026-10-14T08:30:00Z", "traceId": "d7b2a92c-5f81-42cb-9964-b0e6df41c107", "isSuccess": true },
  "data":   { "id": 100, "name": "doggie", "status": "available" }
}
```

**Error (any 4xx / 5xx)**
```json
{
  "header": { "timestamp": "2026-10-14T08:30:01Z", "traceId": "d7b2a92c-5f81-42cb-9964-b0e6df41c107", "isSuccess": false },
  "error":  { "code": 429, "message": "Rate limit has been exceeded. Please retry after the duration specified in Retry-After." }
}
```

| Field | Source |
|-------|--------|
| `timestamp` | Time the response is built, ISO-8601 UTC without milliseconds. |
| `traceId` | The caller's `X-Request-Id` header if present and safe (8–64 chars, letters/digits/`-`), otherwise a new UUID v4. The same value is returned in the `X-Request-Id` response header. |
| `data.id` | Petstore IDs are int64 (up to 19 digits). The id is read as text and inserted as-is, so no digits are lost (a JavaScript number would round values above 2^53). |
| `isSuccess` | `true` for success, `false` for errors. |

**Response headers:** `Content-Type: application/json`, `X-Request-Id` (always), `Retry-After` (on 429 only).

**About "schemas" in Apigee:** Apigee has no typed schema objects like a Java/C# class. The "predefined schema" is implemented as one shared flow that builds the objects; every proxy calls it, so the format is defined in exactly one place. Changing a field there changes it for every proxy.

---

## 3. Request lifecycle (petstore-v1)

```
ProxyEndpoint PreFlow
  1. FC-InitTrace          → shared flow: create traceId
  2. SA-SpikeArrest        → max 10 requests/second (sliding)  (fail → 429)
  3. KVM-GetSigningKey     → read jwt-signing-key from KVM
  4. VJ-VerifyToken        → check Bearer JWT                  (fail → 401)
  5. RF-InsufficientScope  → token must contain pet:read       (fail → 403)
  6. Q-PetQuota            → 100 calls/minute per client_id    (fail → 429)

Flow "GetPetById"  (GET /pets/*)
  7. EV-ExtractPetId       → petId from the path
  8. RF-InvalidPetId       → petId must be 1–19 digits (int64) (fail → 400)

Flow "NotFound"  (any other path / method)
  -  RF-NotFound                                               (→ 404)

TargetEndpoint PreFlow
  9. AM-PetstoreRequest    → build GET https://petstore.swagger.io/v2/pet/{petId}
                             (removes Authorization header, adds api_key, Accept)
     → backend call (connect timeout 3 s, read timeout 10 s)   (timeout → 504, backend 404 → 404, backend 5xx → 500)

TargetEndpoint PostFlow (success only)
 10. EV-ExtractPet         → read id as text (keeps int64 exact)
     JS-MapPet             → keep id, name, status
 11. FC-BuildSuccess       → shared flow: wrap as { header, data }

Any failure at any step
  → DefaultFaultRule → FC-BuildError → shared flow: { header, error }
```

---

## 4. File reference

### 4.1 Shared flow `common-envelope`
Path: `src/main/apigee/sharedflows/common-envelope/sharedflowbundle/`

| File | What it does |
|------|--------------|
| `sharedflows/default.xml` | Entry point. Runs one of three steps depending on the parameter `envelope.action`: `init`, `success` or `error`. |
| `policies/JS-InitTrace.xml` | JavaScript policy → `init-trace.js`. |
| `policies/JS-BuildSuccess.xml` | JavaScript policy → `build-success.js`. |
| `policies/JS-BuildError.xml` | JavaScript policy → `build-error.js`. |
| `resources/jsc/envelope-header.js` | Shared helper functions (included by all three policies through `IncludeURL`): `newUuid()`, `envelopeTraceId()`, `envelopeHeader(isSuccess)`, `writeEnvelope(message, status, bodyJson)`. **This is the definition of the `header` object.** `writeEnvelope` writes to the `response` message in the normal flow and to the `error` message in the error flow (see 10.1). |
| `resources/jsc/init-trace.js` | Sets `envelope.traceId` from `X-Request-Id` or a new UUID, and writes it back to the request's `X-Request-Id` header (the runtime echoes that header on the response). |
| `resources/jsc/build-success.js` | Reads `envelope.data` (JSON text set by the proxy) and writes `{ header, data }`. The data is inserted as text, not re-parsed. |
| `resources/jsc/build-error.js` | **Global error handler.** Decides the status code and message, writes `{ header, error }`, sets `Retry-After` for 429, removes `Set-Cookie` from backend errors, sets `envelope.errorHandled = true`. |

**How a proxy uses it** (FlowCallout with a parameter):
```xml
<FlowCallout name="FC-BuildError">
  <Parameters>
    <Parameter name="envelope.action">error</Parameter>
  </Parameters>
  <SharedFlowBundle>common-envelope</SharedFlowBundle>
</FlowCallout>
```

**Variables (the contract between proxy and shared flow)**

| Variable | Set by | Meaning |
|----------|--------|---------|
| `envelope.action` | FlowCallout parameter | `init`, `success` or `error` |
| `envelope.traceId` | `init-trace.js` | Trace ID for the whole call |
| `envelope.data` | Proxy (e.g. `map-pet.js`) | JSON string placed under `data` |
| `envelope.errorCode` | Proxy (RaiseFault, `AssignVariable` inside `FaultResponse`) | Forces a specific error code |
| `envelope.errorMessage` | Proxy (RaiseFault, `AssignVariable` inside `FaultResponse`) | Overrides the default message |
| `envelope.quotaRetryAfter` | Proxy (optional) | Seconds for `Retry-After` on quota errors (default 60) |
| `envelope.errorHandled` | `build-error.js` | Prevents the handler from running twice |

### 4.2 Proxy `petstore-v1`
Path: `src/main/apigee/apiproxies/petstore-v1/apiproxy/`

| File | What it does |
|------|--------------|
| `proxies/default.xml` | Base path `/petstore/v1`. PreFlow (trace, spike arrest, token, scope, quota), flows `GetPetById` and `NotFound`, `DefaultFaultRule` with `AlwaysEnforce=true` → error handler. |
| `targets/default.xml` | Backend `https://petstore.swagger.io/v2`, TLS enforced, timeouts 3 s connect / 10 s read. PostFlow maps and wraps the response. Has its own `DefaultFaultRule` because backend errors and timeouts are raised in the target endpoint. |
| `policies/FC-InitTrace.xml` | Calls shared flow with `envelope.action=init`. |
| `policies/FC-BuildSuccess.xml` | Calls shared flow with `envelope.action=success`. |
| `policies/FC-BuildError.xml` | Calls shared flow with `envelope.action=error`. |
| `policies/SA-SpikeArrest.xml` | `10ps` with `UseEffectiveCount=true`: a sliding one-second window. Without `UseEffectiveCount`, Apigee smooths `10ps` to one request per 100 ms, which rejected normal back-to-back calls. |
| `policies/KVM-GetSigningKey.xml` | Reads `jwt-signing-key` from environment KVM `oauth-config` into `private.secretkey` (the `private.` prefix hides it from Debug/Trace). Cached 300 s. |
| `policies/VJ-VerifyToken.xml` | VerifyJWT, HS256. Reads `Authorization: Bearer <token>`, checks signature, expiry (30 s clock tolerance) and issuer. |
| `policies/RF-InsufficientScope.xml` | 403 when the token's `scope` claim does not contain `pet:read`. |
| `policies/Q-PetQuota.xml` | 100 calls / minute, counted per `client_id` claim of the token. |
| `policies/EV-ExtractPetId.xml` | Extracts `petId` from `/pets/{petId}`. |
| `policies/RF-InvalidPetId.xml` | 400 when `petId` is not 1–19 digits. |
| `policies/RF-NotFound.xml` | 404 for unknown paths or methods. |
| `policies/AM-PetstoreRequest.xml` | Builds the backend request: sets `target.url` to `/v2/pet/{petId}`, removes the client's `Authorization` and query parameters (so they never reach the backend), adds `api_key: special-key` (Petstore demo key) and `Accept: application/json`. |
| `policies/EV-ExtractPet.xml` | Reads `$.id` from the Petstore response as text into `pet.id`. |
| `policies/JS-MapPet.xml` | JavaScript policy → `map-pet.js`. |
| `resources/jsc/map-pet.js` | **Mapping.** Petstore returns a large object (category, photoUrls, tags, …); only `id`, `name`, `status` are kept and stored in `envelope.data` as JSON text. Missing `name`/`status` become `null`. |

### 4.3 Changes to `oauth2-token`

| Change | Why |
|--------|-----|
| `AM-SetSecretKey.xml` removed, replaced by `KVM-GetSigningKey.xml` | The signing key was hard-coded in Git; anyone with repo access could sign valid tokens. It now lives in the encrypted KVM, and both proxies read the same value. |
| Scope check accepts `kpi:read` **or** `pet:read` | The pet API needs its own scope. |
| `GJ-GenerateJWT.xml`: `scope` claim = requested scope; new `client_id` claim | `petstore-v1` checks the scope and counts the quota per client. |
| `RF-InvalidScope.xml` message | Lists both allowed scopes. |

Issuer (`https://34.102.206.98.nip.io`) is unchanged; `VJ-VerifyToken` checks the same value. If the issuer is changed, change it in both files.

### 4.4 Environment and test data

| File | Change |
|------|--------|
| `src/main/apigee/environments/dev/deployments.json` | Added proxy `petstore-v1` and shared flow `common-envelope`. |
| `src/tests/oauth-test/maps.json` | KVM `oauth-config` with a **local-only** signing key for the emulator. Not used in the cloud. |

---

## 5. Error handling (global exception handler)

`build-error.js` decides the code in this order:

1. **Proxy-defined:** `envelope.errorCode` / `envelope.errorMessage` set by a RaiseFault (400 invalid petId, 403 scope, 404 path).
2. **Fault type:** SpikeArrest or Quota violation → 429; gateway/connection timeout → 504.
3. **Backend error** (`ErrorResponseCode`): backend 400 / 404 pass through; any other backend error → 500 (backend auth problems are not exposed as client 401/403).
4. **Policy default status** (e.g. VerifyJWT → 401).
5. **Anything else** → 500.

Only the codes below are ever returned:

| Code | When | Message (default) | Extra header |
|------|------|-------------------|--------------|
| 400 | Invalid `petId`; backend 400 | Invalid path parameter 'petId'. It must be a positive integer (int64). | |
| 401 | Missing, invalid, expired token | Invalid or missing access token in 'Authorization' header. | |
| 403 | Token without `pet:read` | Access denied. The access token does not have the 'pet:read' scope. | |
| 404 | Unknown path; pet does not exist | The requested resource was not found. | |
| 429 | SpikeArrest or Quota exceeded | Rate limit has been exceeded. Please retry after the duration specified in Retry-After. | `Retry-After: 1` (spike) / `60` (quota) |
| 500 | Unexpected error; backend 5xx | An unexpected error occurred. Quote the traceId when contacting support. | |
| 504 | Backend did not answer in time | Request timed out. The service is temporarily unavailable. | |

**Why `DefaultFaultRule` + `AlwaysEnforce`:** the DefaultFaultRule runs for every fault that no specific FaultRule handles, and `AlwaysEnforce` makes it run even if a specific FaultRule was added later. Combined with the shared flow, this behaves like a global exception handler (`@ControllerAdvice` in Spring).

**Adding a new error code:** add it to `MESSAGES` in `build-error.js` (and a rule if it needs detection), redeploy the shared flow. All proxies get it.

**Using it in another proxy:** copy the three `FC-*.xml` policies, add `FC-InitTrace` as the first PreFlow step, and add the `DefaultFaultRule` to the proxy and target endpoints.

---

## 6. Local emulator vs Apigee X

| Feature | Local emulator | Note |
|---------|:--------------:|------|
| Envelope, mapping (JavaScript, shared flow, FlowCallout) | ✅ | |
| Fault rules / global error handler | ✅ | |
| SpikeArrest, Quota → 429 | ✅ | Counters are local to the container; numbers are approximate. |
| GenerateJWT / VerifyJWT | ✅ | |
| KVM | ✅ | Data comes from the test bundle `maps.json`. |
| Calls to petstore.swagger.io, timeouts → 504 | ✅ | Needs internet from Docker. |
| VerifyAPIKey (client credentials) | ⚠️ | Uses test-bundle developers/apps; keys change on every test-bundle deploy. |
| Analytics, distributed quota across instances, real KVM | ❌ | Cloud only. |

---

## 7. How to test

### 7.1 Local emulator
1. Start Docker Desktop; in VS Code → Cloud Code → Apigee: deploy environment `dev` and the test bundle `oauth-test`. Deploy the test bundle again after every environment deploy, otherwise the KVM and the app are missing.
2. Get the client ID and secret of `petSore_app`:
   ```powershell
   curl.exe -s http://localhost:8080/v1/emulator/test/developerapps
   ```
   Use `consumerKey` as `client_id` and `consumerSecret` as `client_secret`.
3. Get a token:
   ```powershell
   curl.exe -s -X POST http://localhost:8998/oauth2/token -d "grant_type=client_credentials" -d "client_id=<KEY>" -d "client_secret=<SECRET>" -d "scope=pet:read"
   ```
4. Call the pet API (use an ID that exists in Petstore, e.g. from `findByStatus?status=available`):
   ```powershell
   curl.exe -i http://localhost:8998/petstore/v1/pets/<petId> -H "Authorization: Bearer <access_token>"
   ```

### 7.2 Test cases

| # | Request | Expected |
|---|---------|----------|
| 1 | Valid token, existing pet | 200, `{header, data:{id,name,status}}` |
| 2 | Valid token, non-existing pet | 404 envelope |
| 3 | `petId = abc` | 400 envelope |
| 4 | No `Authorization` header | 401 envelope |
| 5 | Token with `scope=kpi:read` | 403 envelope |
| 6 | Unknown path, e.g. `/petstore/v1/owners` | 404 envelope |
| 7 | ~20 parallel requests | some 429 with `Retry-After: 1` |
| 8 | `X-Request-Id: my-test-id-123` sent | same value in `traceId` and response header |

---

## 8. Deploying to Apigee X (cloud)

1. **Create the KVM** (once per environment, before deploying):
   - Console: **Apigee → Management → Environments → `eval` → Key Value Maps → Create**, name `oauth-config`.
   - Add entry `jwt-signing-key` with a long random value (32+ characters). If the console does not offer entry editing, use the API:
     ```powershell
     curl.exe -X POST "https://apigee.googleapis.com/v1/organizations/project-953dc129-1db1-4aea-ae3/environments/eval/keyvaluemaps/oauth-config/entries" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" -d '{\"name\":\"jwt-signing-key\",\"value\":\"<random-secret>\"}'
     ```
   - Repeat for `stagin` when promoting.
2. **Deploy the shared flow first** (`common-envelope`), then `oauth2-token`, then `petstore-v1`. A proxy cannot deploy if the shared flow it calls is missing.
3. **Developer app:** the client app's API product must include the `oauth2-token` proxy.
4. **CI/CD:** the current Cloud Build pipeline builds and deploys only `helloworld`. The new proxy and shared flow need their own build steps (one Maven module / deploy step per bundle, shared flow before proxies).

---

## 9. Known limitations / next steps

- Not yet deployed or tested on Apigee X.
- 500 (backend 5xx) and 504 (timeout) are implemented but not tested: Petstore cannot be made to fail or hang on demand. A mock target (e.g. `https://httpbin.org/status/503`, `/delay/15`) can be used to test them.
- On the emulator, a burst of 25 parallel calls let only 1 through (expected up to 10); the emulator's SpikeArrest is an approximation. Re-check on Apigee X.
- `Retry-After` for quota is a fixed 60 s, not the exact time until the quota window resets.
- Issuer/audience still use the old `34.102.206.98.nip.io` host; align with the real hostname when convenient (both proxies).
- The old signing key `MySuperSecretPoCKey123!` is still in Git history; use a new value in the KVM.
- Optional: an **OASValidation** policy can validate requests against the OpenAPI spec and return 400 automatically.

---

## 10. Test results (local emulator)

Emulator `apigee-emulator:1.9.2`, environment `dev`, test bundle `oauth-test`. Each case checks the status code, the `header.timestamp` format, `header.traceId`, `header.isSuccess`, the `error` object, and that the `X-Request-Id` response header equals `traceId`.

| # | Case | Result |
|---|------|--------|
| 1 | Valid token, existing pet (id `9223372000001084117`) | ✅ 200, `data` has exactly `id`, `name`, `status`; id exact |
| 2 | Non-existing pet (`1234567`) | ✅ 404 envelope |
| 3 | `petId = abc` | ✅ 400 envelope, custom message |
| 4a | No `Authorization` header | ✅ 401 envelope |
| 4b | Malformed token | ✅ 401 envelope |
| 5 | Token with `kpi:read` only | ✅ 403 envelope, custom message |
| 6 | Unknown path `/petstore/v1/owners` | ✅ 404 envelope |
| 7 | 25 parallel requests | ✅ 429 envelope, `Retry-After: 1` |
| 8 | `X-Request-Id: my-test-id-123` sent | ✅ reused as `traceId` and response header |
| 9 | 105 requests in one minute (spaced under the spike limit) | ✅ 100 allowed, then 429 envelope, `Retry-After: 60` |
| – | Backend 5xx → 500, timeout → 504 | ⏳ not tested (section 9) |

### 10.1 Issues found during testing and how they were fixed

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | The error handler ran (visible in Trace) but the client got Apigee's default `{"fault": …}` body | In the error flow Apigee sends the **`error`** message, not `response`; writing `response.content` had no effect. | `writeEnvelope` writes to `error.*` in the error flow and `response.*` in the normal flow. |
| 2 | Errors became 500, Trace showed `For input string: "400.0"` | A JavaScript number passed to `context.setVariable("error.status.code", …)` arrives as `400.0`. | Pass the status as a string: `String(statusCode)`. |
| 3 | Custom messages (403 scope, 400 petId) were replaced by the defaults | `AssignVariable` placed directly under `<RaiseFault>` was not executed. | Moved `AssignVariable` inside `<FaultResponse>`. |
| 4 | Valid Petstore IDs returned 400 | Petstore IDs are int64 (19 digits); the check allowed 18. | Regex `[0-9]{1,19}`. |
| 5 | Large IDs would be rounded | `JSON.parse` stores numbers as doubles (exact only up to 2^53). | `EV-ExtractPet` reads `$.id` as text; the envelope is built as text without re-parsing. |
| 6 | Normal back-to-back calls got 429 | `10ps` is smoothed to 1 call per 100 ms. | `UseEffectiveCount=true` (sliding window). |
| 7 | `X-Request-Id` response header was empty | The runtime copies the request's `X-Request-Id` onto the response, overwriting the value set by the proxy. | `init-trace.js` also writes the trace ID into the request header, so both are the same. |

### 10.2 Debugging tip

Most of these were found with the emulator's Trace (Cloud Code → Apigee → emulator → Trace): it shows each policy, the variables it read and set, and JavaScript errors with line numbers. When a response looks wrong, trace one request before changing code.
