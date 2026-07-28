/**
 * Constantes e limites da Central de Tesouraria (client-safe).
 */

export const TREASURY_MODULE_ID = "treasury" as const;

export const TREASURY_MODULE_LABEL = "Central de Tesouraria" as const;

/** Prefixo HTTP canônico do módulo. */
export const TREASURY_API_PREFIX = "/api/finance/treasury" as const;

export const TREASURY_AVAILABILITY_PATH =
  `${TREASURY_API_PREFIX}/availability` as const;

export const TREASURY_ACCOUNTS_PATH =
  `${TREASURY_API_PREFIX}/accounts` as const;

export const TREASURY_RECEIVABLES_PATH =
  `${TREASURY_API_PREFIX}/receivables` as const;

export const TREASURY_PAYABLES_PATH =
  `${TREASURY_API_PREFIX}/payables` as const;

export const TREASURY_PROMISES_PATH =
  `${TREASURY_API_PREFIX}/promises` as const;

export const TREASURY_COLLECTION_ACTIONS_PATH =
  `${TREASURY_API_PREFIX}/collection-actions` as const;

export const TREASURY_DISPUTES_PATH =
  `${TREASURY_API_PREFIX}/disputes` as const;

export const TREASURY_DASHBOARD_PATH =
  `${TREASURY_API_PREFIX}/dashboard` as const;

export const TREASURY_PROJECTIONS_PATH =
  `${TREASURY_API_PREFIX}/projections` as const;

export const TREASURY_PROJECTIONS_COMPARE_PATH =
  `${TREASURY_PROJECTIONS_PATH}/compare` as const;

export const TREASURY_AGENDA_PATH =
  `${TREASURY_API_PREFIX}/agenda` as const;

export const TREASURY_TRANSFERS_PATH =
  `${TREASURY_API_PREFIX}/transfers` as const;

export const TREASURY_LEDGER_ENTRIES_PATH =
  `${TREASURY_API_PREFIX}/ledger-entries` as const;

export const TREASURY_PAYMENT_SCHEDULE_PATH =
  `${TREASURY_API_PREFIX}/payment-schedule` as const;

export const TREASURY_FORECAST_VS_ACTUAL_PATH =
  `${TREASURY_API_PREFIX}/forecast-vs-actual` as const;

export const TREASURY_ALERTS_PATH =
  `${TREASURY_API_PREFIX}/alerts` as const;

export const TREASURY_AUDIT_PATH =
  `${TREASURY_API_PREFIX}/audit` as const;

export const TREASURY_HEALTH_PATH =
  `${TREASURY_API_PREFIX}/health` as const;

export const TREASURY_RECONCILE_WORKSPACE_PATH =
  `${TREASURY_API_PREFIX}/reconcile/workspace` as const;

export const TREASURY_EXCEPTIONS_PATH =
  `${TREASURY_API_PREFIX}/exceptions` as const;

export const TREASURY_ALERT_SETTINGS_PATH =
  `${TREASURY_API_PREFIX}/alert-settings` as const;

export const TREASURY_DAILY_CLOSING_PATH =
  `${TREASURY_API_PREFIX}/daily-closing` as const;

export const TREASURY_DAILY_CLOSING_PREVIEW_PATH =
  `${TREASURY_DAILY_CLOSING_PATH}/preview` as const;

export const TREASURY_BANK_IMPORTS_PATH =
  `${TREASURY_API_PREFIX}/bank-imports` as const;

export const TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH =
  `${TREASURY_BANK_IMPORTS_PATH}/ofx/preview` as const;

export const TREASURY_BANK_IMPORTS_OFX_APPLY_PATH =
  `${TREASURY_BANK_IMPORTS_PATH}/ofx/apply` as const;

export const TREASURY_BANK_MOVEMENTS_PATH =
  `${TREASURY_API_PREFIX}/bank-movements` as const;

export const TREASURY_RECONCILIATIONS_PATH =
  `${TREASURY_API_PREFIX}/reconciliations` as const;

export const TREASURY_REPORTS_PATH =
  `${TREASURY_API_PREFIX}/reports` as const;

/** Frase obrigatória na UI/API de reversão forte. */
export const TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE = "REVERTER" as const;

/** TTL do token de preview OFX (segundos). */
export const TREASURY_OFX_PREVIEW_TOKEN_TTL_SECONDS = 15 * 60;

/** Default; override via TREASURY_PROJECTION_MAX_HORIZON_DAYS. */
export const TREASURY_PROJECTION_DEFAULT_MAX_HORIZON_DAYS = 90;

export const TREASURY_SCAFFOLD_VERSION = "0.1.0-scaffold" as const;

export const TREASURY_DEFAULT_CURRENCY = "BRL" as const;

export const TREASURY_DEFAULT_PAGE = 1;
export const TREASURY_DEFAULT_PAGE_SIZE = 50;
export const TREASURY_MAX_PAGE_SIZE = 200;
export const TREASURY_MIN_PAGE_SIZE = 1;

/** Limites de tamanho de string em DTOs/inputs. */
export const TREASURY_FIELD_LIMITS = {
  id: 64,
  userId: 64,
  accountId: 64,
  plannedAccountId: 64,
  fromAccountId: 64,
  toAccountId: 64,
  nomusExternalId: 64,
  nextAction: 500,
  code: 32,
  name: 120,
  companyCode: 64,
  companyName: 120,
  institutionName: 120,
  institutionCode: 16,
  bankCode: 8,
  agency: 16,
  agencyMasked: 32,
  accountNumber: 32,
  accountNumberMasked: 32,
  nomusBankAccountId: 64,
  memo: 500,
  reason: 500,
  notes: 2000,
  contactNote: 500,
  contactPerson: 200,
  result: 500,
  involvedArea: 120,
  channel: 64,
  actionType: 64,
  counterpartRef: 128,
  search: 120,
  currency: 3,
  justification: 500,
  expectedUpdatedAt: 64,
  idempotencyKey: 128,
  attachmentUrl: 500,
  uniqueKey: 200,
  sourceHash: 128,
  previewToken: 256,
  contentHash: 128,
  title: 240,
  description: 4000,
  resolution: 2000,
  ignoreJustification: 2000,
  entityId: 128,
} as const;

export type TreasuryFieldLimitKey = keyof typeof TREASURY_FIELD_LIMITS;
