# Build the Apigee CI/CD Pipeline Yourself (Cloud Build) — Step by Step

A practice guide for rebuilding this project's pipeline from zero, using the **Google Cloud console (UI)**.
It is the short "how to" version; `IMPLEMENTATION.md` has the full history, explanations and every issue we hit (section 8).

**What you will have at the end**

```
Pull request to main ──► trigger helloworld-pr:      install → lint → package             (no deploy, no secrets)
Push / merge to main ──► trigger helloworld-deploy:  [manual approval] → install → lint → package → store bundle (Cloud Storage)
                                                     → deploy to Apigee eval (Maven plugin)
                                                     → API tests (Newman, key from Secret Manager) → store report
.md / .csv only      ──► nothing runs
```

> Tip: if you practice in a **new** GCP project or repo, replace the values in the table below everywhere. If you practice in the same project, use different names (e.g. add `-practice`) so you do not break the working pipeline, and remember both pipelines deploy the same proxy to `eval` if you keep the proxy name.

| Value used in this guide | This project |
|--------------------------|--------------|
| GCP project / Apigee org | `project-953dc129-1db1-4aea-ae3` |
| Region | `us-west1` (same as the Apigee org) |
| Apigee environment | `eval` |
| Apigee hostname | `https://8.228.239.128.nip.io` |
| GitHub repo | `youssefessam2000/apigeeLocalDev` |
| Service account | `cloudbuild-apigee-deployer` |
| Secret | `apigee-helloworld-apikey` |
| Bucket | `project-953dc129-1db1-4aea-ae3-apigee-bundles` |

---

## Part 0 — Before you start

- [ ] Tools installed and the repo cloned → follow **`SETUP.md`**.
- [ ] The proxy works locally: `npm run lint` passes and `mvn package -P nonprod` gives `BUILD SUCCESS`.
- [ ] You are **Owner** of the GCP project (needed to create service accounts and grant roles).
- [ ] The repo contains: `src/main/apigee/apiproxies/helloworld/`, `pom.xml`, `package.json` + `package-lock.json`, `tests/postman/` (collection, `env/eval.postman_environment.json`, `run-cloud.js`).

In the console, select the project in the top bar first. "☰" = navigation menu (top left).

---

## Part 1 — Test data in Apigee (product, developer, app)

The API needs an API key, so the pipeline's tests need an app with a key.

**1.1 API product** — ☰ → **Apigee → Distribution → API products** → **+ Create**

| Field | Value |
|-------|-------|
| Name / Display name | `helloworld-product` |
| Access | Public (or Private) |
| Automatically approve access requests | ✅ |
| Quota | 100 requests per 1 minute |
| Operations → Add an operation | Proxy `helloworld`, path `/` and `/**`, methods GET |
| Environments | `eval` |

→ **Save**. (The proxy must be deployed once before it appears in the list — Part 6 can do that, or deploy it manually once: see `IMPLEMENTATION.md` 9.2.)

**1.2 Developer** — ☰ → **Apigee → Distribution → Developers** → **+ Create**: first name `Alex`, last name `Hamilton`, email `ahamilton@example.com`, username `ahamilton` → **Add**.

**1.3 App** — ☰ → **Apigee → Distribution → Apps** → **+ Create**: name `helloworld-app`, developer `ahamilton@example.com`, **Add credential** → product `helloworld-product` → **Create**.

**1.4 Copy the key** — open `helloworld-app` → **Credentials** → eye icon next to **Key** → copy. (The **Key**, not the Secret.)

✅ Check: `$env:APIGEE_APIKEY = "<key>"; npm run test:api:eval` → 8 assertions, 0 failed.

---

## Part 2 — Google Cloud setup

**2.1 Enable APIs** — ☰ → **APIs & Services → Library** → enable **Cloud Build API** and **Secret Manager API** (and **Apigee API** if not already).

**2.2 Service account** (the identity the pipeline runs as) — ☰ → **IAM & Admin → Service Accounts** → **+ Create service account**

1. Name `Cloud Build Apigee deployer`, ID `cloudbuild-apigee-deployer` → **Create and continue**.
2. Roles (**+ Add another role** for each):

   | Role | Why | What breaks without it |
   |------|-----|------------------------|
   | **Apigee API Admin** | Import the proxy, create revisions | Deploy step fails |
   | **Apigee Environment Admin** | Deploy a revision to `eval` | Deploy fails with **403** (issue 8.14) |
   | **Secret Manager Secret Accessor** | Read the API key | Build fails before `api-tests` |
   | **Logs Writer** | Write build logs | Build cannot start / no logs |
3. **Continue → Done**.

✅ Check: ☰ → **IAM & Admin → IAM** → filter `cloudbuild-apigee-deployer` → 4 roles.

**2.3 Secret** — ☰ → **Security → Secret Manager** → **+ Create secret**

| Field | Value |
|-------|-------|
| Name | `apigee-helloworld-apikey` |
| Secret value | The key from 1.4 — **no space or new line** |
| Replication | Automatic |

→ **Create secret**. ✅ Check: Version 1 — Enabled.

**2.4 Bucket** (keeps every deployed bundle + reports) — ☰ → **Cloud Storage → Buckets** → **+ Create**

| Setting | Value |
|---------|-------|
| Name | `<project-id>-apigee-bundles` |
| Location | Region → `us-west1` |
| Storage class | Standard |
| Public access | ✅ Enforce public access prevention |
| Access control | Uniform |

→ **Create**.

**2.5 Bucket permission** — open the bucket → **Permissions** → **Grant access** → principal `cloudbuild-apigee-deployer@<project-id>.iam.gserviceaccount.com`, role **Storage Object Admin** → **Save**.

---

## Part 3 — Connect GitHub to Cloud Build

☰ → **Cloud Build → Repositories** → **2nd gen** tab → **Create host connection**

1. Provider **GitHub**, Region **us-west1**, Name `github-conn` → **Connect**.
2. If asked to grant **Secret Manager Admin** to the Cloud Build service agent → **Grant**.
3. GitHub window: **Authorize** Google Cloud Build, then **Install** the app → **Only select repositories** → your repo.
4. Back in the console → **Link repository** → select the repo → **Link**.

✅ Check: the connection shows a green status and the repo is listed under it.

---

## Part 4 — The pipeline files (in the repo root)

Copy them from this repo or write them yourself. Key ideas:

**Readable test report (Day 4 task 2):** install the HTML reporter once — `npm install -D -E newman-reporter-htmlextra@1.23.1` — and run Newman with `-r cli,junit,htmlextra --reporter-htmlextra-export reports/newman-eval.html` (already in `run-cloud.js`).

**`cloudbuild.yaml`** — pull request checks

```yaml
steps:
  - id: install
    name: node:22
    entrypoint: npm
    args: ['ci']
  - id: lint
    name: node:22
    entrypoint: npm
    args: ['run', 'lint']
  - id: package
    name: maven:3.9.9-eclipse-temurin-17
    entrypoint: mvn
    args: ['-B', 'package', '-P', 'nonprod']
    env: ['APIGEE_ORG=${_APIGEE_ORG}', 'APIGEE_ENV=${_APIGEE_ENV}']
substitutions:
  _APIGEE_ORG: <project-id>
  _APIGEE_ENV: eval
options:
  logging: CLOUD_LOGGING_ONLY
```

**`cloudbuild-deploy.yaml`** — deploy pipeline: see the file in the repo. Its steps:

| # | Step | Does |
|---|------|------|
| 1 | `install` | `npm ci` |
| 2 | `lint` | `npm run lint` (quality gate) |
| 3 | `lint-report` | `npm run lint:report` |
| 4 | `package` | `mvn package -P nonprod` → `target/helloworld-1.0.0.zip` |
| 5 | `build-info` | writes `target/build-info.json` (commit, build ID, time) |
| 6 | `store-bundle` | `gcloud storage cp` zip + info + lint report → `gs://<bucket>/helloworld/$COMMIT_SHA/` |
| 7 | `get-token` | `gcloud auth print-access-token > /workspace/.apigee-token` |
| 8 | `deploy` | reads + deletes the token file, `mvn -P nonprod apigee-enterprise:deploy` |
| 9 | `api-tests` | `node tests/postman/run-cloud.js eval` with `secretEnv: ['APIGEE_APIKEY']`; writes XML + HTML reports; saves exit code |
| 10 | `store-report` | copies `newman-eval.xml` + `newman-eval.html` to the bucket, prints the report link, exits with the test exit code (quality gate) |

Plus:

```yaml
availableSecrets:
  secretManager:
    - versionName: projects/$PROJECT_ID/secrets/${_APIKEY_SECRET}/versions/latest
      env: APIGEE_APIKEY
options:
  logging: CLOUD_LOGGING_ONLY
```

**Rules that bite (learned the hard way):**

| Rule | Why |
|------|-----|
| `options.logging: CLOUD_LOGGING_ONLY` | Required when the build runs as your own service account |
| Shell variables as `$$VAR`, `$$(command)` | A single `$` is read by Cloud Build as a substitution |
| Every substitution you set on a trigger must be used in the YAML | Default `MUST_MATCH` mode fails the build otherwise |
| Mask the key in Newman output **and report files** | Cloud Build does **not** hide secrets in logs; Newman prints `?apikey=<key>` URLs (issue 8.17) and the reports contain them too. `run-cloud.js` replaces the key with `***` everywhere |
| Do not run `mvn clean` in steps that need the zip | It deletes `target/` |

Commit and push the files to a **branch** (not `main` yet) — Part 6 tests them through a PR.

If GitHub Actions is still active, change `.github/workflows/ci.yml` to `on: workflow_dispatch:` only in the same branch, so a merge does not deploy twice.

---

## Part 5 — Triggers

☰ → **Cloud Build → Triggers** → region **us-west1** → **+ Create trigger**

**5.1 `helloworld-pr`**

| Field | Value |
|-------|-------|
| Name | `helloworld-pr` |
| Region | `us-west1` |
| Event | **Pull request** |
| Repository | 2nd gen → your linked repo |
| Base branch | `^main$` |
| Comment control | Not required |
| Ignored files (under "Show included and ignored files filters") | `**/*.md`, `**/*.csv`, `*.md`, `*.csv` |
| Configuration | Cloud Build configuration file, location Repository, `cloudbuild.yaml` |
| Service account | `cloudbuild-apigee-deployer@...` |

**5.2 `helloworld-deploy`** — same, except: Event **Push to a branch**, branch `^main$`, file `cloudbuild-deploy.yaml`, substitution variables `_APIGEE_ENV` = `eval`, `_APIGEE_BASE_URL` = `https://<apigee hostname>`.

✅ Check: both triggers listed and enabled.

**5.3 Manual approval before deploy** (Day 4 task 1)

1. **Cloud Build → Triggers** → click **`helloworld-deploy`**.
2. **Approval** → ✅ **Require approval before build executes** → **Save**.
3. Leave `helloworld-pr` without approval (it never deploys).

Now every merge waits as **Awaiting approval** until approved. Approvers need project Owner or the **Cloud Build Approver** role.

---

## Part 6 — Test it

1. GitHub → **New pull request** from your branch to `main`.
2. The PR shows a **Cloud Build** check → ☰ → **Cloud Build → History** (us-west1) → `helloworld-pr` → green.
3. **Merge** the PR → `helloworld-deploy` starts and waits with **Awaiting approval**.
4. **Approve:** Cloud Build → History → the waiting build → **Review** → **Approve** → all 10 steps green (~3–4 min). (Try **Reject** once too: nothing is deployed.)
5. **Red test:** make a PR that breaks lint (e.g. remove `<DisplayName>` from a policy or change a test's expected status) → the PR check is red → close it without merging.

## Part 7 — Verify the result

| What | Where in the console | Expected |
|------|----------------------|----------|
| Build steps and logs | Cloud Build → History → build → click a step | All green; `api-tests` shows 8 assertions, 0 failed; URL shows `apikey=***` |
| New revision | Apigee → Proxy development → API proxies → `helloworld` → Deployments | New revision deployed on `eval` |
| Stored files | Cloud Storage → bucket → `helloworld/<commit>/` | `helloworld-1.0.0.zip`, `build-info.json`, `apigeelint-baseline.json`, `newman-eval.xml`, `newman-eval.html` |
| Readable test report | `store-report` step log → `Test report (HTML)` link, or bucket → `newman-eval.html` → **Authenticated URL** | Dashboard: 3 requests, 8 assertions, 0 failed; URL shows `apikey=***` |
| API works | Browser / curl: `https://<hostname>/helloworld?apikey=<key>` | 200 JSON |

Traceability: commit → Cloud Build build ID (`build-info.json`) → bundle in the bucket → Apigee revision (deploy step log) → test report.

---

## Part 8 — Configuration and secret check (Day 4 task 4)

Before calling the pipeline done, check:

- [ ] **Git:** no keys/tokens in files or history — `git grep -I -c -F "<key>" $(git rev-list --all)` → no output (do not paste the key into files; use an environment variable).
- [ ] **Artifacts:** download the bucket folder, unzip the bundle, search for the key → nothing; reports show `apikey=***`.
- [ ] **Logs:** Cloud Build → History → each build → search the log for `apikey=` → only `***`. (When scripting this, save each log to a file first — fast reads can return empty logs.)
- [ ] **Secrets only in Secret Manager** (delete old copies, e.g. GitHub secrets).
- [ ] **No service account keys:** IAM & Admin → Service Accounts → each account → **Keys** tab is empty.
- [ ] **Least privilege:** IAM & Admin → IAM → each service account has only the roles it needs.
- [ ] **Apigee config:** Apigee → Management → Environments → `eval` → Target servers, Key value maps, Keystores → note what the proxy uses (here: none).
- [ ] **Manual vs code list** written down (see `IMPLEMENTATION.md` 11.4.6).
- [ ] If a key ever appeared in a log: **rotate it**.

## Troubleshooting

| Symptom | Cause | Fix | Issue |
|---------|-------|-----|-------|
| Deploy step: `403 PERMISSION_DENIED` | Missing Apigee Environment Admin | Add the role to the service account | 8.14 |
| Build fails to start: logs bucket / logging error | User-managed service account without logging option | `options.logging: CLOUD_LOGGING_ONLY` | — |
| Manual `gcloud builds submit` → 403 on `<project>_cloudbuild` | Service account cannot read uploaded source | Test through triggers, or grant Storage Object Viewer on that bucket | 8.16 |
| `api-tests` 401 | Wrong key in the secret (extra space/new line) or app not approved for the product | Re-create the secret version; check app credentials | 8.15 |
| API key visible in the build log | Newman prints request URLs | Mask it in `run-cloud.js` | 8.17 |
| A docs change starts a build | Ignored files filter missing | Add `**/*.md`, `*.md`, … to the trigger | — |
| `gcloud` uses the wrong account in VS Code | Cloud Code credentials override | Sign in to Cloud Code with the same account | 8.10 |

---

## Practice checklist

- [ ] Part 1 — product, developer, app; key copied; eval tests pass locally
- [ ] Part 2 — APIs, service account + 4 roles, secret, bucket, bucket permission
- [ ] Part 3 — GitHub connection + linked repo
- [ ] Part 4 — `cloudbuild.yaml`, `cloudbuild-deploy.yaml` on a branch
- [ ] Part 5 — two triggers + approval on `helloworld-deploy`
- [ ] Part 6 — green PR, merge, approve, green deploy, red PR demo
- [ ] Part 7 — revision, bucket files, HTML report opens, logs and report without the key
