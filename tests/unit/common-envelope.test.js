"use strict";

const { expect } = require("chai");
const { runPolicy } = require("./helpers/apigee");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// Every JavaScript policy in common-envelope includes envelope-header.js first.
function run(file, variables) {
  return runPolicy("envelope", ["envelope-header.js", file], variables);
}

describe("common-envelope", function () {
  describe("envelope-header.js", function () {
    it("creates a v4 UUID trace ID when none is set and reuses it", function () {
      const vars = runPolicy("envelope", ["envelope-header.js"], {});
      expect(vars).to.deep.equal({});

      const out = run("build-success.js", {});
      const body = JSON.parse(out["response.content"]);
      expect(body.header.traceId).to.match(UUID_V4);
      expect(out["envelope.traceId"]).to.equal(body.header.traceId);
      expect(out["response.header.X-Request-Id"]).to.equal(body.header.traceId);
    });

    it("writes the timestamp as ISO-8601 UTC without milliseconds", function () {
      const body = JSON.parse(run("build-success.js", {})["response.content"]);
      expect(body.header.timestamp).to.match(TIMESTAMP);
    });

    it("creates a different trace ID for each call", function () {
      const a = run("build-success.js", {})["envelope.traceId"];
      const b = run("build-success.js", {})["envelope.traceId"];
      expect(a).to.not.equal(b);
    });
  });

  describe("init-trace.js", function () {
    function traceId(header) {
      const vars = run("init-trace.js", { "request.header.X-Request-Id": header });
      expect(vars["request.header.X-Request-Id"]).to.equal(vars["envelope.traceId"]);
      return vars["envelope.traceId"];
    }

    it("keeps the caller's X-Request-Id when it is safe", function () {
      expect(traceId("abc-12345")).to.equal("abc-12345");
      expect(traceId("6F9619FF-8B86-D011-B42D-00CF4FC964FF")).to.equal("6F9619FF-8B86-D011-B42D-00CF4FC964FF");
      expect(traceId("a".repeat(64))).to.equal("a".repeat(64));
    });

    it("replaces a missing, too short, too long or unsafe X-Request-Id with a UUID", function () {
      [null, "", "short", "a".repeat(65), "abc 12345", "abc_12345", "<script>x</script>", "id\r\nX-Evil: 1"]
        .forEach(function (header) {
          expect(traceId(header), JSON.stringify(header)).to.match(UUID_V4);
        });
    });
  });

  describe("build-success.js", function () {
    it("wraps envelope.data as {header, data} with isSuccess true", function () {
      const vars = run("build-success.js", {
        "envelope.traceId": "trace-0001",
        "envelope.data": "{\"id\":1,\"name\":\"doggie\"}",
        "response.status.code": 200
      });
      const body = JSON.parse(vars["response.content"]);
      expect(body.header).to.include({ traceId: "trace-0001", isSuccess: true });
      expect(body.data).to.deep.equal({ id: 1, name: "doggie" });
      expect(vars["response.status.code"]).to.equal("200");
      expect(vars["response.header.Content-Type"]).to.equal("application/json");
      expect(vars["response.header.X-Request-Id"]).to.equal("trace-0001");
    });

    it("inserts envelope.data as text so int64 IDs are not rounded", function () {
      const vars = run("build-success.js", { "envelope.data": "{\"id\":9223372036854775807}" });
      expect(vars["response.content"]).to.contain("\"data\":{\"id\":9223372036854775807}}");
    });

    it("uses null data when envelope.data is not set", function () {
      const body = JSON.parse(run("build-success.js", {})["response.content"]);
      expect(body.data).to.equal(null);
    });

    it("keeps the response status and uses 200 when there is none", function () {
      expect(run("build-success.js", { "response.status.code": 201 })["response.status.code"]).to.equal("201");
      expect(run("build-success.js", {})["response.status.code"]).to.equal("200");
    });
  });

  describe("build-error.js", function () {
    function buildError(variables) {
      const vars = run("build-error.js", Object.assign({ "envelope.traceId": "trace-0001" }, variables));
      return { vars, body: JSON.parse(vars["error.content"]), status: Number(vars["error.status.code"]) };
    }

    it("builds the {header, error} envelope with isSuccess false", function () {
      const { vars, body, status } = buildError({ "envelope.errorCode": "404" });
      expect(status).to.equal(404);
      expect(body.header).to.include({ traceId: "trace-0001", isSuccess: false });
      expect(body.header.timestamp).to.match(TIMESTAMP);
      expect(body.error).to.deep.equal({ code: 404, message: "The requested resource was not found." });
      expect(vars["error.header.Content-Type"]).to.equal("application/json");
      expect(vars["error.header.X-Request-Id"]).to.equal("trace-0001");
      expect(vars["envelope.errorHandled"]).to.equal("true");
    });

    it("uses envelope.errorMessage when the proxy sets one", function () {
      const { body } = buildError({ "envelope.errorCode": "400", "envelope.errorMessage": "petId must be a number." });
      expect(body.error).to.deep.equal({ code: 400, message: "petId must be a number." });
    });

    it("lets envelope.errorCode win over the fault", function () {
      const { status, vars } = buildError({ "envelope.errorCode": "403", "fault.name": "SpikeArrestViolation" });
      expect(status).to.equal(403);
      expect(vars).to.not.have.property("error.header.Retry-After");
    });

    it("turns an envelope.errorCode outside the catalog into 500", function () {
      const { body } = buildError({ "envelope.errorCode": "418" });
      expect(body.error.code).to.equal(500);
      expect(body.error.message).to.match(/traceId/);
    });

    it("maps SpikeArrest to 429 with Retry-After 1", function () {
      const { status, body, vars } = buildError({ "fault.name": "SpikeArrestViolation", "error.status.code": "429" });
      expect(status).to.equal(429);
      expect(vars["error.header.Retry-After"]).to.equal("1");
      expect(body.error.message).to.match(/1 second/);
    });

    it("maps Quota to 429 with Retry-After 60 by default", function () {
      const { status, body, vars } = buildError({ "fault.name": "QuotaViolation" });
      expect(status).to.equal(429);
      expect(vars["error.header.Retry-After"]).to.equal("60");
      expect(body.error.message).to.match(/^Quota exceeded/);
    });

    it("uses envelope.quotaRetryAfter for Quota when set", function () {
      const { vars } = buildError({ "fault.name": "QuotaViolation", "envelope.quotaRetryAfter": "3600" });
      expect(vars["error.header.Retry-After"]).to.equal("3600");
    });

    it("keeps envelope.errorMessage for a 429", function () {
      const { body } = buildError({ "fault.name": "QuotaViolation", "envelope.errorMessage": "Daily limit reached." });
      expect(body.error.message).to.equal("Daily limit reached.");
    });

    it("maps timeouts to 504", function () {
      [{ "fault.name": "GatewayTimeout" }, { "fault.name": "ConnectionTimeout" }, { "error.status.code": "504" }]
        .forEach(function (v) {
          const { status, body } = buildError(v);
          expect(status, JSON.stringify(v)).to.equal(504);
          expect(body.error.message).to.match(/timed out/);
        });
    });

    it("passes backend 400 and 404 through and turns other backend errors into 500", function () {
      [[400, 400], [404, 404], [401, 500], [409, 500], [500, 500], [503, 500]].forEach(function (pair) {
        const { status } = buildError({ "fault.name": "ErrorResponseCode", "response.status.code": pair[0] });
        expect(status, "backend " + pair[0]).to.equal(pair[1]);
      });
    });

    it("keeps a 401 or 403 raised by a policy", function () {
      expect(buildError({ "fault.name": "InvalidToken", "error.status.code": "401" }).status).to.equal(401);
      expect(buildError({ "fault.name": "InsufficientScope", "error.status.code": "403" }).status).to.equal(403);
    });

    it("returns 500 for an unknown fault", function () {
      expect(buildError({ "fault.name": "ScriptExecutionFailed", "error.status.code": "500" }).status).to.equal(500);
      expect(buildError({ "error.status.code": "418" }).status).to.equal(500);
      expect(buildError({}).status).to.equal(500);
    });

    it("removes a Set-Cookie header set by the target", function () {
      const { vars } = buildError({ "fault.name": "ErrorResponseCode", "response.status.code": 500,
        "error.header.Set-Cookie": "session=abc" });
      expect(vars).to.not.have.property("error.header.Set-Cookie");
    });

    it("creates a trace ID when init did not run", function () {
      const vars = run("build-error.js", { "envelope.errorCode": "401" });
      expect(JSON.parse(vars["error.content"]).header.traceId).to.match(UUID_V4);
      expect(vars["error.header.X-Request-Id"]).to.equal(vars["envelope.traceId"]);
    });
  });
});
