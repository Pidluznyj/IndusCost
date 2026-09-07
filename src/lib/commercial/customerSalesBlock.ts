/**
 * Trava comercial de venda por boleto vencido — regras PURAS.
 *
 * Autoridade financeira: motor oficial de AR.
 * Identidade: SalesOrder.externalCustomerId = Nomus idPessoaCliente = AR.personId.
 * Sem persistência em Customer.status. Sem matching por nome.
 */

import {
  computeDaysOverdue,
  roundMoney,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { filterOfficialArOverdueTitles } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import { isBoletoPaymentMethod } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import type {
  CustomerSalesBlockPublic,
  CustomerSalesBlockResolution,
} from "./customerSalesBlockView.js";

export {
  CUSTOMER_SALES_BLOCKED_BUTTON_HINT,
  CUSTOMER_SALES_BLOCKED_GENERIC_HINT,
  CUSTOMER_SALES_BLOCKED_MESSAGE,
  CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO,
  customerSalesBlockTooltip,
  formatCustomerCadastralStatus,
  type CustomerSalesBlockPublic,
  type CustomerSalesBlockResolution,
} from "./customerSalesBlockView.js";

/**
 * IDs Nomus `idFormaPagamento` confirmados como boleto. Vazio até o domínio
 * publicar o catálogo — a detecção vigente é o classificador de token já usado
 * em Compras (`isBoletoPaymentMethod` sobre `nomeFormaPagamento`).
 */
export const CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS: readonly number[] = [];

export type CustomerNomusPersonResolution =
  | { kind: "RESOLVED"; personId: number }
  | { kind: "MISSING" }
  | { kind: "CONFLICT"; personIds: number[] };

export type CustomerSalesBlockArTitle = FinanceArDashboardRow & {
  paymentMethodId?: number | null;
};

export type CustomerSalesBlockStatus = {
  blocked: boolean;
  reason: "OVERDUE_BOLETO" | null;
  overdueBoletoCount: number;
  overdueOpenBalance: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number | null;
  nomusPersonId: number | null;
  evaluatedAt: string;
  resolution: CustomerSalesBlockResolution;
};

export function resolveUniqueNomusPersonId(
  externalCustomerIds: ReadonlyArray<number | null | undefined>
): CustomerNomusPersonResolution {
  const unique = [
    ...new Set(
      externalCustomerIds.filter((id): id is number => Number.isInteger(id) && (id as number) > 0)
    ),
  ].sort((a, b) => a - b);
  if (unique.length === 0) return { kind: "MISSING" };
  if (unique.length > 1) return { kind: "CONFLICT", personIds: unique };
  return { kind: "RESOLVED", personId: unique[0]! };
}

export function isOfficialArBoletoPaymentMethod(row: {
  paymentMethodId?: number | null;
  paymentMethodName?: string | null;
}): boolean {
  if (row.paymentMethodId != null && CANONICAL_AR_BOLETO_PAYMENT_METHOD_IDS.includes(row.paymentMethodId)) {
    return true;
  }
  return isBoletoPaymentMethod(row.paymentMethodName);
}

export function isUnclassifiedArPaymentMethod(row: {
  paymentMethodId?: number | null;
  paymentMethodName?: string | null;
}): boolean {
  const id = row.paymentMethodId;
  const name = row.paymentMethodName?.trim() ?? "";
  return (id == null || id <= 0) && name.length === 0;
}

function toIsoDateOnly(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DEFAULT_AR_FILTERS: FinanceArDashboardFilters = { status: "all" };

export function buildCustomerSalesBlockStatus(input: {
  personResolution: CustomerNomusPersonResolution;
  titles: readonly CustomerSalesBlockArTitle[];
  today: Date;
  evaluatedAt?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
}): CustomerSalesBlockStatus {
  const evaluatedAt = (input.evaluatedAt ?? input.today).toISOString();
  const empty = (
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

  if (input.personResolution.kind === "MISSING" || input.personResolution.kind === "CONFLICT") {
    return empty("UNRESOLVED_IDENTITY", null);
  }

  const personId = input.personResolution.personId;
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
    return empty("UNRESOLVED_PAYMENT_METHOD", personId);
  }

  return empty("RESOLVED", personId);
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

export class CustomerSalesBlockedError extends Error {
  readonly code = "CUSTOMER_SALES_BLOCKED_OVERDUE_BOLETO";
  readonly httpStatus = 409;

  constructor(message = "Venda bloqueada. O cliente possui boleto(s) vencido(s) em aberto.") {
    super(message);
    this.name = "CustomerSalesBlockedError";
  }
}
