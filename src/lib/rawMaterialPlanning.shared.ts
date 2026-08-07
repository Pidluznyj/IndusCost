/**
 * Orquestrador de Matéria-Prima — engine pura (sem Prisma).
 *
 * Junta saldo contado + demanda prevista (pedidos de venda, quantidade AINDA
 * EM ABERTO) + entradas de compra confirmadas para responder: o que comprar,
 * quanto, até quando, e com que confiança.
 *
 * Regras centrais (não violar sem atualizar os testes):
 * - Saldo contado e saldo projetado NUNCA se confundem — este arquivo só
 *   projeta; nunca escreve em Material.quantity.
 * - Proteção (mínimo + contingência) é um LIMIAR constante ao longo da linha
 *   do tempo, nunca somada ao saldo físico.
 * - Toda quantidade "pendente" já vem líquida de atendimento/corte — a
 *   camada de orquestração (rawMaterialPlanning.server.ts) é responsável por
 *   já entregar `quantity` líquida aqui; este arquivo não sabe o que é
 *   nomusQuantityPending/nomusIsCut.
 * - asOfDate é sempre explícito — nunca lê o relógio.
 */

export const RAW_MATERIAL_PLANNING_STATUSES = [
  "BUY_NOW",
  "BUY_WITHIN_7_DAYS",
  "PLAN_PURCHASE",
  "COVERED_BY_STOCK",
  "COVERED_BY_CONFIRMED_INBOUND",
  "INBOUND_LATE",
  "PARTIALLY_COVERED",
  "DATA_INCOMPLETE",
  "STOCK_COUNT_STALE",
  "UNIT_CONVERSION_ERROR",
] as const;

export type RawMaterialPlanningStatus = (typeof RAW_MATERIAL_PLANNING_STATUSES)[number];

export type RawMaterialPlanningConfidence = "HIGH" | "MEDIUM" | "LOW";

export type RawMaterialDemandEvent = {
  kind: "demand";
  /** ISO yyyy-mm-dd — data de necessidade já resolvida (ver resolveRawMaterialNeedByDate). */
  date: string;
  quantity: number;
  salesOrderId: string;
  orderCode: string | null;
};

export type RawMaterialInboundEvent = {
  kind: "inbound";
  date: string;
  quantity: number;
  purchaseOrderId: string;
  purchaseOrderCode: string | null;
  status: string;
};

export type RawMaterialTimelineEvent = RawMaterialDemandEvent | RawMaterialInboundEvent;

export type RawMaterialTimelinePoint = {
  date: string;
  openingBalance: number;
  inbound: number;
  outbound: number;
  closingBalance: number;
  protectionTotal: number;
  freeBalance: number;
  /** max(0, -freeBalance) — falta técnica do dia. */
  shortfall: number;
  demandEvents: RawMaterialDemandEvent[];
  inboundEvents: RawMaterialInboundEvent[];
};

export type RawMaterialProjection = {
  timeline: RawMaterialTimelinePoint[];
  lowestProjectedBalance: number;
  lowestProjectedBalanceDate: string | null;
  /** Primeira data (>= asOfDate) em que o saldo livre fica negativo. null = nunca, no horizonte dado. */
  firstRiskDate: string | null;
  protectionTotal: number;
};

/**
 * Projeta o saldo dia a dia (só nas datas com evento — mesmo formato do
 * exemplo do pedido: "05/08 — saldo contado: 2.500 kg; 08/08 — consumo...").
 * O primeiro ponto é sempre `asOfDate`, mesmo sem evento nele.
 */
export function projectRawMaterialBalance(input: {
  countedBalance: number;
  minimumQuantity: number | null;
  contingencyQuantity: number | null;
  events: RawMaterialTimelineEvent[];
  asOfDate: string;
  horizonEndDate: string;
}): RawMaterialProjection {
  const protectionTotal = (input.minimumQuantity ?? 0) + (input.contingencyQuantity ?? 0);

  const byDate = new Map<string, { demand: RawMaterialDemandEvent[]; inbound: RawMaterialInboundEvent[] }>();
  const ensureDate = (date: string) => {
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = { demand: [], inbound: [] };
      byDate.set(date, bucket);
    }
    return bucket;
  };
  ensureDate(input.asOfDate);
  for (const event of input.events) {
    if (event.date < input.asOfDate || event.date > input.horizonEndDate) continue;
    const bucket = ensureDate(event.date);
    if (event.kind === "demand") bucket.demand.push(event);
    else bucket.inbound.push(event);
  }

  const dates = [...byDate.keys()].sort();
  const timeline: RawMaterialTimelinePoint[] = [];
  let runningBalance = input.countedBalance;
  let lowestProjectedBalance = input.countedBalance;
  let lowestProjectedBalanceDate: string | null = input.asOfDate;
  let firstRiskDate: string | null = null;

  for (const date of dates) {
    const bucket = byDate.get(date)!;
    const opening = runningBalance;
    const inboundQty = bucket.inbound.reduce((sum, e) => sum + e.quantity, 0);
    const outboundQty = bucket.demand.reduce((sum, e) => sum + e.quantity, 0);
    const closing = opening + inboundQty - outboundQty;
    const freeBalance = closing - protectionTotal;
    const shortfall = Math.max(0, -freeBalance);

    timeline.push({
      date,
      openingBalance: opening,
      inbound: inboundQty,
      outbound: outboundQty,
      closingBalance: closing,
      protectionTotal,
      freeBalance,
      shortfall,
      demandEvents: bucket.demand,
      inboundEvents: bucket.inbound,
    });

    if (closing < lowestProjectedBalance) {
      lowestProjectedBalance = closing;
      lowestProjectedBalanceDate = date;
    }
    if (freeBalance < 0 && firstRiskDate == null) firstRiskDate = date;

    runningBalance = closing;
  }

  return { timeline, lowestProjectedBalance, lowestProjectedBalanceDate, firstRiskDate, protectionTotal };
}

export type PurchaseRecommendation = {
  technicalNeed: number;
  suggestedQuantity: number;
  lotAdjustment: number;
  /** null = não houve ajuste comercial (lote/múltiplo não cadastrados). */
  adjustmentNote: string | null;
};

/**
 * Necessidade técnica → quantidade sugerida. Nunca arredonda silenciosamente:
 * sem lote/múltiplo cadastrados, devolve a necessidade técnica pura e explica
 * por quê (adjustmentNote null é o sinal "sem ajuste comercial" pro
 * chamador/UI).
 */
export function calculatePurchaseRecommendation(input: {
  technicalNeed: number;
  minPurchaseLot: number | null;
  purchaseMultiple: number | null;
}): PurchaseRecommendation {
  const technicalNeed = Math.max(0, input.technicalNeed);
  if (technicalNeed <= 0) {
    return { technicalNeed: 0, suggestedQuantity: 0, lotAdjustment: 0, adjustmentNote: null };
  }

  let suggested = technicalNeed;
  const notes: string[] = [];

  if (input.purchaseMultiple != null && input.purchaseMultiple > 0) {
    const multiple = input.purchaseMultiple;
    const rounded = Math.ceil(suggested / multiple) * multiple;
    if (rounded !== suggested) notes.push(`arredondado ao múltiplo de compra (${multiple})`);
    suggested = rounded;
  }
  if (input.minPurchaseLot != null && input.minPurchaseLot > 0 && suggested < input.minPurchaseLot) {
    notes.push(`elevado ao lote mínimo de compra (${input.minPurchaseLot})`);
    suggested = input.minPurchaseLot;
  }

  return {
    technicalNeed,
    suggestedQuantity: suggested,
    lotAdjustment: suggested - technicalNeed,
    adjustmentNote: notes.length > 0 ? notes.join("; ") : null,
  };
}

export type BuyByDateResult = {
  buyByDate: string | null;
  /** null quando buyByDate foi calculado normalmente. */
  blockedReason: "NO_RISK" | "NO_LEAD_TIME" | null;
};

/**
 * Data de risco − lead time − aprovação interna − margem logística.
 * Sem data de risco: nada a comprar (NO_RISK). Sem lead time confiável:
 * nunca inventa uma data (NO_LEAD_TIME) — mostra a data de risco crua e
 * deixa claro que falta o lead time.
 */
export function calculateBuyByDate(input: {
  firstRiskDate: string | null;
  leadTimeDays: number | null;
  approvalDays: number;
  logisticsMarginDays: number;
}): BuyByDateResult {
  if (!input.firstRiskDate) return { buyByDate: null, blockedReason: "NO_RISK" };
  if (input.leadTimeDays == null) return { buyByDate: null, blockedReason: "NO_LEAD_TIME" };

  const totalDays = input.leadTimeDays + input.approvalDays + input.logisticsMarginDays;
  const risk = new Date(`${input.firstRiskDate}T00:00:00.000Z`);
  risk.setUTCDate(risk.getUTCDate() - totalDays);
  return { buyByDate: risk.toISOString().slice(0, 10), blockedReason: null };
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * Retrocede `businessDays` dias úteis (segunda a sexta) COMPLETOS a partir de
 * `ymd` — a própria data de partida nunca conta como um dos dias
 * retrocedidos. Data-only via UTC (evita deslocamento de timezone: nunca lê
 * o relógio local, sempre ancora em T00:00:00.000Z).
 *
 * Sem calendário de feriados corporativo cadastrado no projeto no momento
 * desta implementação (auditado — ver rawMaterialPlanning.shared.ts §need
 * date) — considera somente sábado/domingo como não úteis. Se um calendário
 * de feriados oficial for introduzido, este é o único ponto a atualizar.
 */
export function subtractBusinessDaysFromYmd(ymd: string, businessDays: number): string {
  const cursor = new Date(`${ymd}T00:00:00.000Z`);
  let remaining = businessDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

export type RawMaterialPlanningClassificationInput = {
  asOfDate: string;
  firstRiskDate: string | null;
  buyByDate: string | null;
  buyByBlockedReason: BuyByDateResult["blockedReason"];
  /** Existe pelo menos 1 evento de entrada confirmada dentro do horizonte. */
  hasConfirmedInbound: boolean;
  /** Entre os eventos de entrada confirmada, a última chega ANTES do firstRiskDate? null quando não há risco. */
  inboundArrivesBeforeRisk: boolean | null;
  technicalNeed: number;
  unitConversionError: boolean;
  stockCountAgeDays: number | null;
  stockCountStaleDaysThreshold: number;
};

/**
 * Deriva a situação operacional — precedência fixa (não reordenar sem
 * atualizar os 20 cenários de teste do pedido):
 * 1. UNIT_CONVERSION_ERROR — bloqueia qualquer número, sempre primeiro.
 * 2. Contagem tão desatualizada que não dá pra confiar em nada calculado.
 * 3. DATA_INCOMPLETE — há risco mas falta lead time pra recomendar data.
 * 4. Sem risco no horizonte → coberto (por estoque ou por entrada).
 * 5. Há risco: entrada confirmada resolve? antes = coberto, depois = atrasada.
 * 6. Há risco sem entrada nenhuma ou entrada insuficiente → BUY_NOW,
 *    BUY_WITHIN_7_DAYS ou PLAN_PURCHASE, conforme a distância até a data limite.
 */
export function classifyRawMaterialPlanningStatus(
  input: RawMaterialPlanningClassificationInput
): RawMaterialPlanningStatus {
  if (input.unitConversionError) return "UNIT_CONVERSION_ERROR";

  if (
    input.stockCountAgeDays != null &&
    input.stockCountAgeDays > input.stockCountStaleDaysThreshold
  ) {
    return "STOCK_COUNT_STALE";
  }

  if (!input.firstRiskDate) {
    return input.hasConfirmedInbound ? "COVERED_BY_CONFIRMED_INBOUND" : "COVERED_BY_STOCK";
  }

  if (input.buyByBlockedReason === "NO_LEAD_TIME") return "DATA_INCOMPLETE";

  if (input.hasConfirmedInbound) {
    if (input.inboundArrivesBeforeRisk === true) return "COVERED_BY_CONFIRMED_INBOUND";
    if (input.inboundArrivesBeforeRisk === false) {
      return input.technicalNeed > 0 ? "PARTIALLY_COVERED" : "INBOUND_LATE";
    }
  }

  if (!input.buyByDate) return "PLAN_PURCHASE";
  const daysUntilBuyBy = daysBetween(input.asOfDate, input.buyByDate);
  if (daysUntilBuyBy <= 0) return "BUY_NOW";
  if (daysUntilBuyBy <= 7) return "BUY_WITHIN_7_DAYS";
  return "PLAN_PURCHASE";
}

export type PlanningConfidenceFactor = string;

/**
 * Confiança é um indicador OPERACIONAL de qualidade dos dados, não
 * estatístico — soma penalidades e satura em LOW/MEDIUM/HIGH.
 */
export function calculatePlanningConfidence(input: {
  stockCountAgeDays: number | null;
  stockCountRecentDaysThreshold: number;
  stockCountStaleDaysThreshold: number;
  hasLeadTime: boolean;
  hasUnresolvedBomOrAnalysisIssue: boolean;
  unitConversionError: boolean;
  hasOrdersWithoutNeedDate: boolean;
  inboundUnconfirmed: boolean;
}): { level: RawMaterialPlanningConfidence; reasons: PlanningConfidenceFactor[] } {
  const reasons: PlanningConfidenceFactor[] = [];
  let penalty = 0;

  if (input.unitConversionError) {
    penalty += 2;
    reasons.push("Unidade incompatível sem conversão oficial");
  }
  if (input.hasUnresolvedBomOrAnalysisIssue) {
    penalty += 2;
    reasons.push("Composição (BOM) incompleta para algum pedido considerado");
  }
  if (!input.hasLeadTime) {
    penalty += 2;
    reasons.push("Lead time não cadastrado/sem histórico de compras");
  }
  if (input.stockCountAgeDays == null) {
    penalty += 2;
    reasons.push("Sem data de última contagem de estoque");
  } else if (input.stockCountAgeDays > input.stockCountStaleDaysThreshold) {
    penalty += 2;
    reasons.push(`Contagem de estoque desatualizada (${input.stockCountAgeDays} dias)`);
  } else if (input.stockCountAgeDays > input.stockCountRecentDaysThreshold) {
    penalty += 1;
    reasons.push(`Contagem de estoque há ${input.stockCountAgeDays} dias`);
  }
  if (input.hasOrdersWithoutNeedDate) {
    penalty += 1;
    reasons.push("Existem pedidos consumidores sem data de necessidade confiável");
  }
  if (input.inboundUnconfirmed) {
    penalty += 1;
    reasons.push("Entrada considerada ainda sem confirmação firme");
  }

  const level: RawMaterialPlanningConfidence = penalty >= 4 ? "LOW" : penalty >= 2 ? "MEDIUM" : "HIGH";
  return { level, reasons };
}

export type NeedByDateResolution =
  | { date: string; source: "expectedDeliveryDate" }
  | { date: null; source: "none" };

/** Prazo industrial: quanto antes da entrega ao cliente a MP precisa estar disponível. */
export const RAW_MATERIAL_PLANNING_NEED_DATE_LEAD_BUSINESS_DAYS = 10;

/**
 * ÚNICA autoridade de "data de necessidade da matéria-prima" — alimenta
 * timeline, saldo projetado, ruptura, buy-by-date, tabela, memória do
 * cálculo, impressão e exportação. Nenhum outro ponto do módulo deve
 * recalcular esta regra.
 *
 * Regra oficial:
 *   materialNeedDate = dataDeEntregaPrevistaDaDemanda − 10 dias úteis
 *
 * Fonte da data de entrega — prioridade real disponível hoje no IndusCost:
 * 1. data planejada oficial de produção — NÃO EXISTE ainda no sistema;
 * 2. data de entrega prevista da demanda (SalesOrder.expectedDeliveryDate)
 *    — única fonte confiável hoje, mesma granularidade por pedido (não há
 *    entrega por item/parcela distinta cadastrada no sistema);
 * 3. sem data confiável.
 *
 * A data de CRIAÇÃO/EMISSÃO do pedido NUNCA participa deste cálculo.
 * Nunca cai para "hoje" como fallback silencioso quando a entrega é ausente.
 */
export function resolveRawMaterialNeedByDate(input: {
  expectedDeliveryDate: string | null;
}): NeedByDateResolution {
  if (!input.expectedDeliveryDate) return { date: null, source: "none" };
  const date = subtractBusinessDaysFromYmd(
    input.expectedDeliveryDate,
    RAW_MATERIAL_PLANNING_NEED_DATE_LEAD_BUSINESS_DAYS
  );
  return { date, source: "expectedDeliveryDate" };
}

export function resolveStockCountAgeDays(
  lastStockConferenceAt: string | null,
  asOfDate: string
): number | null {
  if (!lastStockConferenceAt) return null;
  const lastIso = lastStockConferenceAt.slice(0, 10);
  const age = daysBetween(lastIso, asOfDate);
  return age >= 0 ? age : 0;
}

export const RAW_MATERIAL_PLANNING_DEFAULT_STOCK_RECENT_DAYS = 3;
export const RAW_MATERIAL_PLANNING_DEFAULT_STOCK_STALE_DAYS = 7;
export const RAW_MATERIAL_PLANNING_DEFAULT_APPROVAL_DAYS = 2;
export const RAW_MATERIAL_PLANNING_DEFAULT_LOGISTICS_MARGIN_DAYS = 2;

export const RAW_MATERIAL_PLANNING_HORIZON_VALUES = ["30", "60", "90", "custom"] as const;
export type RawMaterialPlanningHorizon = (typeof RAW_MATERIAL_PLANNING_HORIZON_VALUES)[number];

export function resolveRawMaterialPlanningHorizonEndDate(
  asOfDate: string,
  horizon: RawMaterialPlanningHorizon,
  customEndDate?: string | null
): string {
  if (horizon === "custom" && customEndDate) return customEndDate;
  const days = horizon === "30" ? 30 : horizon === "90" ? 90 : 60;
  const d = new Date(`${asOfDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
