// Reuses the caller's X-Request-Id when it looks safe, otherwise creates a UUID.
var incoming = context.getVariable("request.header.X-Request-Id");
var traceId = (incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming)) ? String(incoming) : String(newUuid());
context.setVariable("envelope.traceId", traceId);
// The runtime echoes the request's X-Request-Id on the response, so keep both in sync.
context.setVariable("request.header.X-Request-Id", traceId);
