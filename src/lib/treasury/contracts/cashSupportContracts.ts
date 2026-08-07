/**
 * Contratos do Apoio ao Caixa (read model).
 *
 * Camada de LEITURA sobre fontes existentes — não é autoridade de nada.
 * A conciliação continua sendo do `TreasuryReconciliation*` (ADR 001).
 *
 * Três identidades distintas e NÃO intercambiáveis. O compilador é quem
 * impede o erro caro: uma previsão nunca pode ser passada onde se espera um
 * título conciliável, porque os tipos são incompatíveis por marca.
 */

import type { TreasuryMoneyString } from "../treasuryMoney.js";

// ─── Identidades ────────────────────────────────────────────────────────────

/** Lado oficial do título no Nomus. */
export type CashSupportTitleSide = "ACCOUNTS_RECEIVABLE" | "ACCOUNTS_PAYABLE";

/**
 * Título REAL do Nomus — a única coisa conciliável.
 * `externalId` é sempre > 0; id sintético (previsão) é negativo e rejeitado.
 */
export type CashSupportOfficialTitleKey = {
  readonly __brand: "officialTitleKey";
  companyCode: string;
  side: CashSupportTitleSide;
  externalId: number;
};

/** Movimento bancário — reutiliza a identidade que já existe. */
export type CashSupportBankMovementKey = {
  readonly __brand: "bankMovementKey";
  bankMovementId: string;
};

/**
 * Contexto de previsão. **Proibida em qualquer escrita.** Instável por
 * natureza: muda com recálculo/reagendamento e desaparece quando o CR real
 * é emitido.
 */
export type CashSupportForecastContextKey = {
  readonly __brand: "forecastContextKey";
  orderCode: string | null;
  lineKind: string;
  syntheticId: number;
};

export class CashSupportIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashSupportIdentityError";
  }
}

/**
 * Constrói a chave de título oficial. Rejeita id sintético — é aqui que a
 * regra "previsão não é conciliável" vira impossibilidade, não convenção.
 */
export function buildCashSupportOfficialTitleKey(input: {
  companyCode: string;
  side: CashSupportTitleSide;
  externalId: number;
}): CashSupportOfficialTitleKey {
  if (!Number.isInteger(input.externalId) || input.externalId <= 0) {
    throw new CashSupportIdentityError(
      `externalId ${input.externalId} não é um título oficial: previsões usam id sintético e não são conciliáveis.`
    );
  }
  if (!input.companyCode.trim()) {
    throw new CashSupportIdentityError("companyCode é obrigatório na chave do título.");
  }
  return {
    __brand: "officialTitleKey",
    companyCode: input.companyCode.trim(),
    side: input.side,
    externalId: input.externalId,
  };
}

export function buildCashSupportBankMovementKey(
  bankMovementId: string
): CashSupportBankMovementKey {
  if (!bankMovementId.trim()) {
    throw new CashSupportIdentityError("bankMovementId é obrigatório.");
  }
  return { __brand: "bankMovementKey", bankMovementId: bankMovementId.trim() };
}

export function buildCashSupportForecastContextKey(input: {
  orderCode: string | null;
  lineKind: string;
  syntheticId: number;
}): CashSupportForecastContextKey {
  return {
    __brand: "forecastContextKey",
    orderCode: input.orderCode?.trim() || null,
    lineKind: input.lineKind,
    syntheticId: input.syntheticId,
  };
}

/** Serialização estável para exibição e agrupamento. */
export function formatCashSupportOfficialTitleKey(
  key: CashSupportOfficialTitleKey
): string {
  return `${key.companyCode}:${key.side}:${key.externalId}`;
}

export function formatCashSupportForecastContextKey(
  key: CashSupportForecastContextKey
): string {
  return `${key.orderCode ?? "?"}:${key.lineKind}:${key.syntheticId}`;
}

// ─── Enums do read model ────────────────────────────────────────────────────

export const CASH_SUPPORT_RESOURCE_TYPES = [
  "FORECAST",
  "OFFICIAL_RECEIVABLE",
  "OFFICIAL_PAYABLE",
  "BANK_MOVEMENT",
  "INTERNAL_TRANSFER",
  "ADJUSTMENT",
  "UNIDENTIFIED",
] as const;
export type CashSupportResourceType =
  (typeof CASH_SUPPORT_RESOURCE_TYPES)[number];

/** Tipos que nunca são conciliáveis, qualquer que seja o estado. */
export const CASH_SUPPORT_NON_RECONCILABLE_TYPES: readonly CashSupportResourceType[] =
  ["FORECAST"];

export type CashSupportDirection = "IN" | "OUT";

export const CASH_SUPPORT_RECONCILIATION_STATES = [
  "NOT_APPLICABLE",
  "PENDING",
  "PARTIAL",
  "MATCHED",
  "UNMATCHED",
  "IGNORED",
] as const;
export type CashSupportReconciliationState =
  (typeof CASH_SUPPORT_RECONCILIATION_STATES)[number];

export const CASH_SUPPORT_WARNING_CODES = [
  "COMPANY_CONTEXT_UNAVAILABLE",
  "ACCOUNT_CONTEXT_UNAVAILABLE",
  "CURRENCY_ASSUMED",
  "STATEMENT_COVERAGE_UNKNOWN",
  "AVAILABLE_BALANCE_UNSUPPORTED",
  "SOURCE_CORRECTION_UNSUPPORTED",
  "OTHER_MOVEMENTS_NOT_LOADED",
  "FORECAST_CONTEXT_ONLY",
  "SOURCE_CHANGED",
  "BALANCE_NOT_COMPARABLE",
] as const;
export type CashSupportWarningCode =
  (typeof CASH_SUPPORT_WARNING_CODES)[number];

export type CashSupportWarning = {
  code: CashSupportWarningCode;
  message: string;
};

export const CASH_SUPPORT_ACTIONS = [
  "VIEW_DETAIL",
  "VIEW_SUGGESTIONS",
  "RECONCILE",
  "UNMATCH",
  "REVERSE",
  "CLASSIFY",
  "INVESTIGATE",
] as const;
export type CashSupportActionKind = (typeof CASH_SUPPORT_ACTIONS)[number];

export type CashSupportAvailableAction = {
  kind: CashSupportActionKind;
  /** Backend decide; a UI só desenha. */
  enabled: boolean;
  /** Motivo do bloqueio, quando desabilitada. */
  disabledReason: string | null;
};

export type CashSupportSourceReference = {
  /** Tabela/serviço de origem, ex.: "TreasuryBankMovement". */
  source: string;
  id: string;
  label: string | null;
};

/** Contexto que pode faltar — `null` é fato, nunca preenchido por adivinhação. */
export type CashSupportCompanyContext = { companyCode: string } | null;
export type CashSupportAccountContext = {
  accountId: string;
  accountName: string | null;
} | null;
export type CashSupportCurrencyContext = { currency: "BRL"; assumed: boolean };

// ─── Linha unificada ────────────────────────────────────────────────────────

export type CashSupportUnifiedRow = {
  displayId: string;
  resourceType: CashSupportResourceType;

  officialTitleKey: CashSupportOfficialTitleKey | null;
  bankMovementKey: CashSupportBankMovementKey | null;
  forecastContextKey: CashSupportForecastContextKey | null;

  /** Backend decide. `false` obrigatoriamente para FORECAST. */
  reconcilable: boolean;

  direction: CashSupportDirection;
  description: string | null;

  /** Previsão espera. */
  expectedDate: string | null;
  /** Vencimento oficial — previsão, atraso, programação. Nunca é realizado. */
  dueDate: string | null;
  /** `postedCivilDate` do extrato — a ÚNICA data de caixa realizado. */
  bankDate: string | null;
  /** Instante do fato na origem. */
  occurredAt: string | null;
  /** Última alteração conhecida da fonte. */
  sourceUpdatedAt: string | null;

  expectedAmount: TreasuryMoneyString | null;
  officialAmount: TreasuryMoneyString | null;
  bankAmount: TreasuryMoneyString | null;
  allocatedAmount: TreasuryMoneyString;
  adjustmentAmount: TreasuryMoneyString;
  residualAmount: TreasuryMoneyString;

  reconciliationState: CashSupportReconciliationState;
  /** Estado na fonte (`calculatedStatus`, status do lote, etc.). */
  sourceState: string | null;

  companyContext: CashSupportCompanyContext;
  accountContext: CashSupportAccountContext;
  currencyContext: CashSupportCurrencyContext;

  sourceReferences: CashSupportSourceReference[];
  warnings: CashSupportWarning[];
  availableActions: CashSupportAvailableAction[];
};

// ─── Resumo ─────────────────────────────────────────────────────────────────

/**
 * Duas famílias separadas por ponte explícita. Posição bancária é dinheiro;
 * posição canônica é compromisso. Somar as duas num número só produziria
 * dupla contagem — por isso são campos distintos.
 */
export type CashSupportSummary = {
  bankPosition: {
    balance: TreasuryMoneyString | null;
    inflows: TreasuryMoneyString;
    outflows: TreasuryMoneyString;
    reconciled: TreasuryMoneyString;
    partiallyReconciled: TreasuryMoneyString;
    unreconciled: TreasuryMoneyString;
    unidentified: TreasuryMoneyString;
  };
  canonicalPosition: {
    expectedTitles: TreasuryMoneyString;
    /** Títulos com evidência bancária conciliada — não somar de novo. */
    evidencedTitles: TreasuryMoneyString;
    futureForecasts: TreasuryMoneyString;
    overdue: TreasuryMoneyString;
  };
  bridge: {
    bankNotExplainedByTitles: TreasuryMoneyString;
    titlesWithoutBankEvidence: TreasuryMoneyString;
    /** Transferências internas: sempre "0.00" no consolidado. */
    internalTransfersConsolidated: TreasuryMoneyString;
  };
  warnings: CashSupportWarning[];
};

// ─── Filtros e resultado ────────────────────────────────────────────────────

export type CashSupportFilters = {
  civilDateFrom: string;
  civilDateTo: string;
  companyCode?: string | null;
  accountId?: string | null;
  currency?: "BRL" | null;
  direction?: CashSupportDirection | null;
  resourceTypes?: readonly CashSupportResourceType[] | null;
  reconciliationStates?: readonly CashSupportReconciliationState[] | null;
  search?: string | null;
  onlyPending?: boolean;
  onlyWarnings?: boolean;
  page?: number;
  pageSize?: number;
};

export type CashSupportReadModel = {
  rows: CashSupportUnifiedRow[];
  summary: CashSupportSummary;
  /** Instante da análise — toda leitura é datada. */
  analysisAsOfDateTime: string;
  pagination: { page: number; pageSize: number; total: number };
  warnings: CashSupportWarning[];
};

// ─── Invariantes ────────────────────────────────────────────────────────────

/**
 * Guarda de integridade da linha. Roda no backend antes de responder — é o
 * ponto onde uma regressão futura que tornasse previsão conciliável falha
 * ruidosamente em vez de virar allocation indevida.
 */
export function assertCashSupportRowInvariants(row: CashSupportUnifiedRow): void {
  if (
    CASH_SUPPORT_NON_RECONCILABLE_TYPES.includes(row.resourceType) &&
    row.reconcilable
  ) {
    throw new CashSupportIdentityError(
      `${row.displayId}: ${row.resourceType} não pode ser conciliável.`
    );
  }
  if (row.resourceType === "FORECAST") {
    if (row.officialTitleKey) {
      throw new CashSupportIdentityError(
        `${row.displayId}: previsão não pode carregar officialTitleKey.`
      );
    }
    if (row.bankDate) {
      throw new CashSupportIdentityError(
        `${row.displayId}: previsão não pode ter bankDate — não houve dinheiro.`
      );
    }
    const reconcileAction = row.availableActions.find(
      (a) => a.kind === "RECONCILE" && a.enabled
    );
    if (reconcileAction) {
      throw new CashSupportIdentityError(
        `${row.displayId}: previsão não pode oferecer ação de conciliar.`
      );
    }
  }
  if (row.reconcilable && !row.officialTitleKey && !row.bankMovementKey) {
    throw new CashSupportIdentityError(
      `${row.displayId}: linha conciliável exige título oficial ou movimento bancário.`
    );
  }
  if (row.bankDate && !row.bankMovementKey) {
    throw new CashSupportIdentityError(
      `${row.displayId}: bankDate só pode vir de movimento bancário.`
    );
  }
}
