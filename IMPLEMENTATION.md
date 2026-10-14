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
9. [Day 3 — Non-Production Deployment & CI](#9-day-3--non-production-deployment--ci)

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

### 9.7 Remaining Day 3 steps

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

**Next:** Day 4 — controlled deployment stage (deploy only after merge/approval), configuration and secret review, and switching the pipeline to the staging environment once its TLS certificate is fixed (8.11).
