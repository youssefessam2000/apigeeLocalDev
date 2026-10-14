# Apigee CI/CD POC — Implementation Document

**Project:** myapigeeworkspace  
**Repository:** https://github.com/youssefessam2000/apigeeLocalDev  
**Author:** Youssef  
**Date:** October 2026  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tools & Prerequisites](#2-tools--prerequisites)
3. [Project Structure](#3-project-structure)
4. [Day 1 — Local Proxy Development](#4-day-1--local-proxy-development)
5. [Day 2 — Quality Gates & Packaging](#5-day-2--quality-gates--packaging)
6. [Git History](#6-git-history)
7. [Day 1 & Day 2 Task Completion Summary](#7-day-1--day-2-task-completion-summary)
8. [Issues & Solutions](#8-issues--solutions)

---

## 1. Project Overview

A simple Apigee X proxy (`helloworld`) built as a CI/CD proof-of-concept. The proxy:

- Exposes a `GET /helloworld` endpoint
- Requires an **API key** for authentication
- Enforces a **quota** based on the API product configuration
- Calls a **mock XML target** and transforms the response to **JSON**
- Is tested locally using the **Apigee Emulator** (Docker-based)
- Is linted with **apigeelint** and tested via **Newman** (Postman CLI runner)
- Is packaged and deployable via the **Apigee Deploy Maven Plugin v2.x**

---

## 2. Tools & Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| VS Code + Cloud Code extension | Latest | Apigee workspace & emulator management |
| Docker | Latest | Runs the Apigee Emulator container |
| Node.js | v18+ | Runs apigeelint and Newman |
| apigeelint | 2.85.1 | Static analysis for Apigee proxy bundles |
| Newman | 6.2.3 | CLI runner for Postman collections |
| Java | 11+ | Maven build |
| Maven | 3.6+ | Proxy packaging & deployment |
| gcloud CLI | Latest | Authentication for Apigee X deployments |
| Git | Latest | Source control |
| Postman | Latest | API test collection authoring |

---

## 3. Project Structure

```
myapigeeworkspace/
├── src/
│   ├── main/apigee/
│   │   ├── apiproxies/
│   │   │   └── helloworld/
│   │   │       └── apiproxy/
│   │   │           ├── policies/
│   │   │           │   ├── verify-api-key.xml       # API key validation
│   │   │           │   ├── AM-RemoveApiKeyParam.xml  # Strip key from upstream
│   │   │           │   ├── Q-ImposeQuota.xml         # Quota enforcement
│   │   │           │   └── XMLtoJSON.xml             # Response transformation
│   │   │           ├── proxies/
│   │   │           │   └── default.xml               # Proxy endpoint definition
│   │   │           └── targets/
│   │   │               └── default.xml               # Target endpoint (mock)
│   │   └── environments/
│   │       └── dev/
│   │           ├── deployments.json                  # Proxy deployment config
│   │           ├── targetservers.json                # Target server definitions
│   │           ├── keystores.json                    # TLS keystores
│   │           ├── flowhooks.json                    # Shared flow hooks
│   │           └── debugmask.json                    # Debug session masking
│   └── tests/
│       └── mytestbundle/
│           ├── products.json                         # API product definition
│           ├── developers.json                       # Developer definition
│           ├── developerapps.json                    # Developer app + API key
│           └── maps.json                             # KVM entries (empty)
├── tests/
│   └── postman/
│       ├── hello.postman_collection.json             # Functional test collection
│       └── env/
│           └── local.postman_environment.json        # Local emulator environment
├── reports/                                          # Generated reports (git-ignored)
├── target/                                           # Maven build output (git-ignored)
├── pom.xml                                           # Maven build & deployment config
├── package.json                                      # Node.js scripts & dependencies
├── .gitignore                                        # Ignore rules
├── README.md                                         # Setup & usage guide
└── IMPLEMENTATION.md                                 # This document
```

---

## 4. Day 1 — Local Proxy Development

### 4.1 Proxy Endpoint — `proxies/default.xml`

Defines the base path, PreFlow policy chain, and route rule.

```xml
<ProxyEndpoint name="default">
  <PreFlow name="PreFlow">
    <Request>
      <Step><Name>verify-api-key</Name></Step>
      <Step><Name>AM-RemoveApiKeyParam</Name></Step>
      <Step><Name>Q-ImposeQuota</Name></Step>
    </Request>
    <Response>
      <Step><Name>XMLtoJSON</Name></Step>
    </Response>
  </PreFlow>
  <HTTPProxyConnection>
    <BasePath>/helloworld</BasePath>
  </HTTPProxyConnection>
  <RouteRule name="default-route">
    <TargetEndpoint>default</TargetEndpoint>
  </RouteRule>
</ProxyEndpoint>
```

**Flow:**
1. Request arrives at `/helloworld?apikey=<key>`
2. API key is verified against the product
3. API key query param is stripped before forwarding to target
4. Quota is checked and decremented
5. Target responds with XML → transformed to JSON on the way back

---

### 4.2 Target Endpoint — `targets/default.xml`

Uses the Apigee mock target which returns a static XML response.

```xml
<TargetEndpoint name="default">
  <HTTPTargetConnection>
    <SSLInfo>
      <Enabled>true</Enabled>
      <Enforce>true</Enforce>
    </SSLInfo>
    <URL>https://mocktarget.apigee.net/xml</URL>
  </HTTPTargetConnection>
</TargetEndpoint>
```

---

### 4.3 Policies

#### verify-api-key.xml
Validates the `apikey` query parameter against registered API products.

```xml
<VerifyAPIKey async="false" continueOnError="false" enabled="true" name="verify-api-key">
    <DisplayName>verify-api-key</DisplayName>
    <APIKey ref="request.queryparam.apikey"/>
</VerifyAPIKey>
```

#### AM-RemoveApiKeyParam.xml
Removes the `apikey` query param before forwarding to the backend target.

```xml
<AssignMessage async="false" continueOnError="false" enabled="true" name="AM-RemoveApiKeyParam">
    <DisplayName>AM-RemoveApiKeyParam</DisplayName>
    <Remove>
        <QueryParams>
            <QueryParam name="apikey"/>
        </QueryParams>
    </Remove>
    <IgnoreUnresolvedVariables>true</IgnoreUnresolvedVariables>
</AssignMessage>
```

#### Q-ImposeQuota.xml
Enforces the quota configured on the API product (100 req/min).

```xml
<Quota async="false" continueOnError="false" enabled="true" name="Q-ImposeQuota">
    <DisplayName>Q-ImposeQuota</DisplayName>
    <Allow countRef="verifyapikey.verify-api-key.apiproduct.developer.quota.limit" count="2000"/>
    <Interval ref="verifyapikey.verify-api-key.apiproduct.developer.quota.interval">1</Interval>
    <Distributed>true</Distributed>
    <Synchronous>true</Synchronous>
    <TimeUnit ref="verifyapikey.verify-api-key.apiproduct.developer.quota.timeunit">month</TimeUnit>
</Quota>
```

#### XMLtoJSON.xml
Transforms the XML response from the mock target into JSON.

```xml
<XMLToJSON async="false" continueOnError="false" enabled="true" name="XMLtoJSON">
    <DisplayName>XMLtoJSON</DisplayName>
    <Properties/>
    <Format>yahoo</Format>
    <OutputVariable>response</OutputVariable>
    <Source>response</Source>
</XMLToJSON>
```

---

### 4.4 Test Bundle — `src/tests/mytestbundle/`

The test bundle provisions the local emulator with all required resources to generate an API key.

#### products.json
```json
[
  {
    "name": "myproduct",
    "displayName": "my first product",
    "proxies": ["helloworld"],
    "apiResources": ["/", "/*", "/**"],
    "quota": "100",
    "quotaInterval": "1",
    "quotaTimeUnit": "minute",
    "scopes": [],
    "environments": []
  }
]
```

#### developers.json
```json
[
  {
    "email": "ahamilton@example.com",
    "userName": "ahamilton",
    "firstName": "Alex",
    "lastName": "Hamilton"
  }
]
```

#### developerapps.json
```json
[
  {
    "name": "myapp",
    "displayName": "myapp",
    "developerEmail": "ahamilton@example.com",
    "apiProducts": ["myproduct"],
    "callbackUrl": "",
    "expiryType": "never"
  }
]
```

---

### 4.5 Test Cases

#### Happy Path — Valid API key

```bash
curl "http://localhost:8998/helloworld?apikey=<YOUR_API_KEY>"
```

**Expected:** `200 OK` with JSON body

#### Negative Test 1 — Missing API key

```bash
curl -i "http://localhost:8998/helloworld"
```

**Expected:** `401 Unauthorized`
```json
{
  "fault": {
    "faultstring": "Failed to resolve API Key variable request.queryparam.apikey",
    "detail": { "errorcode": "steps.oauth.v2.FailedToResolveAPIKey" }
  }
}
```

#### Negative Test 2 — Invalid API key

```bash
curl -i "http://localhost:8998/helloworld?apikey=invalid-key-123"
```

**Expected:** `401 Unauthorized`
```json
{
  "fault": {
    "faultstring": "Invalid ApiKey for given resource",
    "detail": { "errorcode": "oauth.v2.InvalidApiKey" }
  }
}
```

---

### 4.6 Git Setup

#### .gitignore
```
# Dependencies
node_modules/

# Generated output
reports/
target/

# Secrets & local config
.env
*.key
*.pem
*-credentials.json
*service-account*.json

# OS / editor
.DS_Store
Thumbs.db
```

---

## 5. Day 2 — Quality Gates & Packaging

### 5.1 Node.js Configuration — `package.json`

```json
{
  "name": "myapigeeworkspace",
  "version": "1.0.0",
  "description": "Apigee hello-world proxy with CI/CD quality gates",
  "scripts": {
    "lint": "apigeelint -s src/main/apigee/apiproxies/helloworld/apiproxy --profile apigeex -e TD002,TD007 -f table.js",
    "prelint:report": "node -e \"require('fs').mkdirSync('reports',{recursive:true})\"",
    "lint:report": "apigeelint -s src/main/apigee/apiproxies/helloworld/apiproxy --profile apigeex -e TD002,TD007 -f json.js > reports/apigeelint-baseline.json",
    "test:api:local": "newman run tests/postman/hello.postman_collection.json -e tests/postman/env/local.postman_environment.json -r cli,junit --reporter-junit-export reports/newman-local.xml",
    "test": "npm run lint && npm run test:api:local"
  },
  "devDependencies": {
    "apigeelint": "2.85.1",
    "newman": "6.2.3"
  }
}
```

**Scripts:**

| Command | Description |
|---------|-------------|
| `npm run lint` | Run apigeelint on the proxy bundle (table output) |
| `npm run lint:report` | Generate JSON lint report → `reports/apigeelint-baseline.json` |
| `npm run test:api:local` | Run Newman against local emulator → `reports/newman-local.xml` |
| `npm test` | Run lint + functional tests (full quality gate) |

---

### 5.2 Static Analysis — apigeelint

- **Profile:** `apigeex` (Apigee X rules)
- **Suppressed rules:** `TD002`, `TD007` (emulator limitations — these rules flag behaviors that differ in local emulator vs production)
- **Result:** 0 errors, 0 warnings across all 7 files
- **Baseline report:** `reports/apigeelint-baseline.json`

---

### 5.3 Postman Test Collection — `tests/postman/hello.postman_collection.json`

Three test cases covering the full happy path and both negative scenarios:

| Test | Method | URL | Assertions |
|------|--------|-----|------------|
| Happy path — valid API key returns 200 | GET | `{{baseUrl}}/helloworld?apikey={{apikey}}` | Status 200, Content-Type includes `application/json`, body is object |
| Negative — missing API key returns 401 | GET | `{{baseUrl}}/helloworld` | Status 401, body has `fault.faultstring` |
| Negative — invalid API key returns 401 | GET | `{{baseUrl}}/helloworld?apikey=invalid-key-000` | Status 401, body has `fault.faultstring`, errorcode includes `ApiKey` |

#### Environment file — `tests/postman/env/local.postman_environment.json`

| Variable | Value | Notes |
|----------|-------|-------|
| `baseUrl` | `http://localhost:8998` | Apigee Emulator default port |
| `apikey` | `REPLACE_WITH_EMULATOR_API_KEY` | Copy from emulator UI after deploying test bundle |

---

### 5.4 Quality Gates

| Gate | Tool | Threshold | Result |
|------|------|-----------|--------|
| Static analysis | apigeelint | Zero errors (exit 0) | ✅ Passing |
| Functional tests | Newman | All 8 assertions pass (exit 0) | ✅ Ready (requires API key) |
| JS unit tests | N/A | Not applicable | ✅ No JS resources in proxy |

**Rule:** Any gate failure exits non-zero and stops the pipeline.

---

### 5.5 Maven Packaging — `pom.xml`

Uses the **Apigee Deploy Maven Plugin v2.5.2** (`io.apigee.build-tools.enterprise4g:apigee-edge-maven-plugin`) for Apigee X/hybrid.

```xml
<groupId>com.example.apigee</groupId>
<artifactId>helloworld</artifactId>
<version>1.0.0</version>
<name>helloworld</name>  <!-- used by the plugin as the proxy name -->
```

| Phase | Step | Output |
|-------|------|--------|
| `package` | `maven-resources-plugin` copies `src/main/apigee/apiproxies/helloworld/apiproxy` to `target/apiproxy` | `target/apiproxy/` |
| `package` | `apigee-enterprise:configure` zips the bundle | `target/helloworld-1.0.0.zip` |
| `install` | `apigee-enterprise:deploy` imports and deploys the bundle | New proxy revision in Apigee |

> **Fix (Day 2 verification):** the first version of `pom.xml` referenced `com.apigee.edge:apigee-deploy-maven-plugin:2.4.4`, which does not exist on Maven Central, and had no `configure` step, so `mvn package` produced nothing. It was corrected to the official plugin coordinates and the setup from the plugin's sample project.

#### Verification

```powershell
$env:APIGEE_ORG="test-org"; $env:APIGEE_ENV="eval"; $env:APIGEE_TOKEN="dummy"
mvn package -P nonprod     # BUILD SUCCESS, target/helloworld-1.0.0.zip with 6 files under apiproxy/
mvn install -P nonprod     # 401 Unauthorized from apigee.googleapis.com (expected with a dummy token)
```

Do not run `mvn clean`: it deletes `target/`, which also holds emulator test data.

#### Maven Profiles

| Profile | Target | Host URL |
|---------|--------|----------|
| `dev` | Local Apigee Emulator | `http://localhost:8998` |
| `nonprod` | Apigee X non-production | `https://apigee.googleapis.com` |

#### Deploy to non-production

```powershell
$env:APIGEE_ORG="your-org-name"
$env:APIGEE_ENV="your-env"
$env:APIGEE_TOKEN=(gcloud auth print-access-token)

mvn install -P nonprod
```

**Security:** Credentials are passed via environment variables — never committed to Git.

---

### 5.6 Environment Configuration — `src/main/apigee/environments/dev/`

| File | Purpose | Status |
|------|---------|--------|
| `deployments.json` | Lists `helloworld` proxy as deployed | Configured |
| `targetservers.json` | Target server definitions | Empty (mock target used) |
| `keystores.json` | TLS keystore config | Empty (not required for POC) |
| `flowhooks.json` | Shared flow hook bindings | Empty |
| `debugmask.json` | Debug session data masking | Empty |

---

## 6. Git History

| Commit | Message |
|--------|---------|
| `d785e59` | feat(tests): fetch emulator API key automatically for Newman runs |
| `e9963a6` | docs: add IMPLEMENTATION.md covering Day 1 and Day 2 full implementation details |
| `f6cc23e` | feat(day2): add Postman collection, Newman tests, Maven pom, and quality gate docs |
| `f43efcc` | docs: add README with local setup, endpoint behavior, test cases, and known limitations |
| `cd00baa` | fix: resolve apigeelint findings; document TD002/TD007 exceptions |
| `eb9a812` | chore: add lint and test npm scripts |
| `61ecc4a` | chore: add gitignore |
| `5f660b6` | chore: pin apigeelint and newman, add lint/test scripts |
| `e49e84b` | Update developer and app IDs in test data JSON files |
| `f373640` | Initial commit |

---

## 7. Day 1 & Day 2 Task Completion Summary

### Day 1 — Local Proxy Development

| # | Task | Status | Evidence |
|---|------|--------|---------|
| 1 | Scope and prerequisites | ✅ Complete | helloworld API defined, tools installed and confirmed |
| 2 | Create local workspace | ✅ Complete | Apigee workspace created in VS Code with full proxy folder structure |
| 3 | Build the proxy | ✅ Complete | Proxy with API key, quota, XMLtoJSON, mock target |
| 4 | Run locally | ✅ Complete | Deployed to Apigee Emulator, 200 response verified |
| 5 | Add a negative test | ✅ Complete | 401 on missing/invalid API key — documented with curl examples |
| 6 | Initialize Git repository | ✅ Complete | Repo pushed to GitHub with `.gitignore` and meaningful commits |
| 7 | Add repository documentation | ✅ Complete | `README.md` with setup, curl tests, emulator steps, known limitations |
| 8 | Day 1 checkpoint | ✅ Complete | Working proxy + full committed baseline |

### Day 2 — Quality Gates & Packaging

| # | Task | Status | Evidence |
|---|------|--------|---------|
| 1 | Set up static analysis | ✅ Complete | apigeelint 2.85.1 installed, `npm run lint` working |
| 2 | Fix lint findings | ✅ Complete | 0 errors, 0 warnings; TD002/TD007 documented exceptions |
| 3 | Create automated API tests | ✅ Complete | `tests/postman/hello.postman_collection.json` — 3 tests, 8 assertions |
| 4 | Run tests from command line | ✅ Complete | `npm run test:api:local` via Newman, JUnit XML report output |
| 5 | JS unit tests | ✅ N/A | No JavaScript resources in this proxy |
| 6 | Define quality gates | ✅ Complete | Thresholds documented in README and this document |
| 7 | Package the proxy | ✅ Complete | `mvn package -P nonprod` builds `target/helloworld-1.0.0.zip` (plugin v2.5.2) |
| 8 | Validate deployment config | ✅ Complete | `dev` and `nonprod` profiles resolve; `mvn install` reaches the Apigee API (401 with dummy token); secrets via env vars |

---

## 8. Issues & Solutions

Problems found while building and verifying Day 1 and Day 2, and how each was resolved.

### 8.1 apigeelint findings on the proxy (Day 2, `cd00baa`)

**Issue:** The first lint run reported findings in the proxy bundle:
- Policy names (`remove-query-param-apikey`, `impose-quota`) did not follow the type-prefix naming convention.
- Display names did not match the policy names.
- The base path was `helloworld` without a leading `/`.
- The target endpoint called an HTTPS URL without an `SSLInfo` block.
- `AM-RemoveApiKeyParam` had an unnecessary `AssignTo` element.

**Solution:**
- Renamed the policies to `AM-RemoveApiKeyParam` and `Q-ImposeQuota`, updated their flow steps, and aligned all display names.
- Changed the base path to `/helloworld`.
- Added `SSLInfo` (`Enabled` and `Enforce` set to `true`) to the target.
- Removed the `AssignTo` element.
- Rules `TD002` and `TD007` were excluded as justified exceptions (see 5.2). Result: 0 errors, 0 warnings.

### 8.2 Emulator API key changes on every test-bundle deploy (Day 2, `d785e59`)

**Issue:** The emulator generates a new developer app key each time `mytestbundle` is deployed. The key stored in the Postman environment file went stale, and the Newman tests failed with 401.

**Solution:** Added `tests/postman/run-local.js`. It reads the current key for app `myapp` from the emulator control API (`http://localhost:8080/v1/emulator/test/developerapps`) and passes it to Newman, so no key is stored in Git. A key can still be supplied manually with `--env-var "apikey=..."`.

### 8.3 Maven plugin did not exist; packaging produced nothing (Day 2, `9c7f3d1`)

**Issue:** `pom.xml` referenced `com.apigee.edge:apigee-deploy-maven-plugin:2.4.4`, which is not on Maven Central. It also had no `configure` goal, so `mvn package` reported `BUILD SUCCESS` without building a bundle, and `mvn install` would have failed.

**Solution:**
- Switched to the official `io.apigee.build-tools.enterprise4g:apigee-edge-maven-plugin:2.5.2`.
- Added `maven-resources-plugin` to copy the proxy into `target/apiproxy`, bound `configure` to `package` and `deploy` to `install`, following the plugin's sample project (see 5.5).
- Verified: `mvn package -P nonprod` builds `target/helloworld-1.0.0.zip`, and `mvn install -P nonprod` reaches `apigee.googleapis.com` (401 with a dummy token, as expected).

### 8.4 Proxy name would have been "helloworld Apigee Proxy" (Day 2, `9c7f3d1`)

**Issue:** The plugin uses the pom's `<name>` as the proxy name in the Apigee org. The original value was `helloworld Apigee Proxy`.

**Solution:** Set `<name>helloworld</name>`.

### 8.5 Maven could not run: no JDK installed (Day 2)

**Issue:** After `choco install maven`, `mvn` failed with `The JAVA_HOME environment variable is not defined correctly`. Maven and the Apigee plugin are Java programs, and no JDK was installed.

**Solution:** Installed Eclipse Temurin 17 (`choco install temurin17 -y`), which sets `JAVA_HOME` and `PATH`. A new terminal (or `refreshenv`) is needed for the change to take effect.

### 8.6 `dev` Maven profile cannot deploy to the emulator (Day 2)

**Issue:** The emulator does not expose the Apigee management API, so `mvn install -P dev` cannot deploy to it.

**Solution:** The `dev` profile is used for packaging only (`mvn package -P dev`). The proxy is deployed to the emulator with Cloud Code.

### 8.7 Git merge blocked by a file open in WPS Office (Day 2)

**Issue:** `git merge` failed with `unable to unlink 'Apigee_CICD_POC.csv': Invalid argument` because the file was open in WPS Office, which locks it on Windows.

**Solution:** Closed the file, then merged and pushed. Close files that Git needs to update before switching branches or merging.

### 8.8 Generated `target/` files still tracked by Git (Day 2)

**Issue:** `target/` is listed in `.gitignore`, but `target/emulator/testdata/` was committed before the rule was added (`f373640`, `e49e84b`). Every test-bundle deploy regenerates developer/app IDs and emulator API keys there, so these files keep showing up as modified, and old emulator keys are in Git history. `mvn clean` would also delete them.

**Solution:** Stopped tracking the folder with `git rm -r --cached target`. The files stay on disk and the `.gitignore` rule now applies, so regenerated emulator data no longer shows as changes. Emulator keys are local-only, so the keys already in history are low risk. `mvn clean` still deletes the emulator test data on disk; redeploy the test bundle from Cloud Code if that happens.

---

**Next:** Day 3 — CI Pipeline (GitHub Actions), automated deployment to non-production, end-to-end pipeline run.
