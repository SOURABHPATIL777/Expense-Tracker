// Limits that both the UI (for early feedback) and the API (for enforcement) apply.

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
} as const;

export const UPLOAD = {
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  ACCEPTED_EXTENSIONS: [".csv", ".xls", ".xlsx", ".pdf", ".html", ".json"],
  ACCEPTED_MIME_TYPES: [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/pdf",
    "text/html",
    "application/json",
  ],
} as const;

export const SPLIT = {
  MAX_PARTICIPANTS: 20,
  MIN_PARTICIPANTS: 2,
  PERCENT_SCALE: 100,
} as const;

export const TEXT = {
  NAME_MAX: 80,
  TITLE_MAX: 120,
  NOTE_MAX: 500,
} as const;

export const CURRENCY = {
  CODE: "INR",
  MINOR_PER_MAJOR: 100,
  LOCALE: "en-IN",
  TIME_ZONE: "Asia/Kolkata",
} as const;
