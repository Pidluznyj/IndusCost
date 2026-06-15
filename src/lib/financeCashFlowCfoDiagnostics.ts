import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import {
  isFinanceArOpen,
  roundMoney,
  startOfLocalDay,
} from "./financeAccountsReceivableDashboard.js";
import { isFinanceApOpen } from "./financeAccountsPayableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type {
  FinanceCashFlowCriticalMovement,
  FinanceCashFlowDashboardPayload,
  FinanceCashFlowPartySummary,
} from "./financeCashFlowDashboardTypes.js";
import {
  cashFlowViewModeSlices,
  resolveCashFlowArMovementDate,
  resolveCashFlowApMovementDate,
} from "./financeCashFlowLedger.js";

/** Limite de concentração (%) para alerta gerencial. */
export const CFO_CONCENTRATION_ALERT_PERCENT = 40;

export type CashFlowHealthClassification = "healthy" | "attention" | "risk" | "critical";

export type CashFlowInsightSeverity = "info" | "warning" | "critical" | "success";

export type CashFlowInsightItem = {
  title: string;
  description: string;
  severity: CashFlowInsightSeverity;
  relatedAmount: number | null;
  relatedEntity: string | null;
  suggestedAction: string | null;
};

export type CashHealthScore = {
  score: number;
  classification: CashFlowHealthClassification;
  classificationLabel: string;
  explanation: string;
  components: {
    netPosition: number;
    negativeMonths: number;
    overdueReceivable: number;
    overduePayable: number;
    customerConcentration: number;
    supplierConcentration: number;
    conservativeNeed: number;
    trend: number;
  };
};

export type FinanceCashFlowShortTermRiskWindow = {
  label: string;
  days: number;
  projectedInflow: number;
  projectedOutflow: number;
  projectedNet: number;
  status: "positive" | "negative" | "neutral";
};

export type FinanceCashFlowDailyPoint = {
  date: string;
  dayLabel: string;
  inflowAmount: number;
  outflowAmount: number;
  netAmount: number;
  status: "positive" | "negative" | "neutral";
  inflowCount: number;
  outflowCount: number;
  hasLargeInflow: boolean;
  hasLargeOutflow: boolean;
  summary: string;
};

export type FinanceCashFlowCfoDiagnostics = {
  cashHealth: CashHealthScore;
  shortTermRisk: FinanceCashFlowShortTermRiskWindow[];
  paymentPressure: {
    criticalSuppliers: FinanceCashFlowPartySummary[];
    overduePayables: FinanceCashFlowCriticalMovement[];
    upcomingOutflows: FinanceCashFlowCriticalMovement[];
  };
  collectionOpportunity: {
    overdueReceivables: FinanceCashFlowCriticalMovement[];
    largestReceivables: FinanceCashFlowCriticalMovement[];
    deficitReliefCandidates: FinanceCashFlowCriticalMovement[];
  };
  concentration: {
    topCustomer: FinanceCashFlowPartySummary | null;
    topSupplier: FinanceCashFlowPartySummary | null;
    customerAlert: boolean;
    supplierAlert: boolean;
  };
};

export type FinanceCashFlowExecutiveInsights = {
  summary: string;
  riskLevel: CashFlowHealthClassification;
  cashHealthScore: CashHealthScore;
  diagnostics: FinanceCashFlowCfoDiagnostics;
  alerts: CashFlowInsightItem[];
  opportunities: CashFlowInsightItem[];
  recommendedActions: CashFlowInsightItem[];
  watchItems: CashFlowInsightItem[];
};

type DayBucket = {
  inflow: number;
  outflow: number;
  inflowCount: number;
  outflowCount: number;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, roundMoney(value)));
}

function classifyHealthScore(score: number): {
  classification: CashFlowHealthClassification;
  classificationLabel: string;
} {
  if (score >= 80) return { classification: "healthy", classificationLabel: "Saudável" };
  if (score >= 60) return { classification: "attention", classificationLabel: "Atenção" };
  if (score >= 40) return { classification: "risk", classificationLabel: "Risco" };
  return { classification: "critical", classificationLabel: "Crítico" };
}

function concentrationSubscore(percentOfTotal: number, weight: number): number {
  if (percentOfTotal < CFO_CONCENTRATION_ALERT_PERCENT) return weight;
  const excess = percentOfTotal - CFO_CONCENTRATION_ALERT_PERCENT;
  return roundMoney(weight * Math.max(0, 1 - excess / 60));
}

/**
 * Score de saúde do caixa (0–100), determinístico.
 *
 * Componentes (pesos somam 100):
 * - Posição líquida (25): superávit = 25; déficit penalizado por |net| / max(receber, pagar).
 * - Meses negativos (15): 15 × max(0, 1 − meses/6).
 * - Vencidos AR (15): 15 × max(0, 1 − vencidosAR / receber aberto).
 * - Vencidos AP (15): 15 × max(0, 1 − vencidosAP / pagar aberto).
 * - Concentração cliente (10): pleno abaixo de 40%; reduz acima.
 * - Concentração fornecedor (10): idem.
 * - Necessidade conservadora (5): 5 × max(0, 1 − need / receber aberto).
 * - Tendência 3 meses (5): líquido dos próximos 3 meses ≥ 0 → 5; parcial se positivo no mês atual.
 */
export function buildCashHealthScore(
  payload: Pick<
    FinanceCashFlowDashboardPayload,
    "cards" | "cashForecast" | "conservativeScenario" | "topCustomers" | "topSuppliers"
  >
): CashHealthScore {
  const { cards, cashForecast, conservativeScenario, topCustomers, topSuppliers } = payload;
  const receivable = Math.max(cards.totalReceivableOpen, 1);
  const payable = Math.max(cards.totalPayableOpen, 1);
  const denom = Math.max(receivable, payable, 1);

  let netPosition = 25;
  if (cards.netCashPositionStatus === "deficit") {
    netPosition = roundMoney(25 * Math.max(0, 1 - cards.netCashPositionAbs / denom));
  }

  const negativeMonths = roundMoney(
    15 * Math.max(0, 1 - cards.negativeBalanceMonthsCount / 6)
  );
  const overdueReceivable = roundMoney(
    15 * Math.max(0, 1 - cards.overdueReceivableAmount / receivable)
  );
  const overduePayable = roundMoney(15 * Math.max(0, 1 - cards.overduePayableAmount / payable));
  const customerConcentration = concentrationSubscore(
    topCustomers[0]?.percentOfTotal ?? 0,
    10
  );
  const supplierConcentration = concentrationSubscore(
    topSuppliers[0]?.percentOfTotal ?? 0,
    10
  );
  const conservativeNeed = roundMoney(
    5 * Math.max(0, 1 - conservativeScenario.cashNeedConservative / receivable)
  );

  const h3 = cashForecast.horizons.next3Months;
  let trend = 0;
  if (h3.projectedNet >= 0) trend = 5;
  else if (cashForecast.horizons.currentMonth.projectedNet >= 0) trend = 2;

  const components = {
    netPosition,
    negativeMonths,
    overdueReceivable,
    overduePayable,
    customerConcentration,
    supplierConcentration,
    conservativeNeed,
    trend,
  };

  const raw =
    components.netPosition +
    components.negativeMonths +
    components.overdueReceivable +
    components.overduePayable +
    components.customerConcentration +
    components.supplierConcentration +
    components.conservativeNeed +
    components.trend;

  const score = clampScore(raw);
  const { classification, classificationLabel } = classifyHealthScore(score);

  let explanation = `Score composto ${score}/100 (${classificationLabel}). `;
  if (cards.netCashPositionStatus === "deficit") {
    explanation += `Déficit de ${formatFinanceCurrency(cards.netCashPositionAbs)} na carteira. `;
  } else {
    explanation += `Superávit de ${formatFinanceCurrency(cards.netCashPositionAbs)} na carteira. `;
  }
  if (cards.negativeBalanceMonthsCount > 0) {
    explanation += `${cards.negativeBalanceMonthsCount} mês(es) com fluxo negativo. `;
  }
  if (conservativeScenario.cashNeedConservative > cards.cashNeedAmount) {
    explanation += `Cenário conservador eleva necessidade para ${formatFinanceCurrency(conservativeScenario.cashNeedConservative)}.`;
  }

  return { score, classification, classificationLabel, explanation: explanation.trim(), components };
}

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildMovementBuckets(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): Map<string, DayBucket> {
  const buckets = new Map<string, DayBucket>();
  const modes = cashFlowViewModeSlices(filters.viewMode);

  const add = (key: string, side: "inflow" | "outflow", amount: number) => {
    const b = buckets.get(key) ?? { inflow: 0, outflow: 0, inflowCount: 0, outflowCount: 0 };
    if (side === "inflow") {
      b.inflow += amount;
      b.inflowCount += 1;
    } else {
      b.outflow += amount;
      b.outflowCount += 1;
    }
    buckets.set(key, b);
  };

  for (const slice of modes) {
    for (const row of arRows) {
      if (slice === "projected") {
        if (!isFinanceArOpen(row) || row.suspendCollection || row.balanceReceivable <= 0) continue;
        const date = resolveCashFlowArMovementDate(row, slice, filters.dateBase);
        if (!date) continue;
        add(dateKey(startOfLocalDay(date)), "inflow", row.balanceReceivable);
      } else if (row.amountReceived > 0 && row.settlementDate) {
        const date = resolveCashFlowArMovementDate(row, slice, filters.dateBase);
        if (!date) continue;
        add(dateKey(startOfLocalDay(date)), "inflow", row.amountReceived);
      }
    }
    for (const row of apRows) {
      if (slice === "projected") {
        if (!isFinanceApOpen(row) || row.suspendPayment || row.balancePayable <= 0) continue;
        const date = resolveCashFlowApMovementDate(row, slice, filters.dateBase);
        if (!date) continue;
        add(dateKey(startOfLocalDay(date)), "outflow", row.balancePayable);
      } else {
        const payDate = row.paymentDate ?? row.settlementDate;
        if (row.amountPaid > 0 && payDate) {
          const date = resolveCashFlowApMovementDate(row, slice, filters.dateBase);
          if (!date) continue;
          add(dateKey(startOfLocalDay(date)), "outflow", row.amountPaid);
        }
      }
    }
  }

  return buckets;
}

function sumWindow(
  buckets: Map<string, DayBucket>,
  referenceDate: Date,
  days: number
): FinanceCashFlowShortTermRiskWindow {
  const ref = startOfLocalDay(referenceDate);
  const end = new Date(ref);
  end.setDate(end.getDate() + days);

  let inflow = 0;
  let outflow = 0;
  for (const [key, bucket] of buckets) {
    const d = startOfLocalDay(new Date(`${key}T12:00:00`));
    if (d >= ref && d <= end) {
      inflow += bucket.inflow;
      outflow += bucket.outflow;
    }
  }
  const net = roundMoney(inflow - outflow);
  return {
    label: `Próximos ${days} dias`,
    days,
    projectedInflow: roundMoney(inflow),
    projectedOutflow: roundMoney(outflow),
    projectedNet: net,
    status: net > 0 ? "positive" : net < 0 ? "negative" : "neutral",
  };
}

export function buildCashFlowDailyCalendar(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowDailyPoint[] {
  const buckets = buildMovementBuckets(arRows, apRows, filters, referenceDate);
  const calendarYear = filters.year ?? referenceDate.getFullYear();
  const calendarMonth = filters.month ?? referenceDate.getMonth() + 1;

  const points: FinanceCashFlowDailyPoint[] = [];
  let maxFlow = 0;

  for (const [key, bucket] of buckets) {
    const d = startOfLocalDay(new Date(`${key}T12:00:00`));
    if (d.getFullYear() !== calendarYear || d.getMonth() + 1 !== calendarMonth) continue;
    const inflow = roundMoney(bucket.inflow);
    const outflow = roundMoney(bucket.outflow);
    const net = roundMoney(inflow - outflow);
    maxFlow = Math.max(maxFlow, inflow, outflow, Math.abs(net));
    points.push({
      date: key,
      dayLabel: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      inflowAmount: inflow,
      outflowAmount: outflow,
      netAmount: net,
      status: net > 0 ? "positive" : net < 0 ? "negative" : "neutral",
      inflowCount: bucket.inflowCount,
      outflowCount: bucket.outflowCount,
      hasLargeInflow: false,
      hasLargeOutflow: false,
      summary: "",
    });
  }

  const largeThreshold = maxFlow > 0 ? maxFlow * 0.35 : 0;
  for (const p of points) {
    p.hasLargeInflow = p.inflowAmount >= largeThreshold && largeThreshold > 0;
    p.hasLargeOutflow = p.outflowAmount >= largeThreshold && largeThreshold > 0;
    const parts: string[] = [];
    if (p.inflowAmount > 0) parts.push(`+${formatFinanceCurrency(p.inflowAmount)}`);
    if (p.outflowAmount > 0) parts.push(`−${formatFinanceCurrency(p.outflowAmount)}`);
    parts.push(`Líquido ${formatFinanceCurrency(p.netAmount)}`);
    p.summary = parts.join(" · ");
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function insight(
  title: string,
  description: string,
  severity: CashFlowInsightSeverity,
  relatedAmount: number | null = null,
  relatedEntity: string | null = null,
  suggestedAction: string | null = null
): CashFlowInsightItem {
  return { title, description, severity, relatedAmount, relatedEntity, suggestedAction };
}

function partyName(party: FinanceCashFlowPartySummary | FinanceCashFlowCriticalMovement): string {
  return party.personName?.trim() || "sem nome identificado";
}

function buildDiagnosticsBlocks(
  payload: FinanceCashFlowInsightsInput,
  referenceDate: Date
): FinanceCashFlowCfoDiagnostics {
  const { topCustomers, topSuppliers, overdueReceivables, overduePayables, largestProjectedInflows, largestProjectedOutflows, cards } =
    payload;

  const ref = startOfLocalDay(referenceDate);

  const upcomingOutflows = largestProjectedOutflows
    .filter((m) => {
      if (!m.dueDate) return false;
      const due = startOfLocalDay(new Date(m.dueDate));
      const limit = new Date(ref);
      limit.setDate(limit.getDate() + 90);
      return due >= ref && due <= limit;
    })
    .slice(0, 5);

  const deficitRelief = cards.netCashPositionStatus === "deficit"
    ? [...overdueReceivables, ...largestProjectedInflows]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    : [];

  const cashHealth = buildCashHealthScore(payload);

  return {
    cashHealth,
    shortTermRisk: [],
    paymentPressure: {
      criticalSuppliers: topSuppliers.slice(0, 5),
      overduePayables: overduePayables.slice(0, 5),
      upcomingOutflows,
    },
    collectionOpportunity: {
      overdueReceivables: overdueReceivables.slice(0, 5),
      largestReceivables: largestProjectedInflows.slice(0, 5),
      deficitReliefCandidates: deficitRelief,
    },
    concentration: {
      topCustomer: topCustomers[0] ?? null,
      topSupplier: topSuppliers[0] ?? null,
      customerAlert: (topCustomers[0]?.percentOfTotal ?? 0) >= CFO_CONCENTRATION_ALERT_PERCENT,
      supplierAlert: (topSuppliers[0]?.percentOfTotal ?? 0) >= CFO_CONCENTRATION_ALERT_PERCENT,
    },
  };
}

export type FinanceCashFlowInsightsInput = Omit<
  FinanceCashFlowDashboardPayload,
  | "executiveInsights"
  | "dailyCalendar"
  | "cashHealthScore"
  | "executiveReading"
  | "executiveSummary"
  | "executiveYtd"
  | "executiveYtdReading"
  | "reconciliation"
>;

export function buildCashFlowExecutiveInsights(
  payload: FinanceCashFlowInsightsInput,
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  referenceDate: Date
): FinanceCashFlowExecutiveInsights {
  const cashHealth = buildCashHealthScore(payload);
  const filters = payload.filtersApplied as FinanceCashFlowDashboardFilters;
  const buckets = buildMovementBuckets(arRows, apRows, filters, referenceDate);

  const shortTermRisk: FinanceCashFlowShortTermRiskWindow[] = [
    sumWindow(buckets, referenceDate, 30),
    sumWindow(buckets, referenceDate, 60),
    sumWindow(buckets, referenceDate, 90),
  ];

  const diagnostics = buildDiagnosticsBlocks(payload, referenceDate);
  diagnostics.shortTermRisk = shortTermRisk;
  diagnostics.cashHealth = cashHealth;

  const alerts: CashFlowInsightItem[] = [];
  const opportunities: CashFlowInsightItem[] = [];
  const recommendedActions: CashFlowInsightItem[] = [];
  const watchItems: CashFlowInsightItem[] = [];

  const { cards, cashForecast, conservativeScenario, stressScenario } = payload;

  if (cards.netCashPositionStatus === "deficit") {
    alerts.push(
      insight(
        "Déficit na carteira",
        `Recebíveis em aberto não cobrem pagáveis — gap de ${formatFinanceCurrency(cards.netCashPositionAbs)}.`,
        "critical",
        cards.netCashPositionAbs,
        null,
        "Priorizar cobrança e adiar despesas não essenciais."
      )
    );
  }

  if (conservativeScenario.cashNeedConservative > cards.cashNeedAmount) {
    alerts.push(
      insight(
        "Cenário conservador mais pressionado",
        `Se apenas 80% dos recebíveis forem realizados, a necessidade sobe para ${formatFinanceCurrency(conservativeScenario.cashNeedConservative)}.`,
        "warning",
        conservativeScenario.cashNeedConservative,
        null,
        "Revisar previsão de recebimentos e plano de cobrança."
      )
    );
  }

  const worst = cashForecast.horizons.next12Months.worstMonth;
  if (worst && worst.projectedNet < 0) {
    watchItems.push(
      insight(
        `${worst.monthLabel} — maior pressão`,
        `Mês com pior fluxo líquido projetado: ${formatFinanceCurrency(worst.projectedNet)}.`,
        "warning",
        Math.abs(worst.projectedNet),
        worst.monthLabel,
        "Acompanhar entradas e saídas concentradas neste mês."
      )
    );
  }

  for (const w of shortTermRisk) {
    if (w.status === "negative") {
      alerts.push(
        insight(
          `Déficit em ${w.days} dias`,
          `${w.label}: saídas ${formatFinanceCurrency(w.projectedOutflow)} vs entradas ${formatFinanceCurrency(w.projectedInflow)}.`,
          w.days <= 30 ? "critical" : "warning",
          Math.abs(w.projectedNet),
          null,
          "Antecipar cobranças e negociar prazos de pagamento."
        )
      );
    }
  }

  if (diagnostics.concentration.customerAlert && diagnostics.concentration.topCustomer) {
    const c = diagnostics.concentration.topCustomer;
    alerts.push(
      insight(
        "Concentração de entradas",
        `Cliente ${partyName(c)} responde por ${c.percentOfTotal.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das entradas previstas.`,
        "warning",
        c.amount,
        partyName(c),
        "Diversificar carteira e monitorar inadimplência deste cliente."
      )
    );
  }

  if (diagnostics.concentration.supplierAlert && diagnostics.concentration.topSupplier) {
    const s = diagnostics.concentration.topSupplier;
    alerts.push(
      insight(
        "Concentração de saídas",
        `Fornecedor ${partyName(s)} concentra ${s.percentOfTotal.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% dos pagáveis.`,
        "warning",
        s.amount,
        partyName(s),
        "Negociar prazos e buscar fornecedores alternativos."
      )
    );
  }

  for (const row of payload.overduePayables.slice(0, 3)) {
    alerts.push(
      insight(
        `Pagamento vencido — ${partyName(row)}`,
        `${formatFinanceCurrency(row.amount)} em atraso${row.daysOverdue > 0 ? ` (${row.daysOverdue}d)` : ""}.`,
        "critical",
        row.amount,
        partyName(row),
        "Quitar ou renegociar imediatamente."
      )
    );
  }

  for (const row of payload.overdueReceivables.slice(0, 5)) {
    opportunities.push(
      insight(
        `Cobrar ${partyName(row)}`,
        `${formatFinanceCurrency(row.amount)} vencidos — impacto potencial no caixa.`,
        "success",
        row.amount,
        partyName(row),
        "Acionar cobrança e confirmar previsão de recebimento."
      )
    );
  }

  for (const row of payload.largestProjectedInflows.slice(0, 3)) {
    if (row.daysOverdue > 0) continue;
    opportunities.push(
      insight(
        `Recebível relevante — ${partyName(row)}`,
        `${formatFinanceCurrency(row.amount)} previsto${row.dueDate ? ` para ${new Date(row.dueDate).toLocaleDateString("pt-BR")}` : ""}.`,
        "info",
        row.amount,
        partyName(row),
        "Confirmar recebimento no prazo."
      )
    );
  }

  if (cards.netCashPositionStatus === "deficit" && diagnostics.collectionOpportunity.deficitReliefCandidates[0]) {
    const top = diagnostics.collectionOpportunity.deficitReliefCandidates[0];
    opportunities.push(
      insight(
        "Recebível que alivia déficit",
        `${partyName(top)} — ${formatFinanceCurrency(top.amount)} podem reduzir a necessidade de caixa.`,
        "success",
        top.amount,
        partyName(top),
        "Priorizar este título na cobrança."
      )
    );
  }

  const actionCandidates: CashFlowInsightItem[] = [
    ...opportunities.filter((o) => o.severity === "success" || o.severity === "critical"),
    ...alerts,
    ...watchItems,
  ];

  const seen = new Set<string>();
  for (const item of actionCandidates.sort(
    (a, b) => (b.relatedAmount ?? 0) - (a.relatedAmount ?? 0)
  )) {
    const key = `${item.title}-${item.relatedEntity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recommendedActions.push(item);
    if (recommendedActions.length >= 5) break;
  }

  if (recommendedActions.length < 5) {
    for (const line of payload.operationalRecommendations) {
      recommendedActions.push(
        insight(line, line, "info", null, null, null)
      );
      if (recommendedActions.length >= 5) break;
    }
  }

  if (stressScenario.monthsAtRiskStress > 0) {
    watchItems.push(
      insight(
        "Meses em risco (cenário crítico)",
        `${stressScenario.monthsAtRiskStress} mês(es) com fluxo negativo na simulação crítica.`,
        "warning",
        stressScenario.cashNeedStress,
        null,
        "Preparar plano de contingência de caixa."
      )
    );
  }

  const uniqueActions = dedupeInsights(
    [
      ...recommendedActions,
      ...diagnostics.paymentPressure.upcomingOutflows.slice(0, 2).map((out) =>
        insight(
          `Negociar com ${partyName(out)}`,
          `Saída de ${formatFinanceCurrency(out.amount)}${out.dueDate ? ` em ${new Date(out.dueDate).toLocaleDateString("pt-BR")}` : ""}.`,
          "warning",
          out.amount,
          partyName(out),
          "Avaliar postergação ou parcelamento."
        )
      ),
    ].sort((a, b) => (b.relatedAmount ?? 0) - (a.relatedAmount ?? 0))
  ).slice(0, 5);

  const summary =
    cashHealth.classification === "healthy"
      ? `Caixa em situação saudável (score ${cashHealth.score}). Carteira com folga projetada de ${formatFinanceCurrency(cards.netCashPositionAbs)}.`
      : cashHealth.classification === "critical"
        ? `Caixa crítico (score ${cashHealth.score}). Necessidade estimada de ${formatFinanceCurrency(cards.cashNeedAmount || conservativeScenario.cashNeedConservative)} — ação imediata recomendada.`
        : `Caixa em ${cashHealth.classificationLabel.toLowerCase()} (score ${cashHealth.score}). ${alerts.length} alerta(s) e ${opportunities.length} oportunidade(s) identificados.`;

  return {
    summary,
    riskLevel: cashHealth.classification,
    cashHealthScore: cashHealth,
    diagnostics,
    alerts: dedupeInsights(alerts),
    opportunities: dedupeInsights(opportunities),
    recommendedActions: uniqueActions,
    watchItems: dedupeInsights(watchItems),
  };
}

function dedupeInsights(items: CashFlowInsightItem[]): CashFlowInsightItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cashFlowCfoMetricsAreFinite(insights: FinanceCashFlowExecutiveInsights): boolean {
  if (!Number.isFinite(insights.cashHealthScore.score)) return false;
  for (const c of Object.values(insights.cashHealthScore.components)) {
    if (!Number.isFinite(c)) return false;
  }
  for (const w of insights.diagnostics.shortTermRisk) {
    for (const v of [w.projectedInflow, w.projectedOutflow, w.projectedNet]) {
      if (!Number.isFinite(v)) return false;
    }
  }
  for (const item of [
    ...insights.alerts,
    ...insights.opportunities,
    ...insights.recommendedActions,
    ...insights.watchItems,
  ]) {
    if (item.relatedAmount != null && !Number.isFinite(item.relatedAmount)) return false;
  }
  return true;
}
