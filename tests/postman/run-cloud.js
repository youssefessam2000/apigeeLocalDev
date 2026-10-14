// Runs the Newman suite against a deployed Apigee X environment.
// The API key is read from the APIGEE_APIKEY environment variable instead of
// a command-line flag: Windows PowerShell drops the "--" in
// `npm run x -- --env-var ...`, and CI secrets are exposed as env vars anyway.
//
// Usage:
//   node tests/postman/run-cloud.js <env>     e.g. eval, stagin
//   APIGEE_APIKEY  API key of a developer app with access to the proxy (required)
//
// Uses tests/postman/env/<env>.postman_environment.json and writes
// reports/newman-<env>.xml.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envName = process.argv[2];
const apiKey = process.env.APIGEE_APIKEY;
const root = path.resolve(__dirname, '..', '..');

if (!envName) {
  console.error('Error: missing environment name, e.g. node tests/postman/run-cloud.js eval');
  process.exit(1);
}
const envFile = `tests/postman/env/${envName}.postman_environment.json`;
if (!fs.existsSync(path.join(root, envFile))) {
  console.error(`Error: ${envFile} not found.`);
  process.exit(1);
}
if (!apiKey) {
  console.error('Error: APIGEE_APIKEY is not set. Set it to the API key of the test developer app.');
  process.exit(1);
}

const args = [
  require.resolve('newman/bin/newman.js'),
  'run', 'tests/postman/hello.postman_collection.json',
  '-e', envFile,
  '--env-var', `apikey=${apiKey}`,
  '-r', 'cli,junit',
  '--reporter-junit-export', `reports/newman-${envName}.xml`,
  ...process.argv.slice(3),
];

const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
