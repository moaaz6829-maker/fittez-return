import pino from "pino";

// Section 46 / 39 / 27: audit logs and app logs must NEVER contain API keys,
// tokens, passwords, or other sensitive credentials. This redaction list is
// applied globally so a future developer adding a field to a logged object
// doesn't accidentally leak a secret.
const REDACT_PATHS = [
  "*.apiKey",
  "*.accessToken",
  "*.access_token",
  "*.BOSTA_API_KEY",
  "*.bostaApiKey",
  "*.password",
  "*.token",
  "*.authorization",
  "*.headers.authorization",
  "req.headers.authorization",
];

export const logger = pino({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
});
