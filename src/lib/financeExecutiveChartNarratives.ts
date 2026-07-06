import type { ExecutiveCashFlowChartRow } from "./financeExecutiveReportPresentation.js";
import type { ExecutiveBarComparisonRow } from "./financeExecutiveReportPresentation.js";
import type { ExecutiveRealizedProjectedChartModel } from "./financeExecutiveReportPresentation.js";
import type { ExecutiveScheduleChartRow } from "./financeExecutiveReportPresentation.js";
import type { ExecutiveSalesOrdersChartRow } from "./financeExecutiveReportPresentation.js";

export type ExecutiveChartNarrativeInput = {
  cashFlow?: ExecutiveCashFlowChartRow[];
  billingComparison?: {
    rows: ExecutiveBarComparisonRow[];
    selectedYear: number;
    currentMonth: number;
    target?: number | null;
    actual?: number | null;
  };
  realizedProjected?: ExecutiveRealizedProjectedChartModel;
  arSchedule?: ExecutiveScheduleChartRow[];
  apSchedule?: ExecutiveScheduleChartRow[];
  salesOrders?: {
    rows: ExecutiveSalesOrdersChartRow[];
    target?: number | null;
    actual?: number | null;
    currentMonth: number;
  };
};

export function buildCashFlowChartNarrative(rows: ExecutiveCashFlowChartRow[]): string {
  if (rows.length === 0) {
    return "Sem movimentos projetados para compor a leitura do caixa no período.";
  }

  const finalAccumulated = rows[rows.length - 1]?.accumulated ?? 0;
  const q4 = rows.filter((r) => r.month >= 10);
  const q4Negative = q4.filter((r) => r.netFlow < 0).length;
  const negativeMonths = rows.filter((r) => r.netFlow < 0).length;

  if (finalAccumulated < 0) {
    return "O caixa projetado encerra o ano negativo, indicando que as saídas previstas superam as entradas ao longo do período.";
  }

  if (q4Negative >= 2) {
    return "Há pressão de caixa no fim do ano, com meses negativos concentrados no último trimestre.";
  }

  if (negativeMonths >= 4) {
    return "Existem vários meses com saldo líquido negativo; acompanhe recebimentos e pagamentos concentrados.";
  }

  const minAccum = Math.min(...rows.map((r) => r.accumulated));
  const maxAccum = Math.max(...rows.map((r) => r.accumulated));
  if (maxAccum - minAccum > 0 && minAccum < finalAccumulated * 0.5 && minAccum < maxAccum) {
    return "Existe uma queda relevante no saldo acumulado, exigindo atenção aos recebimentos previstos e aos pagamentos concentrados.";
  }

  return "O caixa projetado se mantém positivo no acumulado anual, com entradas suficientes para cobrir as saídas previstas.";
}

export function buildBillingComparisonChartNarrative(
  input: NonNullable<ExecutiveChartNarrativeInput["billingComparison"]>
): string {
  const current = input.rows.find((r) => r.month === input.currentMonth);
  const actual = input.actual ?? current?.values[input.selectedYear] ?? 0;
  const target = input.target;

  if (target != null && target > 0 && actual < target * 0.95) {
    return "O faturamento está abaixo da referência esperada, exigindo atenção à conversão dos pedidos e emissão de NF até o fechamento.";
  }

  if (target != null && target > 0 && actual >= target) {
    return "O faturamento está acima da referência esperada, indicando bom desempenho no período.";
  }

  const years = Object.keys(current?.values ?? {}).map(Number).sort();
  if (years.length >= 2) {
    const prev = years[years.length - 2];
    const cur = years[years.length - 1];
    const prevVal = current?.values[prev] ?? 0;
    const curVal = current?.values[cur] ?? 0;
    if (curVal > prevVal && prevVal > 0) {
      return "O faturamento do mês evoluiu em relação ao ano anterior, sinalizando crescimento na receita.";
    }
    if (curVal < prevVal && prevVal > 0) {
      return "O faturamento do mês ficou abaixo do mesmo período do ano anterior; vale revisar ritmo comercial e faturamento.";
    }
  }

  return "O gráfico compara o faturamento mês a mês entre anos para identificar sazonalidade e evolução da receita.";
}

export function buildRealizedProjectedChartNarrative(model: ExecutiveRealizedProjectedChartModel): string {
  if (!model.hasData) {
    return "Sem dados suficientes para comparar realizado, projeção e meta no mês.";
  }

  const realized = model.realized ?? 0;
  const projected = model.projected ?? 0;
  const target = model.target;

  if (target != null && target > 0) {
    if (realized < target * 0.9) {
      return "O realizado está abaixo da meta; a projeção indica se o ritmo atual é suficiente para atingir o resultado esperado até o fim do mês.";
    }
    if (projected >= target) {
      return "A projeção indica que o ritmo atual é suficiente para atingir ou superar a meta até o fechamento do mês.";
    }
    return "O realizado ainda não alcança a meta; acompanhe o ritmo diário até o fechamento.";
  }

  if (projected > realized) {
    return "A projeção mostra se o ritmo atual é suficiente para atingir o resultado esperado até o fim do mês.";
  }

  return "O gráfico confronta o faturamento realizado com a projeção e a meta do mês para leitura rápida do desempenho.";
}

export function buildArScheduleChartNarrative(rows: ExecutiveScheduleChartRow[]): string {
  const overdue = rows.reduce((s, r) => s + r.overdueAmount, 0);
  const open = rows.reduce((s, r) => s + r.openAmount, 0);

  if (overdue > open * 0.3 && overdue > 0) {
    return "Há volume relevante em atraso; priorize cobrança dos títulos vencidos para melhorar o caixa.";
  }

  return "O volume em aberto mostra quanto ainda precisa entrar no caixa e ajuda a priorizar cobrança dos títulos vencidos.";
}

export function buildApScheduleChartNarrative(rows: ExecutiveScheduleChartRow[]): string {
  const upcoming = rows.reduce((s, r) => s + r.upcomingAmount, 0);
  const overdue = rows.reduce((s, r) => s + r.overdueAmount, 0);

  if (upcoming > overdue * 2 && upcoming > 0) {
    return "Há concentração de pagamentos nos próximos meses; planeje o caixa para honrar os compromissos a vencer.";
  }

  return "O volume a pagar indica os compromissos financeiros previstos e os períodos de maior pressão de saída de caixa.";
}

export function buildSalesOrdersChartNarrative(
  input: NonNullable<ExecutiveChartNarrativeInput["salesOrders"]>
): string {
  const current = input.rows.find((r) => r.month === input.currentMonth);
  const actual = input.actual ?? current?.currentYear ?? 0;
  const target = input.target;

  if (target != null && target > 0 && actual < target * 0.95) {
    return "Os pedidos do mês estão abaixo da meta; acompanhe conversão comercial e faturamento dos pedidos em carteira.";
  }

  if (target != null && target > 0 && actual >= target) {
    return "Os pedidos do mês atingem ou superam a meta, indicando boa força comercial no período.";
  }

  const withData = input.rows.filter((r) => (r.currentYear ?? 0) > 0);
  if (withData.length >= 3) {
    const last = withData[withData.length - 1];
    const prev = withData[withData.length - 2];
    if ((last.currentYear ?? 0) < (prev.currentYear ?? 0)) {
      return "Há desaceleração recente nos pedidos; vale reforçar prospecção e acompanhamento da carteira aberta.";
    }
  }

  return "Os pedidos indicam a força comercial do período e ajudam a antecipar faturamento futuro, desde que sejam entregues e faturados no prazo.";
}

export function buildExecutiveChartNarrative(
  kind:
    | "cash-flow"
    | "billing-comparison"
    | "billing-projection"
    | "accounts-receivable"
    | "accounts-payable"
    | "sales-orders",
  input: ExecutiveChartNarrativeInput
): string {
  switch (kind) {
    case "cash-flow":
      return buildCashFlowChartNarrative(input.cashFlow ?? []);
    case "billing-comparison":
      return input.billingComparison
        ? buildBillingComparisonChartNarrative(input.billingComparison)
        : "Comparativo de faturamento entre anos.";
    case "billing-projection":
      return input.realizedProjected
        ? buildRealizedProjectedChartNarrative(input.realizedProjected)
        : "Realizado versus projeção no mês.";
    case "accounts-receivable":
      return buildArScheduleChartNarrative(input.arSchedule ?? []);
    case "accounts-payable":
      return buildApScheduleChartNarrative(input.apSchedule ?? []);
    case "sales-orders":
      return input.salesOrders
        ? buildSalesOrdersChartNarrative(input.salesOrders)
        : "Evolução comercial dos pedidos de venda.";
    default:
      return "Leitura executiva do gráfico.";
  }
}

export function assertChartNarrativeFinite(text: string): boolean {
  return !text.includes("NaN") && !text.includes("Infinity");
}
