"use strict";

const { expect } = require("chai");
const rule = require("../../apigeelint-rules/EX-PN001-policyNamePrefix.js");

// A stand-in for apigeelint's Policy object: only what the rule uses.
function fakePolicy(name, type) {
  const messages = [];
  return {
    messages,
    getName: () => name,
    getType: () => type,
    select: () => [{ lineNumber: 1, columnNumber: 42 }],
    addMessage: (msg) => messages.push(msg)
  };
}

function lint(name, type) {
  const policy = fakePolicy(name, type);
  let flagged;
  rule.onPolicy(policy, (err, result) => { flagged = result; });
  return { flagged, messages: policy.messages };
}

describe("apigeelint rule EX-PN001 (policy naming)", function () {
  it("is an error-level rule with an external rule ID", function () {
    expect(rule.plugin.ruleId).to.equal("EX-PN001");
    expect(rule.plugin.severity).to.equal(2);
    expect(rule.plugin.nodeType).to.equal("Policy");
  });

  it("accepts <PREFIX>-<PascalCaseName> for each policy type", function () {
    [
      ["AM-RemoveApiKeyParam", "AssignMessage"],
      ["Q-ImposeQuota", "Quota"],
      ["VAK-VerifyApiKey", "VerifyAPIKey"],
      ["X2J-ResponseToJson", "XMLToJSON"],
      ["RF-InvalidScope", "RaiseFault"],
      ["KVM-GetSigningKey", "KeyValueMapOperations"],
      ["SA-SpikeArrest", "SpikeArrest"],
      ["JS-MapPet2", "Javascript"]
    ].forEach(([name, type]) => {
      const { flagged, messages } = lint(name, type);
      expect(flagged, name).to.equal(false);
      expect(messages, name).to.have.length(0);
    });
  });

  it("rejects the old helloworld names", function () {
    expect(lint("verify-api-key", "VerifyAPIKey").messages[0].message).to.contain("must start with \"VAK-\"");
    expect(lint("XMLtoJSON", "XMLToJSON").messages[0].message).to.contain("must start with \"X2J-\"");
  });

  it("rejects a prefix in the wrong case or for another policy type", function () {
    ["am-RemoveParam", "Am-RemoveParam", "AM_RemoveParam", "AMRemoveParam", "Q-RemoveParam"].forEach((name) => {
      const { flagged, messages } = lint(name, "AssignMessage");
      expect(flagged, name).to.equal(true);
      expect(messages[0].severity, name).to.equal(2);
    });
  });

  it("rejects a name part that is not PascalCase", function () {
    ["AM-", "AM-removeParam", "AM-Remove-Param", "AM-Remove_Param", "AM-Remove Param", "AM-1Remove"].forEach((name) => {
      const { flagged, messages } = lint(name, "AssignMessage");
      expect(flagged, name).to.equal(true);
      expect(messages[0].message, name).to.contain("PascalCase");
    });
  });

  it("rejects a policy without a name", function () {
    const { flagged, messages } = lint("", "Quota");
    expect(flagged).to.equal(true);
    expect(messages[0].message).to.contain("has no name");
  });

  it("only warns for a policy type with no team prefix", function () {
    const { flagged, messages } = lint("Anything", "XSL");
    expect(flagged).to.equal(true);
    expect(messages[0].severity).to.equal(1);
    expect(messages[0].message).to.contain("No team prefix is defined for policy type XSL");
  });

  it("reports the line and column of the name attribute", function () {
    const msg = lint("verify-api-key", "VerifyAPIKey").messages[0];
    expect(msg).to.include({ line: 1, column: 42, severity: 2 });
    expect(msg.plugin.ruleId).to.equal("EX-PN001");
  });

  it("uses one prefix per policy type, each upper-case letters and digits", function () {
    Object.entries(rule.TYPE_PREFIXES).forEach(([type, prefix]) => {
      expect(prefix, type).to.match(/^[A-Z][A-Z0-9]*$/);
    });
  });
});
