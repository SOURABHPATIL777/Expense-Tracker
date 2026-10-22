import "server-only";

// Every error the API can return. Messages are safe to show to end users; internals go to logs only.
export const ERRORS = {
  UNAUTHENTICATED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You do not have access to this resource." },
  BAD_ORIGIN: { status: 403, message: "Request origin not allowed." },
  NOT_FOUND: { status: 404, message: "Not found." },
  METHOD_NOT_ALLOWED: { status: 405, message: "Method not allowed." },
  CONFLICT: { status: 409, message: "This conflicts with existing data." },
  INVALID_STATE: { status: 409, message: "This action is not allowed in the current state." },
  VERSION_MISMATCH: { status: 409, message: "This item changed since you loaded it. Refresh and try again." },
  INVITE_INVALID: { status: 410, message: "This invitation link is invalid, expired or has been revoked." },
  INVITE_TAKEN: { status: 409, message: "This invitation was already opened on another device. Ask for a new link." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "File is too large." },
  UNSUPPORTED_FILE: { status: 415, message: "This file type is not supported." },
  VALIDATION: { status: 422, message: "Some fields are invalid." },
  IMPORT_UNREADABLE: { status: 422, message: "We could not read this file." },
  PASSWORD_REQUIRED: { status: 422, message: "This file is password protected." },
  LLM_DISABLED: { status: 409, message: "AI processing is turned off for this task." },
  LLM_CLOUD_NOT_ALLOWED: { status: 409, message: "Cloud AI processing has not been allowed in settings." },
  LLM_NOT_CONFIGURED: { status: 409, message: "This AI provider is not configured on the server." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please slow down." },
  LLM_UNAVAILABLE: { status: 502, message: "The AI provider did not respond. Try again later." },
  UPSTREAM: { status: 502, message: "A dependent service failed. Try again later." },
  INTERNAL: { status: 500, message: "Something went wrong." },
} as const;

export type ErrorCode = keyof typeof ERRORS;
