import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import { roundMoney, safeRatio } from "./financeAccountsReceivableDashboard.js";
import type {
  FinanceCashFlowDashboardCards,
  FinanceCashFlowMonthlyPoint,
  FinanceCashFlowPartySummary,
} from "./financeCashFlowDashboardTypes.js";

export type NetCashPositionStatus = "surplus" | "deficit";
export type FinanceCashFlowMonthlyNetStatus = "positive" | "negative";

const CONCENTRATION_THRESHOLD_PERCENT = 40;

export type NetCashPositionMetrics = {
  netCashPosition: number;
  netCashPositionStatus: NetCashPositionStatus;
  netCashPositionAbs: number;
  netCashPositionLabel: string;
  cashCoverageRatio: number | null;
  cashNeedAmount: number;
  cashNeedLabel: string;
};

export function buildNetCashPositionMetrics(
  totalReceivableOpen: number,
  totalPayableOpen: number
): NetCashPositionMetrics {
  const netCashPosition = roundMoney(totalReceivableOpen - totalPayableOpen);
  const isSurplus = netCashPosition >= 0;
  const netCashPositionAbs = roundMoney(Math.abs(netCashPosition));

  let cashCoverageRatio: number | null = null;
  if (totalPayableOpen > 0) {
    cashCoverageRatio = roundMoney(safeRatio(totalReceivableOpen, totalPayableOpen));
  } else if (totalReceivableOpen > 0) {
    cashCoverageRatio = null;
  }

  return {
    netCashPosition,
    netCashPositionStatus: isSurplus ? "surplus" : "deficit",
    netCashPositionAbs,
    netCashPositionLabel: isSurplus ? "Superávit projetado" : "Déficit projetado",
    cashCoverageRatio,
    cashNeedAmount: isSurplus ? 0 : netCashPositionAbs,
    cashNeedLabel: isSurplus ? "Folga projetada" : "Necessidade de caixa",
  };
}

export function resolveMonthlyNetStatus(
  netFlowAmount: number | null
): FinanceCashFlowMonthlyNetStatus | null {
  if (netFlowAmount == null) return null;
  return netFlowAmount >= 0 ? "positive" : "negative";
}

export function enrichFinanceCashFlowMonthlyPoint(
  point: FinanceCashFlowMonthlyPoint
): FinanceCashFlowMonthlyPoint {
  return {
    ...point,
    status: resolveMonthlyNetStatus(point.netFlowAmount),
  };
}

export type CashFlowExecutiveReadingInput = {
  cards: Pick<
    FinanceCashFlowDashboardCards,
    | "netCashPosition"
    | "netCashPositionAbs"
    | "netCashPositionStatus"
    | "overdueReceivableAmount"
    | "overduePayableAmount"
    | "negativeBalanceMonthsCount"
  >;
  topCustomer?: FinanceCashFlowPartySummary;
  topSupplier?: FinanceCashFlowPartySummary;
};

export function buildCashFlowExecutiveReading(input: CashFlowExecutiveReadingInput): string[] {
  const lines: string[] = [];
  const { cards, topCustomer, topSupplier } = input;

  if (cards.netCashPositionStatus === "deficit") {
    lines.push(
      `A carteira projetada indica déficit de ${formatFinanceCurrency(cards.netCashPositionAbs)} no período filtrado.`
    );
  } else {
    lines.push(
      `A carteira projetada indica folga de ${formatFinanceCurrency(cards.netCashPositionAbs)} no período filtrado.`
    );
  }

  if (cards.overdueReceivableAmount > 0) {
    lines.push(
      `Há ${formatFinanceCurrency(cards.overdueReceivableAmount)} vencidos a receber que podem melhorar o caixa se recuperados.`
    );
  }

  if (cards.overduePayableAmount > 0) {
    lines.push(
      `Há ${formatFinanceCurrency(cards.overduePayableAmount)} em pagamentos vencidos pressionando o caixa.`
    );
  }

  if (cards.negativeBalanceMonthsCount > 0) {
    const n = cards.negativeBalanceMonthsCount;
    lines.push(
      `O caixa apresenta ${n} ${n === 1 ? "mês" : "meses"} com fluxo líquido negativo.`
    );
  }

  const customerLine = concentrationLine(topCustomer, "cliente");
  if (customerLine) lines.push(customerLine);

  const supplierLine = concentrationLine(topSupplier, "fornecedor");
  if (supplierLine) lines.push(supplierLine);

  return lines;
}

function concentrationLine(
  party: FinanceCashFlowPartySummary | undefined,
  kind: "cliente" | "fornecedor"
): string | null {
  if (!party || party.percentOfTotal < CONCENTRATION_THRESHOLD_PERCENT) return null;
  const name = party.personName?.trim() || "sem nome identificado";
  const pct = party.percentOfTotal.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `Existe concentração relevante em ${kind} ${name} (${pct}% do total).`;
}
