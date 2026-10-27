// Global error handler: turns any fault into the standard {header, error} envelope.
//
// The status code is decided in this order:
//   1. envelope.errorCode / envelope.errorMessage, set by the proxy (e.g. RaiseFault AssignVariable)
//   2. the fault itself: SpikeArrest/Quota -> 429, VerifyJWT/VerifyAPIKey -> 401, timeouts -> 504
//   3. a backend error (ErrorResponseCode): 400 and 404 pass through, anything else -> 500
// Only the codes in MESSAGES are ever returned; everything unknown becomes 500.

var MESSAGES = {
  400: "Invalid request parameters.",
  401: "Invalid or missing access token in 'Authorization' header.",
  403: "Access denied. The access token is not authorized to access this resource.",
  404: "The requested resource was not found.",
  429: "Rate limit has been exceeded. Please retry after the duration specified in Retry-After.",
  500: "An unexpected error occurred. Quote the traceId when contacting support.",
  504: "Request timed out. The service is temporarily unavailable."
};

var faultName = context.getVariable("fault.name") || "";
var policyStatus = parseInt(context.getVariable("error.status.code"), 10) || 0;
var code = parseInt(context.getVariable("envelope.errorCode"), 10) || 0;
var message = context.getVariable("envelope.errorMessage");
var retryAfter = null;

if (!code) {
  if (faultName === "SpikeArrestViolation") {
    code = 429;
    retryAfter = 1;
  } else if (faultName === "QuotaViolation") {
    code = 429;
    retryAfter = parseInt(context.getVariable("envelope.quotaRetryAfter"), 10) || 60;
  } else if (faultName === "GatewayTimeout" || faultName === "ConnectionTimeout" || policyStatus === 504) {
    code = 504;
  } else if (faultName === "ErrorResponseCode") {
    var backendStatus = parseInt(context.getVariable("response.status.code"), 10) || 0;
    code = (backendStatus === 400 || backendStatus === 404) ? backendStatus : 500;
  } else if (MESSAGES[policyStatus]) {
    // VerifyJWT, VerifyAPIKey and similar policies fail with 401/403.
    code = policyStatus;
  } else {
    code = 500;
  }
}

if (!MESSAGES[code]) {
  code = 500;
}
if (!message) {
  message = MESSAGES[code];
}

// Drop backend headers so nothing from the target leaks into the error.
context.removeVariable("error.header.Set-Cookie");
if (retryAfter !== null) {
  context.setVariable("error.header.Retry-After", String(retryAfter));
}

writeEnvelope("error", code, JSON.stringify({
  header: envelopeHeader(false),
  error: { code: code, message: message }
}));
context.setVariable("envelope.errorHandled", "true");
