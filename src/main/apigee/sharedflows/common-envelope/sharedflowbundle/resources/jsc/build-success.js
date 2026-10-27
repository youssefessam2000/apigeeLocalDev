// Wraps the mapped payload (envelope.data, a JSON string set by the proxy) as {header, data}.
// envelope.data is inserted as text, not re-parsed, so int64 IDs are not rounded.
var data = context.getVariable("envelope.data") || "null";
writeEnvelope("response", context.getVariable("response.status.code") || 200,
  "{\"header\":" + JSON.stringify(envelopeHeader(true)) + ",\"data\":" + data + "}");
