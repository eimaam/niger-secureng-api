import moment from "moment-timezone";

export const unauthenticatedRoutes: (string | RegExp)[] = [
  "/api/v1/auth/login",
  "/api/v1/healthcheck",
  "/api/v1/webhook/funding",
  "/api/v1/webhook/disbursement",
  // vehicles
  /^\/api\/v1\/vehicle\/qr\/[a-fA-F0-9]{24}$/,
  /^\/api\/v1\/vehicle\/qr\/public\/[a-fA-F0-9]{24}$/,
  /^\/api\/v1\/vehicle\/qr\/([a-fA-F0-9]{24}|[0-9A-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 
  /^\/api\/v1\/vehicle\/qr\/public\/([a-fA-F0-9]{24}|[0-9A-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 
  /^\/api\/v1\/vehicle\/qr\/transactions\/([a-fA-F0-9]{24}|[0-9A-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 
  // drivers
  /^\/api\/v1\/drivers\/qr\/[a-fA-F0-9]{24}$/,
  /^\/api\/v1\/drivers\/qr\/public\/[a-fA-F0-9]{24}$/,
  /^\/api\/v1\/drivers\/qr\/([a-fA-F0-9]{24}|[0-9A-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 
  /^\/api\/v1\/drivers\/qr\/public\/([a-fA-F0-9]{24}|[0-9A-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 
  /^\/api\/v1\/drivers\/qr\/transactions\/([a-fA-F0-9]{24}|[0-9A-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 
];

export const dates = {
  CURRENT_DATE_TIME_UTC: moment.utc().toDate(), // Current date and time in UTC
  CURRENT_DATE_UTC: moment.utc().startOf("day").toDate(), // Start of the current day in UTC
};

// query params
export const DEFAULT_QUERY_PAGE = 1;
export const DEFAULT_QUERY_LIMIT = 10;


export const ERROR_MESSAGE = {
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not Found",
  INTERNAL_SERVER_ERROR: "Internal Server Error",
}

export const API_RATE_LIMIT = {
  WINDOW_MS: 30 * 60 * 1000, // 30 minutes
  MAX_REQUESTS: 100, // limit each IP to 100 requests per windowMs
  MESSAGE: 'Too many requests from this IP, please try again later.',
  STANDARD_HEADERS: true,
  LEGACY_HEADERS: false,
};

export const WEBHOOK_RATE_LIMIT = {
  WINDOW_MS: 1 * 60 * 1000, // 1 minute
  MAX_REQUESTS: 10, // limit each IP to 10 requests per windowMs
  MESSAGE: 'Too many webhook requests from this IP, please try again later.',
  STANDARD_HEADERS: true,
  LEGACY_HEADERS: false,
};