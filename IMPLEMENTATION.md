# Apigee CI/CD POC — Implementation Document

**Project:** myapigeeworkspace  
**Repository:** https://github.com/youssefessam2000/apigeeLocalDev  
**Author:** Youssef  
**Date:** October 2026  

---

## How to read this document

| If you want to… | Read |
|-----------------|------|
| Understand the project and its files | 1 Overview, 2 Tools, 3 Project Structure |
| See what was built each day and why | 4 Day 1, 5 Day 2, 9 Day 3 (each step lists the commands, what each part does, and the results) |
| See every problem we hit and how it was solved | 8 Issues & Solutions (8.1–8.14, each with *Issue → Root cause → Solution*) |
| Check what is finished against the task plan | 7 (Days 1–2) and 9.10 (Day 3) |
| Find the Apigee org, environments and hostnames | "Apigee org reference" at the end of section 8 |
| Re-run something yourself | The command blocks in 5.5, 9.2, 9.3, 9.4 and 9.5 |
| Understand design decisions (console development, Cloud Build, production readiness, Day 4 plan) | 10 Design Notes & Decisions |
| Resume the work in a new session | `CHAT_HISTORY.md` → "Resume here" |

**Status:** Day 1 ✅ · Day 2 ✅ · Day 3 ✅ · Next: migrate the pipeline to Cloud Build (10.3), then Day 4 (10.4).

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
9. [Day 3 — Non-Production Deployment & CI](#9-day-3--non-production-deployment--ci)
10. [Design Notes & Decisions](#10-design-notes--decisions)
11. [Day 4 — Controlled Deployment, Promotion & Release](#11-day-4--controlled-deployment-promotion--release)

---

## 1. Project Overview

A simple Apigee X proxy (`helloworld`) built as a CI/CD proof-of-concept. The proxy:

- Exposes a `GET /helloworld` endpoint
- Requires an **API key** for authentication
- Enforces a **quota** based on the API product configuration
- Calls a **mock XML target** and transforms the response to **JSON**
- Is tested locally using the **Apigee Emulator** (Docker-based)
- Is linted with **apigeelint** and tested via **Newman** (Postman CLI runner)
- Is packaged and deployed via the **Apigee Deploy Maven Plugin v2.5.2**
- Is deployed to the Apigee X evaluation org (environment `eval`) and tested there with the same Postman collection
- Runs through a **GitHub Actions** pipeline: lint → package → stored artifact → keyless Google login → deploy → API tests

---

## 2. Tools & Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| VS Code + Cloud Code extension | Latest | Apigee workspace & emulator management |
| Docker | Latest | Runs the Apigee Emulator container |
| Node.js | v18+ | Runs apigeelint and Newman |
| apigeelint | 2.85.1 | Static analysis for Apigee proxy bundles |
| Newman | 6.2.3 | CLI runner for Postman collections |
| Java (Eclipse Temurin JDK) | 17 (11+ works) | Runs Maven and the Apigee plugin |
| Maven | 3.9.16 (3.6+ works) | Proxy packaging & deployment |
| gcloud CLI | 589.0.0 | Login and access tokens for Apigee X; Workload Identity setup |
| GitHub Actions | — | CI/CD pipeline (`.github/workflows/ci.yml`) |
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
│       ├── hello.postman_collection.json             # Functional test collection (3 requests, 8 assertions)
│       ├── run-local.js                              # Runs it against the emulator (fetches the emulator key)
│       ├── run-cloud.js                              # Runs it against Apigee X (key from APIGEE_APIKEY)
│       └── env/
│           ├── local.postman_environment.json        # Local emulator environment
│           └── eval.postman_environment.json         # Apigee X eval environment (no key stored)
├── .github/
│   └── workflows/
│       └── ci.yml                                    # GitHub Actions pipeline (build + deploy jobs)
├── reports/                                          # Generated reports (git-ignored)
├── target/                                           # Maven build output + emulator data (git-ignored)
├── pom.xml                                           # Maven build & deployment config
├── package.json                                      # Node.js scripts & dependencies
├── .gitignore                                        # Ignore rules
├── Apigee_CICD_POC.csv                               # 4-day task plan
├── CHAT_HISTORY.md                                   # Notes from the first working session
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
    "test:api:local": "node tests/postman/run-local.js",
    "test:api:eval": "node tests/postman/run-cloud.js eval",
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
| `npm run test:api:local` | Run Newman against the local emulator (key fetched automatically, see 8.2) → `reports/newman-local.xml` |
| `npm run test:api:eval` | Run Newman against Apigee X eval; needs `$env:APIGEE_APIKEY` (added on Day 3, see 9.3) → `reports/newman-eval.xml` |
| `npm test` | Run lint + emulator functional tests (full local quality gate) |

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

Newest first. Commits after `873fe83` are visible with `git log --oneline`.

| Commit | Message |
|--------|---------|
| `873fe83` | docs: record red/green PR demo and correct revision history |
| `65f0c5e` | docs: record pipeline run 3 (revision 5 READY) |
| `6c22dc9` | ci: skip pipeline for documentation-only changes; mark Day 3 complete |
| `5aa621f` | docs: record pipeline deploy 403 and Environment Admin fix (issue 8.14) |
| `820965d` | ci: add GitHub Actions pipeline (lint, package, deploy to eval, API tests) |
| `ed61ed8` | docs: document Day 3 step 4 (Workload Identity Federation for GitHub) |
| `3841329` | docs: document Day 3 step 3 (test failure handling) |
| `43f819a` | feat(tests): run API tests against Apigee eval |
| `3004178` | docs: document Day 3 step 1 (Maven deploy to Apigee eval) |
| `8e92698` | docs: record Day 3 setup issues (PATH, gcloud/Cloud Code login, staging TLS) |
| `2b70733` | chore: stop tracking generated target/ folder |
| `f3bd17e` | docs: add Issues & Solutions section to IMPLEMENTATION.md |
| `9c7f3d1` | fix(maven): use the official Apigee deploy plugin so packaging works |
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

### 8.9 `mvn` / `java` / `gcloud` not found in the VS Code terminal (Day 3 prep)

**Issue:** After installing Maven, the JDK and the Google Cloud CLI, the commands were still "not recognized" in the VS Code terminal, although the installers had added them to `PATH`.

**Solution:** VS Code reads `PATH` once at startup. Closing **all** VS Code windows and reopening fixed it. Without a restart, the current terminal can reload `PATH` with:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

### 8.10 gcloud could not see the Apigee project (Day 3 prep)

**Issue:** `gcloud config set project project-953dc129-1db1-4aea-ae3` and `gcloud projects describe` returned *"does not have permission to access projects instance"*. gcloud reported the active account as `youssef.essam1955@gmail.com` (the project owner), but the token it actually used belonged to a different Google account, which has no projects. Later every command failed with `invalid_grant: Token has been expired or revoked`.

**Root cause:** The **Cloud Code** VS Code extension keeps its own Google login in `%LOCALAPPDATA%\google-vscode-extension\auth\application_default_credentials.json` (created on Day 1 with another account). In VS Code terminals it sets gcloud's `auth/credential_file_override` to that file, and right after each `gcloud auth login` its background `gcloud config config-helper` call stored those credentials under the new account name. Running `gcloud auth revoke --all` inside VS Code then revoked the Cloud Code credentials, so every call failed.

**Solution:**
1. In VS Code: `Ctrl+Shift+P` → **Cloud Code: Sign In** with the project owner account. This replaces the Cloud Code credentials file.
2. Ran `gcloud auth login` from a normal PowerShell window (outside VS Code) with the same account.
3. Verified the real identity behind the token, not just the label shown by `gcloud auth list`:

```powershell
$t = gcloud auth print-access-token
curl.exe -s "https://oauth2.googleapis.com/tokeninfo?access_token=$t"   # "email" must be the project owner
gcloud projects describe project-953dc129-1db1-4aea-ae3                  # project details, no permission error
```

**Lesson:** When gcloud and Cloud Code are both used, sign both in with the same account, and do not run `gcloud auth revoke` from a VS Code terminal.

### 8.11 Staging hostname has no valid TLS certificate (Day 3 prep, open)

**Issue:** `https://staging.8.228.239.128.nip.io` fails certificate validation (`curl` exit code 60). The load balancer's Google-managed certificate covers only `8.228.239.128.nip.io` (the eval hostname).

**Solution (pending):** Create a Google-managed certificate covering both hostnames and attach it to the Apigee load balancer. Until then, Day 3 uses the **eval** environment only; `--insecure` in Newman would also work but disables certificate checks.

### 8.12 Staging environment is named `stagin` (Day 3 prep, accepted)

**Issue:** The Apigee environment was created as `stagin`, not `staging`. Its environment group is `staging-group` (`staging.8.228.239.128.nip.io`). Apigee environments cannot be renamed.

**Solution:** Kept as is for the POC. When switching to staging, use `APIGEE_ENV=stagin`.

### 8.13 `npm run ... -- --env-var` loses the API key in Windows PowerShell (Day 3)

**Issue:** `npm run test:api:eval -- --env-var "apikey=<key>"` got `401` on the happy-path test, although `curl` with the same key returned `200` and running `npx newman ... --env-var` directly passed. Newman was still sending the placeholder key from the environment file.

**Root cause:** In Windows PowerShell, `npm` resolves to the `npm.ps1` wrapper, and PowerShell treats `--` as its own end-of-parameters marker and drops it. npm then read `--env-var` as an npm option instead of passing it to the script. (`npm.cmd` keeps the `--` but has the same problem in this setup.) Local runs had hidden this because `run-local.js` fetches the emulator key by itself.

**Solution:** `tests/postman/run-cloud.js` reads the key from the `APIGEE_APIKEY` environment variable, which works the same in PowerShell, bash and GitHub Actions. Earlier instructions that pass `-- --env-var "apikey=..."` through npm should not be used in PowerShell; call Newman directly or use the environment variable.

### 8.14 Pipeline deploy failed with `403 PERMISSION_DENIED` (Day 3, first pipeline run)

**Issue:** In the first GitHub Actions run, the keyless Google login and the bundle import both worked (revision 3 was created), but the deploy call `POST .../environments/eval/apis/helloworld/revisions/3/deployments` returned `403 The caller does not have permission`.

**Root cause:** `roles/apigee.apiAdminV2` (Apigee API Admin) allows importing proxies and includes `apigee.proxyrevisions.deploy`, but not the environment-level permissions `apigee.deployments.create` (deploy into an environment) and `apigee.deployments.get` (used by the plugin to wait for `READY`). Of the predefined roles, only Apigee Organization Admin, Apigee Editor and **Apigee Environment Admin** include `apigee.deployments.create`; Environment Admin is the narrowest.

**Solution:** Granted `roles/apigee.environmentAdmin` to the deployer service account (run by Youssef):

```powershell
gcloud projects add-iam-policy-binding project-953dc129-1db1-4aea-ae3 --member="serviceAccount:github-apigee-deployer@project-953dc129-1db1-4aea-ae3.iam.gserviceaccount.com" --role="roles/apigee.environmentAdmin" --condition=None
```

Verified: the service account now has `roles/apigee.apiAdminV2` and `roles/apigee.environmentAdmin`.

**Note:** this grant is project-wide, so it covers both `eval` and `stagin`. A tighter alternative is to grant Environment Admin on a single environment through the Apigee environment IAM API (`GET .../environments/eval:getIamPolicy`, then `POST .../environments/eval:setIamPolicy`); the project-wide grant was chosen for simplicity and because the pipeline will later deploy to staging too.

**Lesson:** "Apigee API Admin" alone is not enough to *deploy*; a CI deployer needs a role with `apigee.deployments.create` on the target environment.

**Also observed:** pasting multi-line PowerShell commands into the terminal can merge lines, and `!` (the Claude Code "run in session" prefix) is not valid PowerShell. Run long commands as a single line.

### Apigee org reference (checked Day 3)

| Item | Value |
|------|-------|
| Org / project | `project-953dc129-1db1-4aea-ae3` (Apigee X evaluation, expires **2026-12-10**) |
| Environments | `eval`, `stagin` |
| Environment groups | `eval-group` → `8.228.239.128.nip.io`; `staging-group` → `staging.8.228.239.128.nip.io` |
| Other proxies on eval | `hello-world` (`/hello-world`), `oauth-v1` (`/oauth/v1`) — no base-path conflict with `/helloworld` |

---

### 8.15 Secret writes blocked for Claude; PowerShell one-liner failed

**Issue:** Creating the Secret Manager secret from Claude Code was blocked by the Claude Code safety check (secret-store writes), like role grants (8.14). The PowerShell one-liner given to Youssef to read the key from Apigee and create the secret returned an error in the VS Code terminal.

**Solution:** Youssef created the secret in the Cloud console. Claude verified it by comparing SHA-256 fingerprints of the secret and the Apigee key (no key printed). When a key is piped in PowerShell, a trailing new line can be added; writing it with `[IO.File]::WriteAllText` or pasting it in the console avoids that.

**Lesson:** Secrets and IAM changes are done by Youssef (console or a single-line command); Claude prepares and verifies them.

---

### 8.16 Manual `gcloud builds submit` fails with 403 on the `_cloudbuild` bucket

**Issue:** Testing `cloudbuild.yaml` with `gcloud builds submit --service-account=...cloudbuild-apigee-deployer...` failed: `cloudbuild-apigee-deployer ... does not have storage.objects.get access to ... project-953dc129-1db1-4aea-ae3_cloudbuild/source/...tgz`.

**Root cause:** A manual submit uploads the local folder to the bucket `<project>_cloudbuild`, and the build's service account must read it. Our account only has access to the bundle bucket. Triggers do not need this: they fetch the source directly from GitHub.

**Solution:** No extra permission added. The files are tested through the real triggers (PR, then merge). If manual submits are wanted later, grant the service account **Storage Object Viewer** on the `<project>_cloudbuild` bucket (Cloud Storage → bucket → Permissions → Grant access).

---

### 8.17 API key visible in the Cloud Build log

**Issue:** The first Cloud Build deploy (build `a6b473c6`, revision 8) printed the real API key in the `api-tests` step: Newman's CLI output shows each request URL, `GET https://8.228.239.128.nip.io/helloworld?apikey=<key>`.

**Root cause:** GitHub Actions automatically masks registered secrets in logs, so this never showed on Day 3. Cloud Build does **not** mask values from Secret Manager in step output. The test report (`newman-eval.xml`) did not contain the key.

**Solution:** `tests/postman/run-cloud.js` now captures Newman's output and replaces the key with `***` before printing (commit `fbea836`). Works the same in Cloud Build, GitHub Actions and locally. Verified in build `46f86883`: 0 occurrences of the key, URL shows `apikey=***`.

**Follow-up:** The key from before the fix is in the Cloud Logging entries of build `a6b473c6` (readable only by project members with log access). Rotate it: Apigee → Distribution → Apps → `helloworld-app` → add a new key, add it as a new version of secret `apigee-helloworld-apikey`, then revoke the old key.

**Lesson:** When moving pipelines, check what the old platform did implicitly (here: secret masking). Prefer sending API keys in a header rather than the URL, so they do not show up in logs.

---

## 9. Day 3 — Non-Production Deployment & CI

**Target:** Apigee X evaluation org `project-953dc129-1db1-4aea-ae3`, environment **`eval`** (`https://8.228.239.128.nip.io`). Staging (`stagin`) is postponed until its TLS certificate is fixed (see 8.11). Switching later only changes `APIGEE_ENV` and the test base URL.

### 9.1 Prerequisites set up

| Tool | Version | Purpose |
|------|---------|---------|
| Eclipse Temurin JDK | 17.0.17 | Runs Maven and the Apigee Maven plugin (both are Java programs) |
| Apache Maven | 3.9.16 | Builds the bundle and runs the deployment |
| Google Cloud CLI (`gcloud`) | 589.0.0 | Logs in to Google Cloud and issues the access token used for deployment |

Login checks (see 8.10 for why the token's real identity is checked):

```powershell
gcloud auth list                                            # youssef.essam1955@gmail.com is active
gcloud projects describe project-953dc129-1db1-4aea-ae3     # project details, no permission error
```

### 9.2 Step 1 — Deploy the proxy to eval with Maven ✅

**Commands** (PowerShell, from the project root):

```powershell
$env:APIGEE_ORG   = "project-953dc129-1db1-4aea-ae3"   # Apigee org
$env:APIGEE_ENV   = "eval"                             # target environment
$env:APIGEE_TOKEN = (gcloud auth print-access-token)   # OAuth token, valid ~1 hour

mvn install -P nonprod
```

**What each part does:**

| Part | Purpose |
|------|---------|
| `$env:APIGEE_*` | Session-only environment variables. `pom.xml` reads them as `${env.APIGEE_ORG}`, `${env.APIGEE_ENV}`, `${env.APIGEE_TOKEN}`, so no org, environment or token is stored in Git. |
| `-P nonprod` | Selects the `nonprod` Maven profile, which points the plugin at `https://apigee.googleapis.com` (the Apigee management API). |
| `install` | Runs every Maven phase up to `install`, which triggers the steps below. |

**Steps Maven runs:**

| Phase | Plugin / goal | Result |
|-------|---------------|--------|
| `package` | `maven-resources-plugin:copy-resources` | Copies `src/main/apigee/apiproxies/helloworld/apiproxy` to `target/apiproxy` |
| `package` | `apigee-edge-maven-plugin:configure` | Zips the bundle into `target/helloworld-1.0.0.zip` |
| `install` | `apigee-edge-maven-plugin:deploy` | Imports the zip as a new proxy revision and deploys it to the environment |

**What the deploy goal does behind the scenes** (Apigee management API calls, authenticated with the bearer token):

1. **Import:** `POST /v1/organizations/{org}/apis?action=import&name=helloworld` with the zip → Apigee creates **revision 1**.
2. **Deploy:** `POST /v1/organizations/{org}/environments/eval/apis/helloworld/revisions/1/deployments?override=true`. `override` comes from `apigee.options` in `pom.xml`; later revisions replace the deployed one without downtime.
3. **Wait:** polls `GET .../revisions/1/deployments` until the state is `READY` (the repeated "Getting Deployment Info" lines). The full run took about 1.5 minutes.

**Verification:**

| Check | Result |
|-------|--------|
| Deployment state (`helloworld` rev 1 in `eval`) | `READY` |
| `GET https://8.228.239.128.nip.io/helloworld` (no key) | `401` — `Failed to resolve API Key variable request.queryparam.apikey` |
| `GET https://8.228.239.128.nip.io/helloworld?apikey=bad-key` | `401` — `Invalid ApiKey` |

Both 401 responses show the proxy is live and enforcing the API key. A `200` needs a cloud API key, which is created in step 2. In the Apigee console the proxy appears under **Proxy development → API proxies → helloworld**, revision 1 deployed to `eval`.

### 9.3 Step 2 — Cloud test data and API tests against eval ✅

Emulator API keys do not work in Apigee X, so the cloud org needs its own product, developer and app (the same model as `src/tests/mytestbundle/`). They were created once with the Apigee management API (`POST` requests with `gcloud auth print-access-token` as bearer token):

| Resource | Name | Settings |
|----------|------|----------|
| API product | `helloworld-product` | Proxy `helloworld`, environment `eval`, resources `/` and `/**`, quota 100 per minute, auto-approval |
| Developer | `ahamilton@example.com` | Alex Hamilton (same as the emulator test developer) |
| Developer app | `helloworld-app` | Subscribed to `helloworld-product`; Apigee generated an approved API key |

The key is visible in the Apigee console under **Distribution → Apps → helloworld-app**, or with:

```powershell
$t = gcloud auth print-access-token
(curl.exe -s -H "Authorization: Bearer $t" "https://apigee.googleapis.com/v1/organizations/project-953dc129-1db1-4aea-ae3/developers/ahamilton@example.com/apps/helloworld-app" | ConvertFrom-Json).credentials[0].consumerKey
```

**New files:**

| File | Purpose |
|------|---------|
| `tests/postman/env/eval.postman_environment.json` | `baseUrl` = `https://8.228.239.128.nip.io`. The `apikey` value is a placeholder; the real key is never committed. |
| `tests/postman/run-cloud.js` | Runs the same Postman collection against a cloud environment. Takes the environment name (`eval`, later `stagin`), reads the key from the `APIGEE_APIKEY` environment variable, and writes `reports/newman-<env>.xml`. Fails with a clear message if the key or environment file is missing. |
| `package.json` → `test:api:eval` | `node tests/postman/run-cloud.js eval` |

**Run:**

```powershell
$env:APIGEE_APIKEY = "<helloworld-app key>"
npm run test:api:eval
```

**Result:** 3 requests, 8 assertions, 0 failures — `200` + JSON with the valid key, `401` without a key, `401` `InvalidApiKey` with a wrong key. JUnit report: `reports/newman-eval.xml`.

The key is read from an environment variable rather than `--env-var` on the npm command line because of issue 8.13. GitHub Actions will provide it the same way, from a repository secret.

### 9.4 Step 3 — Test failure handling ✅

**Goal:** prove that a failing test makes the command exit non-zero, so a pipeline stops instead of continuing.

**What was done:** In `tests/postman/hello.postman_collection.json`, the happy-path assertion was temporarily changed from `pm.response.to.have.status(200)` to `pm.response.to.have.status(418)`, both test commands were run, then the change was reverted (no commit).

| Run | Command | Assertions failed | Exit code |
|-----|---------|-------------------|-----------|
| Before (unchanged) | `npm run test:api:eval` | 0 / 8 | `0` |
| Before (unchanged) | `npm test` (lint + emulator tests) | 0 / 8 | `0` |
| Broken assertion | `npm run test:api:eval` | 1 / 8 — *expected response to have status code 418 but got 200* | `1` |
| Broken assertion | `npm test` | 1 / 8 (lint still 0 errors) | `1` |
| After revert | `npm run test:api:eval` | 0 / 8 | `0` |
| After revert | `npm test` | 0 / 8 | `0` |

**How it stops a pipeline:** Newman exits with code `1` when any assertion fails, `run-cloud.js` / `run-local.js` pass that exit code on, and `npm test` uses `&&`, so nothing after a failed step runs. GitHub Actions marks a step as failed on any non-zero exit code and skips the following steps.

To repeat the demo: change `status(200)` to `status(418)`, run `npm run test:api:eval` and `echo $LASTEXITCODE` (expect `1`), then undo the change.

### 9.5 Step 4 — Keyless login for GitHub Actions (Workload Identity Federation) ✅

**Why:** GitHub Actions needs a Google identity to deploy. Service-account key files are blocked in this project (org policy `iam.disableServiceAccountKeyCreation` is enforced), and keys are long-lived secrets anyway. With **Workload Identity Federation (WIF)**, GitHub issues a short-lived OIDC token for each workflow run, Google's Security Token Service (STS) exchanges it for a short-lived Google token, and the workflow acts as a service account. No key is created or stored.

```
GitHub Actions run ──OIDC token──▶ WIF pool/provider ──(repo check)──▶ STS
        ▲                                                          │
        └──────── short-lived token as github-apigee-deployer ◀────┘ ──▶ Apigee API
```

**Resources created:**

| Resource | Name | Purpose |
|----------|------|---------|
| API | `sts.googleapis.com` | Security Token Service, exchanges GitHub's token for a Google token (`iam` and `iamcredentials` were already enabled) |
| Service account | `github-apigee-deployer@project-953dc129-1db1-4aea-ae3.iam.gserviceaccount.com` | Identity the pipeline deploys as |
| Project IAM role | `roles/apigee.apiAdminV2` (Apigee API Admin) on the service account | Import proxy bundles (create revisions) |
| Project IAM role | `roles/apigee.environmentAdmin` (Apigee Environment Admin) on the service account | Deploy revisions into environments and read deployment status — added after the first pipeline run failed with 403 (see 8.14) |
| Workload Identity pool | `github-pool` (global) | Container for external identities Google trusts |
| OIDC provider | `github-provider` in `github-pool` | Trusts tokens from `https://token.actions.githubusercontent.com`; condition `assertion.repository=='youssefessam2000/apigeeLocalDev'` rejects every other repository |
| Service account IAM role | `roles/iam.workloadIdentityUser` for `principalSet://…/github-pool/attribute.repository/youssefessam2000/apigeeLocalDev` | Lets workflows from this repo act as the service account |

**Commands** (PowerShell; 4.1–4.4 were run by Youssef, 4.5–4.6 by Claude):

```powershell
# 4.0 Variables
$PROJECT_ID     = "project-953dc129-1db1-4aea-ae3"
$PROJECT_NUMBER = "445485313308"
$REPO           = "youssefessam2000/apigeeLocalDev"
$SA_NAME        = "github-apigee-deployer"
$SA_EMAIL       = "$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
$POOL           = "github-pool"
$PROVIDER       = "github-provider"
gcloud config set project $PROJECT_ID

# 4.1 Enable the Security Token Service API
gcloud services enable sts.googleapis.com

# 4.2 Create the service account
gcloud iam service-accounts create $SA_NAME --display-name="GitHub Actions Apigee deployer"

# 4.3 Allow it to deploy Apigee proxies
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA_EMAIL" --role="roles/apigee.apiAdminV2" --condition=None

# 4.4 Create the Workload Identity pool
gcloud iam workload-identity-pools create $POOL --location="global" --display-name="GitHub Actions pool"

# 4.5 Create the GitHub OIDC provider, limited to this repository
gcloud iam workload-identity-pools providers create-oidc $PROVIDER --location="global" --workload-identity-pool=$POOL --display-name="GitHub provider" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" --attribute-condition="assertion.repository=='$REPO'"

# 4.6 Let workflows from this repository act as the service account (uses the project NUMBER)
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL --role="roles/iam.workloadIdentityUser" --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO"
```

| Flag (4.5) | Meaning |
|------------|---------|
| `--issuer-uri` | Accept tokens issued by GitHub Actions |
| `--attribute-mapping` | Copy the token's subject, repository and branch (`ref`) into Google attributes |
| `--attribute-condition` | Security lock: only tokens from `youssefessam2000/apigeeLocalDev` are accepted |

**Verification:**

| Check | Result |
|-------|--------|
| `gcloud services list --enabled` | `sts.googleapis.com` enabled |
| Service account roles | `roles/apigee.apiAdminV2` |
| Pool `github-pool` | `ACTIVE` |
| Provider `github-provider` | `ACTIVE`, condition `assertion.repository=='youssefessam2000/apigeeLocalDev'` |
| Service account IAM policy | `roles/iam.workloadIdentityUser` → `principalSet://iam.googleapis.com/projects/445485313308/locations/global/workloadIdentityPools/github-pool/attribute.repository/youssefessam2000/apigeeLocalDev` |

The real end-to-end test of this setup is the first workflow run in step 5.

#### 4.7 GitHub repository variables and secret (done in the GitHub web UI)

Repository → **Settings → Secrets and variables → Actions**:

| Type | Name | Value |
|------|------|-------|
| Variable | `GCP_WIF_PROVIDER` | `projects/445485313308/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| Variable | `GCP_SERVICE_ACCOUNT` | `github-apigee-deployer@project-953dc129-1db1-4aea-ae3.iam.gserviceaccount.com` |
| Variable | `APIGEE_ORG` | `project-953dc129-1db1-4aea-ae3` |
| Variable | `APIGEE_ENV` | `eval` |
| Variable | `APIGEE_BASE_URL` | `https://8.228.239.128.nip.io` |
| **Secret** | `APIGEE_APIKEY` | API key of `helloworld-app` (Apigee console → Distribution → Apps) |

Only `APIGEE_APIKEY` is sensitive. The provider name and service account email are identifiers, not credentials: they are useless outside workflows from this repository. Switching the pipeline to staging later means changing `APIGEE_ENV` to `stagin` and `APIGEE_BASE_URL` to the staging hostname.

### 9.6 Step 5 — GitHub Actions workflow ✅

**File:** `.github/workflows/ci.yml`

**Triggers:** pull requests to `main`, pushes to `main`, and manual runs (**Actions → CI → Run workflow**).

```
┌──────────────── build (PRs + pushes) ────────────────┐     ┌──────── deploy (pushes to main + manual) ────────┐
│ checkout → npm ci → npm run lint → mvn package       │     │ download bundle → Google login (WIF)             │
│ → build-info.json → upload bundle artifact           │ ──▶ │ → mvn apigee-enterprise:deploy → API tests       │
└──────────────────────────────────────────────────────┘     └──────────────────────────────────────────────────┘
       any failing step stops the run (non-zero exit)              runs only if build succeeded (needs: build)
```

**Job `build` — "Lint and package":**

| Step | What it does |
|------|--------------|
| `actions/checkout@v4` | Gets the commit being built |
| `actions/setup-node@v4` (Node 20, npm cache) + `npm ci` | Installs the pinned apigeelint and newman from `package-lock.json` |
| `npm run lint` | **Quality gate:** apigeelint must exit 0 |
| `npm run lint:report` (always) | Saves `reports/apigeelint-baseline.json` |
| `actions/setup-java@v4` (Temurin 17, Maven cache) | Java + Maven for the Apigee plugin |
| `mvn -B package -P nonprod` | Builds `target/helloworld-1.0.0.zip` (no Google login needed for packaging) |
| Write build metadata | `target/build-info.json`: proxy, version, commit SHA, branch, event, run ID/number, UTC build time |
| `actions/upload-artifact@v4` | Stores the zip + `build-info.json` as artifact `helloworld-bundle-<commit SHA>` for 30 days |
| Upload lint report (always) | Artifact `apigeelint-report-<commit SHA>` |

**Job `deploy` — "Deploy to eval and test":** runs only on pushes to `main` or manual runs, and only after `build` succeeds. Pull requests are linted and packaged but never deployed.

| Step / setting | What it does |
|----------------|--------------|
| `permissions: id-token: write` | Allows the job to request a GitHub OIDC token, needed for Workload Identity Federation |
| `concurrency: deploy-eval` | One deployment at a time; a newer run waits instead of racing |
| `actions/download-artifact@v4` | Downloads **the exact zip built by the `build` job** into `target/` |
| `google-github-actions/auth@v2` | Exchanges the GitHub OIDC token for a 1-hour Google access token as `github-apigee-deployer` (no key file; see 9.5) |
| `mvn -B -P nonprod apigee-enterprise:deploy` | Runs **only** the plugin's deploy goal, so the downloaded zip is imported as a new revision and deployed without being rebuilt. `APIGEE_TOKEN` comes from the auth step; `APIGEE_ORG` / `APIGEE_ENV` from repository variables. |
| `npm ci` + `node tests/postman/run-cloud.js eval` | Post-deploy API tests (**quality gate**) against `APIGEE_BASE_URL` with the `APIGEE_APIKEY` secret |
| Upload test report (always) | Artifact `newman-report-<commit SHA>` (`reports/newman-eval.xml`) |

**Supporting changes:**
- `tests/postman/run-cloud.js` accepts `APIGEE_BASE_URL` to override the environment file's `baseUrl`, so the target URL is a GitHub variable, not code.
- Verified locally before pushing: deploying a stored zip with only the deploy goal works (`target/apiproxy` removed, zip imported as revision 2, state `READY`, `200` with the app key).

**Not run in CI:** the emulator-based tests (`npm run test:api:local`) need the local Apigee Emulator. In the pipeline the functional tests run against the deployed eval proxy instead.

**Switching to staging later:** set `APIGEE_ENV` = `stagin` and `APIGEE_BASE_URL` = `https://staging.8.228.239.128.nip.io` (after the certificate fix, 8.11), add `stagin` to `helloworld-product`'s environments, and change `run-cloud.js eval` to the staging environment file.

### 9.7 Day 3 step checklist

| # | Step | Status |
|---|------|--------|
| 1 | Deploy `helloworld` to eval with Maven | ✅ Done |
| 2 | Create cloud API product, developer and app; add `eval` Postman environment; run Newman against eval | ✅ Done |
| 3 | Demonstrate that a failing assertion fails the test command | ✅ Done |
| 4 | Workload Identity Federation + deploy service account (service-account keys are blocked by the `iam.disableServiceAccountKeyCreation` org policy) | ✅ Done (GitHub variables: see 4.7) |
| 5 | GitHub Actions workflow (lint, package, store artifact, deploy, API tests) | ✅ Done |
| 6 | Push a change and observe the full pipeline run | ✅ Done (run 2, see 9.8) |

### 9.8 Step 6 — End-to-end pipeline runs

| Run | Trigger | Build job | Deploy job | Notes |
|-----|---------|-----------|------------|-------|
| 1 | Push `820965d` (workflow added) | ✅ Lint 0 errors, bundle packaged and stored | ❌ Google login ✅, import ✅ (revision 3), deploy `403` | Missing deploy permission (8.14); fixed by adding Apigee Environment Admin |
| 2 | Push `5aa621f` (documenting 8.14) | ✅ | ✅ Google login, import + deploy **revision 4** (`PROGRESSING` 08:38:07 → `READY` 08:38:29), API tests passed | **First successful end-to-end run** |
| 1 (re-run) | **Re-run failed jobs** on run 1 (after 8.14 fix) | — (reused) | ✅ Deployed run 1's stored bundle as **revision 5** (created 08:39:45) | Shows a stored artifact can be redeployed without rebuilding |
| 3 | Push `6c22dc9` (adds `paths-ignore`) | ✅ | ✅ Deployed **revision 6** (created 08:41:18, `READY`) | Workflow file changed, so this run was not skipped |
| — | Push `65f0c5e` (docs only) | skipped | skipped | ✅ No run; no new revision appeared in the following 6 minutes (`paths-ignore` works) |
| — | Pushes `873fe83`, `75a403e` (docs only) | skipped | skipped | ✅ No run; still revision 6 |
| 4 | Push `28bfdbe` (comment added to `verify-api-key.xml`) | ✅ | ✅ Deployed **revision 7** (created 09:19:07, `READY` 09:20:22) | Code change → automatic deploy; see "Code change to live revision" below |

**Code change to live revision (run 4):** a one-line XML comment was added to `policies/verify-api-key.xml` and pushed to `main` at 09:18:03. Without any manual step, GitHub Actions linted and packaged the proxy, and deployed it as revision 7, which replaced revision 6 on `eval` about 2.5 minutes after the push. Downloading both bundles from Apigee (`GET .../apis/helloworld/revisions/{rev}?format=bundle`) showed the comment only in revision 7, proving the pipeline deployed the pushed commit, not an older bundle. Live check after the deploy: `200` with the app key, `401` without a key.

```
09:18:03  push 28bfdbe to main
09:19:07  revision 7 imported by the pipeline
09:19:18  revision 7 deploying (PROGRESSING), replacing revision 6
09:20:22  revision 7 READY — live on https://8.228.239.128.nip.io/helloworld
```

**Scope:** the pipeline handles the `helloworld` proxy only (paths in `package.json`, `pom.xml` and the Postman collection). A new proxy folder would trigger the pipeline but would not be linted, packaged or deployed. Supporting multiple proxies (one Maven module per proxy, deploying only changed proxies) is a backlog item.

**Correction:** an earlier version of this table attributed revision 5 to run 3. Revision timestamps show revision 5 was created at 08:39:45, before commit `6c22dc9` existed (08:39:56); it came from the manual re-run of run 1. Run 3 created revision 6.

Confirmed independently from the Apigee side: revision 4 was created and deployed by the pipeline and replaced revision 2 on `eval`; running the same API tests against it locally gave 3 requests, 8 assertions, 0 failures. Both jobs were green in GitHub Actions, with the bundle, lint report and Newman report stored as run artifacts.

**Where to find the evidence:**

| What | Where |
|------|-------|
| Run history and logs | GitHub → **Actions → CI** |
| Stored bundle + `build-info.json` (commit, run number, build time) | Run page → **Artifacts → `helloworld-bundle-<commit SHA>`** (kept 30 days) |
| Lint and API test reports | Run page → **Artifacts → `apigeelint-report-<SHA>`**, **`newman-report-<SHA>`** |
| Deployed revisions | Apigee console → **Proxy development → API proxies → helloworld → Deployments** |

**Improvement after run 2:** every push to `main` deployed a new revision, even documentation-only commits. The workflow now has `paths-ignore: ['**.md', '**.csv']` on `push` and `pull_request`, so changes that only touch documentation do not run the pipeline. A manual run (**Actions → CI → Run workflow**) is still possible at any time.

### 9.9 Red/green quality gate on a pull request

**Why:** the task plan asks for *"Red/green CI behavior demonstrated"* and *"Keep deployment out of untrusted pull-request jobs"*. Run 1 was red because of a deploy permission, not because a quality gate caught a problem, and the pull-request trigger had never run.

**What was done:**

| # | Action | Commit | CI result |
|---|--------|--------|-----------|
| 1 | Created temporary branch `demo/quality-gate-red-green`; added a flow step referencing a policy that does not exist (`AM-DoesNotExist`) | `14f30e8` | — (pushes to other branches do not trigger CI) |
| 2 | Opened a pull request into `main` ("Demo: quality gate red/green (do not merge)") | — | ❌ **Red**: *Lint proxy (apigeelint)* failed with error **BN010 `Missing policy "AM-DoesNotExist"`**, exit code 1; packaging and artifact steps did not run |
| 3 | Pushed the fix (removed the step) to the same branch | `14b2bb4` | ✅ **Green**: lint 0 errors, bundle packaged and stored |
| 4 | Closed the pull request **without merging**; deleted the branch (local and remote) | — | — |

**How the PR went from red to green automatically:**
1. The workflow subscribes to `pull_request` events for `main`. Opening the PR started a run on its newest commit (`14f30e8`); lint exited 1, so GitHub stopped the job and marked the commit red.
2. Pushing `14b2bb4` to the PR's branch fired a new pull request event (`synchronize`), which started a new run on the new commit without any manual action.
3. A PR's check status always reflects its newest commit, so the PR turned green.

**Deployment stayed out of pull requests:** the `deploy` job only runs for `push` and `workflow_dispatch` events, so it did not run for either PR run. Confirmed in Apigee: revisions stayed at 1–6 throughout.

**Note:** removing the `<APIKey>` element from `verify-api-key` was considered as the deliberate lint error, but rejected because it weakens the proxy's security even on a temporary branch. A missing-policy reference is harmless and still a real lint error.

**In a team setup**, enabling branch protection on `main` (Settings → Branches → require the *CI / Lint and package* check) makes GitHub block merging while the check is red.

### 9.10 Day 3 summary

| # | Day 3 task (task plan) | Status | Evidence |
|---|------------------------|--------|----------|
| 1 | Prepare non-production target | ✅ | Eval org/environment checked (9.1, org table in 8); deployer identity and minimum roles defined (9.5, 8.14) |
| 2 | Deploy the proxy | ✅ | Maven deploy to eval, revision 1 `READY` (9.2) |
| 3 | Run post-deploy functional tests | ✅ | Newman against eval, 8/8 (9.3) |
| 4 | Test failure handling | ✅ | Wrong expected status → exit 1; restored → exit 0 (9.4) |
| 5 | Create CI workflow | ✅ | `.github/workflows/ci.yml`; triggered by pushes to `main` (runs 1–3) and pull requests (9.9) |
| 6 | Wire in automated quality gates | ✅ | Red/green demonstrated on a pull request: lint error → red, fix → green; deploy never runs for PRs (9.9) |
| 7 | Store build artifact | ✅ | Bundle + `build-info.json` uploaded per run, 30-day retention; stored bundle redeployed by a re-run as revision 5 (9.6, 9.8) |
| 8 | Run end-to-end pipeline | ✅ | Run 2: lint → package → artifact → deploy revision 4 → API tests (9.8) |

---

## 10. Design Notes & Decisions

Answers to questions raised after Day 3, kept here as learning material.

### 10.1 Is this a real CI/CD pipeline for production Apigee?

**The pattern is production-grade; the setup is a POC.**

| Already production-standard | Why |
|-----------------------------|-----|
| apigeelint as a quality gate | Google's own linter for Apigee bundles |
| Apigee Deploy Maven Plugin | Long-standing, widely used way to deploy Apigee from CI |
| Keyless CI login (Workload Identity Federation / service account) | Google's recommended approach; no long-lived keys |
| Build once, store, deploy the same artifact | Core CI/CD principle; proven by the run 1 re-run (revision 5) |
| PRs validate, only `main` deploys | Separation of validation and deployment |
| Post-deploy Newman tests as a gate | Automatic verification of every deployment |
| Zero-downtime revision swap (`override`) | Standard Apigee deployment mode |

| Missing for production | What production would add |
|------------------------|---------------------------|
| One evaluation environment (org expires 2026-12-10) | Separate dev / test / prod environments (often a separate prod org) |
| No approval, no branch protection | Required PR reviews, block merge on red CI, manual approval before prod |
| Product, developer, app created by hand | Config-as-code (Maven config goals or `apigeecli`): products, KVMs, target servers |
| Target URL hard-coded in `targets/default.xml` | Target servers per environment |
| Deploy role granted project-wide | Environment-scoped roles; separate deploy identity for prod |
| Fixed version `1.0.0` | Version per build (git tag or build number) |
| No rollback procedure | Documented/automated redeploy of the previous revision |
| No monitoring | Alerts on error rate and latency (Apigee analytics, Cloud Monitoring) |
| Single-proxy pipeline | One Maven module per proxy; deploy only proxies that changed |
| Functional tests only | Security checks and production-sized performance tests |

### 10.2 Developing in the Apigee console instead of VS Code

The pipeline deploys only what is **in Git**. Changes saved in the Apigee web editor exist only in Apigee, and the **next pipeline deploy overwrites them** (it imports the Git version as a new revision). Rule: **Git is the source of truth; the console is for experimenting.**

Flow when building in the console:

```
Edit/test in the console (sandbox env or a copy, e.g. helloworld-dev)
  → export the revision as a zip → unzip into src/main/apigee/apiproxies/<proxy>/apiproxy
  → commit + push or open a PR → pipeline lints, packages, deploys, tests
```

Export options:
- Console: **Proxy development → API proxies → <proxy> → Develop → Project → Download revision**.
- API (scriptable): `GET https://apigee.googleapis.com/v1/organizations/<org>/apis/<proxy>/revisions/<rev>?format=bundle` with a bearer token from `gcloud auth print-access-token` (used in 9.8 to compare revisions 6 and 7).
- Optional automation: a manual "import from Apigee" job that downloads a revision and opens a PR for review.

### 10.3 Decision: move the pipeline from GitHub Actions to Cloud Build

**Reason:** the client works on Google Cloud. Cloud Build keeps builds, identities, secrets, artifacts and logs inside the client's GCP project.

**What stays the same:** proxy, `pom.xml` and Maven plugin, apigeelint, Newman, `run-cloud.js`, eval product/app, the stage order (lint → package → store → deploy → test).

| | GitHub Actions (Day 3) | Cloud Build (planned) |
|---|---|---|
| Pipeline file | `.github/workflows/ci.yml` | `cloudbuild.yaml` (PR validation) + `cloudbuild-deploy.yaml` (deploy) |
| Google login | Workload Identity Federation (`github-pool` / `github-provider`) | Built in: build runs as a user-managed service account; WIF not needed |
| API key | GitHub secret `APIGEE_APIKEY` | Secret Manager secret |
| Stored bundle | GitHub artifacts (30 days) | Cloud Storage bucket per commit (or Artifact Registry) |
| Settings | GitHub variables | Trigger substitutions (`_APIGEE_ENV`, `_APIGEE_BASE_URL`, …) |
| Triggers | `on:` in the workflow | Cloud Build triggers on the GitHub repo (PR trigger + push-to-`main` trigger) |
| Manual approval | GitHub environments | "Require approval" on a trigger |
| Logs / audit | GitHub | Cloud Logging + Cloud Audit Logs |
| Cost | Free minutes | Free tier (120 build-minutes/day), then paid |

**Same repository, not a new one.** Cloud Build is added to this repo next to the GitHub Actions workflow. A second repo would deploy the same `helloworld` proxy to the same `eval` environment, so revisions from two pipelines would mix and could not be traced. The GitHub Actions version is kept with a Git tag, and `ci.yml` will be switched to manual-only (`workflow_dispatch`) instead of being deleted.

**Migration progress:**

| Step | Date | Result |
|------|------|--------|
| 0. Tag the GitHub Actions state | 2026-10-15 | Annotated tag `github-actions-final` on `456c36a`, pushed. See below. |
| 1. Enable APIs | 2026-10-15 | Already enabled (Cloud Build API, Secret Manager API). Nothing to do. |
| 2. Service account + roles | 2026-10-15 | Youssef created `cloudbuild-apigee-deployer` and granted 4 project roles. Verified by Claude. |
| 3. Secret + bucket | 2026-10-15 | Secret `apigee-helloworld-apikey` (created by Youssef in the console, verified to match the Apigee key); bucket `project-953dc129-1db1-4aea-ae3-apigee-bundles` (created by Claude); bucket role granted by Youssef. |
| 4. Connect GitHub to Cloud Build | 2026-10-15 | Youssef created connection `github-conn` (us-west1) and linked the repo. Verified by Claude: status COMPLETE, repo `youssefessam2000-apigeeLocalDev`. |
| 5. Cloud Build files | 2026-10-15 | `cloudbuild.yaml` + `cloudbuild-deploy.yaml` written by Claude (branch `cloud-build-pipeline`, commit `1d9ba7a`). |
| 6. Triggers | 2026-10-15 | `helloworld-pr` and `helloworld-deploy` created by Claude (us-west1). |
| 7. GitHub Actions manual-only | 2026-10-15 | `ci.yml` now runs only on `workflow_dispatch` (same commit `1d9ba7a`). |
| 8. Test | 2026-10-15 | PR #2 → `helloworld-pr` green; merge `831e59e` → `helloworld-deploy` green, **revision 8**. Found the API key in the build log (issue 8.17); fix `fbea836` → **revision 9**, key masked. Demo branch deleted. **Migration complete.** |

**Step 0 — tag the GitHub Actions version**

```bash
git tag -a github-actions-final -m "Last state with GitHub Actions as the only pipeline ..."
git push origin github-actions-final
```

| Part | What it does |
|------|--------------|
| `git tag -a` | Creates an **annotated** tag: a permanent named pointer to a commit, with author, date and a message (a lightweight tag has no message). |
| `github-actions-final` | Tag name. It points to `456c36a`, the last commit where GitHub Actions is the only pipeline (Day 3 complete; revision 7 was deployed by `28bfdbe`). |
| `git push origin <tag>` | Tags are not pushed by a normal `git push`; they must be pushed by name (or with `--tags`). |

How to use it later:

```bash
git show github-actions-final                         # tag message and commit
git checkout github-actions-final                     # look at that version (detached HEAD; `git checkout main` to return)
git diff github-actions-final main -- .github cloudbuild*.yaml   # compare the pipelines
```

On GitHub the tag appears under **Code → Tags** and can be downloaded as a zip.

> The GCP steps below are written as **Cloud Console (UI) steps**. Console: https://console.cloud.google.com (project `project-953dc129-1db1-4aea-ae3` selected in the top bar). "☰" is the navigation menu at the top left.

**Step 1 — Enable the Cloud Build and Secret Manager APIs**

1. ☰ → **APIs & Services → Library**.
2. Search **Cloud Build API** → open it → **Enable**.
3. Search **Secret Manager API** → open it → **Enable**.
4. Check: ☰ → **APIs & Services → Enabled APIs & services** lists both.

Result: both were already enabled (button showed **Manage** instead of **Enable**). Nothing to do.

**Step 2 — Create the Cloud Build service account and give it roles** (Youssef)

A service account is the identity the build runs as. A dedicated one (instead of the default Cloud Build account) has only the permissions we give it.

1. ☰ → **IAM & Admin → Service Accounts** → **+ Create service account**.
2. **Service account details:**
   | Field | Value |
   |-------|-------|
   | Service account name | `Cloud Build Apigee deployer` |
   | Service account ID | `cloudbuild-apigee-deployer` (email becomes `cloudbuild-apigee-deployer@project-953dc129-1db1-4aea-ae3.iam.gserviceaccount.com`) |
   → **Create and continue**.
3. **Grant this service account access to project** — add these roles (**+ Add another role** for each):
   | Role (as shown in the UI) | Why |
   |---------------------------|-----|
   | **Apigee API Admin** | Import proxies and create revisions (same as the GitHub deployer) |
   | **Apigee Environment Admin** | Deploy a revision to an environment; without it deploy fails with 403 (issue 8.14) |
   | **Secret Manager Secret Accessor** | Read the API key secret for the post-deploy tests |
   | **Logs Writer** | Write build logs to Cloud Logging (required when a build uses its own service account) |
   → **Continue** → **Done** (skip "Grant users access").
4. Check: ☰ → **IAM & Admin → IAM** → filter by `cloudbuild-apigee-deployer` → the four roles are listed.

Checked by Claude (terminal): the account exists and has exactly these four project roles.

**Step 3a — Store the API key in Secret Manager** (Youssef)

Secret Manager is a Google Cloud service: the secret is stored encrypted inside the GCP project, only principals with *Secret Manager Secret Accessor* can read it, every read is audit-logged, and a changed key is added as a new **version** (the pipeline reads `latest`). It replaces the GitHub secret `APIGEE_APIKEY`. Free tier: 6 active versions and 10,000 reads per month.

1. Get the key: ☰ → **Apigee → Distribution → Apps** → **`helloworld-app`** → **Credentials** → click the eye icon next to **Key** → copy it (the **Key**, not the Secret).
2. ☰ → **Security → Secret Manager** → **+ Create secret**.
   | Field | Value |
   |-------|-------|
   | Name | `apigee-helloworld-apikey` (the pipeline uses this exact name) |
   | Secret value | Paste the key — **no space or new line** before/after |
   | Replication policy | Automatic |
   | Labels | `app` = `helloworld`, `env` = `eval` |
   → **Create secret**.
3. Check: the secret page shows **Version 1 — Enabled**.

Checked by Claude (terminal): the secret's SHA-256 fingerprint matches the Apigee key's fingerprint (48 characters, no extra whitespace); the key itself was never printed.

**Step 3b — Create the bundle bucket** (created by Claude; UI steps for reference)

The pipeline stores each tested proxy zip here, one per commit (replaces GitHub artifacts).

1. ☰ → **Cloud Storage → Buckets** → **+ Create**.
2. Fill in:
   | Setting | Value | Why |
   |---------|-------|-----|
   | Name | `project-953dc129-1db1-4aea-ae3-apigee-bundles` | Bucket names are global, so the project ID is the prefix |
   | Location type | **Region** → `us-west1 (Oregon)` | Same region as the Apigee org |
   | Storage class | Standard | Default |
   | Prevent public access | ✅ **Enforce public access prevention on this bucket** | The bucket can never be made public |
   | Access control | **Uniform** | Permissions only through IAM, no per-object ACLs |
   | Data protection | Defaults | — |
   → **Create** (confirm the public-access prompt).

**Step 3c — Let the service account use the bucket** (Youssef)

1. ☰ → **Cloud Storage → Buckets** → open `project-953dc129-1db1-4aea-ae3-apigee-bundles` → **Permissions** tab → **Grant access**.
2. **New principals:** `cloudbuild-apigee-deployer@project-953dc129-1db1-4aea-ae3.iam.gserviceaccount.com`
3. **Role:** **Cloud Storage → Storage Object Admin** → **Save**.

Granted on **this bucket only**, so the build can upload/read bundles here but has no access to other buckets.

Checked by Claude (terminal): the bucket policy lists `roles/storage.objectAdmin` for the service account.

**Step 4 — Connect the GitHub repository to Cloud Build** (Youssef)

1. ☰ → **Cloud Build → Repositories** → **2nd gen** tab → **Create host connection**.
2. Fill in: Provider **GitHub**, Region **us-west1**, Name `github-conn` → **Connect**.
3. If asked to grant **Secret Manager Admin** to the Cloud Build service agent → **Grant** (Google's agent stores the GitHub login token as a secret).
4. In the GitHub window: **Authorize** Google Cloud Build as `youssefessam2000`, then **Install** the Cloud Build GitHub app with **Only select repositories → `apigeeLocalDev`**.
5. Back in the console the connection shows a green status → **Link repository** → select `youssefessam2000/apigeeLocalDev` → **Link**.

Checked by Claude (terminal): connection `github-conn` is **COMPLETE** and enabled, authorized as `youssefessam2000`; linked repository `youssefessam2000-apigeeLocalDev` → `https://github.com/youssefessam2000/apigeeLocalDev.git`.

**Step 5 — The Cloud Build files** (Claude)

Cloud Build reads a YAML file from the repo. Each **step** runs in its own container image; all steps share the folder `/workspace` (the checked-out repo), so files made by one step (e.g. `target/helloworld-1.0.0.zip`) are available to the next. Steps run in order and the build stops at the first step that fails.

| File | Used by trigger | Steps |
|------|-----------------|-------|
| `cloudbuild.yaml` | `helloworld-pr` (pull request to `main`) | `install` (npm ci) → `lint` (apigeelint) → `package` (mvn package). **No deploy and no secrets**: PR code is not trusted until merged. |
| `cloudbuild-deploy.yaml` | `helloworld-deploy` (push to `main`) | `install` → `lint` → `lint-report` → `package` → `build-info` → `store-bundle` → `get-token` → `deploy` → `api-tests` → `store-report` |

`cloudbuild-deploy.yaml` step by step:

| Step | Image | What it does |
|------|-------|--------------|
| `install` | `node:22` | `npm ci` — exact versions of apigeelint and Newman from `package-lock.json` |
| `lint` | `node:22` | `npm run lint` — **quality gate**: lint errors stop the build |
| `lint-report` | `node:22` | Saves `reports/apigeelint-baseline.json` |
| `package` | `maven:3.9.9-eclipse-temurin-17` | `mvn package -P nonprod` → `target/helloworld-1.0.0.zip` |
| `build-info` | `node:22` | Writes `target/build-info.json` (commit, branch, build ID, trigger, environment, time) |
| `store-bundle` | `cloud-sdk:slim` | Copies the zip, build-info and lint report to `gs://project-953dc129-1db1-4aea-ae3-apigee-bundles/helloworld/<commit>/` (replaces GitHub artifacts) |
| `get-token` | `cloud-sdk:slim` | Gets a short-lived access token of the build's service account (no keys, no WIF needed) into a workspace file; never printed |
| `deploy` | `maven` | Reads and deletes the token file, then `mvn -P nonprod apigee-enterprise:deploy` deploys the zip as a new revision (no rebuild) |
| `api-tests` | `node:22` | Newman against `_APIGEE_BASE_URL` with the API key from **Secret Manager** (`secretEnv`). Saves the exit code instead of failing, so the report is still stored |
| `store-report` | `cloud-sdk:slim` | Copies `reports/newman-eval.xml` to the same bucket folder, then exits with Newman's exit code — **quality gate**: failing tests fail the build |

Other parts of the file:

| Part | What it does |
|------|--------------|
| `availableSecrets.secretManager` | Reads `apigee-helloworld-apikey` (latest version) and gives it only to steps that list it in `secretEnv`. |
| `substitutions` | Settings with defaults: `_APIGEE_ORG`, `_APIGEE_ENV`, `_APIGEE_BASE_URL`, `_BUNDLE_BUCKET`, `_APIKEY_SECRET`. A trigger can override them (replaces GitHub variables). User-defined names must start with `_`. |
| `$COMMIT_SHA`, `$BRANCH_NAME`, `$BUILD_ID`, `$TRIGGER_NAME` | Built-in substitutions filled by Cloud Build. |
| `$$VAR` | A shell variable. `$$` is needed so Cloud Build does not treat it as a substitution. |
| `options.logging: CLOUD_LOGGING_ONLY` | Required when a build runs as a user-managed service account (logs go to Cloud Logging). |

**Step 6 — Create the triggers** (created by Claude; UI steps for reference)

A trigger starts a build when something happens in the repo.

1. ☰ → **Cloud Build → Triggers** → region **us-west1** at the top → **+ Create trigger**.
2. Trigger **`helloworld-pr`**:
   | Field | Value |
   |-------|-------|
   | Name | `helloworld-pr` |
   | Region | `us-west1` |
   | Description | PR to main: install, lint, package (no deploy) |
   | Event | **Pull request** |
   | Repository generation | **2nd gen** → repository `youssefessam2000-apigeeLocalDev` |
   | Base branch | `^main$` |
   | Comment control | **Not required** (private repo, only Youssef pushes) |
   | Included and ignored files filters → Ignored files | `**/*.md`, `**/*.csv`, `*.md`, `*.csv` (docs-only changes do not build — same as `paths-ignore` before) |
   | Configuration | **Cloud Build configuration file (yaml or json)**, location **Repository**, file `cloudbuild.yaml` |
   | Service account | `cloudbuild-apigee-deployer@...` |
   → **Create**.
3. Trigger **`helloworld-deploy`** — same as above except:
   | Field | Value |
   |-------|-------|
   | Name | `helloworld-deploy` |
   | Description | Push to main: lint, package, store bundle, deploy to eval, API tests |
   | Event | **Push to a branch**, branch `^main$` |
   | Configuration file | `cloudbuild-deploy.yaml` |
   | Substitution variables (Advanced) | `_APIGEE_ENV` = `eval`, `_APIGEE_BASE_URL` = `https://8.228.239.128.nip.io` |
4. Check: the **Triggers** page lists both, enabled.

`^main$` is a regular expression: exactly the branch `main`.

**Step 7 — Switch GitHub Actions to manual-only** (Claude)

In `.github/workflows/ci.yml`, the `pull_request` and `push` triggers were removed; only `workflow_dispatch` remains. Pushes and PRs now run only Cloud Build (no double deploy). The workflow can still be run by hand: GitHub → **Actions → CI → Run workflow**. The automatic version is kept as tag `github-actions-final`.

Steps 5 and 7 were pushed on branch `cloud-build-pipeline` (commit `1d9ba7a`), not directly to `main`, so the change can be tested through a pull request in step 8.

**Step 8 — Test the new pipeline** (Youssef + Claude)

1. GitHub → **Pull requests → New pull request** → base `main` ← compare `cloud-build-pipeline` → **Create pull request** (PR #2).
2. The PR shows a **Cloud Build** check. In the console: ☰ → **Cloud Build → History** (region us-west1) → build of trigger `helloworld-pr`.
3. When green → **Merge pull request**. The push to `main` starts trigger `helloworld-deploy`.
4. Check the deploy build: **Cloud Build → History** → open the build → each step shows a green tick; click a step to see its log.
5. Check the deployed revision: ☰ → **Apigee → Proxy development → API proxies → helloworld** → **Deployments** shows the new revision on `eval`.
6. Check the stored files: ☰ → **Cloud Storage → Buckets → `project-953dc129-1db1-4aea-ae3-apigee-bundles` → `helloworld/<commit>/`**.

Results:

| Build | Trigger | Commit | Steps | Result |
|-------|---------|--------|-------|--------|
| `84195da3` | `helloworld-pr` | `1d9ba7a` (PR #2) | install, lint, package | ✅ SUCCESS (~1 min) |
| `a6b473c6` | `helloworld-deploy` | `831e59e` (merge) | all 10 steps | ✅ SUCCESS (3 min 24 s) — **revision 8** deployed, Newman 3 requests / 8 assertions / 0 failed |
| `46f86883` | `helloworld-deploy` | `fbea836` (key masking fix) | all 10 steps | ✅ SUCCESS — **revision 9**, key shown as `***` in the log |

Files stored for commit `831e59e` (`gs://project-953dc129-1db1-4aea-ae3-apigee-bundles/helloworld/831e59ecf1ccf715a98cc8c121dc7b58f002868d/`):

| File | Size | What it is |
|------|------|-----------|
| `helloworld-1.0.0.zip` | 2,159 B | The exact bundle that was deployed |
| `build-info.json` | 277 B | Commit, branch, build ID, trigger, environment, time |
| `apigeelint-baseline.json` | 1,309 B | Lint report |
| `newman-eval.xml` | 1,548 B | Post-deploy test report (JUnit) |

So a commit can be traced to its build, bundle, Apigee revision and test report.

GitHub Actions did not run for the PR or the merge (`ci.yml` is manual-only). The demo branch `cloud-build-pipeline` was deleted afterwards.

**Pipeline now (Cloud Build):**

```
Pull request to main ──► helloworld-pr:      install → lint → package                          (no deploy, no secrets)
Push / merge to main ──► helloworld-deploy:  install → lint → package → store bundle (GCS)
                                             → deploy (Maven, token of cloudbuild-apigee-deployer)
                                             → Newman tests (key from Secret Manager) → store report (GCS)
.md / .csv only      ──► nothing runs
```

**Migration plan:**

| # | Step | Who |
|---|------|-----|
| 1 | Enable Cloud Build and Secret Manager APIs | Claude |
| 2 | Create service account `cloudbuild-apigee-deployer`; grant Apigee API Admin, Apigee Environment Admin, Secret Manager Secret Accessor, Logs Writer, bucket write | Youssef (role grants are blocked for Claude, see 8.14) |
| 3 | Store the `helloworld-app` key in Secret Manager; create the bundle bucket | Claude |
| 4 | Connect the GitHub repo to Cloud Build (browser authorization of the Cloud Build GitHub app) | Youssef |
| 5 | Write `cloudbuild.yaml` and `cloudbuild-deploy.yaml` | Claude |
| 6 | Create the PR trigger and the push-to-`main` trigger | Claude |
| 7 | Disable the GitHub Actions workflow so pushes do not deploy twice | Claude |
| 8 | Test: red/green PR, then a code push that deploys a new revision | Both |
| 9 | Document in this file | Claude |

### 10.4 Day 4 plan (task plan)

| # | Day 4 task | Deliverable | Status before Day 4 | Remaining work |
|---|------------|-------------|---------------------|----------------|
| 1 | Add controlled deployment stage | Non-production deployment stage | ✅ **Done 2026-10-15** (section 11.1) | — |
| 2 | Run post-deployment tests in pipeline | Automated post-deploy verification | ✅ **Done 2026-10-15** (section 11.2) | — |
| 3 | Environment promotion design | Documented promotion path | Not started | dev → eval → staging → prod design; promote the same tested revision from `eval` to `stagin` |
| 4 | Configuration and secret review | Config and secret checklist | Partly known | Checklist of target URL, KVMs/target servers (none), secrets, git history, manual vs as-code resources |
| 5 | Optional performance test | Baseline results or documented deferral | Not started | Small k6 run on eval, or documented deferral |
| 6 | Documentation and release notes | Complete project documentation | IMPLEMENTATION.md complete to Day 3 | OpenAPI file, README update, pipeline diagram, release notes |
| 7 | Final clean run | End-to-end evidence pack | Not started | Change → PR → green → merge → approval → deploy → tests; trace commit ↔ artifact ↔ revision ↔ report |
| 8 | Demo and retrospective | Demo checklist + backlog | Not started | Demo script; done / optional / production-hardening backlog (10.1) |

Suggested order: Cloud Build migration (10.3) → 4 → 1 → 2 → 3 → 6 → 5 → 7 → 8.

---

**Next:** Day 4 (section 11).

---

## 11. Day 4 — Controlled Deployment, Promotion & Release

Day 4 runs on the **Cloud Build** pipeline (10.3). Task list and plan: 10.4. A shorter "do it yourself" version of each step is in `CICD_GUIDE.md`.

| # | Task | Status |
|---|------|--------|
| 1 | Add controlled deployment stage | ✅ Done (11.1) |
| 2 | Run post-deployment tests in pipeline | ✅ Done (11.2) |
| 3 | Environment promotion design | Pending |
| 4 | Configuration and secret review | Pending |
| 5 | Optional performance test | Pending |
| 6 | Documentation and release notes | Pending |
| 7 | Final clean run | Pending |
| 8 | Demo and retrospective | Pending |

### 11.1 Task 1 — Controlled deployment stage (manual approval)

**CSV:** *Configure deployment to a non-production environment only, triggered after CI succeeds and preferably after merge/approval. Store credentials in CI secrets or use workload identity federation where supported; never print tokens in logs.*

| Requirement | How it is met |
|-------------|---------------|
| Non-production only | Trigger `helloworld-deploy` deploys only to `eval` (`_APIGEE_ENV=eval`). The service account has no access outside this project. |
| After CI succeeds | Code reaches `main` only through a PR whose `helloworld-pr` check is green; the deploy build runs lint and package again before deploying. |
| After merge | `helloworld-deploy` runs only on pushes to `main` (`^main$`). PR builds never deploy and get no secrets. |
| **After approval** | **New:** the deploy trigger requires manual approval; the build waits until someone approves it. |
| Credentials | No keys: the build uses the identity of `cloudbuild-apigee-deployer`; the API key is in Secret Manager. |
| No tokens in logs | The access token goes to a workspace file that the deploy step deletes; the API key is masked as `***` (issue 8.17). |

**What was done (Youssef, console):**

1. ☰ → **Cloud Build → Triggers** → region **us-west1** → click **`helloworld-deploy`**.
2. Section **Approval** → ✅ **Require approval before build executes** → **Save**.
3. `helloworld-pr` was **not** changed: PR checks never deploy, so they do not need approval.

Checked by Claude (terminal): `helloworld-deploy` → `approvalConfig.approvalRequired: True`; `helloworld-pr` → no approval.

**How a deploy works now:**

```
merge to main ─► build created, status "Awaiting approval" (no step runs, nothing deployed)
                   │
                   ├─ Approve ─► all 10 steps run ─► new revision on eval + tests
                   └─ Reject  ─► build ends, nothing deployed
```

**How to approve (console):** ☰ → **Cloud Build → History** (us-west1) → the build with **Awaiting approval** → **Review** → **Approve** (optional comment) → confirm. **Reject** stops it.

**Who can approve:** anyone with the permission `cloudbuild.builds.approve` — project Owners, or the role **Cloud Build Approver**. In a real team, give that role to a release manager and not to developers, so nobody approves their own change.

**Test (2026-10-15):**

| Item | Value |
|------|-------|
| Change | Comment in `Q-ImposeQuota.xml` (where the quota limits come from) — commit `1d1ec4a`, pushed to `main` |
| Build | `07c46853` (`helloworld-deploy`) |
| Created | 10:52:15 UTC — status **PENDING / Awaiting approval**, no steps ran |
| Approved | 10:54:19 UTC by `youssef.essam1955@gmail.com`, comment "Approved: quota comment, deploy to eval" |
| Ran | 10:54:20 → 10:57:38 UTC (3 min 18 s), all 10 steps ✅ |
| Result | **Revision 10** deployed on `eval`; Newman 8 assertions, 0 failed; key not in the log; bundle + reports in `gs://…-apigee-bundles/helloworld/1d1ec4af…/` |

The approval (who, when, comment) is stored with the build: Cloud Build → History → build → **Approval** details, and in Cloud Audit Logs.

**Notes / limits:**

- Approval gates the **whole** build (it waits before the first step), not only the deploy step. Lint and packaging already passed in the PR, so this is fine for the POC.
- Cloud Build does not notify anyone that a build is waiting. For a team, add notifications (Pub/Sub topic `cloud-builds` → email/Slack/Chat). Production backlog.
- If several merges are waiting, each build is approved separately; reject old ones to deploy only the latest.

---

### 11.2 Task 2 — Post-deployment tests in the pipeline (readable report)

**CSV:** *Add a Newman step after deployment, pointing to the deployed non-production URL. The pipeline must fail if post-deploy assertions fail; produce a readable report as an artifact.*

| Requirement | How it is met |
|-------------|---------------|
| Newman step after deployment | Step `api-tests` runs right after `deploy` in `cloudbuild-deploy.yaml` |
| Points to the deployed non-production URL | `APIGEE_BASE_URL` = trigger substitution `_APIGEE_BASE_URL` (`https://8.228.239.128.nip.io`, the `eval` hostname) |
| Pipeline fails if assertions fail | `api-tests` saves Newman's exit code; `store-report` stores the reports first and then exits with that code, so failing tests make the build **FAILURE** — and the report is still stored |
| **Readable report as an artifact** | **New:** HTML report `newman-eval.html` stored next to the bundle in Cloud Storage; the build log prints its link |

**What was changed (Claude):**

| File | Change |
|------|--------|
| `package.json` / `package-lock.json` | New dev dependency **`newman-reporter-htmlextra` 1.23.1** (pinned with `npm install -D -E`). A Newman *reporter* is a plugin that writes results in a format; htmlextra writes a single HTML page. |
| `tests/postman/run-cloud.js` | Reporters `cli,junit,htmlextra`; writes `reports/newman-<env>.xml` (JUnit, for tools) **and** `reports/newman-<env>.html` (for people), with a report title. After Newman finishes, the API key is replaced with `***` in **both report files** (they contain request URLs, like the console output — issue 8.17). |
| `cloudbuild-deploy.yaml` → `store-report` | Copies the XML **and** HTML report to `gs://<bucket>/helloworld/<commit>/` and prints `Test report (HTML): https://storage.cloud.google.com/...` |

Newman options used:

| Option | What it does |
|--------|--------------|
| `-r cli,junit,htmlextra` | Three reporters: console output, JUnit XML, HTML |
| `--reporter-junit-export <file>` | Where the XML goes |
| `--reporter-htmlextra-export <file>` | Where the HTML goes |
| `--reporter-htmlextra-title` / `-browserTitle` | Heading and browser tab title of the report |

Local check before pushing: `npm run test:api:eval` → 8/8 passed; `reports/newman-eval.html` created (80 KB); key found 0 times in the console output, the XML and the HTML (the HTML shows `apikey&#x3D;***`, the HTML-encoded form of `apikey=***`).

**What the report shows:** a summary dashboard (iterations, requests, assertions, failed tests, average response time), then each request — method, URL (key masked), status, response time, response headers and body — and each assertion as pass/fail. A failed assertion is shown in red with its error message.

**How to open it (console):**

- Cloud Build → History → the build → step **`store-report`** → click the `Test report (HTML)` link in the log (opens in the browser while you are signed in to Google), **or**
- ☰ → **Cloud Storage → Buckets → `project-953dc129-1db1-4aea-ae3-apigee-bundles` → `helloworld/<commit>/`** → **`newman-eval.html`** → **Authenticated URL**.

The bucket is private: only signed-in users with access to the project can open the report.

**Test (2026-10-15):**

| Item | Value |
|------|-------|
| Commit | `c0849d8` (pushed to `main`) |
| Build | `d9297e20` — waited for approval; approved by `youssef.essam1955@gmail.com` at 11:08:53 UTC |
| Ran | 11:08:54 → 11:12:41 UTC, all 10 steps ✅ |
| Deployed | **Revision 11** on `eval` |
| Tests | 8 assertions, 0 failed |
| Stored in `helloworld/c0849d8…/` | `helloworld-1.0.0.zip`, `build-info.json`, `apigeelint-baseline.json`, `newman-eval.xml`, **`newman-eval.html`** (80 KB, content type `text/html`) |
| Key | Not in the build log; not in the HTML report (URL shows `apikey=***`) |

**Not demonstrated yet on Cloud Build:** a run where a post-deploy assertion fails (Day 3 showed it locally and on GitHub Actions, 9.4/9.9). It is part of the final clean run evidence (task 7).

---

**Next:** Day 4 task 4 — configuration and secret review (then task 3).

