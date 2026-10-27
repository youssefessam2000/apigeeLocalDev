// Runs the Newman suite against the local Apigee emulator.
// The emulator generates a new API key each time the test bundle is deployed,
// so the key is read from the emulator's control API instead of being stored.
//
// Overrides:
//   EMULATOR_CONTROL_URL  control API base URL (default http://localhost:8080)
//   EMULATOR_APP_NAME     developer app whose key is used (default myapp)
//   --env-var "apikey=…"  skips the lookup and uses the given key

const { spawnSync } = require('child_process');
const path = require('path');

const CONTROL_URL = process.env.EMULATOR_CONTROL_URL || 'http://localhost:8081';
const APP_NAME = process.env.EMULATOR_APP_NAME || 'myapp';

const root = path.resolve(__dirname, '..', '..');
const extraArgs = process.argv.slice(2);

async function fetchApiKey() {
  const url = `${CONTROL_URL}/v1/emulator/test/developerapps`;
  let apps;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    apps = await res.json();
  } catch (err) {
    throw new Error(`Could not read test data from ${url} (${err.message}). Is the emulator running?`);
  }

  const app = (apps || []).find((a) => a.name === APP_NAME);
  if (!app) {
    throw new Error(`Developer app "${APP_NAME}" not found in emulator. Deploy the test bundle (src/tests/mytestbundle) first.`);
  }
  const cred = (app.credentials || []).find((c) => c.status === 'approved');
  if (!cred) throw new Error(`Developer app "${APP_NAME}" has no approved credentials.`);
  return cred.consumerKey;
}

async function main() {
  const args = [
    require.resolve('newman/bin/newman.js'),
    'run', 'tests/postman/hello.postman_collection.json',
    '-e', 'tests/postman/env/local.postman_environment.json',
    '-r', 'cli,junit',
    '--reporter-junit-export', 'reports/newman-local.xml',
  ];

  const keyGiven = extraArgs.some((a) => a.startsWith('apikey='));
  if (!keyGiven) {
    const key = await fetchApiKey();
    console.log(`Using API key of emulator app "${APP_NAME}" (${key.slice(0, 4)}…)`);
    args.push('--env-var', `apikey=${key}`);
  }
  args.push(...extraArgs);

  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
