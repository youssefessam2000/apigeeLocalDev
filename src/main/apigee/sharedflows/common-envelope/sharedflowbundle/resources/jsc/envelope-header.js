// The standard "header" object shared by success and error responses:
//   { timestamp: ISO-8601 UTC without milliseconds, traceId: UUID, isSuccess: boolean }

function newUuid() {
  "use strict";
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Returns the trace ID of this call, creating one if init did not run
// (for example when the request failed before the PreFlow).
function envelopeTraceId() {
  "use strict";
  var id = context.getVariable("envelope.traceId");
  if (!id) {
    id = String(newUuid());
    context.setVariable("envelope.traceId", id);
  }
  return String(id);
}

function envelopeHeader(isSuccess) {
  "use strict";
  return {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    traceId: envelopeTraceId(),
    isSuccess: isSuccess
  };
}

// message: "response" in the normal flow, "error" in the error flow
// (in the error flow Apigee sends the error message to the client, not the response).
// bodyJson is a JSON string, so large numbers in the payload are kept exactly.
function writeEnvelope(message, statusCode, bodyJson) {
  "use strict";
  context.setVariable(message + ".status.code", String(statusCode));
  context.setVariable(message + ".header.Content-Type", "application/json");
  context.setVariable(message + ".header.X-Request-Id", envelopeTraceId());
  context.setVariable(message + ".content", bodyJson);
}
