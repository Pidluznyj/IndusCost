/**
 * Enums de domínio da Central de Tesouraria (client-safe).
 * Valores estáveis para API/DTO — sem Prisma.
 */

export const TREASURY_SIDES = ["AR", "AP"] as const;
export type TreasurySide = (typeof TREASURY_SIDES)[number];

export const TREASURY_ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "CASH",
  "INVESTMENT",
  "OTHER",
] as const;
export type TreasuryAccountType = (typeof TREASURY_ACCOUNT_TYPES)[number];

export const TREASURY_CURRENCIES = ["BRL"] as const;
export type TreasuryCurrency = (typeof TREASURY_CURRENCIES)[number];

export const TREASURY_BALANCE_LAYERS = [
  "observed",
  "calculated",
  "reconciled",
] as const;
export type TreasuryBalanceLayer = (typeof TREASURY_BALANCE_LAYERS)[number];

/** Origem explícita de cada valor na posição financeira (não esconder MISSING). */
export const TREASURY_POSITION_VALUE_ORIGINS = [
  "BALANCE_SNAPSHOT",
  "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
  "OFFICIAL_MOVEMENTS_ONLY",
  "ZERO_BASELINE",
  "RECONCILIATION",
  "MISSING",
] as const;
export type TreasuryPositionValueOrigin =
  (typeof TREASURY_POSITION_VALUE_ORIGINS)[number];

/** Origens de saldo/snapshot (alinhado a `TreasuryBalanceOrigin` no Prisma). */
export const TREASURY_BALANCE_ORIGINS = [
  "MANUAL",
  "OFX",
  "CLOSING",
  "SYSTEM",
  "IMPORT",
] as const;
export type TreasuryBalanceOrigin = (typeof TREASURY_BALANCE_ORIGINS)[number];

/** @deprecated Preferir `TREASURY_BALANCE_ORIGINS` / `TreasuryBalanceOrigin`. */
export const TREASURY_BALANCE_SOURCES = TREASURY_BALANCE_ORIGINS;
export type TreasuryBalanceSource = TreasuryBalanceOrigin;

export const TREASURY_ACCOUNT_LIQUIDITIES = [
  "IMMEDIATE",
  "D_PLUS_1",
  "D_PLUS_N",
  "TERM",
  "ILLIQUID",
] as const;
export type TreasuryAccountLiquidity =
  (typeof TREASURY_ACCOUNT_LIQUIDITIES)[number];

export const TREASURY_ACCOUNT_ACCESS_LEVELS = [
  "VIEW",
  "OPERATE",
  "MANAGE",
] as const;
export type TreasuryAccountAccessLevel =
  (typeof TREASURY_ACCOUNT_ACCESS_LEVELS)[number];

export const TREASURY_LEDGER_DIRECTIONS = ["DEBIT", "CREDIT"] as const;
export type TreasuryLedgerDirection = (typeof TREASURY_LEDGER_DIRECTIONS)[number];

export const TREASURY_LEDGER_NATURES = [
  "MANUAL",
  "TRANSFER",
  "OFX_MATCH",
  "ADJUSTMENT",
  "REVERSAL",
] as const;
export type TreasuryLedgerNature = (typeof TREASURY_LEDGER_NATURES)[number];

export const TREASURY_LEDGER_STATUSES = ["ACTIVE", "REVERSED"] as const;
export type TreasuryLedgerStatus = (typeof TREASURY_LEDGER_STATUSES)[number];

/** Statuses de transferência interna (prevista→…→conciliada / cancelada). */
export const TREASURY_TRANSFER_STATUSES = [
  "FORECAST",
  "SCHEDULED",
  "SENT",
  "RECEIVED",
  "RECONCILED",
  "CANCELLED",
] as const;
export type TreasuryTransferStatus = (typeof TREASURY_TRANSFER_STATUSES)[number];

/** Statuses que ainda projetam movimento de caixa (não cancelados). */
export const TREASURY_ACTIVE_TRANSFER_STATUSES = [
  "FORECAST",
  "SCHEDULED",
  "SENT",
  "RECEIVED",
  "RECONCILED",
] as const;

export const TREASURY_PROMISE_STATUSES = [
  "ACTIVE",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "EXPIRED",
  "BROKEN",
  "CANCELLED",
] as const;
export type TreasuryPromiseStatus = (typeof TREASURY_PROMISE_STATUSES)[number];

/** Statuses que ainda afetam projeção / filtro "com promessa". */
export const TREASURY_ACTIVE_PROMISE_STATUSES = [
  "ACTIVE",
  "PARTIALLY_FULFILLED",
] as const;

export const TREASURY_DISPUTE_STATUSES = [
  "OPEN",
  "RESOLVED",
  "CANCELLED",
] as const;
export type TreasuryDisputeStatus = (typeof TREASURY_DISPUTE_STATUSES)[number];

export const TREASURY_COLLECTION_ACTION_TYPES = [
  "PHONE",
  "WHATSAPP",
  "EMAIL",
  "MEETING",
  "COMMERCIAL_CONTACT",
  "INTERNAL_ANALYSIS",
  "OTHER",
] as const;
export type TreasuryCollectionActionType =
  (typeof TREASURY_COLLECTION_ACTION_TYPES)[number];

export const TREASURY_SCHEDULE_STATUSES = [
  "PLANNED",
  "APPROVED",
  "EXECUTED",
  "CANCELLED",
] as const;
export type TreasuryScheduleStatus = (typeof TREASURY_SCHEDULE_STATUSES)[number];

export const TREASURY_PROJECTION_LAYERS = [
  "CONTRACTUAL",
  "PROBABLE",
  "CONFIRMED",
  "MANUAL",
] as const;
export type TreasuryProjectionLayer = (typeof TREASURY_PROJECTION_LAYERS)[number];

/** Alias semântico alinhado ao enum Prisma `TreasuryProjectionScenario`. */
export const TREASURY_PROJECTION_SCENARIOS = TREASURY_PROJECTION_LAYERS;
export type TreasuryProjectionScenario = TreasuryProjectionLayer;

export const TREASURY_PROJECTION_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
  "CANCELLED",
] as const;
export type TreasuryProjectionRunStatus =
  (typeof TREASURY_PROJECTION_RUN_STATUSES)[number];

export const TREASURY_PROJECTION_RECALC_JOB_STATUSES = [
  "PENDING",
  "LOCKED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;
export type TreasuryProjectionRecalcJobStatus =
  (typeof TREASURY_PROJECTION_RECALC_JOB_STATUSES)[number];

export const TREASURY_PROJECTION_RECALC_EVENT_TYPES = [
  "AR_SYNC",
  "AP_SYNC",
  "SETTLEMENT",
  "CANCELLATION",
  "EXPECTATION",
  "PROMISE",
  "PROGRAMMING",
  "LEDGER_ENTRY",
  "TRANSFER",
  "BALANCE",
  "RECONCILIATION",
  "REVERSAL",
  "CLOSING",
  "REOPENING",
] as const;
export type TreasuryProjectionRecalcEventType =
  (typeof TREASURY_PROJECTION_RECALC_EVENT_TYPES)[number];

export const TREASURY_PROJECTION_RISK_CODES = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type TreasuryProjectionRiskCode =
  (typeof TREASURY_PROJECTION_RISK_CODES)[number];

export const TREASURY_PROJECTION_ITEM_KINDS = [
  "RECEIVABLE",
  "PAYABLE",
  "TRANSFER",
  "MANUAL_ENTRY",
  "REALIZED",
  "UNCERTAIN_RECEIVABLE",
  "OTHER",
] as const;
export type TreasuryProjectionItemKind =
  (typeof TREASURY_PROJECTION_ITEM_KINDS)[number];

export const TREASURY_CLOSING_STATUSES = ["OPEN", "CLOSED", "REOPENED"] as const;
export type TreasuryClosingStatus = (typeof TREASURY_CLOSING_STATUSES)[number];

/**
 * Status conceituais da rotina diária por conta (jornada simples).
 * CLOSED/REOPENED alinham-se ao fechamento formal (`TreasuryDailyClosingStatus`).
 * NOT_STARTED / OPEN / NEEDS_REVIEW / READY_TO_CLOSE são estados operacionais
 * derivados de abertura/fechamento bancário informados + divergência — sem model novo.
 */
export const TREASURY_DAILY_ACCOUNT_ROUTINE_STATUSES = [
  "NOT_STARTED",
  "OPEN",
  "NEEDS_REVIEW",
  "READY_TO_CLOSE",
  "CLOSED",
  "REOPENED",
] as const;
export type TreasuryDailyAccountRoutineStatus =
  (typeof TREASURY_DAILY_ACCOUNT_ROUTINE_STATUSES)[number];

/** Origem semântica do saldo inicial informado na rotina diária. */
export const TREASURY_DAILY_OPENING_BALANCE_ORIGINS = [
  /** Confirmado a partir do observedBalance do último fechamento CLOSED da conta. */
  "PREVIOUS_CLOSING",
  /** Digitado manualmente (sem fechamento anterior ou correção consciente). */
  "MANUAL",
  /** Espelho de snapshot MANUAL já existente no dia. */
  "SNAPSHOT",
] as const;
export type TreasuryDailyOpeningBalanceOrigin =
  (typeof TREASURY_DAILY_OPENING_BALANCE_ORIGINS)[number];

/** Justificativa simples quando o saldo inicial difere do saldo final anterior. */
export const TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES = [
  "MOVEMENT_AFTER_CLOSING",
  "FEE_OR_INTEREST",
  "CREDIT_AFTER_CLOSING",
  "AUTOMATIC_DEBIT",
  "PREVIOUS_BALANCE_INCORRECT",
  "OTHER",
] as const;
export type TreasuryDailyOpeningDiffJustificationCode =
  (typeof TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES)[number];

/** Bloqueios absolutos do preview de fechamento — impedem fechar mesmo com ressalva. */
export const TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES = [
  "DAY_ALREADY_CLOSED",
  "MISSING_OBSERVED_BALANCE",
  "NEGATIVE_BALANCE_FORBIDDEN",
  "SOURCE_DATA_UNAVAILABLE",
  "OPEN_SUSPECTED_DUPLICATE",
] as const;
export type TreasuryDailyClosingAbsoluteBlockCode =
  (typeof TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES)[number];

/** Pendências que exigem ressalva explícita para permitir o fechamento. */
export const TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES = [
  "RECONCILIATION_DIFFERENCE",
  "STALE_BALANCE",
  "EXPIRED_PROMISE",
  "TRANSFER_IN_TRANSIT",
  "PENDING_RECEIVABLE",
  "PENDING_PAYABLE",
  "UNRECONCILED_MOVEMENT",
  "ACCOUNT_BELOW_MINIMUM",
  "SYNC_DELAYED",
] as const;
export type TreasuryDailyClosingCaveatRequiredCode =
  (typeof TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES)[number];

/** Avisos informativos — não bloqueiam nem exigem ressalva. */
export const TREASURY_DAILY_CLOSING_WARNING_CODES = [
  "PENDING_RECEIVABLE_FUTURE",
  "PENDING_PAYABLE_FUTURE",
  "BALANCE_NEAR_MINIMUM",
] as const;
export type TreasuryDailyClosingWarningCode =
  (typeof TREASURY_DAILY_CLOSING_WARNING_CODES)[number];

export type TreasuryDailyClosingGateCode =
  | TreasuryDailyClosingAbsoluteBlockCode
  | TreasuryDailyClosingCaveatRequiredCode
  | TreasuryDailyClosingWarningCode;

export const TREASURY_EXCEPTION_STATUSES = [
  "OPEN",
  /** Legado P38 — tratado como causa aberta; UI canônica usa IN_ANALYSIS. */
  "ACK",
  "IN_ANALYSIS",
  "WAITING_THIRD_PARTY",
  "RESOLVED",
  "IGNORED",
  "CANCELLED",
] as const;
export type TreasuryExceptionStatus = (typeof TREASURY_EXCEPTION_STATUSES)[number];

/** Status operacionais alteráveis sem fechar a causa. */
export const TREASURY_EXCEPTION_OPERATIONAL_STATUSES = [
  "OPEN",
  "IN_ANALYSIS",
  "WAITING_THIRD_PARTY",
] as const;
export type TreasuryExceptionOperationalStatus =
  (typeof TREASURY_EXCEPTION_OPERATIONAL_STATUSES)[number];

export const TREASURY_EXCEPTION_SEVERITIES = [
  "INFO",
  "WARNING",
  "CRITICAL",
] as const;
export type TreasuryExceptionSeverity =
  (typeof TREASURY_EXCEPTION_SEVERITIES)[number];

export const TREASURY_EXCEPTION_TYPES = [
  "POSITION_ALERT",
  "BALANCE_DIVERGENCE",
  "NEGATIVE_BALANCE",
  "HIGH_PRIORITY_RECEIVABLES",
  "HIGH_PRIORITY_PAYABLES",
  "OVERDUE_WITHOUT_FORECAST",
  "TRANSFER_IN_TRANSIT",
  "OFX_UNMATCHED",
  "MANUAL",
  "OTHER",
  /** Motor determinístico (Prompt 39) */
  "EXPECTED_RECEIPT_NOT_RECEIVED",
  "EXPECTED_PAYMENT_NOT_MADE",
  "OVERDUE_RECEIVABLE_WITHOUT_ACTION",
  "EXPIRED_PROMISE",
  "CRITICAL_PAYMENT_NOT_PROGRAMMED",
  "ACCOUNT_BELOW_MINIMUM",
  "ACCOUNT_PROJECTION_NEGATIVE",
  "CONSOLIDATED_PROJECTION_NEGATIVE",
  "STALE_BALANCE",
  "BANK_MOVEMENT_UNIDENTIFIED",
  "RECONCILIATION_DIFFERENCE",
  "TITLE_WITHOUT_RESPONSIBLE",
  "SYNC_DELAYED",
  "SUSPECTED_DUPLICATE",
  "FINANCIAL_CHANGE_AFTER_CLOSING",
] as const;
export type TreasuryExceptionType = (typeof TREASURY_EXCEPTION_TYPES)[number];

export const TREASURY_EXCEPTION_ENTITY_KINDS = [
  "ACCOUNT",
  "RECEIVABLE",
  "PAYABLE",
  "TRANSFER",
  "LEDGER_ENTRY",
  "POSITION",
  "PROJECTION",
  "CLOSING",
  "RECONCILIATION",
  "OTHER",
] as const;
export type TreasuryExceptionEntityKind =
  (typeof TREASURY_EXCEPTION_ENTITY_KINDS)[number];

/** Statuses que ainda representam causa aberta (dedupe por uniqueKey). */
export const TREASURY_OPEN_EXCEPTION_STATUSES = [
  "OPEN",
  "ACK",
  "IN_ANALYSIS",
  "WAITING_THIRD_PARTY",
] as const;

export const TREASURY_EXCEPTION_SORT_FIELDS = [
  "detectedAt",
  "dueAt",
  "severity",
  "status",
  "amount",
  "title",
  "ageDays",
] as const;
export type TreasuryExceptionSortField =
  (typeof TREASURY_EXCEPTION_SORT_FIELDS)[number];

export const TREASURY_RECONCILIATION_MATCH_STATUSES = [
  "PENDING",
  "MATCHED",
  "UNMATCHED",
  "IGNORED",
] as const;
export type TreasuryReconciliationMatchStatus =
  (typeof TREASURY_RECONCILIATION_MATCH_STATUSES)[number];

/**
 * Tipos de alocação de um match bancário.
 * DISCOUNT/ABATEMENT reduzem o covering net; demais somam.
 */
export const TREASURY_RECONCILIATION_ALLOCATION_KINDS = [
  "TITLE",
  "FEE",
  "INTEREST",
  "DISCOUNT",
  "ABATEMENT",
  "DIFFERENCE",
  "TRANSFER",
  "MANUAL_LEDGER",
  "UNIDENTIFIED",
] as const;
export type TreasuryReconciliationAllocationKind =
  (typeof TREASURY_RECONCILIATION_ALLOCATION_KINDS)[number];

/** Kinds que somam ao covering net (lado que explica o extrato). */
export const TREASURY_RECONCILIATION_ALLOCATION_POSITIVE_KINDS = [
  "TITLE",
  "FEE",
  "INTEREST",
  "DIFFERENCE",
  "TRANSFER",
  "MANUAL_LEDGER",
  "UNIDENTIFIED",
] as const satisfies readonly TreasuryReconciliationAllocationKind[];

/** Kinds que reduzem o covering net (desconto/abatimento sobre título). */
export const TREASURY_RECONCILIATION_ALLOCATION_NEGATIVE_KINDS = [
  "DISCOUNT",
  "ABATEMENT",
] as const satisfies readonly TreasuryReconciliationAllocationKind[];

/**
 * Classificações de negócio da diferença conciliada — vocabulário FECHADO
 * gravado em `TreasuryReconciliationAllocation.differenceCode` (coluna já
 * existente; sem migration). O kind contábil continua decidindo o sinal
 * (POSITIVE/NEGATIVE_KINDS); o código diz O QUE a diferença é.
 */
export const TREASURY_RECONCILIATION_DIFFERENCE_CODES = [
  "DESCONTO",
  "JUROS",
  "MULTA",
  "TARIFA",
  "RETENCAO",
  "ABATIMENTO",
  "COMPENSACAO",
  "ARREDONDAMENTO",
  "OUTRO",
] as const;
export type TreasuryReconciliationDifferenceCode =
  (typeof TREASURY_RECONCILIATION_DIFFERENCE_CODES)[number];

export const TREASURY_RECONCILIATION_DIFFERENCE_CODE_LABELS: Record<
  TreasuryReconciliationDifferenceCode,
  string
> = {
  DESCONTO: "Desconto",
  JUROS: "Juros",
  MULTA: "Multa",
  TARIFA: "Tarifa",
  RETENCAO: "Retenção",
  ABATIMENTO: "Abatimento",
  COMPENSACAO: "Compensação",
  ARREDONDAMENTO: "Arredondamento",
  OUTRO: "Outro",
};

/**
 * Efeito da diferença sobre a cobertura do extrato:
 * "ADD" = o banco moveu MAIS que o valor líquido do título (juros/multa/…);
 * "REDUCE" = o banco moveu MENOS (desconto/retenção/compensação/…).
 */
export type TreasuryReconciliationDifferenceEffect = "ADD" | "REDUCE";

export const TREASURY_RECONCILIATION_DIFFERENCE_DEFAULT_EFFECT: Record<
  TreasuryReconciliationDifferenceCode,
  TreasuryReconciliationDifferenceEffect
> = {
  DESCONTO: "REDUCE",
  JUROS: "ADD",
  MULTA: "ADD",
  TARIFA: "ADD",
  RETENCAO: "REDUCE",
  ABATIMENTO: "REDUCE",
  COMPENSACAO: "REDUCE",
  ARREDONDAMENTO: "ADD",
  OUTRO: "ADD",
};

/**
 * Deriva o kind contábil (sinal) para uma classificação de diferença.
 * Determinístico: REDUCE usa DISCOUNT para DESCONTO e ABATEMENT para o
 * resto; ADD usa INTEREST para JUROS/MULTA, FEE para TARIFA e DIFFERENCE
 * para o restante. O par (code, kind) é persistido junto — auditável.
 */
export function resolveTreasuryReconciliationDifferenceKind(
  code: TreasuryReconciliationDifferenceCode,
  effect: TreasuryReconciliationDifferenceEffect
): TreasuryReconciliationAllocationKind {
  if (effect === "REDUCE") {
    return code === "DESCONTO" ? "DISCOUNT" : "ABATEMENT";
  }
  if (code === "JUROS" || code === "MULTA") return "INTEREST";
  if (code === "TARIFA") return "FEE";
  return "DIFFERENCE";
}

/**
 * Faixa de confiança da sugestão de conciliação bancária.
 * MVP: só sugere — nunca aplica match automático.
 */
export const TREASURY_RECONCILIATION_SUGGESTION_CONFIDENCE_BANDS = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;
export type TreasuryReconciliationSuggestionConfidenceBand =
  (typeof TREASURY_RECONCILIATION_SUGGESTION_CONFIDENCE_BANDS)[number];

/** Motivos estáveis retornados pelo motor de sugestões. */
export const TREASURY_RECONCILIATION_SUGGESTION_REASON_CODES = [
  "AMOUNT_EXACT",
  "DOCUMENT_MATCH",
  "TAX_ID_MATCH",
  "DATE_PROXIMITY",
  "NAME_SIMILAR",
  "HISTORY_MATCH",
  "DIRECTION_COMPATIBLE",
  "AMOUNT_COMBINATION_EXACT",
  "MOVEMENT_COMBINATION_EXACT",
  "TAX_ID_CONFLICT",
  "DATE_DISTANT",
] as const;
export type TreasuryReconciliationSuggestionReasonCode =
  (typeof TREASURY_RECONCILIATION_SUGGESTION_REASON_CODES)[number];

/** Status do lote de importação bancária (OFX). */
export const TREASURY_BANK_IMPORT_BATCH_STATUSES = [
  "RECEIVED",
  "PROCESSED",
  "FAILED",
  "DISCARDED",
] as const;
export type TreasuryBankImportBatchStatus =
  (typeof TREASURY_BANK_IMPORT_BATCH_STATUSES)[number];

export const TREASURY_BANK_OFX_FORMATS = ["OFX1", "OFX2", "UNKNOWN"] as const;
export type TreasuryBankOfxFormat = (typeof TREASURY_BANK_OFX_FORMATS)[number];

/** Direção do movimento bancário (espelha DEBIT/CREDIT do ledger). */
export const TREASURY_BANK_MOVEMENT_DIRECTIONS = ["DEBIT", "CREDIT"] as const;
export type TreasuryBankMovementDirection =
  (typeof TREASURY_BANK_MOVEMENT_DIRECTIONS)[number];

/** Status de conciliação do movimento (inclui PARTIAL para valor conciliado). */
export const TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES = [
  "PENDING",
  "PARTIAL",
  "MATCHED",
  "UNMATCHED",
  "IGNORED",
] as const;
export type TreasuryBankMovementReconciliationStatus =
  (typeof TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES)[number];

/** Classificação de linha no preview de importação OFX (não persiste). */
export const TREASURY_OFX_PREVIEW_ROW_STATUSES = [
  "NEW",
  "DUPLICATE",
  "INVALID",
] as const;
export type TreasuryOfxPreviewRowStatus =
  (typeof TREASURY_OFX_PREVIEW_ROW_STATUSES)[number];

export const TREASURY_OFX_PREVIEW_DUPLICATE_REASONS = [
  "EXISTING_MOVEMENT",
  "INTRA_FILE",
  "EXISTING_FILE",
] as const;
export type TreasuryOfxPreviewDuplicateReason =
  (typeof TREASURY_OFX_PREVIEW_DUPLICATE_REASONS)[number];

/** Buckets de filtro da UI de movimentos bancários. */
/**
 * Relatórios canônicos da Tesouraria (GET /reports/:reportKey).
 * Valores estáveis na URL — kebab-case.
 */
export const TREASURY_REPORT_KEYS = [
  "daily-position",
  "cash-bridge",
  "planned-vs-actual",
  "delinquency",
  "promises",
  "predictability",
  "position-by-account",
  "exceptions",
  "reconciliations",
  "projection-by-scenario",
] as const;
export type TreasuryReportKey = (typeof TREASURY_REPORT_KEYS)[number];

export const TREASURY_BANK_MOVEMENT_FILTER_BUCKETS = [
  "UNRECONCILED",
  "PARTIAL",
  "RECONCILED",
  "DUPLICATES",
] as const;
export type TreasuryBankMovementFilterBucket =
  (typeof TREASURY_BANK_MOVEMENT_FILTER_BUCKETS)[number];

export const TREASURY_AVAILABILITY_STATUSES = [
  "available",
  "disabled",
  "scaffold",
] as const;
export type TreasuryAvailabilityStatus =
  (typeof TREASURY_AVAILABILITY_STATUSES)[number];

export const TREASURY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type TreasurySortDirection = (typeof TREASURY_SORT_DIRECTIONS)[number];

export const TREASURY_ACCOUNT_SORT_FIELDS = [
  "code",
  "name",
  "createdAt",
  "updatedAt",
  "sortOrder",
] as const;
export type TreasuryAccountSortField =
  (typeof TREASURY_ACCOUNT_SORT_FIELDS)[number];

export const TREASURY_LEDGER_SORT_FIELDS = [
  "civilDate",
  "createdAt",
  "amount",
] as const;
export type TreasuryLedgerSortField =
  (typeof TREASURY_LEDGER_SORT_FIELDS)[number];

export const TREASURY_AGENDA_SORT_FIELDS = [
  "civilDate",
  "amount",
  "side",
] as const;
export type TreasuryAgendaSortField =
  (typeof TREASURY_AGENDA_SORT_FIELDS)[number];

/** Status operacional derivado (oficial + complemento) na listagem de CR. */
export const TREASURY_RECEIVABLE_OPERATIONAL_STATUSES = [
  "OPEN",
  "OVERDUE",
  "SETTLED",
  "PROMISED",
  "EXPECTED",
  "ON_HOLD",
  "CANCELLED_SOURCE",
  "CANCELLED_LOCAL",
] as const;
export type TreasuryReceivableOperationalStatus =
  (typeof TREASURY_RECEIVABLE_OPERATIONAL_STATUSES)[number];

export const TREASURY_RECEIVABLE_SORT_FIELDS = [
  "dueDate",
  "personName",
  "openAmount",
  "originalAmount",
  "daysOverdue",
  "expectedDate",
  "priority",
  "lastSyncedAt",
  "externalId",
] as const;
export type TreasuryReceivableSortField =
  (typeof TREASURY_RECEIVABLE_SORT_FIELDS)[number];

/** Status operacional derivado (oficial + complemento) na listagem de CP. */
export const TREASURY_PAYABLE_OPERATIONAL_STATUSES = [
  "OPEN",
  "OVERDUE",
  "SETTLED",
  "PROGRAMMED",
  "AUTHORIZED",
  "EXPECTED",
  "ON_HOLD",
  "CANCELLED_SOURCE",
  "CANCELLED_LOCAL",
] as const;
export type TreasuryPayableOperationalStatus =
  (typeof TREASURY_PAYABLE_OPERATIONAL_STATUSES)[number];

/** Status da programação local de pagamento (CP). */
export const TREASURY_PAYABLE_PROGRAMMING_STATUSES = [
  "PROGRAMMED",
  "AUTHORIZED",
] as const;
export type TreasuryPayableProgrammingStatus =
  (typeof TREASURY_PAYABLE_PROGRAMMING_STATUSES)[number];

export const TREASURY_PAYABLE_SORT_FIELDS = [
  "dueDate",
  "personName",
  "openAmount",
  "originalAmount",
  "daysOverdue",
  "scheduledDate",
  "priority",
  "lastSyncedAt",
  "externalId",
  "documentNumber",
] as const;
export type TreasuryPayableSortField =
  (typeof TREASURY_PAYABLE_SORT_FIELDS)[number];

export const TREASURY_TITLE_OPERATIONAL_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;
export type TreasuryTitleOperationalPriority =
  (typeof TREASURY_TITLE_OPERATIONAL_PRIORITIES)[number];

export const TREASURY_TITLE_OPERATIONAL_STATUSES = [
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TreasuryTitleOperationalStatusCode =
  (typeof TREASURY_TITLE_OPERATIONAL_STATUSES)[number];
