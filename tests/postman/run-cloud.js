// Runs the Newman suite against a deployed Apigee X environment.
// The API key is read from the APIGEE_APIKEY environment variable instead of
// a command-line flag: Windows PowerShell drops the "--" in
// `npm run x -- --env-var ...`, and CI secrets are exposed as env vars anyway.
//
// Usage:
//   node tests/postman/run-cloud.js <env>     e.g. eval, stagin
//   APIGEE_APIKEY    API key of a developer app with access to the proxy (required)
//   APIGEE_BASE_URL  overrides the environment file's baseUrl (optional, used by CI)
//
// Uses tests/postman/env/<env>.postman_environment.json and writes
// reports/newman-<env>.xml (JUnit, for tools) and reports/newman-<env>.html
// (readable report, newman-reporter-htmlextra). The API key is masked in the
// console output and in both report files.

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

const reports = {
  junit: `reports/newman-${envName}.xml`,
  html: `reports/newman-${envName}.html`,
};

const args = [
  require.resolve('newman/bin/newman.js'),
  'run', 'tests/postman/hello.postman_collection.json',
  '-e', envFile,
  '--env-var', `apikey=${apiKey}`,
  '-r', 'cli,junit,htmlextra',
  '--reporter-junit-export', reports.junit,
  '--reporter-htmlextra-export', reports.html,
  '--reporter-htmlextra-title', `helloworld API tests - ${envName}`,
  '--reporter-htmlextra-browserTitle', `helloworld - ${envName}`,
];
if (process.env.APIGEE_BASE_URL) {
  args.push('--env-var', `baseUrl=${process.env.APIGEE_BASE_URL}`);
}
args.push(...process.argv.slice(3));

// Newman prints request URLs, which contain ?apikey=<key>. Cloud Build does not
// mask secrets in logs, so the key is replaced before the output is printed.
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: ['inherit', 'pipe', 'pipe'],
  maxBuffer: 64 * 1024 * 1024,
});
const mask = (buf) => (buf ? buf.toString().split(apiKey).join('***') : '');
process.stdout.write(mask(result.stdout));
process.stderr.write(mask(result.stderr));

// The reports also contain request URLs; mask the key before they are stored.
for (const file of Object.values(reports)) {
  const full = path.join(root, file);
  if (fs.existsSync(full)) fs.writeFileSync(full, mask(fs.readFileSync(full)));
}
process.exit(result.status === null ? 1 : result.status);
