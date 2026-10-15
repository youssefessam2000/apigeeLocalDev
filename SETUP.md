# Machine Setup — New PC / Laptop (Windows)

Step-by-step guide to set up a new Windows machine, clone this project and check that everything works.
Follow the steps in order. Run each command **on its own line** (multi-line pastes can merge in PowerShell).

**What you get at the end:** lint, packaging, local emulator tests and eval API tests all work, and you can continue the POC with Claude Code.

---

## 0. What is needed and why

| # | Tool | Version (same as main PC) | Why it is needed | Required? |
|---|------|---------------------------|------------------|-----------|
| 1 | Chocolatey | 2.4+ | Windows package manager used to install the rest | Yes |
| 2 | Git | 2.45+ | Clone / commit / push the repo | Yes |
| 3 | Node.js (+ npm) | **22.x** | Runs apigeelint, Newman and the test scripts (`run-local.js`, `run-cloud.js`) | Yes |
| 4 | apigeelint | **2.85.1** (npm, from `package.json`) | Static analysis (lint) of the proxy — quality gate | Yes (installed by `npm ci`) |
| 5 | Newman | **6.2.3** (npm, from `package.json`) | Runs the Postman collection from the command line — quality gate | Yes (installed by `npm ci`) |
| 6 | Java JDK (Eclipse Temurin) | **17** | Maven and the Apigee Maven plugin are Java programs | Yes |
| 7 | Maven | **3.9.16** | Packages the proxy into a zip and deploys it to Apigee (`pom.xml`) | Yes |
| 8 | apigee-edge-maven-plugin | 2.5.2 | Deploy plugin used by `pom.xml` | Automatic (Maven downloads it) |
| 9 | Google Cloud CLI (gcloud) | 589+ | Google login, access tokens for Apigee, Cloud Build / IAM / Secret Manager commands | Yes |
| 10 | VS Code | Latest | Editor | Yes |
| 11 | Cloud Code extension (VS Code) | Latest | Apigee workspace view + local Apigee Emulator | Yes (for local work) |
| 12 | Docker Desktop (+ WSL 2) | Latest | Runs the Apigee Emulator container | Yes (for local work) |
| 13 | Claude Code | Latest | AI assistant used to build this POC | Recommended |
| 14 | apigeecli | Latest | Google's CLI for Apigee (list/export/deploy proxies, products, apps, KVMs). Not used by the pipeline yet; useful for Day 4 (promotion, config review) | Optional |
| 15 | GitHub CLI (`gh`) | Latest | View pipeline runs and PRs from the terminal | Optional |
| 16 | Postman (desktop app) | Latest | Edit the test collection visually | Optional |

> Nothing secret is in Git. The API key, `node_modules/`, `target/` (build + emulator data) and `reports/` are **not** in the repo; this guide recreates them.

---

## 1. Install Chocolatey

Open **PowerShell as Administrator** (Start → type *PowerShell* → right-click → *Run as administrator*):

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

Close and reopen PowerShell **as Administrator**, then check:

```powershell
choco --version
```

---

## 2. Install the tools (PowerShell as Administrator)

Run one line at a time.

**Required**

```powershell
choco install git -y
```
```powershell
choco install nodejs --version=22.12.0 -y
```
```powershell
choco install temurin17 -y
```
```powershell
choco install maven -y
```
```powershell
choco install gcloudsdk -y
```
```powershell
choco install vscode -y
```
```powershell
choco install docker-desktop -y
```

**Optional**

```powershell
choco install gh -y
```
```powershell
choco install postman -y
```

**Restart the computer** (Docker Desktop needs it for WSL 2, and it refreshes PATH for all tools).

After the restart, open **Docker Desktop** once and accept the terms. If it asks to install/update WSL, run this and restart again:

```powershell
wsl --install
```

---

## 3. Check the versions

Open a **normal** PowerShell (not Administrator):

```powershell
git --version; node -v; npm -v; java -version; mvn -v; gcloud --version; docker --version
```

Expected (roughly):

| Command | Expected |
|---------|----------|
| `node -v` | `v22.x` |
| `java -version` | `openjdk version "17..."` (Temurin) |
| `mvn -v` | `Apache Maven 3.9.x` and **`Java version: 17...`** |
| `gcloud --version` | `Google Cloud SDK 5xx` |
| `docker --version` | `Docker version 2x...` |

If `mvn -v` shows a different Java, set `JAVA_HOME` to the Temurin 17 folder (System Properties → Environment Variables), e.g. `C:\Program Files\Eclipse Adoptium\jdk-17...`, then reopen the terminal.

If `gcloud` is not found, reopen the terminal; it installs to `C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin`.

---

## 4. Configure Git

```powershell
git config --global user.name "Youssef Essam"
```
```powershell
git config --global user.email "<your GitHub email>"
```

---

## 5. Clone the project and install npm packages

Choose a folder (example uses the same path as the main PC):

```powershell
mkdir "D:\vs code\Projects\apigeeee local"; cd "D:\vs code\Projects\apigeeee local"
```
```powershell
git clone https://github.com/youssefessam2000/apigeeLocalDev.git myapigeeworkspace
```

The repo is **private**: Git opens a browser window to sign in to GitHub — sign in as `youssefessam2000`.

```powershell
cd myapigeeworkspace; npm ci
```

`npm ci` installs the exact versions from `package-lock.json` into `node_modules/` — this includes **apigeelint 2.85.1** and **Newman 6.2.3**. You do not need to install them globally; the npm scripts use the local copies.

(Optional) global copies, if you want to call them directly from any folder:

```powershell
npm install -g apigeelint@2.85.1 newman@6.2.3
```

---

## 6. Sign in to Google Cloud

Use the **same account in gcloud and Cloud Code** (see `IMPLEMENTATION.md` issue 8.10).

```powershell
gcloud auth login youssef.essam1955@gmail.com
```
```powershell
gcloud config set project project-953dc129-1db1-4aea-ae3
```
```powershell
gcloud auth print-access-token
```

The last command must print a long token (do not share it). That token is what Maven uses to deploy.

> Do not run `gcloud auth revoke` from a VS Code terminal (issue 8.10).

---

## 7. VS Code extensions

```powershell
code --install-extension googlecloudtools.cloudcode
```

Then in VS Code: open the folder `myapigeeworkspace` → `Ctrl+Shift+P` → **Cloud Code: Sign In** → sign in with **youssef.essam1955@gmail.com** (same as gcloud).

Recommended extra extensions (optional):

```powershell
code --install-extension redhat.vscode-xml
```
```powershell
code --install-extension Postman.postman-for-vscode
```

---

## 8. Install apigeecli (optional)

apigeecli is a single `.exe`. Download the latest Windows release and add it to PATH (normal PowerShell):

```powershell
$rel = Invoke-RestMethod https://api.github.com/repos/apigee/apigeecli/releases/latest; $asset = $rel.assets | Where-Object { $_.name -like "*Windows_x86_64.zip" } | Select-Object -First 1; $dir = "$env:USERPROFILE\.apigeecli"; New-Item -ItemType Directory -Force $dir | Out-Null; Invoke-WebRequest $asset.browser_download_url -OutFile "$dir\apigeecli.zip"; Expand-Archive "$dir\apigeecli.zip" -DestinationPath $dir -Force; Get-ChildItem $dir -Recurse -Filter apigeecli.exe | Select-Object -First 1 -ExpandProperty FullName
```

The last part prints the path of `apigeecli.exe`. Add its folder to your user PATH (replace the folder with the printed one):

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";<folder that contains apigeecli.exe>", "User")
```

Reopen the terminal and test (lists the proxies in the eval org):

```powershell
apigeecli apis list --org project-953dc129-1db1-4aea-ae3 --token (gcloud auth print-access-token)
```

Expected: `helloworld`, `hello-world`, `oauth-v1`.

---

## 9. Install Claude Code (recommended)

```powershell
irm https://claude.ai/install.ps1 | iex
```

Reopen the terminal, `cd` into the project and run `claude`, then sign in.

---

## 10. Verify everything works

Run from the project folder (`myapigeeworkspace`).

**10.1 Lint (apigeelint)**

```powershell
npm run lint
```
Expected: a table with no **errors** (warnings are OK), exit code 0.

**10.2 Package (Java + Maven + Apigee plugin)**

```powershell
$env:APIGEE_ORG = "project-953dc129-1db1-4aea-ae3"; $env:APIGEE_ENV = "eval"; $env:APIGEE_TOKEN = "dummy"; mvn package -P nonprod
```
Expected: `BUILD SUCCESS` and `target\helloworld-1.0.0.zip`. The first run downloads the Maven plugins (takes a minute).

**10.3 API tests against Apigee eval (Newman)**

Get the key: Apigee console → **Distribution → Apps → `helloworld-app`** → copy the key.

```powershell
$env:APIGEE_APIKEY = "<helloworld-app key>"; npm run test:api:eval
```
Expected: 8/8 assertions passed.

**10.4 Local emulator (only if you work locally)**

1. Start **Docker Desktop**.
2. VS Code → Cloud Code → **Apigee** panel → **Apigee Emulator** → create and start a container (default ports 8080 control / 8998 traffic).
3. Deploy the proxy: Apigee Workspace → `helloworld` → **Deploy to Apigee Emulator**.
4. Deploy the test data: `src/tests/mytestbundle` → **Deploy test data** (creates product, developer and app `myapp`).
5. Run all local quality gates:

```powershell
npm test
```
Expected: lint passes and Newman passes (`run-local.js` reads the emulator key automatically).

**10.5 (Optional) Manual deploy to eval** — the pipeline normally does this; only use it to test your login:

```powershell
$env:APIGEE_ORG = "project-953dc129-1db1-4aea-ae3"; $env:APIGEE_ENV = "eval"; $env:APIGEE_TOKEN = (gcloud auth print-access-token); mvn install -P nonprod
```
This creates a **new revision** on eval.

If 10.1–10.3 pass, the laptop is ready.

---

## 11. Continue the POC

In the project folder run `claude` and say:

> Read CHAT_HISTORY.md and IMPLEMENTATION.md, then continue where we stopped (see "Resume here").

---

## Rules to remember

- **Never run `mvn clean`** — it deletes `target/`, which holds the emulator test data.
- **Never commit** API keys or tokens (`git grep -i apikey` before committing).
- Only `main` is used; push directly to `main`. `.md` and `.csv` changes do **not** trigger the pipeline.
- The pipeline runs in the cloud (GitHub Actions now, Cloud Build later) — pushing from the laptop deploys exactly the same as from the main PC.
- Role grants (IAM) are run by Youssef in the terminal, not by Claude.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `mvn` / `node` / `gcloud` not recognized | Reopen the terminal (or restart) so PATH updates |
| `mvn -v` shows the wrong Java | Set `JAVA_HOME` to the Temurin 17 folder |
| Maven `401` / `403` on deploy | `gcloud auth login` again; check the account with `gcloud config list` |
| gcloud uses the wrong account inside VS Code | Sign in to Cloud Code with the same account (issue 8.10) |
| Newman `401` on eval | Wrong/missing `APIGEE_APIKEY`; copy the key from `helloworld-app` again |
| `npm test` says "Is the emulator running?" | Start Docker + the emulator, deploy `helloworld` and `mytestbundle` (10.4) |
| Docker Desktop won't start | Run `wsl --install`, restart, enable virtualization in BIOS if asked |
| `git clone` asks for a password | Use the browser sign-in window (GitHub no longer accepts passwords) |
