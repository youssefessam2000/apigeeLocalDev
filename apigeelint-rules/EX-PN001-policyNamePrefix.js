// Custom apigeelint rule EX-PN001: team policy naming convention.
//
// Every policy name must be <PREFIX>-<Name>:
//   - PREFIX is the exact upper-case prefix for the policy type (TYPE_PREFIXES below);
//   - Name is PascalCase: starts with an upper-case letter, letters and digits only.
//   e.g. AM-RemoveApiKeyParam, Q-ImposeQuota, VAK-VerifyApiKey
//
// Why a custom rule: the built-in PO007 is only a warning, ignores case and accepts loose
// prefixes ("verify", "xmltojson"), so names like "verify-api-key" pass it. This rule is an
// error, so a badly named policy fails lint and therefore the build.
//
// A policy type that is not in TYPE_PREFIXES gets a warning (not an error): add its prefix
// here when the team starts using that type.
//
// Loaded with: apigeelint -x apigeelint-rules ...   (file names must match EX-XX000-*.js)
"use strict";

const TYPE_PREFIXES = {
  AssignMessage: "AM",
  ExtractVariables: "EV",
  FlowCallout: "FC",
  GenerateJWT: "GJ",
  JSONToXML: "J2X",
  Javascript: "JS",
  KeyValueMapOperations: "KVM",
  MessageLogging: "ML",
  OAuthV2: "OA2",
  Quota: "Q",
  RaiseFault: "RF",
  ResponseCache: "RC",
  ServiceCallout: "SC",
  SpikeArrest: "SA",
  VerifyAPIKey: "VAK",
  VerifyJWT: "VJ",
  XMLToJSON: "X2J"
};

const NAME_PART = /^[A-Z][A-Za-z0-9]*$/;

const plugin = {
  ruleId: "EX-PN001",
  name: "Policy naming convention - <PREFIX>-<PascalCaseName>",
  message: "Policy names must be <PREFIX>-<PascalCaseName> with the team prefix for the policy type.",
  fatal: false,
  severity: 2, // error: fails lint
  nodeType: "Policy",
  enabled: true
};

// Returns null when the name is fine, otherwise { severity, message }.
function check(policyName, policyType) {
  const prefix = TYPE_PREFIXES[policyType];
  if (!prefix) {
    return {
      severity: 1,
      message: `No team prefix is defined for policy type ${policyType} (policy "${policyName}"). ` +
        "Add one to TYPE_PREFIXES in apigeelint-rules/EX-PN001-policyNamePrefix.js."
    };
  }
  const expected = `${prefix}-<PascalCaseName>, e.g. ${prefix}-DoSomething`;
  if (!policyName) {
    return { severity: 2, message: `Policy of type ${policyType} has no name. Expected ${expected}.` };
  }
  if (!policyName.startsWith(prefix + "-")) {
    return {
      severity: 2,
      message: `Policy "${policyName}" (${policyType}) must start with "${prefix}-". Expected ${expected}.`
    };
  }
  if (!NAME_PART.test(policyName.slice(prefix.length + 1))) {
    return {
      severity: 2,
      message: `Policy "${policyName}" (${policyType}): the part after "${prefix}-" must be PascalCase ` +
        `(letters and digits, starting with an upper-case letter). Expected ${expected}.`
    };
  }
  return null;
}

function onPolicy(policy, cb) {
  const problem = check(policy.getName(), policy.getType());
  if (problem) {
    const nameAttr = policy.select("//@name")[0];
    policy.addMessage({
      plugin,
      severity: problem.severity,
      message: problem.message,
      line: nameAttr && nameAttr.lineNumber,
      column: nameAttr && nameAttr.columnNumber
    });
  }
  if (typeof cb === "function") {
    cb(null, !!problem);
  }
}

module.exports = { plugin, onPolicy, check, TYPE_PREFIXES };
