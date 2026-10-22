// Page and API paths. The frontend apiClient and backend controllers both read from here.

export const API_BASE = "/api/v1";

export const API_ROUTES = {
  health: `${API_BASE}/health`,
  auth: {
    signup: `${API_BASE}/auth/signup`,
    login: `${API_BASE}/auth/login`,
    logout: `${API_BASE}/auth/logout`,
    me: `${API_BASE}/auth/me`,
    callback: `${API_BASE}/auth/callback`,
    resend: `${API_BASE}/auth/resend`,
    realtime: `${API_BASE}/auth/realtime`,
  },
  accounts: `${API_BASE}/accounts`,
  account: (id: string) => `${API_BASE}/accounts/${id}`,
  imports: `${API_BASE}/imports`,
  import: (id: string) => `${API_BASE}/imports/${id}`,
  importUploaded: (id: string) => `${API_BASE}/imports/${id}/uploaded`,
  importPassword: (id: string) => `${API_BASE}/imports/${id}/password`,
  importRows: (id: string) => `${API_BASE}/imports/${id}/rows`,
  transactions: `${API_BASE}/transactions`,
  transaction: (id: string) => `${API_BASE}/transactions/${id}`,
  categories: `${API_BASE}/categories`,
  category: (id: string) => `${API_BASE}/categories/${id}`,
  rules: `${API_BASE}/rules`,
  rule: (id: string) => `${API_BASE}/rules/${id}`,
  rulesApply: `${API_BASE}/rules/apply`,
  reviewItems: `${API_BASE}/review-items`,
  reviewItem: (id: string) => `${API_BASE}/review-items/${id}`,
  refunds: `${API_BASE}/refunds`,
  refund: (id: string) => `${API_BASE}/refunds/${id}`,
  refundMessage: (id: string) => `${API_BASE}/refunds/${id}/message`,
  reports: {
    overview: `${API_BASE}/reports/overview`,
    summary: `${API_BASE}/reports/summary`,
  },
  splits: `${API_BASE}/splits`,
  split: (id: string) => `${API_BASE}/splits/${id}`,
  splitInvite: (id: string, participantId: string) => `${API_BASE}/splits/${id}/participants/${participantId}/invite`,
  splitClaim: (id: string, claimId: string) => `${API_BASE}/splits/${id}/claims/${claimId}`,
  splitStatus: (id: string) => `${API_BASE}/splits/${id}/status`,
  splitPayments: (id: string) => `${API_BASE}/splits/${id}/payments`,
  guest: {
    redeem: `${API_BASE}/guest/redeem`,
    share: `${API_BASE}/guest/share`,
    respond: `${API_BASE}/guest/respond`,
    payment: `${API_BASE}/guest/payment`,
  },
} as const;

export const PAGE_ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
  dashboard: "/dashboard",
  transactions: "/transactions",
  imports: "/imports",
  importReview: (id: string) => `/imports/${id}`,
  categories: "/categories",
  rules: "/rules",
  review: "/review",
  refunds: "/refunds",
  splits: "/splits",
  split: (id: string) => `/splits/${id}`,
  settingsAccounts: "/settings/accounts",
  guestLanding: (token: string) => `/s/${token}`,
  guestView: "/s/view",
} as const;

// Route prefixes that require a signed-in (non-anonymous) user; enforced in proxy.ts and again in the API.
export const PROTECTED_PAGE_PREFIXES = [
  PAGE_ROUTES.dashboard,
  PAGE_ROUTES.transactions,
  PAGE_ROUTES.imports,
  PAGE_ROUTES.categories,
  PAGE_ROUTES.rules,
  PAGE_ROUTES.review,
  PAGE_ROUTES.refunds,
  PAGE_ROUTES.splits,
  "/settings",
] as const;

export const GUEST_PAGE_PREFIX = "/s/";
