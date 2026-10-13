# myapigeeworkspace — Apigee Hello World Proxy (CI/CD POC)

A simple Apigee X proxy (`helloworld`) secured with an API key, with quota enforcement and XML-to-JSON response transformation. Built as a CI/CD proof-of-concept using the Apigee local emulator.

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [VS Code](https://code.visualstudio.com/) + [Cloud Code extension](https://cloud.google.com/code/docs/vscode) | Apigee workspace and emulator management |
| [Docker](https://www.docker.com/) | Runs the Apigee Emulator container |
| [Node.js](https://nodejs.org/) (v18+) | Runs apigeelint and Newman |
| [Newman](https://www.npmjs.com/package/newman) | CLI runner for Postman collections |
| [apigeelint](https://github.com/apigee/apigeelint) | Static analysis for Apigee proxy bundles |

Install Node.js dependencies:

```bash
npm install
```

---

## Proxy Overview

| Property | Value |
|----------|-------|
| Base path | `/helloworld` |
| Method | `GET` |
| Auth | API key via `?apikey=<key>` query param |
| Target | `https://mocktarget.apigee.net/xml` (mock) |
| Response | JSON (XML target response transformed by XMLtoJSON policy) |
| Quota | 100 requests/minute per API product |

### Policies applied (PreFlow)
1. **verify-api-key** — validates `?apikey` query param
2. **AM-RemoveApiKeyParam** — strips the API key from the upstream request
3. **Q-ImposeQuota** — enforces quota defined on the API product
4. **XMLtoJSON** (Response) — converts the mock XML response to JSON

---

## Local Development with Apigee Emulator

### 1. Start the emulator

Open VS Code → Cloud Code extension → **Apigee Emulator** → Start (requires Docker running).

### 2. Create the test bundle (product, developer, app, API key)

The test bundle is located in `src/tests/mytestbundle/`. Deploy it via Cloud Code or the Apigee Emulator UI to provision:
- **Product:** `myproduct` (quota: 100 req/min, proxy: `helloworld`)
- **Developer:** `ahamilton@example.com`
- **App:** `myapp` → generates an API key

Copy the generated API key from the emulator UI.

### 3. Deploy the proxy

In VS Code → Cloud Code → Apigee Workspace → right-click `helloworld` → **Deploy to Emulator**.

### 4. Call the API

**Happy path (valid API key):**
```bash
curl "http://localhost:8998/helloworld?apikey=<YOUR_API_KEY>"
```

Expected response: `200 OK` with a JSON body.

**Negative test — missing API key:**
```bash
curl -i "http://localhost:8998/helloworld"
```

Expected response: `401 Unauthorized`
```json
{"fault":{"faultstring":"Failed to resolve API Key variable request.queryparam.apikey","detail":{"errorcode":"steps.oauth.v2.FailedToResolveAPIKey"}}}
```

**Negative test — invalid API key:**
```bash
curl -i "http://localhost:8998/helloworld?apikey=invalid-key-123"
```

Expected response: `401 Unauthorized`
```json
{"fault":{"faultstring":"Invalid ApiKey for given resource","detail":{"errorcode":"oauth.v2.InvalidApiKey"}}}
```

---

## Quality Gates

### Lint the proxy

```bash
npm run lint
```

Runs `apigeelint` against the proxy bundle using the `apigeex` profile. Rules `TD002` and `TD007` are suppressed (emulator limitations).

### Generate lint report

```bash
npm run lint:report
```

Output: `reports/apigeelint-baseline.json`

---

## Project Structure

```
myapigeeworkspace/
├── src/
│   ├── main/apigee/
│   │   ├── apiproxies/helloworld/apiproxy/
│   │   │   ├── policies/          # Apigee policies (XML)
│   │   │   ├── proxies/           # Proxy endpoint config
│   │   │   └── targets/           # Target endpoint config
│   │   └── environments/dev/      # Environment-level config
│   └── tests/mytestbundle/        # Local test data (product, developer, app)
├── reports/                       # Generated lint/test reports (git-ignored)
├── target/                        # Maven build output (git-ignored)
├── package.json                   # Node.js scripts and dependencies
└── README.md                      # This file
```

---

## Known Limitations

- The Apigee Emulator does not support all Apigee X policies. Some advanced features (e.g., distributed quota enforcement) may behave differently locally vs. non-production Apigee X.
- The mock target (`mocktarget.apigee.net`) returns a static XML response. In production, replace with a real backend.
- Emulator-generated API keys are local only and will not work against a deployed Apigee X environment.

---

## Environment Configuration

Environment-specific resources are defined under `src/main/apigee/environments/dev/`:
- `targetservers.json` — target server definitions
- `keystores.json` — TLS keystores
- `flowhooks.json` — shared flow hooks
- `debugmask.json` — debug session masking rules
- `deployments.json` — deployment metadata

No secrets are stored in this repository. API keys and credentials must be retrieved from the Apigee Emulator UI or Apigee Console at runtime.
