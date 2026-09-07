/**
 * Trava comercial de venda por boleto vencido — regras PURAS.
 *
 * Autoridade financeira: motor oficial de AR (`filterOfficialArOverdueTitles`).
 *
 * Identidade financeira (ver docs/commercial/customer-overdue-boleto-sales-block.md):
 *   primária   Customer.nomusExternalPersonId  ← Nomus `pessoas[].id` (idPessoa),
 *              gravado exclusivamente por scripts/nomusCustomersSyncV1.ts;
 *   evidência  SalesOrder.externalCustomerId    ← Nomus idPessoaCliente — só
 *              valida consistência, NÃO é requisito (863 clientes sem pedido);
 *   AR         NomusAccountsReceivable.personId.
 *
 * Boleto: decidido por `paymentMethodId` (catálogo Nomus observado: 10 =
 * "Boleto Bancário"). `paymentMethodName` é rótulo/diagnóstico, nunca decisão.
 *
 * Identidade não validável ⇒ fail closed para criação de venda, sem afirmar
 * inadimplência. Sem persistência em Customer.status. Sem matching por nome.
 */

import {
  computeDaysOverdue,
  roundMoney,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { filterOfficialArOverdueTitles } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import {
  CUSTOMER_SALES_BLOCK_ERROR_CODES,
  CUSTOMER_SALES_BLOCK_MESSAGES,
  type CustomerSalesBlockErrorCode,
  type CustomerSalesBlockPublic,
  type CustomerSalesBlockReason,
  type CustomerSalesBlockResolution,
} from "./customerSalesBlockView.js";

export {
  CUSTOMER_SALES_BLOCKED_BUTTON_HINT,
  CUSTOMER_SALES_BLOCKED_FINANCIAL_IDENTITY_UNRESOLVED,
  CUSTOMER_SALES_BLOCKED_GENERIC_HINT,
  CUSTOMER_SALES_BLOCKED_IDENTITY_HINT,
  CUSTOMER_SALES_BLOCKED_IDENTITY_MESSAGE,
  CUSTOMER_SALES_BLOCKED_MESSAGE,
  CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO,
  customerSalesBlockButtonHint,
  customerSalesBlockTooltip,
  formatCustomerCadastralStatus,
  isCustomerSalesBlockIdentityUnresolved,
  type CustomerSalesBlockErrorCode,
  type CustomerSalesBlockPublic,
  type CustomerSalesBlockReason,
  type CustomerSalesBlockResolution,
} from "./customerSalesBlockView.js";

/* ------------------------------------------------------------------ *
 * Boleto — autoridade por ID Nomus
 * ------------------------------------------------------------------ */

/**
 * Nomus `idFormaPagamento` de boleto no Contas a Receber. Catálogo observado na
 * homologação (4.835 títulos, 290 clientes): 10 = "Boleto Bancário"; nenhum
 * outro ID apareceu com nome contendo "boleto". O ID é a autoridade.
 */
export const CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS: ReadonlySet<number> = new Set([10]);

/** Decide boleto exclusivamente por `paymentMethodId`. O nome não participa. */
export function isOfficialArBoletoPaymentMethod(row: {
  paymentMethodId?: number | null;
  paymentMethodName?: string | null;
}): boolean {
  const id = row.paymentMethodId;
  return id != null && Number.isInteger(id) && CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS.has(id);
}

/** Título sem forma de pagamento informada (nem ID nem nome): não prova boleto. */
export function isUnclassifiedArPaymentMethod(row: {
  paymentMethodId?: number | null;
  paymentMethodName?: string | null;
}): boolean {
  const id = row.paymentMethodId;
  const name = row.paymentMethodName?.trim() ?? "";
  return (id == null || id <= 0) && name.length === 0;
}

/* ------------------------------------------------------------------ *
 * Identidade financeira do cliente
 * ------------------------------------------------------------------ */

export type CustomerFinancialIdentityInput = {
  /** Customer.nomusExternalPersonId — Nomus idPessoa (autoridade primária). */
  nomusExternalPersonId: number | null | undefined;
  /** SalesOrder.externalCustomerId dos pedidos do cliente — evidência de consistência. */
  salesOrderExternalCustomerIds: ReadonlyArray<number | null | undefined>;
};

export type CustomerFinancialIdentityResolution =
  | {
      kind: "RESOLVED";
      personId: number;
      /** IDs distintos vistos nos pedidos (vazio para cliente sem pedido). */
      salesOrderPersonIds: number[];
    }
  | { kind: "MISSING"; salesOrderPersonIds: number[] }
  | {
      kind: "CONFLICT";
      /** Customer.nomusExternalPersonId — NÃO usado para consultar AR. */
      customerPersonId: number;
      /** IDs distintos vistos nos pedidos, incluindo os divergentes. */
      salesOrderPersonIds: number[];
    };

function toPositiveInt(value: number | null | undefined): number | null {
  return value != null && Number.isInteger(value) && value > 0 ? value : null;
}

/** IDs Nomus distintos e válidos (>0), ordenados — sem escolher nenhum. */
export function uniqueNomusPersonIds(ids: ReadonlyArray<number | null | undefined>): number[] {
  return [...new Set(ids.map(toPositiveInt).filter((id): id is number => id != null))].sort((a, b) => a - b);
}

/**
 * Resolve a identidade financeira do cliente sem heurística:
 *
 * A/B. nomusExternalPersonId presente e nenhum pedido diverge (inclui cliente
 *      sem pedido) → RESOLVED com o ID do Customer.
 * C.   nomusExternalPersonId presente e algum pedido diverge → CONFLICT
 *      (não escolhe, não soma, não infere).
 * D/E. nomusExternalPersonId ausente → MISSING. Não há regra oficial que
 *      promova SalesOrder.externalCustomerId a identidade do Customer
 *      (a Inteligência do Cliente liga AR por CNPJ, não por pedido), e a
 *      evidência da homologação tem 0 casos de D — nada a inventar.
 */
export function resolveCustomerFinancialIdentity(
  input: CustomerFinancialIdentityInput
): CustomerFinancialIdentityResolution {
  const salesOrderPersonIds = uniqueNomusPersonIds(input.salesOrderExternalCustomerIds);
  const customerPersonId = toPositiveInt(input.nomusExternalPersonId);
  if (customerPersonId == null) return { kind: "MISSING", salesOrderPersonIds };
  const conflicting = salesOrderPersonIds.filter((id) => id !== customerPersonId);
  if (conflicting.length > 0) {
    return { kind: "CONFLICT", customerPersonId, salesOrderPersonIds };
  }
  return { kind: "RESOLVED", personId: customerPersonId, salesOrderPersonIds };
}

/* ------------------------------------------------------------------ *
 * Status da trava
 * ------------------------------------------------------------------ */

export type CustomerSalesBlockArTitle = FinanceArDashboardRow & {
  paymentMethodId?: number | null;
};

export type CustomerSalesBlockStatus = {
  blocked: boolean;
  reason: CustomerSalesBlockReason | null;
  overdueBoletoCount: number;
  overdueOpenBalance: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number | null;
  nomusPersonId: number | null;
  evaluatedAt: string;
  resolution: CustomerSalesBlockResolution;
};

function toIsoDateOnly(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DEFAULT_AR_FILTERS: FinanceArDashboardFilters = { status: "all" };

export function buildCustomerSalesBlockStatus(input: {
  identity: CustomerFinancialIdentityResolution;
  titles: readonly CustomerSalesBlockArTitle[];
  today: Date;
  evaluatedAt?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
}): CustomerSalesBlockStatus {
  const evaluatedAt = (input.evaluatedAt ?? input.today).toISOString();
  const base = (
    resolution: CustomerSalesBlockResolution,
    nomusPersonId: number | null
  ): CustomerSalesBlockStatus => ({
    blocked: false,
    reason: null,
    overdueBoletoCount: 0,
    overdueOpenBalance: 0,
    oldestDueDate: null,
    maxDaysOverdue: null,
    nomusPersonId,
    evaluatedAt,
    resolution,
  });

  // Fail closed: sem identidade validável não se afirma dívida, mas também
  // não se libera venda. nomusPersonId fica null — nenhum AR foi consultado.
  if (input.identity.kind === "MISSING") {
    return { ...base("UNRESOLVED_IDENTITY", null), blocked: true, reason: "FINANCIAL_IDENTITY_UNRESOLVED" };
  }
  if (input.identity.kind === "CONFLICT") {
    return {
      ...base("UNRESOLVED_IDENTITY_CONFLICT", null),
      blocked: true,
      reason: "FINANCIAL_IDENTITY_UNRESOLVED",
    };
  }

  const personId = input.identity.personId;
  const ofPerson = input.titles.filter((row) => row.personId === personId);
  const officialOverdue = filterOfficialArOverdueTitles(
    [...ofPerson],
    DEFAULT_AR_FILTERS,
    input.today,
    input.syncCutoff
  ) as CustomerSalesBlockArTitle[];

  const boletos = officialOverdue.filter((row) => isOfficialArBoletoPaymentMethod(row));
  if (boletos.length > 0) {
    const overdueOpenBalance = roundMoney(
      boletos.reduce((sum, row) => sum + row.balanceReceivable, 0)
    );
    let oldest: Date | null = null;
    let maxDaysOverdue = 0;
    for (const row of boletos) {
      if (!row.dueDate) continue;
      if (!oldest || row.dueDate.getTime() < oldest.getTime()) oldest = row.dueDate;
      maxDaysOverdue = Math.max(maxDaysOverdue, computeDaysOverdue(row.dueDate, input.today));
    }
    return {
      blocked: true,
      reason: "OVERDUE_BOLETO",
      overdueBoletoCount: boletos.length,
      overdueOpenBalance,
      oldestDueDate: toIsoDateOnly(oldest),
      maxDaysOverdue: maxDaysOverdue > 0 ? maxDaysOverdue : null,
      nomusPersonId: personId,
      evaluatedAt,
      resolution: "RESOLVED",
    };
  }

  const unclassifiableOverdue = officialOverdue.filter((row) => isUnclassifiedArPaymentMethod(row));
  if (officialOverdue.length > 0 && unclassifiableOverdue.length === officialOverdue.length) {
    return base("UNRESOLVED_PAYMENT_METHOD", personId);
  }

  return base("RESOLVED", personId);
}

export function toPublicCustomerSalesBlock(
  status: CustomerSalesBlockStatus,
  includeFinancialDetails: boolean
): CustomerSalesBlockPublic {
  const base: CustomerSalesBlockPublic = {
    blocked: status.blocked,
    reason: status.reason,
    resolution: status.resolution,
  };
  if (!includeFinancialDetails) return base;
  return {
    ...base,
    overdueBoletoCount: status.overdueBoletoCount,
    overdueOpenBalance: status.overdueOpenBalance,
    oldestDueDate: status.oldestDueDate,
    maxDaysOverdue: status.maxDaysOverdue,
    nomusPersonId: status.nomusPersonId,
    evaluatedAt: status.evaluatedAt,
  };
}

/** Erro de domínio do hard block. Código e mensagem seguem o motivo real. */
export class CustomerSalesBlockedError extends Error {
  readonly reason: CustomerSalesBlockReason;
  readonly code: CustomerSalesBlockErrorCode;
  readonly httpStatus = 409;

  constructor(reason: CustomerSalesBlockReason = "OVERDUE_BOLETO") {
    super(CUSTOMER_SALES_BLOCK_MESSAGES[reason]);
    this.name = "CustomerSalesBlockedError";
    this.reason = reason;
    this.code = CUSTOMER_SALES_BLOCK_ERROR_CODES[reason];
  }
}
