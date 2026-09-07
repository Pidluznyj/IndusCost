/**
 * Compras → Performance — motor PURO do read model de performance de fornecedores.
 *
 * Cadeia: DADO OFICIAL (espelho Nomus) → REGRA CANÔNICA (este arquivo) → READ MODEL
 * → API → UI. Sem Prisma/Node. O frontend só formata: nenhuma métrica financeira
 * ou de performance é recalculada em componente, gráfico, ranking ou tooltip.
 *
 * Autoridades reutilizadas (nunca reimplementadas):
 * - identidade do fornecedor: `NomusPurchaseOrder.supplierExternalId` (ID Nomus);
 * - identidade do material: `NomusPurchaseOrderItem.productExternalId` (ID Nomus),
 *   fallback `productCode` (código oficial). Nunca descrição, nome ou fuzzy;
 * - data operacional: `COALESCE(issuedAt, firstSeenAt)` — mesma janela da aba
 *   Avaliação Fornecedor (`periodWhere` em nomusPurchaseOrderEvaluation.server.ts);
 * - valor do pedido: `NomusPurchaseOrder.totalAmount` (cabeçalho oficial, como o
 *   KPI "Valor aberto" de Pedidos Nomus);
 * - valor da linha: `NomusPurchaseOrderItem.totalAmount` (`valorTotal` oficial da
 *   linha Nomus) — usado nas análises por matéria-prima;
 * - cancelamento: `canceled === true OU stage === "CANCELED"` (predicado
 *   `canceledOnly` de nomusPurchaseOrderQuery.ts);
 * - avaliação: motor OP-26 (`resolveSupplierEvaluationAggregation`,
 *   `buildSupplierPerformanceSummary`, `averageScoreOrNull`).
 *
 * Proibido aqui: score composto, pesos novos, rateio de frete/desconto entre
 * linhas, câmbio, conversão de unidade, mistura V1↔V2, agrupamento por nome.
 */

import {
  isNomusPurchaseOrderOpenStage,
  isNomusPurchaseOrderOverdue,
} from "@/src/lib/nomus/nomusPurchaseOrderClassifier.js";
import type { NomusPurchaseOrderStage } from "@/src/lib/nomus/nomusPurchaseOrderTypes.js";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_EVALUATION_METHODOLOGY_V1,
  SUPPLIER_EVALUATION_METHODOLOGY_V2,
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SupplierEvaluationError,
  averageScoreOrNull,
  buildSupplierPerformanceSummary,
  civilKeyToLocalDate,
  getSupplierEvaluationMethodology,
  parseSupplierPerformanceApiPeriod,
  resolveSupplierEvaluationAggregation,
  resolveSupplierPerformanceDateRange,
  type SupplierEvaluationCriterionKey,
  type SupplierPerformancePeriod,
  type SupplierPerformanceSummaryDto,
} from "./supplierPerformance.js";

/* ------------------------------------------------------------------ *
 * Constantes / identidade
 * ------------------------------------------------------------------ */

export const SUPPLIER_PERFORMANCE_DASHBOARD_VERSION = "2026-09-07.1";

/** Moeda assumida quando o espelho não informa `currency` — mesma convenção da aba Pedidos Nomus (formatCurrency = BRL). */
export const NOMUS_PURCHASE_ORDER_DEFAULT_CURRENCY = "BRL";

export const MATERIAL_KEY_PREFIX_NOMUS = "nomus:";
export const MATERIAL_KEY_PREFIX_CODE = "code:";

export const DASHBOARD_RANKING_LIMIT_DEFAULT = 20;
export const DASHBOARD_MATRIX_PAGE_SIZE_DEFAULT = 50;
export const DASHBOARD_MATRIX_PAGE_SIZE_MAX = 200;
export const DASHBOARD_PARETO_LIMIT_MAX = 500;

export const UNRESOLVED_SUPPLIER_LABEL = "Fornecedor não identificado no pedido";
export const UNRESOLVED_MATERIAL_LABEL = "Material não identificado na linha";

/** Rótulo semântico obrigatório — não prova homologação única. */
export const SINGLE_SOURCE_OBSERVED_LABEL = "Fornecedor único observado";
export const SINGLE_SOURCE_OBSERVED_TOOLTIP =
  "Considera somente fornecedores com compras observadas no período selecionado. Não prova que não existam outros fornecedores homologados.";
export const DUAL_SOURCE_OBSERVED_LABEL = "Dual sourcing observado";

export type DashboardMaterialKey = string;

export function resolveDashboardMaterialKey(line: {
  productExternalId: number | null | undefined;
  productCode: string | null | undefined;
}): DashboardMaterialKey | null {
  if (line.productExternalId != null && Number.isInteger(line.productExternalId)) {
    return `${MATERIAL_KEY_PREFIX_NOMUS}${line.productExternalId}`;
  }
  const code = (line.productCode ?? "").trim();
  if (code) return `${MATERIAL_KEY_PREFIX_CODE}${code}`;
  return null;
}

export function parseDashboardMaterialKey(
  key: string
): { kind: "nomus"; productExternalId: number } | { kind: "code"; productCode: string } | null {
  const text = key.trim();
  if (text.startsWith(MATERIAL_KEY_PREFIX_NOMUS)) {
    const raw = text.slice(MATERIAL_KEY_PREFIX_NOMUS.length);
    if (!/^\d+$/.test(raw)) return null;
    return { kind: "nomus", productExternalId: Number(raw) };
  }
  if (text.startsWith(MATERIAL_KEY_PREFIX_CODE)) {
    const code = text.slice(MATERIAL_KEY_PREFIX_CODE.length).trim();
    if (!code) return null;
    return { kind: "code", productCode: code };
  }
  return null;
}

/** Moeda do pedido: código informado (upper) ou a convenção da aba Pedidos Nomus. */
export function resolveNomusPurchaseOrderCurrency(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  return code || NOMUS_PURCHASE_ORDER_DEFAULT_CURRENCY;
}

/** Unidade comparável: texto oficial normalizado (trim/upper). Sem conversão. */
export function normalizeDashboardUnit(unit: string | null | undefined): string | null {
  const text = (unit ?? "").trim().toUpperCase();
  return text || null;
}

/** Data operacional da compra — mesma autoridade da Avaliação Fornecedor (COALESCE(issuedAt, firstSeenAt)). */
export function resolveNomusPurchaseOrderPerformanceDate(order: {
  issuedAt: Date | string | null | undefined;
  firstSeenAt: Date | string;
}): Date {
  const raw = order.issuedAt ?? order.firstSeenAt;
  return raw instanceof Date ? raw : new Date(raw);
}

/** Predicado de cancelamento — espelho exato de `canceledOnly` em nomusPurchaseOrderQuery. */
export function isNomusPurchaseOrderCanceled(order: {
  canceled: boolean | null | undefined;
  stage: string;
}): boolean {
  return order.canceled === true || order.stage === "CANCELED";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Chave de mês civil local (`YYYY-MM`) — mesma convenção de dia civil do módulo. */
export function toDashboardMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPrice(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function comparePtBr(a: string | null | undefined, b: string | null | undefined): number {
  return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { sensitivity: "base" });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/* ------------------------------------------------------------------ *
 * Período / filtros
 * ------------------------------------------------------------------ */

export const SUPPLIER_PERFORMANCE_DASHBOARD_PERIOD_PRESETS = [
  { id: "last12m", label: "Últimos 12 meses" },
  { id: "last6m", label: "Últimos 6 meses" },
  { id: "currentYear", label: "Ano corrente" },
  { id: "previousYear", label: "Ano anterior" },
  { id: "all", label: "Todo o histórico" },
  { id: "custom", label: "Personalizado" },
] as const;

export type SupplierPerformanceDashboardPeriodPresetId =
  (typeof SUPPLIER_PERFORMANCE_DASHBOARD_PERIOD_PRESETS)[number]["id"];

/** Segue `SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET` (Avaliação Fornecedor = últimos 12 meses). */
export const SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_PRESET: Exclude<
  SupplierPerformanceDashboardPeriodPresetId,
  "custom"
> = "last12m";

function civilKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function buildDashboardPeriodFromYear(year: number): SupplierPerformancePeriod {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function buildDashboardPeriodFromPreset(
  preset: SupplierPerformanceDashboardPeriodPresetId,
  today: Date = new Date()
): SupplierPerformancePeriod {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (preset) {
    case "currentYear":
      return buildDashboardPeriodFromYear(base.getFullYear());
    case "previousYear":
      return buildDashboardPeriodFromYear(base.getFullYear() - 1);
    case "last6m":
    case "last12m": {
      const months = preset === "last6m" ? 6 : 12;
      const from = new Date(base.getFullYear(), base.getMonth() - months, base.getDate());
      return { from: civilKey(from), to: civilKey(base) };
    }
    case "all":
    case "custom":
    default:
      return { from: null, to: null };
  }
}

export type SupplierPerformanceDashboardFilters = {
  period: SupplierPerformancePeriod;
  supplierExternalId: number | null;
  materialKey: DashboardMaterialKey | null;
  materialGroup: string | null;
  /** Código ISO da moeda analisada; null = moeda principal da população. */
  currency: string | null;
  /**
   * BLOCKED_BY_BUSINESS_RULE (documentado): o domínio não define "pedido válido
   * para compra". Default = excluir cancelados pelo predicado oficial de
   * Pedidos Nomus; o usuário pode incluir explicitamente.
   */
  includeCanceled: boolean;
};

export const SUPPLIER_PERFORMANCE_DASHBOARD_DEFAULT_FILTERS: SupplierPerformanceDashboardFilters = {
  period: { from: null, to: null },
  supplierExternalId: null,
  materialKey: null,
  materialGroup: null,
  currency: null,
  includeCanceled: false,
};

const CURRENCY_CODE_RE = /^[A-Za-z]{3}$/;

function firstQueryValue(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function invalidFilter(message: string, field: string): SupplierEvaluationError {
  return new SupplierEvaluationError("INVALID_SUPPLIER_PERFORMANCE_FILTER", message, field);
}

/** Boundary HTTP fail-fast: filtro enviado e inválido → 400 (nunca ignorado). */
export function parseSupplierPerformanceDashboardFilters(
  query: Record<string, unknown>
): SupplierPerformanceDashboardFilters {
  const period = parseSupplierPerformanceApiPeriod({ from: query.from, to: query.to });

  let supplierExternalId: number | null = null;
  const supplierRaw = firstQueryValue(query.supplierExternalId ?? query.supplier);
  if (supplierRaw != null) {
    if (!/^\d+$/.test(supplierRaw)) throw invalidFilter("Fornecedor inválido.", "supplierExternalId");
    supplierExternalId = Number(supplierRaw);
  }

  let materialKey: string | null = null;
  const materialRaw = firstQueryValue(query.materialKey ?? query.material);
  if (materialRaw != null) {
    if (!parseDashboardMaterialKey(materialRaw)) {
      throw invalidFilter("Matéria-prima inválida.", "materialKey");
    }
    materialKey = materialRaw;
  }

  const materialGroup = firstQueryValue(query.materialGroup ?? query.group);

  let currency: string | null = null;
  const currencyRaw = firstQueryValue(query.currency);
  if (currencyRaw != null) {
    if (!CURRENCY_CODE_RE.test(currencyRaw)) throw invalidFilter("Moeda inválida.", "currency");
    currency = currencyRaw.toUpperCase();
  }

  let includeCanceled = false;
  const canceledRaw = firstQueryValue(query.includeCanceled);
  if (canceledRaw != null) {
    const normalized = canceledRaw.toLowerCase();
    if (["1", "true", "sim", "yes"].includes(normalized)) includeCanceled = true;
    else if (["0", "false", "nao", "não", "no"].includes(normalized)) includeCanceled = false;
    else throw invalidFilter("Filtro de cancelados inválido.", "includeCanceled");
  }

  return { period, supplierExternalId, materialKey, materialGroup, currency, includeCanceled };
}

export function normalizeDashboardRankingLimit(raw: unknown, fallback = DASHBOARD_RANKING_LIMIT_DEFAULT): number {
  const value = firstQueryValue(raw);
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(DASHBOARD_PARETO_LIMIT_MAX, n);
}

/* ------------------------------------------------------------------ *
 * Entrada (linhas oficiais já carregadas em lote pelo servidor)
 * ------------------------------------------------------------------ */

export type DashboardOrderInput = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  stage: string;
  canceled: boolean | null;
  issuedAt: Date | null;
  firstSeenAt: Date;
  expectedAt: Date | null;
  currency: string | null;
  totalAmount: number | null;
  paymentTerms: string | null;
};

export type DashboardLineInput = {
  purchaseOrderId: string;
  lineIndex: number;
  lineExternalId: number | null;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  unit: string | null;
  orderedQuantity: number | null;
  receivedQuantity: number | null;
  unitPrice: number | null;
  totalAmount: number | null;
};

export type DashboardEvaluationInput = {
  nomusPurchaseOrderId: string;
  overallScore: number;
  qualityScore: number;
  deliveryScore: number;
  conformityScore: number;
  serviceScore: number;
  methodologyVersion: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  updatedByUserName: string | null;
};

export type DashboardCatalogInput = {
  externalProductId: string;
  code: string | null;
  description: string | null;
  groupName: string | null;
  familyName: string | null;
};

export type DashboardSupplierIdentityInput = {
  supplierExternalId: number;
  resolvedName: string | null;
  resolvedDocument: string | null;
  financialSupplierId: string | null;
  matchMethod: string;
  matchConfidence: string;
  /** `FinancialSupplier.status` quando a identidade é EXACT/HIGH; null = desconhecido. */
  registryStatus: string | null;
};

export type SupplierPerformanceDashboardInput = {
  orders: readonly DashboardOrderInput[];
  lines: readonly DashboardLineInput[];
  evaluations: readonly DashboardEvaluationInput[];
  catalog: readonly DashboardCatalogInput[];
  supplierIdentities: readonly DashboardSupplierIdentityInput[];
  /** Feature flag SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED (fail closed). */
  evaluationFeatureEnabled: boolean;
  lastSyncedAt: Date | null;
  availableYears: readonly number[];
  now?: Date;
};

/* ------------------------------------------------------------------ *
 * População normalizada
 * ------------------------------------------------------------------ */

export type PopulationLine = {
  orderId: string;
  lineIndex: number;
  lineExternalId: number | null;
  materialKey: DashboardMaterialKey | null;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  group: string | null;
  unit: string | null;
  orderedQuantity: number | null;
  receivedQuantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
};

export type PopulationOrder = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierKey: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  stage: string;
  canceled: boolean;
  performanceDate: Date;
  monthKey: string;
  currency: string;
  headerTotal: number | null;
  expectedAt: Date | null;
  paymentTerms: string | null;
  lines: PopulationLine[];
  evaluation: DashboardEvaluationInput | null;
  /** Valor canônico do pedido na base de spend vigente. */
  spend: number;
  hasSpendValue: boolean;
};

export type DashboardSpendBasis = "order_header" | "line";

export type DashboardCurrencyOption = { currency: string; orderCount: number; spend: number };

export type DashboardPopulation = {
  filters: SupplierPerformanceDashboardFilters;
  spendBasis: DashboardSpendBasis;
  currency: {
    selected: string;
    multiCurrency: boolean;
    available: DashboardCurrencyOption[];
  };
  orders: PopulationOrder[];
  /** Pedidos após período/cancelamento/moeda, antes de fornecedor/material — base das opções de filtro. */
  baseOrders: PopulationOrder[];
  excluded: {
    outsidePeriod: number;
    canceled: number;
    otherCurrency: number;
    otherSupplier: number;
    noMatchingLine: number;
  };
  unresolvedMaterialLineCount: number;
  linesWithoutValueCount: number;
  ordersWithoutValueCount: number;
  evaluationEnabled: boolean;
  identities: Map<number, DashboardSupplierIdentityInput>;
  now: Date;
  lastSyncedAt: Date | null;
  availableYears: number[];
};

function sumLineTotals(lines: readonly PopulationLine[]): { total: number; valued: number } {
  let total = 0;
  let valued = 0;
  for (const line of lines) {
    if (isFiniteNumber(line.lineTotal)) {
      total += line.lineTotal;
      valued += 1;
    }
  }
  return { total, valued };
}

export function buildSupplierPerformanceDashboardPopulation(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters
): DashboardPopulation {
  const now = input.now ?? new Date();
  const { gte, lt } = resolveSupplierPerformanceDateRange(filters.period);

  const linesByOrder = new Map<string, DashboardLineInput[]>();
  for (const line of input.lines) {
    const list = linesByOrder.get(line.purchaseOrderId) ?? [];
    list.push(line);
    linesByOrder.set(line.purchaseOrderId, list);
  }
  const catalogByExternal = new Map<string, DashboardCatalogInput>();
  for (const row of input.catalog) {
    if (row.externalProductId) catalogByExternal.set(String(row.externalProductId), row);
  }
  const evaluationByOrder = new Map<string, DashboardEvaluationInput>();
  for (const row of input.evaluations) evaluationByOrder.set(row.nomusPurchaseOrderId, row);
  const identities = new Map<number, DashboardSupplierIdentityInput>();
  for (const row of input.supplierIdentities) identities.set(row.supplierExternalId, row);

  const excluded = { outsidePeriod: 0, canceled: 0, otherCurrency: 0, otherSupplier: 0, noMatchingLine: 0 };
  const materialFilterActive = filters.materialKey != null || filters.materialGroup != null;
  const spendBasis: DashboardSpendBasis = materialFilterActive ? "line" : "order_header";
  const groupFilter = filters.materialGroup ? filters.materialGroup.trim().toLowerCase() : null;

  // Etapa A — período, cancelamento (antes da moeda para descobrir a moeda principal).
  const stageA: PopulationOrder[] = [];
  let unresolvedMaterialLineCount = 0;
  for (const order of input.orders) {
    const performanceDate = resolveNomusPurchaseOrderPerformanceDate(order);
    if (Number.isNaN(performanceDate.getTime())) {
      excluded.outsidePeriod += 1;
      continue;
    }
    if (gte && performanceDate.getTime() < gte.getTime()) {
      excluded.outsidePeriod += 1;
      continue;
    }
    if (lt && performanceDate.getTime() >= lt.getTime()) {
      excluded.outsidePeriod += 1;
      continue;
    }
    const canceled = isNomusPurchaseOrderCanceled(order);
    if (canceled && !filters.includeCanceled) {
      excluded.canceled += 1;
      continue;
    }
    const rawLines = (linesByOrder.get(order.id) ?? [])
      .slice()
      .sort((a, b) => a.lineIndex - b.lineIndex);
    const lines: PopulationLine[] = rawLines.map((line) => {
      const materialKey = resolveDashboardMaterialKey(line);
      if (!materialKey) unresolvedMaterialLineCount += 1;
      const catalog =
        line.productExternalId != null ? catalogByExternal.get(String(line.productExternalId)) : undefined;
      return {
        orderId: order.id,
        lineIndex: line.lineIndex,
        lineExternalId: line.lineExternalId,
        materialKey,
        productExternalId: line.productExternalId,
        productCode: line.productCode ?? catalog?.code ?? null,
        description: line.description ?? catalog?.description ?? null,
        group: catalog?.groupName ?? null,
        unit: normalizeDashboardUnit(line.unit),
        orderedQuantity: isFiniteNumber(line.orderedQuantity) ? line.orderedQuantity : null,
        receivedQuantity: isFiniteNumber(line.receivedQuantity) ? line.receivedQuantity : null,
        unitPrice: isFiniteNumber(line.unitPrice) ? line.unitPrice : null,
        lineTotal: isFiniteNumber(line.totalAmount) ? line.totalAmount : null,
      };
    });
    stageA.push({
      id: order.id,
      externalId: order.externalId,
      orderNumber: order.orderNumber,
      supplierKey: order.supplierExternalId != null && Number.isInteger(order.supplierExternalId)
        ? order.supplierExternalId
        : null,
      supplierName: order.supplierName,
      supplierTaxId: order.supplierTaxId,
      stage: order.stage,
      canceled,
      performanceDate,
      monthKey: toDashboardMonthKey(performanceDate),
      currency: resolveNomusPurchaseOrderCurrency(order.currency),
      headerTotal: isFiniteNumber(order.totalAmount) ? order.totalAmount : null,
      expectedAt: order.expectedAt,
      paymentTerms: order.paymentTerms?.trim() || null,
      lines,
      evaluation: input.evaluationFeatureEnabled ? (evaluationByOrder.get(order.id) ?? null) : null,
      spend: 0,
      hasSpendValue: false,
    });
  }

  // Moeda: principal = mais pedidos (empate: código asc). Nunca soma moedas diferentes.
  const currencyMap = new Map<string, DashboardCurrencyOption>();
  for (const order of stageA) {
    const entry = currencyMap.get(order.currency) ?? { currency: order.currency, orderCount: 0, spend: 0 };
    entry.orderCount += 1;
    entry.spend += order.headerTotal ?? 0;
    currencyMap.set(order.currency, entry);
  }
  const available = [...currencyMap.values()]
    .map((row) => ({ ...row, spend: roundMoney(row.spend) }))
    .sort((a, b) => b.orderCount - a.orderCount || a.currency.localeCompare(b.currency));
  const selectedCurrency =
    filters.currency ?? available[0]?.currency ?? NOMUS_PURCHASE_ORDER_DEFAULT_CURRENCY;

  const baseOrders: PopulationOrder[] = [];
  for (const order of stageA) {
    if (order.currency !== selectedCurrency) {
      excluded.otherCurrency += 1;
      continue;
    }
    baseOrders.push(order);
  }

  // Etapa B — fornecedor, material/grupo, base de spend.
  const orders: PopulationOrder[] = [];
  let linesWithoutValueCount = 0;
  let ordersWithoutValueCount = 0;
  for (const base of baseOrders) {
    if (filters.supplierExternalId != null && base.supplierKey !== filters.supplierExternalId) {
      excluded.otherSupplier += 1;
      continue;
    }
    let lines = base.lines;
    if (materialFilterActive) {
      lines = lines.filter((line) => {
        if (filters.materialKey && line.materialKey !== filters.materialKey) return false;
        if (groupFilter && (line.group ?? "").trim().toLowerCase() !== groupFilter) return false;
        return true;
      });
      if (lines.length === 0) {
        excluded.noMatchingLine += 1;
        continue;
      }
    }
    for (const line of lines) if (line.lineTotal == null) linesWithoutValueCount += 1;

    let spend = 0;
    let hasSpendValue = false;
    if (spendBasis === "order_header") {
      if (base.headerTotal != null) {
        spend = base.headerTotal;
        hasSpendValue = true;
      }
    } else {
      const sums = sumLineTotals(lines);
      spend = sums.total;
      hasSpendValue = sums.valued > 0;
    }
    if (!hasSpendValue) ordersWithoutValueCount += 1;
    orders.push({ ...base, lines, spend, hasSpendValue });
  }

  return {
    filters,
    spendBasis,
    currency: { selected: selectedCurrency, multiCurrency: available.length > 1, available },
    orders,
    baseOrders,
    excluded,
    unresolvedMaterialLineCount,
    linesWithoutValueCount,
    ordersWithoutValueCount,
    evaluationEnabled: input.evaluationFeatureEnabled,
    identities,
    now,
    lastSyncedAt: input.lastSyncedAt,
    availableYears: [...input.availableYears].sort((a, b) => b - a),
  };
}

/* ------------------------------------------------------------------ *
 * Agregações internas
 * ------------------------------------------------------------------ */

type UnitAgg = {
  unit: string;
  quantity: number;
  lineCount: number;
  valuedQuantity: number;
  valuedSpend: number;
  monthly: Map<string, { valuedQuantity: number; valuedSpend: number; lineCount: number }>;
};

type LastPurchase = {
  date: Date;
  externalId: number;
  lineIndex: number;
  price: number | null;
  orderNumber: string | null;
  unit: string | null;
};

type PairAgg = {
  supplierKey: number | null;
  materialKey: DashboardMaterialKey;
  spend: number;
  orderIds: Set<string>;
  lineCount: number;
  units: Map<string, UnitAgg>;
  /** Linha mais recente (qualquer). */
  last: LastPurchase | null;
  /** Linha mais recente COM unitPrice — autoridade do "último preço comprado". */
  lastPriced: LastPurchase | null;
};

type MaterialAgg = {
  key: DashboardMaterialKey;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  group: string | null;
  spend: number;
  orderIds: Set<string>;
  lineCount: number;
  units: Set<string>;
  pairs: Map<number | null, PairAgg>;
};

type SupplierAgg = {
  key: number;
  name: string;
  document: string | null;
  identity: DashboardSupplierIdentityInput | null;
  spend: number;
  orderCount: number;
  lineCount: number;
  lineSpend: number;
  materialKeys: Set<DashboardMaterialKey>;
  orders: PopulationOrder[];
  evaluations: DashboardEvaluationInput[];
  paymentTerms: Map<string, number>;
  monthly: Map<string, { spend: number; orderCount: number; materialKeys: Set<string> }>;
};

type Aggregates = {
  suppliers: Map<number, SupplierAgg>;
  materials: Map<DashboardMaterialKey, MaterialAgg>;
  unresolvedSupplier: { spend: number; orderCount: number; lineCount: number };
  totalSpend: number;
  orderCount: number;
  lineCount: number;
};

function resolveSupplierDisplayName(
  supplierKey: number,
  identity: DashboardSupplierIdentityInput | undefined,
  order: PopulationOrder
): string {
  return (
    identity?.resolvedName?.trim() ||
    order.supplierName?.trim() ||
    `Fornecedor Nomus #${supplierKey}`
  );
}

function compareLastPurchase(a: LastPurchase, b: { date: Date; externalId: number; lineIndex: number }): number {
  const byDate = a.date.getTime() - b.date.getTime();
  if (byDate !== 0) return byDate;
  const byExternal = a.externalId - b.externalId;
  if (byExternal !== 0) return byExternal;
  return a.lineIndex - b.lineIndex;
}

function aggregate(population: DashboardPopulation): Aggregates {
  const suppliers = new Map<number, SupplierAgg>();
  const materials = new Map<DashboardMaterialKey, MaterialAgg>();
  const unresolvedSupplier = { spend: 0, orderCount: 0, lineCount: 0 };
  let totalSpend = 0;
  let lineCount = 0;

  for (const order of population.orders) {
    totalSpend += order.spend;
    lineCount += order.lines.length;

    let supplier: SupplierAgg | null = null;
    if (order.supplierKey != null) {
      const identity = population.identities.get(order.supplierKey);
      supplier = suppliers.get(order.supplierKey) ?? null;
      if (!supplier) {
        supplier = {
          key: order.supplierKey,
          name: resolveSupplierDisplayName(order.supplierKey, identity, order),
          document: identity?.resolvedDocument ?? order.supplierTaxId ?? null,
          identity: identity ?? null,
          spend: 0,
          orderCount: 0,
          lineCount: 0,
          lineSpend: 0,
          materialKeys: new Set(),
          orders: [],
          evaluations: [],
          paymentTerms: new Map(),
          monthly: new Map(),
        };
        suppliers.set(order.supplierKey, supplier);
      }
      supplier.spend += order.spend;
      supplier.orderCount += 1;
      supplier.lineCount += order.lines.length;
      supplier.orders.push(order);
      if (order.evaluation) supplier.evaluations.push(order.evaluation);
      if (order.paymentTerms) {
        supplier.paymentTerms.set(order.paymentTerms, (supplier.paymentTerms.get(order.paymentTerms) ?? 0) + 1);
      }
      const month = supplier.monthly.get(order.monthKey) ?? { spend: 0, orderCount: 0, materialKeys: new Set<string>() };
      month.spend += order.spend;
      month.orderCount += 1;
      supplier.monthly.set(order.monthKey, month);
    } else {
      unresolvedSupplier.spend += order.spend;
      unresolvedSupplier.orderCount += 1;
      unresolvedSupplier.lineCount += order.lines.length;
    }

    for (const line of order.lines) {
      if (supplier && line.lineTotal != null) supplier.lineSpend += line.lineTotal;
      if (!line.materialKey) continue;
      if (supplier) {
        supplier.materialKeys.add(line.materialKey);
        supplier.monthly.get(order.monthKey)?.materialKeys.add(line.materialKey);
      }
      let material = materials.get(line.materialKey);
      if (!material) {
        material = {
          key: line.materialKey,
          productExternalId: line.productExternalId,
          productCode: line.productCode,
          description: line.description,
          group: line.group,
          spend: 0,
          orderIds: new Set(),
          lineCount: 0,
          units: new Set(),
          pairs: new Map(),
        };
        materials.set(line.materialKey, material);
      }
      if (!material.description && line.description) material.description = line.description;
      if (!material.productCode && line.productCode) material.productCode = line.productCode;
      if (!material.group && line.group) material.group = line.group;
      material.orderIds.add(order.id);
      material.lineCount += 1;
      if (line.unit) material.units.add(line.unit);
      if (line.lineTotal != null) material.spend += line.lineTotal;

      let pair = material.pairs.get(order.supplierKey);
      if (!pair) {
        pair = {
          supplierKey: order.supplierKey,
          materialKey: line.materialKey,
          spend: 0,
          orderIds: new Set(),
          lineCount: 0,
          units: new Map(),
          last: null,
          lastPriced: null,
        };
        material.pairs.set(order.supplierKey, pair);
      }
      pair.orderIds.add(order.id);
      pair.lineCount += 1;
      if (line.lineTotal != null) pair.spend += line.lineTotal;

      const unitKey = line.unit ?? "";
      let unitAgg = pair.units.get(unitKey);
      if (!unitAgg) {
        unitAgg = { unit: unitKey, quantity: 0, lineCount: 0, valuedQuantity: 0, valuedSpend: 0, monthly: new Map() };
        pair.units.set(unitKey, unitAgg);
      }
      unitAgg.lineCount += 1;
      if (line.orderedQuantity != null) unitAgg.quantity += line.orderedQuantity;
      if (line.orderedQuantity != null && line.orderedQuantity > 0 && line.lineTotal != null) {
        unitAgg.valuedQuantity += line.orderedQuantity;
        unitAgg.valuedSpend += line.lineTotal;
        const month = unitAgg.monthly.get(order.monthKey) ?? { valuedQuantity: 0, valuedSpend: 0, lineCount: 0 };
        month.valuedQuantity += line.orderedQuantity;
        month.valuedSpend += line.lineTotal;
        month.lineCount += 1;
        unitAgg.monthly.set(order.monthKey, month);
      }

      const candidate = { date: order.performanceDate, externalId: order.externalId, lineIndex: line.lineIndex };
      const observation: LastPurchase = { ...candidate, price: line.unitPrice, orderNumber: order.orderNumber, unit: line.unit };
      if (!pair.last || compareLastPurchase(pair.last, candidate) < 0) pair.last = observation;
      if (line.unitPrice != null && (!pair.lastPriced || compareLastPurchase(pair.lastPriced, candidate) < 0)) {
        pair.lastPriced = observation;
      }
    }
  }

  return {
    suppliers,
    materials,
    unresolvedSupplier,
    totalSpend,
    orderCount: population.orders.length,
    lineCount,
  };
}

/* ------------------------------------------------------------------ *
 * DTOs do read model
 * ------------------------------------------------------------------ */

export type DashboardSupplierEvaluationDto = {
  summary: SupplierPerformanceSummaryDto;
  methodologyVersion: number;
  methodologyId: string;
  scaleMin: number;
  scaleMax: number;
  /** Avaliações na escala consolidada (V2 preferida; V1 só quando não há V2). */
  evaluationCount: number;
  v1Count: number;
  v2Count: number;
};

export type DashboardSupplierRow = {
  supplierExternalId: number;
  name: string;
  document: string | null;
  financialSupplierId: string | null;
  matchConfidence: string;
  matchMethod: string;
  registryStatus: string | null;
  spend: number;
  share: number | null;
  orderCount: number;
  lineCount: number;
  averageTicket: number | null;
  mixCount: number;
  exclusiveMaterialCount: number;
  dominantMaterialCount: number;
  maxMaterialShare: number | null;
  evaluation: DashboardSupplierEvaluationDto | null;
};

export type DashboardRankedSupplierRow = DashboardSupplierRow & { position: number };

export type DashboardParetoRow = {
  position: number;
  supplierExternalId: number | null;
  name: string;
  spend: number;
  share: number | null;
  cumulativeShare: number | null;
  orderCount: number;
  mixCount: number;
  unresolved: boolean;
};

export type DashboardMaterialSupplierRef = {
  supplierExternalId: number | null;
  name: string;
  spend: number;
  share: number | null;
  orderCount: number;
};

export type DashboardMaterialConcentrationRow = {
  materialKey: DashboardMaterialKey;
  productCode: string | null;
  description: string | null;
  group: string | null;
  spend: number;
  orderCount: number;
  lineCount: number;
  supplierCountObserved: number;
  /** `financial` = maior share de valor; `orders` = mais frequente (sem valor de linha provado). */
  dominantBasis: "financial" | "orders" | null;
  dominant: DashboardMaterialSupplierRef | null;
  second: DashboardMaterialSupplierRef | null;
  singleSourceObserved: boolean;
};

export type DashboardMonthlyPoint = {
  month: string;
  spend: number;
  orderCount: number;
  lineCount: number;
  activeSuppliers: number;
  materialCount: number;
};

export type DashboardPriceDispersionRow = {
  materialKey: DashboardMaterialKey;
  productCode: string | null;
  description: string | null;
  unit: string | null;
  currency: string;
  supplierCount: number;
  minAveragePrice: number;
  minSupplier: { supplierExternalId: number | null; name: string };
  maxAveragePrice: number;
  maxSupplier: { supplierExternalId: number | null; name: string };
  spread: number;
  spreadPct: number | null;
};

export type DashboardPriceChangeRow = {
  materialKey: DashboardMaterialKey;
  productCode: string | null;
  description: string | null;
  supplierExternalId: number | null;
  supplierName: string;
  unit: string | null;
  currency: string;
  firstMonth: string;
  firstAveragePrice: number;
  lastMonth: string;
  lastAveragePrice: number;
  changeAbsolute: number;
  changePct: number | null;
  monthCount: number;
};

export type DashboardEvaluationBand = { band: string; from: number; to: number | null; orders: number; suppliers: number };

export type DashboardScoreVsSpendPoint = {
  supplierExternalId: number;
  name: string;
  spend: number;
  score: number;
  orderCount: number;
  evaluatedOrders: number;
};

export type DashboardEvaluationSection =
  | { available: false; reason: string }
  | {
      available: true;
      methodologyVersion: number;
      methodologyId: string;
      scaleMin: number;
      scaleMax: number;
      summary: SupplierPerformanceSummaryDto;
      evaluatedSuppliers: number;
      suppliersWithoutEvaluation: number;
      v1OnlySuppliers: number;
      distribution: DashboardEvaluationBand[];
      scoreVsSpend: DashboardScoreVsSpendPoint[];
      criteria: Array<{ key: SupplierEvaluationCriterionKey; label: string; shortLabel: string; weightPercent: number; average: number | null }>;
      /** Indica que a nota consolidada respeita o mesmo período das compras (data do pedido). */
      periodScoped: true;
    };

export type AdvancedMetricStatus = "available" | "partial" | "unavailable";
export type AdvancedMetricGroup =
  | "DELIVERY"
  | "QUALITY"
  | "RESPONSIVENESS"
  | "COMPLIANCE"
  | "COMMERCIAL"
  | "RISK";

export type AdvancedMetricValue =
  | { kind: "count"; value: number; of?: number }
  | { kind: "percent"; value: number; numerator?: number; denominator?: number }
  | { kind: "days"; value: number; count: number }
  | { kind: "distribution"; items: Array<{ label: string; count: number }>; unknownCount: number }
  | { kind: "reference"; label: string };

export type AdvancedMetricEntry = {
  key: string;
  label: string;
  group: AdvancedMetricGroup;
  status: AdvancedMetricStatus;
  source: string | null;
  reason: string | null;
  formula: string | null;
  value: AdvancedMetricValue | null;
};

export const ADVANCED_METRIC_GROUP_LABELS: Record<AdvancedMetricGroup, string> = {
  DELIVERY: "Entrega",
  QUALITY: "Qualidade",
  RESPONSIVENESS: "Responsividade",
  COMPLIANCE: "Compliance",
  COMMERCIAL: "Comercial",
  RISK: "Risco",
};

export const ADVANCED_METRIC_UNAVAILABLE_LABEL =
  "Indicador indisponível — fonte operacional ainda não identificada";

export type DashboardKpiDefinition = {
  key: string;
  label: string;
  description: string;
  formula: string;
  source: string;
  scope: string;
  limitation?: string;
};

export type SupplierPerformanceDashboardReadModel = {
  metadata: {
    version: string;
    generatedAt: string;
    lastSyncedAt: string | null;
    period: SupplierPerformancePeriod;
    filters: SupplierPerformanceDashboardFilters;
    spendBasis: DashboardSpendBasis;
    currency: { selected: string; multiCurrency: boolean; available: DashboardCurrencyOption[] };
    population: {
      orderCount: number;
      lineCount: number;
      supplierCount: number;
      materialCount: number;
      canceledExcluded: number;
      otherCurrencyExcluded: number;
      outsidePeriodExcluded: number;
      noMatchingLineExcluded: number;
      unresolvedSupplierOrders: number;
      unresolvedSupplierSpend: number;
      unresolvedMaterialLines: number;
      linesWithoutValue: number;
      ordersWithoutValue: number;
      headerSpendTotal: number;
      lineSpendTotal: number;
    };
    authorities: Record<string, string>;
    eligibilityRule: {
      status: "BLOCKED_BY_BUSINESS_RULE";
      applied: string;
      note: string;
    };
    availableYears: number[];
    kpiDefinitions: DashboardKpiDefinition[];
  };
  filterOptions: {
    suppliers: Array<{ supplierExternalId: number; name: string; orderCount: number }>;
    materialGroups: Array<{ group: string; lineCount: number }>;
    currencies: DashboardCurrencyOption[];
  };
  kpis: {
    totalSpend: number;
    activeSuppliers: number;
    purchaseOrderCount: number;
    purchaseLineCount: number;
    averageTicket: number | null;
    materialMixCount: number;
    averageSupplierMix: number | null;
    evaluationScore: number | null;
    evaluationScaleMax: number | null;
    evaluationCoverage: number | null;
    evaluatedOrders: number;
    eligibleOrders: number;
    top1Concentration: number | null;
    top3Concentration: number | null;
    top5Concentration: number | null;
    singleSourceObservedCount: number;
    singleSourceObservedRate: number | null;
    dualSourceObservedCount: number;
    dualSourceObservedRate: number | null;
    materialsWithoutIdentifiedSupplier: number;
    averageSuppliersPerMaterial: number | null;
  };
  suppliers: DashboardSupplierRow[];
  rankings: {
    bestEvaluated: DashboardRankedSupplierRow[];
    legacyEvaluated: DashboardRankedSupplierRow[];
    lowestEvaluated: DashboardRankedSupplierRow[];
    byCriterion: Record<SupplierEvaluationCriterionKey, DashboardRankedSupplierRow[]>;
    topSpend: DashboardRankedSupplierRow[];
    topOrderCount: DashboardRankedSupplierRow[];
    topMix: DashboardRankedSupplierRow[];
    limit: number;
  };
  concentration: {
    pareto: DashboardParetoRow[];
    mostConcentratedMaterials: DashboardMaterialConcentrationRow[];
    dominantSupplierByMaterial: DashboardMaterialConcentrationRow[];
    singleSourceMaterials: DashboardMaterialConcentrationRow[];
  };
  charts: {
    monthly: DashboardMonthlyPoint[];
    spendBySupplier: DashboardParetoRow[];
  };
  pricing: {
    dispersion: DashboardPriceDispersionRow[];
    increases: DashboardPriceChangeRow[];
    materialsWithComparablePrices: number;
    materialsWithMixedUnits: number;
  };
  evaluation: DashboardEvaluationSection;
  advancedMetrics: AdvancedMetricEntry[];
};

/* ------------------------------------------------------------------ *
 * Avaliação por fornecedor — reutiliza o motor OP-26
 * ------------------------------------------------------------------ */

export function buildDashboardSupplierEvaluation(
  eligibleOrders: number,
  evaluations: readonly DashboardEvaluationInput[]
): DashboardSupplierEvaluationDto | null {
  if (evaluations.length === 0) {
    if (eligibleOrders === 0) return null;
    const methodology = getSupplierEvaluationMethodology(SUPPLIER_EVALUATION_METHODOLOGY_VERSION);
    return {
      summary: buildSupplierPerformanceSummary({
        eligibleOrders,
        evaluatedOrders: 0,
        averages: { overall: null, quality: null, delivery: null, conformity: null, service: null },
      }),
      methodologyVersion: methodology.version,
      methodologyId: methodology.id,
      scaleMin: methodology.scaleMin,
      scaleMax: methodology.scaleMax,
      evaluationCount: 0,
      v1Count: 0,
      v2Count: 0,
    };
  }
  const aggregated = resolveSupplierEvaluationAggregation(
    evaluations.map((row) => ({
      overallScore: row.overallScore,
      qualityScore: row.qualityScore,
      deliveryScore: row.deliveryScore,
      conformityScore: row.conformityScore,
      serviceScore: row.serviceScore,
      methodologyVersion: row.methodologyVersion,
    }))
  );
  const summary = buildSupplierPerformanceSummary({
    eligibleOrders,
    evaluatedOrders: aggregated.overall.length,
    averages: {
      overall: averageScoreOrNull(aggregated.overall),
      quality: averageScoreOrNull(aggregated.quality),
      delivery: averageScoreOrNull(aggregated.delivery),
      conformity: averageScoreOrNull(aggregated.conformity),
      service: averageScoreOrNull(aggregated.service),
    },
  });
  let v1Count = 0;
  let v2Count = 0;
  for (const row of evaluations) {
    if (row.methodologyVersion === SUPPLIER_EVALUATION_METHODOLOGY_V1) v1Count += 1;
    else if (row.methodologyVersion === SUPPLIER_EVALUATION_METHODOLOGY_V2) v2Count += 1;
  }
  return {
    summary,
    methodologyVersion: aggregated.methodology.version,
    methodologyId: aggregated.methodology.id,
    scaleMin: aggregated.methodology.scaleMin,
    scaleMax: aggregated.methodology.scaleMax,
    evaluationCount: aggregated.overall.length,
    v1Count,
    v2Count,
  };
}

/* ------------------------------------------------------------------ *
 * Rankings / ordenação determinística
 * ------------------------------------------------------------------ */

function tieBreak(a: DashboardSupplierRow, b: DashboardSupplierRow): number {
  return comparePtBr(a.name, b.name) || a.supplierExternalId - b.supplierExternalId;
}

function rank(rows: readonly DashboardSupplierRow[], limit: number): DashboardRankedSupplierRow[] {
  return rows.slice(0, limit).map((row, index) => ({ ...row, position: index + 1 }));
}

function sortDescBy(
  rows: readonly DashboardSupplierRow[],
  pick: (row: DashboardSupplierRow) => number | null
): DashboardSupplierRow[] {
  return rows
    .filter((row) => pick(row) != null)
    .sort((a, b) => (pick(b) as number) - (pick(a) as number) || tieBreak(a, b));
}

function sortAscBy(
  rows: readonly DashboardSupplierRow[],
  pick: (row: DashboardSupplierRow) => number | null
): DashboardSupplierRow[] {
  return rows
    .filter((row) => pick(row) != null)
    .sort((a, b) => (pick(a) as number) - (pick(b) as number) || tieBreak(a, b));
}

function isV2Comparable(row: DashboardSupplierRow): boolean {
  return (
    row.evaluation != null &&
    row.evaluation.methodologyVersion === SUPPLIER_EVALUATION_METHODOLOGY_V2 &&
    row.evaluation.summary.overallScore != null
  );
}

function isV1Only(row: DashboardSupplierRow): boolean {
  return (
    row.evaluation != null &&
    row.evaluation.methodologyVersion === SUPPLIER_EVALUATION_METHODOLOGY_V1 &&
    row.evaluation.summary.overallScore != null
  );
}

const CRITERION_FIELD: Record<SupplierEvaluationCriterionKey, keyof SupplierPerformanceSummaryDto> = {
  quality: "qualityScore",
  delivery: "deliveryScore",
  conformity: "conformityScore",
  service: "serviceScore",
};

/* ------------------------------------------------------------------ *
 * Material — concentração / fornecedor principal
 * ------------------------------------------------------------------ */

function materialSupplierName(
  supplierKey: number | null,
  suppliers: Map<number, SupplierAgg>
): string {
  if (supplierKey == null) return UNRESOLVED_SUPPLIER_LABEL;
  return suppliers.get(supplierKey)?.name ?? `Fornecedor Nomus #${supplierKey}`;
}

function buildMaterialConcentrationRow(
  material: MaterialAgg,
  suppliers: Map<number, SupplierAgg>
): DashboardMaterialConcentrationRow {
  const identified = [...material.pairs.values()].filter((pair) => pair.supplierKey != null);
  const hasFinancial = identified.some((pair) => pair.spend > 0);
  const sorted = identified.slice().sort((a, b) => {
    if (hasFinancial) {
      const bySpend = b.spend - a.spend;
      if (bySpend !== 0) return bySpend;
    } else {
      const byOrders = b.orderIds.size - a.orderIds.size;
      if (byOrders !== 0) return byOrders;
    }
    return (
      comparePtBr(materialSupplierName(a.supplierKey, suppliers), materialSupplierName(b.supplierKey, suppliers)) ||
      (a.supplierKey ?? 0) - (b.supplierKey ?? 0)
    );
  });
  const toRef = (pair: PairAgg | undefined): DashboardMaterialSupplierRef | null => {
    if (!pair) return null;
    return {
      supplierExternalId: pair.supplierKey,
      name: materialSupplierName(pair.supplierKey, suppliers),
      spend: roundMoney(pair.spend),
      share: material.spend > 0 ? roundRatio(pair.spend / material.spend) : null,
      orderCount: pair.orderIds.size,
    };
  };
  return {
    materialKey: material.key,
    productCode: material.productCode,
    description: material.description,
    group: material.group,
    spend: roundMoney(material.spend),
    orderCount: material.orderIds.size,
    lineCount: material.lineCount,
    supplierCountObserved: identified.length,
    dominantBasis: identified.length === 0 ? null : hasFinancial ? "financial" : "orders",
    dominant: toRef(sorted[0]),
    second: toRef(sorted[1]),
    singleSourceObserved: identified.length === 1,
  };
}

/* ------------------------------------------------------------------ *
 * Preço — média ponderada, último preço, dispersão, evolução
 * ------------------------------------------------------------------ */

export function weightedAveragePrice(unitAgg: { valuedQuantity: number; valuedSpend: number }): number | null {
  if (unitAgg.valuedQuantity <= 0) return null;
  return roundPrice(unitAgg.valuedSpend / unitAgg.valuedQuantity);
}

function singleUnit(units: Map<string, UnitAgg>): UnitAgg | null {
  if (units.size !== 1) return null;
  return [...units.values()][0] ?? null;
}

function buildDispersionRows(
  materials: Map<DashboardMaterialKey, MaterialAgg>,
  suppliers: Map<number, SupplierAgg>,
  currency: string
): { rows: DashboardPriceDispersionRow[]; comparable: number; mixedUnits: number } {
  const rows: DashboardPriceDispersionRow[] = [];
  let comparable = 0;
  let mixedUnits = 0;
  for (const material of materials.values()) {
    if (material.units.size > 1) mixedUnits += 1;
    const byUnit = new Map<string, Array<{ supplierKey: number | null; price: number }>>();
    for (const pair of material.pairs.values()) {
      if (pair.supplierKey == null) continue;
      for (const unitAgg of pair.units.values()) {
        const price = weightedAveragePrice(unitAgg);
        if (price == null) continue;
        const list = byUnit.get(unitAgg.unit) ?? [];
        list.push({ supplierKey: pair.supplierKey, price });
        byUnit.set(unitAgg.unit, list);
      }
    }
    for (const [unit, list] of byUnit) {
      if (list.length < 2) continue;
      comparable += 1;
      const sorted = list
        .slice()
        .sort(
          (a, b) =>
            a.price - b.price ||
            comparePtBr(materialSupplierName(a.supplierKey, suppliers), materialSupplierName(b.supplierKey, suppliers))
        );
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const spread = roundPrice(max.price - min.price);
      rows.push({
        materialKey: material.key,
        productCode: material.productCode,
        description: material.description,
        unit: unit || null,
        currency,
        supplierCount: list.length,
        minAveragePrice: min.price,
        minSupplier: { supplierExternalId: min.supplierKey, name: materialSupplierName(min.supplierKey, suppliers) },
        maxAveragePrice: max.price,
        maxSupplier: { supplierExternalId: max.supplierKey, name: materialSupplierName(max.supplierKey, suppliers) },
        spread,
        spreadPct: min.price > 0 ? roundRatio(spread / min.price) : null,
      });
    }
  }
  rows.sort(
    (a, b) =>
      (b.spreadPct ?? -1) - (a.spreadPct ?? -1) ||
      b.spread - a.spread ||
      comparePtBr(a.productCode, b.productCode) ||
      a.materialKey.localeCompare(b.materialKey)
  );
  return { rows, comparable, mixedUnits };
}

function buildPriceChangeRows(
  materials: Map<DashboardMaterialKey, MaterialAgg>,
  suppliers: Map<number, SupplierAgg>,
  currency: string
): DashboardPriceChangeRow[] {
  const rows: DashboardPriceChangeRow[] = [];
  for (const material of materials.values()) {
    for (const pair of material.pairs.values()) {
      if (pair.supplierKey == null) continue;
      for (const unitAgg of pair.units.values()) {
        const months = [...unitAgg.monthly.entries()]
          .filter(([, value]) => value.valuedQuantity > 0)
          .sort(([a], [b]) => a.localeCompare(b));
        if (months.length < 2) continue;
        const [firstMonth, first] = months[0]!;
        const [lastMonth, last] = months[months.length - 1]!;
        const firstPrice = roundPrice(first.valuedSpend / first.valuedQuantity);
        const lastPrice = roundPrice(last.valuedSpend / last.valuedQuantity);
        const changeAbsolute = roundPrice(lastPrice - firstPrice);
        rows.push({
          materialKey: material.key,
          productCode: material.productCode,
          description: material.description,
          supplierExternalId: pair.supplierKey,
          supplierName: materialSupplierName(pair.supplierKey, suppliers),
          unit: unitAgg.unit || null,
          currency,
          firstMonth,
          firstAveragePrice: firstPrice,
          lastMonth,
          lastAveragePrice: lastPrice,
          changeAbsolute,
          changePct: firstPrice > 0 ? roundRatio(changeAbsolute / firstPrice) : null,
          monthCount: months.length,
        });
      }
    }
  }
  return rows.sort(
    (a, b) =>
      (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) ||
      b.changeAbsolute - a.changeAbsolute ||
      comparePtBr(a.productCode, b.productCode) ||
      comparePtBr(a.supplierName, b.supplierName)
  );
}

/* ------------------------------------------------------------------ *
 * Séries mensais
 * ------------------------------------------------------------------ */

function enumerateMonths(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  const result: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    result.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (result.length > 600) break;
  }
  return result;
}

function monthRange(population: DashboardPopulation, observed: readonly string[]): string[] {
  const sorted = [...new Set(observed)].sort();
  let from = sorted[0] ?? null;
  let to = sorted[sorted.length - 1] ?? null;
  if (population.filters.period.from) {
    from = toDashboardMonthKey(civilKeyToLocalDate(population.filters.period.from));
  }
  if (population.filters.period.to) {
    to = toDashboardMonthKey(civilKeyToLocalDate(population.filters.period.to));
  }
  if (!from || !to) return sorted;
  return enumerateMonths(from, to);
}

function buildMonthlySeries(population: DashboardPopulation): DashboardMonthlyPoint[] {
  const byMonth = new Map<
    string,
    { spend: number; orderCount: number; lineCount: number; suppliers: Set<number>; materials: Set<string> }
  >();
  for (const order of population.orders) {
    const entry = byMonth.get(order.monthKey) ?? {
      spend: 0,
      orderCount: 0,
      lineCount: 0,
      suppliers: new Set<number>(),
      materials: new Set<string>(),
    };
    entry.spend += order.spend;
    entry.orderCount += 1;
    entry.lineCount += order.lines.length;
    if (order.supplierKey != null) entry.suppliers.add(order.supplierKey);
    for (const line of order.lines) if (line.materialKey) entry.materials.add(line.materialKey);
    byMonth.set(order.monthKey, entry);
  }
  return monthRange(population, [...byMonth.keys()]).map((month) => {
    const entry = byMonth.get(month);
    return {
      month,
      spend: roundMoney(entry?.spend ?? 0),
      orderCount: entry?.orderCount ?? 0,
      lineCount: entry?.lineCount ?? 0,
      activeSuppliers: entry?.suppliers.size ?? 0,
      materialCount: entry?.materials.size ?? 0,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Indicadores avançados — registro de disponibilidade (nunca 0 falso)
 * ------------------------------------------------------------------ */

type AdvancedInputs = {
  orders: readonly PopulationOrder[];
  suppliers: readonly SupplierAgg[];
  now: Date;
  kpis: SupplierPerformanceDashboardReadModel["kpis"] | null;
};

function meanOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function buildAdvancedMetricsRegistry(input: AdvancedInputs): AdvancedMetricEntry[] {
  const entries: AdvancedMetricEntry[] = [];
  const push = (entry: Omit<AdvancedMetricEntry, "value" | "formula"> & { value?: AdvancedMetricValue | null; formula?: string | null }) =>
    entries.push({ value: null, formula: null, ...entry });

  const noReceiptDate =
    "Não há data efetiva de recebimento no espelho (NomusPurchaseOrder/Item não possuem data de recebimento; NF-e e documento de entrada são evidências do 360, não autoridade de recebimento físico).";

  // DELIVERY
  push({ key: "OTD", label: "OTD — On-Time Delivery", group: "DELIVERY", status: "unavailable", source: null, reason: noReceiptDate });
  push({ key: "OTIF", label: "OTIF — On-Time In-Full", group: "DELIVERY", status: "unavailable", source: null, reason: `${noReceiptDate} Quantidade recebida existe, mas sem data não há entrega elegível.` });
  push({ key: "AVG_DELAY", label: "Atraso médio de entrega", group: "DELIVERY", status: "unavailable", source: null, reason: noReceiptDate });
  push({ key: "MAX_DELAY", label: "Maior atraso de entrega", group: "DELIVERY", status: "unavailable", source: null, reason: noReceiptDate });
  push({ key: "LEAD_TIME", label: "Lead time real (pedido → recebimento)", group: "DELIVERY", status: "unavailable", source: null, reason: noReceiptDate });

  const promised: number[] = [];
  for (const order of input.orders) {
    if (!order.expectedAt) continue;
    const days = (order.expectedAt.getTime() - order.performanceDate.getTime()) / 86_400_000;
    if (Number.isFinite(days)) promised.push(days);
  }
  const promisedMean = meanOrNull(promised);
  push({
    key: "PROMISED_LEAD_TIME",
    label: "Prazo prometido médio (emissão → previsão)",
    group: "DELIVERY",
    status: promisedMean == null ? "unavailable" : "available",
    source: "NomusPurchaseOrder.issuedAt/firstSeenAt → NomusPurchaseOrder.expectedAt",
    reason: promisedMean == null ? "Nenhum pedido da população possui data de previsão." : null,
    formula: "média(expectedAt − data operacional) em dias, pedidos com previsão",
    value: promisedMean == null ? null : { kind: "days", value: Math.round(promisedMean * 10) / 10, count: promised.length },
  });
  push({ key: "EARLY_DELIVERIES", label: "Entregas antecipadas", group: "DELIVERY", status: "unavailable", source: null, reason: noReceiptDate });

  let fillLines = 0;
  let fillFull = 0;
  let fillSum = 0;
  for (const order of input.orders) {
    for (const line of order.lines) {
      if (line.orderedQuantity == null || line.orderedQuantity <= 0 || line.receivedQuantity == null) continue;
      fillLines += 1;
      fillSum += line.receivedQuantity / line.orderedQuantity;
      if (line.receivedQuantity + 1e-9 >= line.orderedQuantity) fillFull += 1;
    }
  }
  push({
    key: "FILL_RATE",
    label: "Atendimento de quantidade (fill rate parcial)",
    group: "DELIVERY",
    status: fillLines === 0 ? "unavailable" : "partial",
    source: "NomusPurchaseOrderItem.receivedQuantity / orderedQuantity (oficial Nomus)",
    reason:
      fillLines === 0
        ? "Nenhuma linha com quantidade pedida e atendida informadas."
        : "Sem data de recebimento: inclui pedidos ainda em aberto, portanto não equivale ao fill rate de entregas concluídas. Razão por linha (mesma unidade), nunca soma de unidades diferentes.",
    formula: "média(receivedQuantity ÷ orderedQuantity) por linha com orderedQuantity > 0",
    value: fillLines === 0 ? null : { kind: "percent", value: roundRatio(fillSum / fillLines), numerator: fillFull, denominator: fillLines },
  });
  const partial = input.orders.filter((order) => order.stage === "PARTIALLY_RECEIVED").length;
  push({
    key: "PARTIALLY_RECEIVED_ORDERS",
    label: "Pedidos parcialmente recebidos",
    group: "DELIVERY",
    status: "available",
    source: "NomusPurchaseOrder.stage = PARTIALLY_RECEIVED (classificador oficial)",
    reason: null,
    formula: "COUNT pedidos da população com fase PARTIALLY_RECEIVED",
    value: { kind: "count", value: partial, of: input.orders.length },
  });
  const overdue = input.orders.filter((order) =>
    isNomusPurchaseOrderOverdue({ stage: order.stage as NomusPurchaseOrderStage, expectedAt: order.expectedAt, now: input.now })
  ).length;
  const open = input.orders.filter((order) => isNomusPurchaseOrderOpenStage(order.stage as NomusPurchaseOrderStage)).length;
  push({
    key: "OPEN_OVERDUE_ORDERS",
    label: "Pedidos abertos com previsão vencida",
    group: "DELIVERY",
    status: "available",
    source: "isNomusPurchaseOrderOverdue (mesma regra do KPI Atrasados em Pedidos Nomus)",
    reason: null,
    formula: "COUNT pedidos abertos (OPEN/APPROVED/PARTIALLY_RECEIVED) com expectedAt < agora",
    value: { kind: "count", value: overdue, of: open },
  });

  // QUALITY
  const noQuality = "Não existe fonte oficial de inspeção, não conformidade ou quantidade rejeitada vinculada ao Pedido Nomus. A nota 'Qualidade' da avaliação 1–5 é percepção, não PPM.";
  push({ key: "APPROVAL_RATE", label: "Taxa de aprovação", group: "QUALITY", status: "unavailable", source: null, reason: noQuality });
  push({ key: "REJECTION_RATE", label: "Taxa de rejeição", group: "QUALITY", status: "unavailable", source: null, reason: noQuality });
  push({ key: "PPM", label: "PPM — partes por milhão defeituosas", group: "QUALITY", status: "unavailable", source: null, reason: noQuality });
  push({ key: "NCR", label: "Não conformidades (nº e taxa)", group: "QUALITY", status: "unavailable", source: null, reason: "Não há módulo/fonte oficial de não conformidade. Nota baixa, atraso ou cancelamento não são inferidos como NC." });
  push({ key: "NCR_RECURRENCE", label: "Reincidência de não conformidade", group: "QUALITY", status: "unavailable", source: null, reason: noQuality });
  push({ key: "RETURNS", label: "Devoluções (nº e valor)", group: "QUALITY", status: "unavailable", source: null, reason: "Status de item 7/8 (devolução) existe apenas no rawPayload da linha, sem coluna oficial, valor devolvido ou data. Fonte futura: NomusPurchaseOrderItem.rawPayload.status." });
  push({ key: "COST_OF_POOR_QUALITY", label: "Custo da não qualidade", group: "QUALITY", status: "unavailable", source: null, reason: noQuality });

  // RESPONSIVENESS
  const noResp = "Não há fonte oficial de chamados, respostas ou ações corretivas (SCAR) vinculada ao fornecedor.";
  push({ key: "RESPONSE_TIME", label: "Tempo médio de resposta", group: "RESPONSIVENESS", status: "unavailable", source: null, reason: noResp });
  push({ key: "RESOLUTION_TIME", label: "Tempo de solução", group: "RESPONSIVENESS", status: "unavailable", source: null, reason: noResp });
  push({ key: "CORRECTIVE_ACTION_RESPONSE", label: "Tempo de resposta a ação corretiva", group: "RESPONSIVENESS", status: "unavailable", source: null, reason: noResp });
  push({ key: "SCAR", label: "SCARs abertos / tempo de fechamento", group: "RESPONSIVENESS", status: "unavailable", source: null, reason: noResp });

  // COMPLIANCE
  const noCompliance = "Não há cadastro oficial de homologação, certificados, laudos ou documentos do fornecedor no IndusCost.";
  push({ key: "SUPPLIER_HOMOLOGATION", label: "Fornecedor homologado", group: "COMPLIANCE", status: "unavailable", source: null, reason: noCompliance });
  push({ key: "CERTIFICATES", label: "Certificados válidos / ISO", group: "COMPLIANCE", status: "unavailable", source: null, reason: noCompliance });
  push({ key: "MATERIAL_CERTIFICATES", label: "Certificados de material / laudos", group: "COMPLIANCE", status: "unavailable", source: null, reason: noCompliance });
  push({ key: "EXPIRED_DOCUMENTS", label: "Documentos vencidos", group: "COMPLIANCE", status: "unavailable", source: null, reason: noCompliance });
  push({ key: "COMPLIANCE_STATUS", label: "Status de compliance", group: "COMPLIANCE", status: "unavailable", source: null, reason: noCompliance });
  const registry = new Map<string, number>();
  let registryUnknown = 0;
  for (const supplier of input.suppliers) {
    const status = supplier.identity?.registryStatus ?? null;
    if (!status) {
      registryUnknown += 1;
      continue;
    }
    registry.set(status, (registry.get(status) ?? 0) + 1);
  }
  push({
    key: "SUPPLIER_REGISTRY_STATUS",
    label: "Status no cadastro de fornecedores (ativo/inativo)",
    group: "COMPLIANCE",
    status: registry.size === 0 ? "unavailable" : "partial",
    source: "FinancialSupplier.status via identidade EXACT/HIGH do pedido Nomus",
    reason:
      registry.size === 0
        ? "Nenhum fornecedor da população possui identidade EXACT/HIGH com cadastro vinculado."
        : "Somente fornecedores com identidade EXACT/HIGH e cadastro vinculado; status cadastral não é homologação.",
    formula: "COUNT fornecedores por FinancialSupplier.status",
    value:
      registry.size === 0
        ? null
        : {
            kind: "distribution",
            items: [...registry.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count })),
            unknownCount: registryUnknown,
          },
  });

  // COMMERCIAL
  push({ key: "AVG_PAYMENT_TERM_DAYS", label: "Prazo médio de pagamento (dias)", group: "COMMERCIAL", status: "unavailable", source: null, reason: "A condição de pagamento do pedido é texto livre; não há vínculo determinístico PO → título AP com prazo em dias. Não usar AP por fornecedor/valor/data como heurística." });
  const terms = new Map<string, number>();
  let termsUnknown = 0;
  for (const order of input.orders) {
    if (!order.paymentTerms) {
      termsUnknown += 1;
      continue;
    }
    terms.set(order.paymentTerms, (terms.get(order.paymentTerms) ?? 0) + 1);
  }
  push({
    key: "PAYMENT_TERMS",
    label: "Condição de pagamento declarada",
    group: "COMMERCIAL",
    status: terms.size === 0 ? "unavailable" : "partial",
    source: "NomusPurchaseOrder.paymentTerms (texto oficial do pedido)",
    reason: terms.size === 0 ? "Nenhum pedido informa condição de pagamento." : "Texto declarado no pedido; sem prazo médio em dias.",
    formula: "COUNT pedidos por texto de condição de pagamento (top 5)",
    value:
      terms.size === 0
        ? null
        : {
            kind: "distribution",
            items: [...terms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([label, count]) => ({ label, count })),
            unknownCount: termsUnknown,
          },
  });
  push({ key: "INCOTERM", label: "CIF / FOB", group: "COMMERCIAL", status: "unavailable", source: null, reason: "modalidadeTransporte existe apenas no rawPayload do cabeçalho (sem coluna oficial no espelho). Fonte futura: NomusPurchaseOrder.rawPayload.modalidadeTransporte." });
  push({ key: "MOQ", label: "Lote mínimo (MOQ)", group: "COMMERCIAL", status: "unavailable", source: null, reason: "Não há cadastro de lote mínimo por fornecedor/material." });
  push({ key: "PRICE_ADJUSTMENTS", label: "Reajustes contratuais", group: "COMMERCIAL", status: "unavailable", source: null, reason: "Não há contrato/tabela de preço acordada. A variação de preço observada nas compras está na seção Preços (dispersão e evolução), sem inferir reajuste.", value: { kind: "reference", label: "Ver 'Maiores aumentos de preço observados'" } });
  push({ key: "SAVINGS", label: "Savings", group: "COMMERCIAL", status: "unavailable", source: null, reason: "O motor de savings existente (cadeia interna SC) não está vinculado ao Pedido Nomus." });
  push({ key: "COST_AVOIDANCE", label: "Cost avoidance", group: "COMMERCIAL", status: "unavailable", source: null, reason: "Sem fonte oficial de custo evitado." });
  push({ key: "PPV", label: "PPV — Purchase Price Variance", group: "COMMERCIAL", status: "unavailable", source: null, reason: "Indisponível — preço de referência oficial não identificado (padrão, orçamento, negociado ou tabela). Material.standardCost pertence ao motor de custeio e não há vínculo determinístico Material ↔ produto Nomus na linha do pedido." });

  // RISK
  push({
    key: "CONCENTRATION",
    label: "Concentração de compras (Top 1 / 3 / 5)",
    group: "RISK",
    status: input.kpis ? "available" : "unavailable",
    source: "Spend canônico por fornecedor ÷ total do período",
    reason: input.kpis ? null : "Sem população.",
    formula: "SUM(spend top N) ÷ SUM(spend total)",
    value: input.kpis && input.kpis.top5Concentration != null ? { kind: "percent", value: input.kpis.top5Concentration } : null,
  });
  push({
    key: "SINGLE_SOURCE_OBSERVED",
    label: SINGLE_SOURCE_OBSERVED_LABEL,
    group: "RISK",
    status: input.kpis ? "available" : "unavailable",
    source: "COUNT DISTINCT supplierExternalId por materialKey na população",
    reason: SINGLE_SOURCE_OBSERVED_TOOLTIP,
    formula: "COUNT materiais com exatamente 1 fornecedor observado",
    value: input.kpis ? { kind: "count", value: input.kpis.singleSourceObservedCount, of: input.kpis.materialMixCount } : null,
  });
  push({
    key: "DUAL_SOURCE_OBSERVED",
    label: DUAL_SOURCE_OBSERVED_LABEL,
    group: "RISK",
    status: input.kpis ? "available" : "unavailable",
    source: "COUNT DISTINCT supplierExternalId por materialKey na população",
    reason: "Não afirma homologação alternativa — apenas compras observadas de ≥ 2 fornecedores no período.",
    formula: "COUNT materiais com ≥ 2 fornecedores observados",
    value: input.kpis ? { kind: "count", value: input.kpis.dualSourceObservedCount, of: input.kpis.materialMixCount } : null,
  });
  push({ key: "CRITICALITY", label: "Criticidade do material", group: "RISK", status: "unavailable", source: null, reason: "Material.marketCriticality existe, mas não há vínculo determinístico Material ↔ produto Nomus da linha do pedido." });
  push({
    key: "DEPENDENCY",
    label: "Dependência (média de fornecedores por MP)",
    group: "RISK",
    status: input.kpis && input.kpis.averageSuppliersPerMaterial != null ? "available" : "unavailable",
    source: "COUNT DISTINCT supplierExternalId por materialKey na população",
    reason: input.kpis && input.kpis.averageSuppliersPerMaterial != null ? null : "Sem materiais com fornecedor identificado.",
    formula: "média(COUNT DISTINCT supplierExternalId por material)",
    value: input.kpis && input.kpis.averageSuppliersPerMaterial != null ? { kind: "count", value: input.kpis.averageSuppliersPerMaterial } : null,
  });

  return entries;
}

/* ------------------------------------------------------------------ *
 * Catálogo de KPIs (tooltip: o que mede, fórmula, escopo, fonte)
 * ------------------------------------------------------------------ */

export function buildDashboardKpiDefinitions(population: DashboardPopulation): DashboardKpiDefinition[] {
  const scope = population.filters.period.from || population.filters.period.to ? "Período selecionado (data operacional do pedido)." : "Todo o histórico sincronizado.";
  const spendSource =
    population.spendBasis === "order_header"
      ? "NomusPurchaseOrder.totalAmount (valor oficial do cabeçalho, como em Pedidos Nomus)"
      : "SUM(NomusPurchaseOrderItem.totalAmount) das linhas filtradas (valor oficial da linha)";
  return [
    { key: "PURCHASE_SPEND", label: "Total comprado", description: "Valor dos pedidos de compra emitidos no período (não é valor recebido nem pago).", formula: "SUM(spend canônico)", source: spendSource, scope, limitation: "Pedidos sem valor informado não somam (contados em metadata). Moedas diferentes nunca são somadas." },
    { key: "ACTIVE_SUPPLIERS", label: "Fornecedores ativos", description: "Fornecedores com ao menos uma compra elegível.", formula: "COUNT DISTINCT supplierExternalId", source: "NomusPurchaseOrder.supplierExternalId", scope, limitation: "Pedidos sem ID de fornecedor não contam como fornecedor." },
    { key: "PURCHASE_ORDER_COUNT", label: "Pedidos de compra", description: "Quantidade de pedidos elegíveis.", formula: "COUNT DISTINCT NomusPurchaseOrder.id", source: "NomusPurchaseOrder", scope },
    { key: "PURCHASE_LINE_COUNT", label: "Linhas de compra", description: "Quantidade de linhas (itens) dos pedidos elegíveis.", formula: "COUNT NomusPurchaseOrderItem", source: "NomusPurchaseOrderItem", scope },
    { key: "AVERAGE_ORDER_TICKET", label: "Ticket médio por pedido", description: "Valor médio por pedido.", formula: "Total comprado ÷ nº pedidos", source: spendSource, scope, limitation: "null quando não há pedidos." },
    { key: "MATERIAL_MIX_COUNT", label: "Mix total de matérias-primas", description: "Materiais distintos comprados.", formula: "COUNT DISTINCT materialKey", source: "NomusPurchaseOrderItem.productExternalId (fallback productCode)", scope, limitation: "Linhas sem ID/código de produto não entram (contadas em metadata)." },
    { key: "AVERAGE_SUPPLIER_MIX", label: "Mix médio por fornecedor", description: "Média de materiais distintos por fornecedor ativo.", formula: "média(COUNT DISTINCT materialKey por fornecedor)", source: "NomusPurchaseOrderItem × NomusPurchaseOrder.supplierExternalId", scope },
    { key: "SUPPLIER_EVALUATION_SCORE", label: "Nota média de fornecedores", description: "Média das notas dos pedidos avaliados no período (cada pedido tem o mesmo peso).", formula: "AVG(overallScore) das avaliações na escala vigente — motor OP-26", source: "NomusPurchaseOrderSupplierEvaluation", scope, limitation: "V1 (0–10) e V2 (1–5) nunca se misturam. Sem ponderação por valor." },
    { key: "SUPPLIER_EVALUATION_COVERAGE", label: "Cobertura de avaliação", description: "Pedidos avaliados sobre pedidos elegíveis.", formula: "evaluatedOrders ÷ eligibleOrders (buildSupplierPerformanceSummary)", source: "NomusPurchaseOrderSupplierEvaluation × NomusPurchaseOrder", scope, limitation: "Mesma autoridade da aba Avaliação Fornecedor (toda a base é elegível)." },
    { key: "TOP1_CONCENTRATION", label: "Concentração Top 1", description: "Participação do maior fornecedor no valor comprado.", formula: "spend maior fornecedor ÷ total", source: spendSource, scope },
    { key: "TOP3_CONCENTRATION", label: "Concentração Top 3", description: "Participação dos três maiores fornecedores.", formula: "SUM(spend top 3) ÷ total", source: spendSource, scope },
    { key: "TOP5_CONCENTRATION", label: "Concentração Top 5", description: "Percentual do valor comprado no período concentrado nos cinco fornecedores com maior spend.", formula: "SUM(spend top 5) ÷ total", source: spendSource, scope },
    { key: "SINGLE_SOURCE_OBSERVED_COUNT", label: "MPs com fornecedor único observado", description: "Materiais comprados de um único fornecedor no período.", formula: "COUNT materiais com 1 fornecedor observado", source: "NomusPurchaseOrderItem × supplierExternalId", scope, limitation: SINGLE_SOURCE_OBSERVED_TOOLTIP },
    { key: "SINGLE_SOURCE_OBSERVED_RATE", label: "% MPs single-source observado", description: "Proporção de materiais com fornecedor único observado.", formula: "MPs com 1 fornecedor ÷ total de MPs compradas", source: "NomusPurchaseOrderItem × supplierExternalId", scope, limitation: SINGLE_SOURCE_OBSERVED_TOOLTIP },
    { key: "DUAL_SOURCE_OBSERVED_RATE", label: DUAL_SOURCE_OBSERVED_LABEL, description: "Materiais comprados de dois ou mais fornecedores no período.", formula: "MPs com ≥ 2 fornecedores ÷ total de MPs compradas", source: "NomusPurchaseOrderItem × supplierExternalId", scope, limitation: "Não afirma homologação alternativa." },
    { key: "AVG_SUPPLIERS_PER_MATERIAL", label: "Média de fornecedores por MP", description: "Média de fornecedores observados por material.", formula: "média(COUNT DISTINCT supplierExternalId por material)", source: "NomusPurchaseOrderItem × supplierExternalId", scope, limitation: "Materiais sem fornecedor identificado ficam fora da média." },
    { key: "SUPPLIER_MATERIAL_SHARE", label: "Share do fornecedor na MP", description: "Participação do fornecedor no valor comprado daquele material.", formula: "spend fornecedor na MP ÷ spend total da MP", source: "NomusPurchaseOrderItem.totalAmount", scope },
    { key: "WEIGHTED_AVERAGE_PRICE", label: "Preço médio ponderado", description: "Preço efetivo médio por unidade.", formula: "SUM(valor da linha) ÷ SUM(quantidade) por material + fornecedor + unidade + moeda", source: "NomusPurchaseOrderItem.totalAmount / orderedQuantity", scope, limitation: "Somente linhas com valor e quantidade > 0; unidades diferentes nunca se misturam." },
    { key: "LAST_PURCHASE_PRICE", label: "Último preço comprado", description: "Preço unitário da última compra do material com o fornecedor.", formula: "unitPrice da linha mais recente (data operacional, ID do pedido, índice da linha)", source: "NomusPurchaseOrderItem.unitPrice", scope, limitation: "Não é preço de contrato." },
    { key: "PRICE_SPREAD", label: "Dispersão de preço observada", description: "Diferença entre o maior e o menor preço médio entre fornecedores da mesma MP/unidade/moeda.", formula: "spread = max − min; spreadPct = spread ÷ min", source: "Preço médio ponderado", scope, limitation: "Não é 'saving potencial': preços podem refletir condições diferentes." },
  ];
}

/* ------------------------------------------------------------------ *
 * Read model principal
 * ------------------------------------------------------------------ */

function supplierRowFromAgg(
  agg: SupplierAgg,
  totalSpend: number,
  materials: Map<DashboardMaterialKey, MaterialAgg>,
  concentrationByMaterial: Map<DashboardMaterialKey, DashboardMaterialConcentrationRow>,
  evaluationEnabled: boolean
): DashboardSupplierRow {
  let exclusive = 0;
  let dominant = 0;
  let maxShare: number | null = null;
  for (const materialKey of agg.materialKeys) {
    const material = materials.get(materialKey);
    const concentration = concentrationByMaterial.get(materialKey);
    if (!material || !concentration) continue;
    if (concentration.singleSourceObserved) exclusive += 1;
    if (concentration.dominant?.supplierExternalId === agg.key) dominant += 1;
    const pair = material.pairs.get(agg.key);
    if (pair && material.spend > 0) {
      const share = pair.spend / material.spend;
      if (maxShare == null || share > maxShare) maxShare = share;
    }
  }
  return {
    supplierExternalId: agg.key,
    name: agg.name,
    document: agg.document,
    financialSupplierId: agg.identity?.financialSupplierId ?? null,
    matchConfidence: agg.identity?.matchConfidence ?? "UNRESOLVED",
    matchMethod: agg.identity?.matchMethod ?? "UNRESOLVED",
    registryStatus: agg.identity?.registryStatus ?? null,
    spend: roundMoney(agg.spend),
    share: totalSpend > 0 ? roundRatio(agg.spend / totalSpend) : null,
    orderCount: agg.orderCount,
    lineCount: agg.lineCount,
    averageTicket: agg.orderCount > 0 ? roundMoney(agg.spend / agg.orderCount) : null,
    mixCount: agg.materialKeys.size,
    exclusiveMaterialCount: exclusive,
    dominantMaterialCount: dominant,
    maxMaterialShare: maxShare == null ? null : roundRatio(maxShare),
    evaluation: evaluationEnabled ? buildDashboardSupplierEvaluation(agg.orderCount, agg.evaluations) : null,
  };
}

function buildParetoRows(
  suppliers: readonly DashboardSupplierRow[],
  unresolved: { spend: number; orderCount: number },
  totalSpend: number
): DashboardParetoRow[] {
  const rows: DashboardParetoRow[] = [];
  let cumulative = 0;
  const sorted = suppliers.slice().sort((a, b) => b.spend - a.spend || tieBreak(a, b));
  sorted.forEach((row, index) => {
    cumulative += row.spend;
    rows.push({
      position: index + 1,
      supplierExternalId: row.supplierExternalId,
      name: row.name,
      spend: row.spend,
      share: row.share,
      cumulativeShare: totalSpend > 0 ? roundRatio(cumulative / totalSpend) : null,
      orderCount: row.orderCount,
      mixCount: row.mixCount,
      unresolved: false,
    });
  });
  if (unresolved.orderCount > 0) {
    cumulative += unresolved.spend;
    rows.push({
      position: rows.length + 1,
      supplierExternalId: null,
      name: UNRESOLVED_SUPPLIER_LABEL,
      spend: roundMoney(unresolved.spend),
      share: totalSpend > 0 ? roundRatio(unresolved.spend / totalSpend) : null,
      cumulativeShare: totalSpend > 0 ? roundRatio(cumulative / totalSpend) : null,
      orderCount: unresolved.orderCount,
      mixCount: 0,
      unresolved: true,
    });
  }
  return rows;
}

function concentrationTopN(sorted: readonly DashboardSupplierRow[], n: number, totalSpend: number): number | null {
  if (totalSpend <= 0 || sorted.length === 0) return null;
  let sum = 0;
  for (const row of sorted.slice(0, n)) sum += row.spend;
  return roundRatio(sum / totalSpend);
}

const EVALUATION_BANDS: Array<{ band: string; from: number; to: number | null }> = [
  { band: "1,00 – 1,99", from: 1, to: 2 },
  { band: "2,00 – 2,99", from: 2, to: 3 },
  { band: "3,00 – 3,99", from: 3, to: 4 },
  { band: "4,00 – 4,99", from: 4, to: 5 },
  { band: "5,00", from: 5, to: null },
];

function bandIndex(score: number): number {
  if (score >= 5) return 4;
  if (score >= 4) return 3;
  if (score >= 3) return 2;
  if (score >= 2) return 1;
  return 0;
}

function buildEvaluationSection(
  population: DashboardPopulation,
  supplierRows: readonly DashboardSupplierRow[]
): DashboardEvaluationSection {
  if (!population.evaluationEnabled) {
    return {
      available: false,
      reason:
        "Avaliação de fornecedor desligada neste ambiente (SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED). Nenhuma nota é exibida ou inferida.",
    };
  }
  const evaluations = population.orders
    .map((order) => order.evaluation)
    .filter((row): row is DashboardEvaluationInput => row != null);
  const global = buildDashboardSupplierEvaluation(population.orders.length, evaluations);
  const methodology = getSupplierEvaluationMethodology(
    global?.methodologyVersion ?? SUPPLIER_EVALUATION_METHODOLOGY_VERSION
  );
  const summary =
    global?.summary ??
    buildSupplierPerformanceSummary({
      eligibleOrders: population.orders.length,
      evaluatedOrders: 0,
      averages: { overall: null, quality: null, delivery: null, conformity: null, service: null },
    });

  const bands: DashboardEvaluationBand[] = EVALUATION_BANDS.map((band) => ({ ...band, orders: 0, suppliers: 0 }));
  for (const row of evaluations) {
    if (row.methodologyVersion !== SUPPLIER_EVALUATION_METHODOLOGY_V2) continue;
    bands[bandIndex(row.overallScore)]!.orders += 1;
  }
  let evaluatedSuppliers = 0;
  let withoutEvaluation = 0;
  let v1Only = 0;
  const scoreVsSpend: DashboardScoreVsSpendPoint[] = [];
  for (const row of supplierRows) {
    if (isV2Comparable(row)) {
      evaluatedSuppliers += 1;
      const score = row.evaluation!.summary.overallScore as number;
      bands[bandIndex(score)]!.suppliers += 1;
      scoreVsSpend.push({
        supplierExternalId: row.supplierExternalId,
        name: row.name,
        spend: row.spend,
        score,
        orderCount: row.orderCount,
        evaluatedOrders: row.evaluation!.summary.evaluatedOrders,
      });
    } else if (isV1Only(row)) {
      v1Only += 1;
    } else {
      withoutEvaluation += 1;
    }
  }
  scoreVsSpend.sort((a, b) => b.spend - a.spend || comparePtBr(a.name, b.name) || a.supplierExternalId - b.supplierExternalId);

  return {
    available: true,
    methodologyVersion: methodology.version,
    methodologyId: methodology.id,
    scaleMin: methodology.scaleMin,
    scaleMax: methodology.scaleMax,
    summary,
    evaluatedSuppliers,
    suppliersWithoutEvaluation: withoutEvaluation,
    v1OnlySuppliers: v1Only,
    distribution: bands,
    scoreVsSpend,
    criteria: SUPPLIER_EVALUATION_CRITERIA.map((criterion) => ({
      key: criterion.key,
      label: criterion.label,
      shortLabel: criterion.shortLabel,
      weightPercent: criterion.weightPercent,
      average: summary[CRITERION_FIELD[criterion.key]] as number | null,
    })),
    periodScoped: true,
  };
}

export const SUPPLIER_PERFORMANCE_DASHBOARD_AUTHORITIES: Record<string, string> = {
  PURCHASE_ORDER_SOURCE: "NomusPurchaseOrder (espelho read-only, sync Nomus)",
  PURCHASE_ITEM_SOURCE: "NomusPurchaseOrderItem (espelho read-only, sync Nomus)",
  SUPPLIER_ID_AUTHORITY: "NomusPurchaseOrder.supplierExternalId (ID Nomus da pessoa fornecedor)",
  SUPPLIER_DISPLAY_AUTHORITY: "resolveNomusOrderSuppliersBatch (nome/documento; nunca agrupa)",
  MATERIAL_ID_AUTHORITY: "NomusPurchaseOrderItem.productExternalId (fallback productCode oficial)",
  MATERIAL_GROUP_AUTHORITY: "NomusProductCatalog.groupName via externalProductId",
  PURCHASE_DATE_AUTHORITY: "COALESCE(NomusPurchaseOrder.issuedAt, firstSeenAt) — periodWhere da Avaliação Fornecedor",
  PURCHASE_VALUE_AUTHORITY: "NomusPurchaseOrder.totalAmount (cabeçalho); NomusPurchaseOrderItem.totalAmount (linha)",
  CANCELED_AUTHORITY: "canceled === true OU stage === CANCELED (canceledOnly de Pedidos Nomus)",
  CURRENCY_AUTHORITY: "NomusPurchaseOrder.currency; ausente = BRL (convenção de Pedidos Nomus); sem câmbio",
  SUPPLIER_EVALUATION_AUTHORITY: "NomusPurchaseOrderSupplierEvaluation + motor OP-26 (supplierPerformance.ts)",
};

export function buildSupplierPerformanceDashboard(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters,
  options: { rankingLimit?: number; paretoLimit?: number } = {}
): SupplierPerformanceDashboardReadModel {
  const rankingLimit = Math.max(1, options.rankingLimit ?? DASHBOARD_RANKING_LIMIT_DEFAULT);
  const population = buildSupplierPerformanceDashboardPopulation(input, filters);
  const agg = aggregate(population);

  const concentrationRows = [...agg.materials.values()].map((material) =>
    buildMaterialConcentrationRow(material, agg.suppliers)
  );
  const concentrationByMaterial = new Map(concentrationRows.map((row) => [row.materialKey, row]));

  const supplierRows = [...agg.suppliers.values()]
    .map((supplier) => supplierRowFromAgg(supplier, agg.totalSpend, agg.materials, concentrationByMaterial, population.evaluationEnabled))
    .sort((a, b) => b.spend - a.spend || tieBreak(a, b));

  const bySpend = supplierRows;
  const activeSuppliers = supplierRows.length;
  const materialMixCount = agg.materials.size;
  const singleSource = concentrationRows.filter((row) => row.supplierCountObserved === 1).length;
  const dualSource = concentrationRows.filter((row) => row.supplierCountObserved >= 2).length;
  const withIdentified = concentrationRows.filter((row) => row.supplierCountObserved >= 1);

  const kpis: SupplierPerformanceDashboardReadModel["kpis"] = {
    totalSpend: roundMoney(agg.totalSpend),
    activeSuppliers,
    purchaseOrderCount: agg.orderCount,
    purchaseLineCount: agg.lineCount,
    averageTicket: agg.orderCount > 0 ? roundMoney(agg.totalSpend / agg.orderCount) : null,
    materialMixCount,
    averageSupplierMix:
      activeSuppliers > 0 ? roundRatio(supplierRows.reduce((sum, row) => sum + row.mixCount, 0) / activeSuppliers) : null,
    evaluationScore: null,
    evaluationScaleMax: null,
    evaluationCoverage: null,
    evaluatedOrders: 0,
    eligibleOrders: agg.orderCount,
    top1Concentration: concentrationTopN(bySpend, 1, agg.totalSpend),
    top3Concentration: concentrationTopN(bySpend, 3, agg.totalSpend),
    top5Concentration: concentrationTopN(bySpend, 5, agg.totalSpend),
    singleSourceObservedCount: singleSource,
    singleSourceObservedRate: materialMixCount > 0 ? roundRatio(singleSource / materialMixCount) : null,
    dualSourceObservedCount: dualSource,
    dualSourceObservedRate: materialMixCount > 0 ? roundRatio(dualSource / materialMixCount) : null,
    materialsWithoutIdentifiedSupplier: materialMixCount - withIdentified.length,
    averageSuppliersPerMaterial:
      withIdentified.length > 0
        ? roundRatio(withIdentified.reduce((sum, row) => sum + row.supplierCountObserved, 0) / withIdentified.length)
        : null,
  };

  const evaluation = buildEvaluationSection(population, supplierRows);
  if (evaluation.available) {
    kpis.evaluationScore = evaluation.summary.overallScore;
    kpis.evaluationScaleMax = evaluation.scaleMax;
    kpis.evaluationCoverage = evaluation.summary.coverage;
    kpis.evaluatedOrders = evaluation.summary.evaluatedOrders;
    kpis.eligibleOrders = evaluation.summary.eligibleOrders;
  }

  const v2Rows = supplierRows.filter(isV2Comparable);
  const v1Rows = supplierRows.filter(isV1Only);
  const scoreOf = (row: DashboardSupplierRow) => row.evaluation?.summary.overallScore ?? null;

  const byCriterion = {} as Record<SupplierEvaluationCriterionKey, DashboardRankedSupplierRow[]>;
  for (const criterion of SUPPLIER_EVALUATION_CRITERIA) {
    byCriterion[criterion.key] = rank(
      sortDescBy(v2Rows, (row) => (row.evaluation?.summary[CRITERION_FIELD[criterion.key]] as number | null) ?? null),
      rankingLimit
    );
  }

  const pareto = buildParetoRows(supplierRows, agg.unresolvedSupplier, agg.totalSpend);
  const dispersion = buildDispersionRows(agg.materials, agg.suppliers, population.currency.selected);
  const increases = buildPriceChangeRows(agg.materials, agg.suppliers, population.currency.selected).filter(
    (row) => row.changeAbsolute > 0
  );

  const materialSortByShare = (a: DashboardMaterialConcentrationRow, b: DashboardMaterialConcentrationRow) =>
    (b.dominant?.share ?? -1) - (a.dominant?.share ?? -1) ||
    b.spend - a.spend ||
    comparePtBr(a.productCode, b.productCode) ||
    a.materialKey.localeCompare(b.materialKey);
  const materialSortBySpend = (a: DashboardMaterialConcentrationRow, b: DashboardMaterialConcentrationRow) =>
    b.spend - a.spend ||
    b.orderCount - a.orderCount ||
    comparePtBr(a.productCode, b.productCode) ||
    a.materialKey.localeCompare(b.materialKey);

  const groups = new Map<string, number>();
  for (const order of population.baseOrders) {
    for (const line of order.lines) {
      if (!line.group) continue;
      groups.set(line.group, (groups.get(line.group) ?? 0) + 1);
    }
  }
  const supplierOptions = new Map<number, { supplierExternalId: number; name: string; orderCount: number }>();
  for (const order of population.baseOrders) {
    if (order.supplierKey == null) continue;
    const identity = population.identities.get(order.supplierKey);
    const entry = supplierOptions.get(order.supplierKey) ?? {
      supplierExternalId: order.supplierKey,
      name: resolveSupplierDisplayName(order.supplierKey, identity, order),
      orderCount: 0,
    };
    entry.orderCount += 1;
    supplierOptions.set(order.supplierKey, entry);
  }

  let headerSpendTotal = 0;
  let lineSpendTotal = 0;
  for (const order of population.orders) {
    headerSpendTotal += order.headerTotal ?? 0;
    lineSpendTotal += sumLineTotals(order.lines).total;
  }

  return {
    metadata: {
      version: SUPPLIER_PERFORMANCE_DASHBOARD_VERSION,
      generatedAt: population.now.toISOString(),
      lastSyncedAt: population.lastSyncedAt ? population.lastSyncedAt.toISOString() : null,
      period: filters.period,
      filters,
      spendBasis: population.spendBasis,
      currency: population.currency,
      population: {
        orderCount: agg.orderCount,
        lineCount: agg.lineCount,
        supplierCount: activeSuppliers,
        materialCount: materialMixCount,
        canceledExcluded: population.excluded.canceled,
        otherCurrencyExcluded: population.excluded.otherCurrency,
        outsidePeriodExcluded: population.excluded.outsidePeriod,
        noMatchingLineExcluded: population.excluded.noMatchingLine,
        unresolvedSupplierOrders: agg.unresolvedSupplier.orderCount,
        unresolvedSupplierSpend: roundMoney(agg.unresolvedSupplier.spend),
        unresolvedMaterialLines: population.unresolvedMaterialLineCount,
        linesWithoutValue: population.linesWithoutValueCount,
        ordersWithoutValue: population.ordersWithoutValueCount,
        headerSpendTotal: roundMoney(headerSpendTotal),
        lineSpendTotal: roundMoney(lineSpendTotal),
      },
      authorities: SUPPLIER_PERFORMANCE_DASHBOARD_AUTHORITIES,
      eligibilityRule: {
        status: "BLOCKED_BY_BUSINESS_RULE",
        applied: filters.includeCanceled
          ? "Toda a base do espelho (inclui cancelados) — mesma elegibilidade da Avaliação Fornecedor."
          : "Pedidos não cancelados (canceled ≠ true e fase ≠ CANCELED) — predicado oficial de Pedidos Nomus.",
        note:
          "O domínio atual não define 'pedido válido para compra'. O tratamento de cancelados é uma decisão de negócio pendente; o filtro é explícito e a quantidade excluída está em metadata.population.canceledExcluded.",
      },
      availableYears: population.availableYears,
      kpiDefinitions: buildDashboardKpiDefinitions(population),
    },
    filterOptions: {
      suppliers: [...supplierOptions.values()].sort((a, b) => comparePtBr(a.name, b.name) || a.supplierExternalId - b.supplierExternalId),
      materialGroups: [...groups.entries()].map(([group, lineCount]) => ({ group, lineCount })).sort((a, b) => comparePtBr(a.group, b.group)),
      currencies: population.currency.available,
    },
    kpis,
    suppliers: supplierRows,
    rankings: {
      bestEvaluated: rank(sortDescBy(v2Rows, scoreOf), rankingLimit),
      legacyEvaluated: rank(sortDescBy(v1Rows, scoreOf), rankingLimit),
      lowestEvaluated: rank(sortAscBy(v2Rows, scoreOf), rankingLimit),
      byCriterion,
      topSpend: rank(bySpend, rankingLimit),
      topOrderCount: rank(
        supplierRows.slice().sort((a, b) => b.orderCount - a.orderCount || tieBreak(a, b)),
        rankingLimit
      ),
      topMix: rank(
        supplierRows.slice().sort((a, b) => b.mixCount - a.mixCount || tieBreak(a, b)),
        rankingLimit
      ),
      limit: rankingLimit,
    },
    concentration: {
      pareto: pareto.slice(0, Math.max(1, options.paretoLimit ?? DASHBOARD_PARETO_LIMIT_MAX)),
      mostConcentratedMaterials: concentrationRows
        .filter((row) => row.supplierCountObserved >= 1)
        .sort(materialSortByShare)
        .slice(0, rankingLimit),
      dominantSupplierByMaterial: concentrationRows
        .filter((row) => row.supplierCountObserved >= 1)
        .sort(materialSortBySpend)
        .slice(0, rankingLimit),
      singleSourceMaterials: concentrationRows
        .filter((row) => row.singleSourceObserved)
        .sort(materialSortBySpend)
        .slice(0, rankingLimit),
    },
    charts: {
      monthly: buildMonthlySeries(population),
      spendBySupplier: pareto.filter((row) => !row.unresolved).slice(0, rankingLimit),
    },
    pricing: {
      dispersion: dispersion.rows.slice(0, rankingLimit),
      increases: increases.slice(0, rankingLimit),
      materialsWithComparablePrices: dispersion.comparable,
      materialsWithMixedUnits: dispersion.mixedUnits,
    },
    evaluation,
    advancedMetrics: buildAdvancedMetricsRegistry({
      orders: population.orders,
      suppliers: [...agg.suppliers.values()],
      now: population.now,
      kpis,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Matriz fornecedor × matéria-prima (paginada no servidor)
 * ------------------------------------------------------------------ */

export type DashboardSupplierMaterialRow = {
  materialKey: DashboardMaterialKey;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  group: string | null;
  supplierExternalId: number | null;
  supplierName: string;
  spend: number;
  shareOfMaterial: number | null;
  shareOfSupplier: number | null;
  orderCount: number;
  lineCount: number;
  quantity: number | null;
  unit: string | null;
  unitsObserved: string[];
  weightedAveragePrice: number | null;
  lastPrice: number | null;
  /** Data da linha que originou lastPrice (pode ser anterior à última compra). */
  lastPriceDate: string | null;
  lastPurchaseDate: string | null;
  lastOrderNumber: string | null;
  supplierCountObserved: number;
  singleSourceObserved: boolean;
};

export const SUPPLIER_MATERIAL_MATRIX_SORTS = [
  "spend",
  "shareOfMaterial",
  "orderCount",
  "lineCount",
  "lastPurchaseDate",
  "material",
  "supplier",
  "weightedAveragePrice",
] as const;
export type SupplierMaterialMatrixSort = (typeof SUPPLIER_MATERIAL_MATRIX_SORTS)[number];

export type SupplierMaterialMatrixQuery = {
  search: string | null;
  sort: SupplierMaterialMatrixSort;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
};

export function parseSupplierMaterialMatrixQuery(query: Record<string, unknown>): SupplierMaterialMatrixQuery {
  const search = firstQueryValue(query.search ?? query.q);
  const sortRaw = firstQueryValue(query.sort);
  if (sortRaw != null && !(SUPPLIER_MATERIAL_MATRIX_SORTS as readonly string[]).includes(sortRaw)) {
    throw invalidFilter("Ordenação inválida.", "sort");
  }
  const directionRaw = firstQueryValue(query.direction ?? query.dir);
  if (directionRaw != null && directionRaw !== "asc" && directionRaw !== "desc") {
    throw invalidFilter("Direção de ordenação inválida.", "direction");
  }
  const pageRaw = Number.parseInt(firstQueryValue(query.page) ?? "1", 10);
  const pageSizeRaw = Number.parseInt(firstQueryValue(query.pageSize) ?? String(DASHBOARD_MATRIX_PAGE_SIZE_DEFAULT), 10);
  return {
    search: search ? search.toLowerCase() : null,
    sort: (sortRaw as SupplierMaterialMatrixSort | null) ?? "spend",
    direction: (directionRaw as "asc" | "desc" | null) ?? (sortRaw === "material" || sortRaw === "supplier" ? "asc" : "desc"),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
    pageSize: Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? Math.min(DASHBOARD_MATRIX_PAGE_SIZE_MAX, pageSizeRaw) : DASHBOARD_MATRIX_PAGE_SIZE_DEFAULT,
  };
}

function pairToRow(
  material: MaterialAgg,
  pair: PairAgg,
  suppliers: Map<number, SupplierAgg>,
  concentration: DashboardMaterialConcentrationRow
): DashboardSupplierMaterialRow {
  const unit = singleUnit(pair.units);
  const supplier = pair.supplierKey != null ? suppliers.get(pair.supplierKey) : undefined;
  return {
    materialKey: material.key,
    productExternalId: material.productExternalId,
    productCode: material.productCode,
    description: material.description,
    group: material.group,
    supplierExternalId: pair.supplierKey,
    supplierName: materialSupplierName(pair.supplierKey, suppliers),
    spend: roundMoney(pair.spend),
    shareOfMaterial: material.spend > 0 ? roundRatio(pair.spend / material.spend) : null,
    shareOfSupplier: supplier && supplier.lineSpend > 0 ? roundRatio(pair.spend / supplier.lineSpend) : null,
    orderCount: pair.orderIds.size,
    lineCount: pair.lineCount,
    quantity: unit ? roundPrice(unit.quantity) : null,
    unit: unit ? unit.unit || null : null,
    unitsObserved: [...pair.units.keys()].map((u) => u || "—").sort(),
    weightedAveragePrice: unit ? weightedAveragePrice(unit) : null,
    lastPrice: pair.lastPriced?.price ?? null,
    lastPriceDate: pair.lastPriced ? pair.lastPriced.date.toISOString() : null,
    lastPurchaseDate: pair.last ? pair.last.date.toISOString() : null,
    lastOrderNumber: pair.last?.orderNumber ?? null,
    supplierCountObserved: concentration.supplierCountObserved,
    singleSourceObserved: concentration.singleSourceObserved,
  };
}

function compareMatrixRows(sort: SupplierMaterialMatrixSort, a: DashboardSupplierMaterialRow, b: DashboardSupplierMaterialRow): number {
  const num = (x: number | null) => (x == null ? -Infinity : x);
  switch (sort) {
    case "spend":
      return a.spend - b.spend;
    case "shareOfMaterial":
      return num(a.shareOfMaterial) - num(b.shareOfMaterial);
    case "orderCount":
      return a.orderCount - b.orderCount;
    case "lineCount":
      return a.lineCount - b.lineCount;
    case "weightedAveragePrice":
      return num(a.weightedAveragePrice) - num(b.weightedAveragePrice);
    case "lastPurchaseDate":
      return (a.lastPurchaseDate ?? "").localeCompare(b.lastPurchaseDate ?? "");
    case "material":
      return comparePtBr(a.productCode ?? a.description, b.productCode ?? b.description);
    case "supplier":
      return comparePtBr(a.supplierName, b.supplierName);
    default:
      return 0;
  }
}

export type SupplierMaterialMatrixResult = {
  page: number;
  pageSize: number;
  total: number;
  rows: DashboardSupplierMaterialRow[];
  totals: { spend: number; orderCount: number; lineCount: number; pairCount: number; materialCount: number; supplierCount: number };
  currency: string;
  spendBasis: DashboardSpendBasis;
};

export function buildSupplierMaterialMatrix(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters,
  query: SupplierMaterialMatrixQuery
): SupplierMaterialMatrixResult {
  const population = buildSupplierPerformanceDashboardPopulation(input, filters);
  const agg = aggregate(population);
  const rows: DashboardSupplierMaterialRow[] = [];
  for (const material of agg.materials.values()) {
    const concentration = buildMaterialConcentrationRow(material, agg.suppliers);
    for (const pair of material.pairs.values()) rows.push(pairToRow(material, pair, agg.suppliers, concentration));
  }
  const filtered = query.search
    ? rows.filter((row) =>
        [row.productCode, row.description, row.supplierName, row.group]
          .some((value) => (value ?? "").toLowerCase().includes(query.search as string))
      )
    : rows;
  const dir = query.direction === "asc" ? 1 : -1;
  filtered.sort(
    (a, b) =>
      dir * compareMatrixRows(query.sort, a, b) ||
      comparePtBr(a.productCode, b.productCode) ||
      a.materialKey.localeCompare(b.materialKey) ||
      comparePtBr(a.supplierName, b.supplierName) ||
      (a.supplierExternalId ?? 0) - (b.supplierExternalId ?? 0)
  );
  const orderIds = new Set<string>();
  const materialKeys = new Set<string>();
  const supplierKeys = new Set<number>();
  let spend = 0;
  let lineCount = 0;
  for (const row of filtered) {
    spend += row.spend;
    lineCount += row.lineCount;
    materialKeys.add(row.materialKey);
    if (row.supplierExternalId != null) supplierKeys.add(row.supplierExternalId);
  }
  for (const material of agg.materials.values()) {
    if (!materialKeys.has(material.key)) continue;
    for (const pair of material.pairs.values()) {
      if (query.search && !filtered.some((row) => row.materialKey === material.key && row.supplierExternalId === pair.supplierKey)) continue;
      for (const id of pair.orderIds) orderIds.add(id);
    }
  }
  const start = (query.page - 1) * query.pageSize;
  return {
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
    rows: filtered.slice(start, start + query.pageSize),
    totals: {
      spend: roundMoney(spend),
      orderCount: orderIds.size,
      lineCount,
      pairCount: filtered.length,
      materialCount: materialKeys.size,
      supplierCount: supplierKeys.size,
    },
    currency: population.currency.selected,
    spendBasis: population.spendBasis,
  };
}

/* ------------------------------------------------------------------ *
 * Scorecard 360º do fornecedor
 * ------------------------------------------------------------------ */

export type DashboardSupplierEvaluationHistoryRow = {
  nomusPurchaseOrderId: string;
  externalId: number;
  orderNumber: string | null;
  performanceDate: string;
  methodologyVersion: number;
  scaleMax: number;
  scores: { quality: number; delivery: number; conformity: number; service: number; overall: number };
  revision: number;
  updatedAt: string;
  updatedByUserName: string | null;
};

export type DashboardSupplierDetail = {
  supplier: DashboardSupplierRow;
  currency: string;
  spendBasis: DashboardSpendBasis;
  period: SupplierPerformancePeriod;
  purchases: {
    spend: number;
    share: number | null;
    orderCount: number;
    lineCount: number;
    averageTicket: number | null;
    mixCount: number;
    exclusiveMaterialCount: number;
    lineSpend: number;
    firstPurchaseDate: string | null;
    lastPurchaseDate: string | null;
    paymentTerms: Array<{ label: string; count: number }>;
  };
  evaluation:
    | { available: false; reason: string }
    | {
        available: true;
        current: DashboardSupplierEvaluationDto | null;
        history: DashboardSupplierEvaluationHistoryRow[];
        monthlyV2: Array<{ month: string; averageOverall: number | null; count: number }>;
        monthlyV1: Array<{ month: string; averageOverall: number | null; count: number }>;
        periodScoped: true;
      };
  materials: DashboardSupplierMaterialRow[];
  concentration: {
    singleSourceMaterials: DashboardSupplierMaterialRow[];
    dominantMaterials: DashboardSupplierMaterialRow[];
    maxMaterialShare: number | null;
  };
  monthly: Array<{ month: string; spend: number; orderCount: number; materialCount: number }>;
  advancedMetrics: AdvancedMetricEntry[];
};

export function buildSupplierPerformanceSupplierDetail(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters,
  supplierExternalId: number
): DashboardSupplierDetail | null {
  const scopedFilters: SupplierPerformanceDashboardFilters = { ...filters, supplierExternalId: null };
  const population = buildSupplierPerformanceDashboardPopulation(input, scopedFilters);
  const agg = aggregate(population);
  const supplierAgg = agg.suppliers.get(supplierExternalId);
  if (!supplierAgg) return null;

  const concentrationByMaterial = new Map<DashboardMaterialKey, DashboardMaterialConcentrationRow>();
  for (const material of agg.materials.values()) {
    concentrationByMaterial.set(material.key, buildMaterialConcentrationRow(material, agg.suppliers));
  }
  const supplier = supplierRowFromAgg(supplierAgg, agg.totalSpend, agg.materials, concentrationByMaterial, population.evaluationEnabled);

  const materials: DashboardSupplierMaterialRow[] = [];
  for (const materialKey of supplierAgg.materialKeys) {
    const material = agg.materials.get(materialKey);
    const pair = material?.pairs.get(supplierExternalId);
    const concentration = concentrationByMaterial.get(materialKey);
    if (!material || !pair || !concentration) continue;
    materials.push(pairToRow(material, pair, agg.suppliers, concentration));
  }
  materials.sort(
    (a, b) => b.spend - a.spend || b.orderCount - a.orderCount || comparePtBr(a.productCode, b.productCode) || a.materialKey.localeCompare(b.materialKey)
  );

  const dominantMaterials = materials.filter(
    (row) => concentrationByMaterial.get(row.materialKey)?.dominant?.supplierExternalId === supplierExternalId
  );

  const sortedOrders = supplierAgg.orders.slice().sort((a, b) => a.performanceDate.getTime() - b.performanceDate.getTime() || a.externalId - b.externalId);
  const monthly = monthRange(population, supplierAgg.orders.map((order) => order.monthKey)).map((month) => {
    const entry = supplierAgg.monthly.get(month);
    return {
      month,
      spend: roundMoney(entry?.spend ?? 0),
      orderCount: entry?.orderCount ?? 0,
      materialCount: entry?.materialKeys.size ?? 0,
    };
  });

  let evaluation: DashboardSupplierDetail["evaluation"];
  if (!population.evaluationEnabled) {
    evaluation = {
      available: false,
      reason: "Avaliação de fornecedor desligada neste ambiente (SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED).",
    };
  } else {
    const history: DashboardSupplierEvaluationHistoryRow[] = [];
    const monthlyV2 = new Map<string, number[]>();
    const monthlyV1 = new Map<string, number[]>();
    for (const order of sortedOrders) {
      if (!order.evaluation) continue;
      const methodology = getSupplierEvaluationMethodology(order.evaluation.methodologyVersion);
      history.push({
        nomusPurchaseOrderId: order.id,
        externalId: order.externalId,
        orderNumber: order.orderNumber,
        performanceDate: order.performanceDate.toISOString(),
        methodologyVersion: order.evaluation.methodologyVersion,
        scaleMax: methodology.scaleMax,
        scores: {
          quality: order.evaluation.qualityScore,
          delivery: order.evaluation.deliveryScore,
          conformity: order.evaluation.conformityScore,
          service: order.evaluation.serviceScore,
          overall: order.evaluation.overallScore,
        },
        revision: order.evaluation.revision,
        updatedAt: order.evaluation.updatedAt.toISOString(),
        updatedByUserName: order.evaluation.updatedByUserName,
      });
      const bucket = order.evaluation.methodologyVersion === SUPPLIER_EVALUATION_METHODOLOGY_V1 ? monthlyV1 : monthlyV2;
      const list = bucket.get(order.monthKey) ?? [];
      list.push(order.evaluation.overallScore);
      bucket.set(order.monthKey, list);
    }
    history.reverse();
    const toMonthly = (bucket: Map<string, number[]>) =>
      [...bucket.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, scores]) => ({ month, averageOverall: averageScoreOrNull(scores), count: scores.length }));
    evaluation = {
      available: true,
      current: supplier.evaluation,
      history,
      monthlyV2: toMonthly(monthlyV2),
      monthlyV1: toMonthly(monthlyV1),
      periodScoped: true,
    };
  }

  const first = sortedOrders[0] ?? null;
  const last = sortedOrders[sortedOrders.length - 1] ?? null;

  return {
    supplier,
    currency: population.currency.selected,
    spendBasis: population.spendBasis,
    period: filters.period,
    purchases: {
      spend: supplier.spend,
      share: supplier.share,
      orderCount: supplier.orderCount,
      lineCount: supplier.lineCount,
      averageTicket: supplier.averageTicket,
      mixCount: supplier.mixCount,
      exclusiveMaterialCount: supplier.exclusiveMaterialCount,
      lineSpend: roundMoney(supplierAgg.lineSpend),
      firstPurchaseDate: first ? first.performanceDate.toISOString() : null,
      lastPurchaseDate: last ? last.performanceDate.toISOString() : null,
      paymentTerms: [...supplierAgg.paymentTerms.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, count]) => ({ label, count })),
    },
    evaluation,
    materials,
    concentration: {
      singleSourceMaterials: materials.filter((row) => row.singleSourceObserved),
      dominantMaterials,
      maxMaterialShare: supplier.maxMaterialShare,
    },
    monthly,
    advancedMetrics: buildAdvancedMetricsRegistry({
      orders: supplierAgg.orders,
      suppliers: [supplierAgg],
      now: population.now,
      kpis: null,
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Detalhe da matéria-prima (fornecedores, preço, evolução)
 * ------------------------------------------------------------------ */

export type DashboardMaterialSupplierRow = DashboardSupplierMaterialRow & {
  evaluation: DashboardSupplierEvaluationDto | null;
};

export type DashboardPriceSeries = {
  supplierExternalId: number | null;
  supplierName: string;
  unit: string | null;
  currency: string;
  points: Array<{ month: string; weightedAveragePrice: number; valuedQuantity: number; valuedSpend: number; lineCount: number }>;
};

export type DashboardMaterialDetail = {
  material: {
    materialKey: DashboardMaterialKey;
    productExternalId: number | null;
    productCode: string | null;
    description: string | null;
    group: string | null;
    unitsObserved: string[];
  };
  currency: string;
  period: SupplierPerformancePeriod;
  totals: { spend: number; orderCount: number; lineCount: number; supplierCountObserved: number; singleSourceObserved: boolean; quantity: number | null; unit: string | null };
  concentration: DashboardMaterialConcentrationRow;
  suppliers: DashboardMaterialSupplierRow[];
  priceEvolution: DashboardPriceSeries[];
  dispersion: DashboardPriceDispersionRow[];
  monthly: Array<{ month: string; spend: number; orderCount: number; lineCount: number }>;
};

export function buildSupplierPerformanceMaterialDetail(
  input: SupplierPerformanceDashboardInput,
  filters: SupplierPerformanceDashboardFilters,
  materialKey: DashboardMaterialKey
): DashboardMaterialDetail | null {
  const scopedFilters: SupplierPerformanceDashboardFilters = { ...filters, materialKey: null, materialGroup: null };
  const population = buildSupplierPerformanceDashboardPopulation(input, scopedFilters);
  const agg = aggregate(population);
  const material = agg.materials.get(materialKey);
  if (!material) return null;

  const concentrationByMaterial = new Map<DashboardMaterialKey, DashboardMaterialConcentrationRow>();
  for (const row of agg.materials.values()) concentrationByMaterial.set(row.key, buildMaterialConcentrationRow(row, agg.suppliers));
  const concentration = concentrationByMaterial.get(materialKey)!;

  const suppliers: DashboardMaterialSupplierRow[] = [];
  const priceEvolution: DashboardPriceSeries[] = [];
  const monthly = new Map<string, { spend: number; orderIds: Set<string>; lineCount: number }>();
  for (const pair of material.pairs.values()) {
    const supplierAgg = pair.supplierKey != null ? agg.suppliers.get(pair.supplierKey) : undefined;
    const supplierRow = supplierAgg
      ? supplierRowFromAgg(supplierAgg, agg.totalSpend, agg.materials, concentrationByMaterial, population.evaluationEnabled)
      : null;
    suppliers.push({
      ...pairToRow(material, pair, agg.suppliers, concentration),
      evaluation: supplierRow?.evaluation ?? null,
    });
    for (const unitAgg of pair.units.values()) {
      const points = [...unitAgg.monthly.entries()]
        .filter(([, value]) => value.valuedQuantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({
          month,
          weightedAveragePrice: roundPrice(value.valuedSpend / value.valuedQuantity),
          valuedQuantity: roundPrice(value.valuedQuantity),
          valuedSpend: roundMoney(value.valuedSpend),
          lineCount: value.lineCount,
        }));
      if (points.length === 0) continue;
      priceEvolution.push({
        supplierExternalId: pair.supplierKey,
        supplierName: materialSupplierName(pair.supplierKey, agg.suppliers),
        unit: unitAgg.unit || null,
        currency: population.currency.selected,
        points,
      });
    }
  }
  for (const order of population.orders) {
    for (const line of order.lines) {
      if (line.materialKey !== materialKey) continue;
      const entry = monthly.get(order.monthKey) ?? { spend: 0, orderIds: new Set<string>(), lineCount: 0 };
      entry.spend += line.lineTotal ?? 0;
      entry.orderIds.add(order.id);
      entry.lineCount += 1;
      monthly.set(order.monthKey, entry);
    }
  }
  suppliers.sort(
    (a, b) => b.spend - a.spend || b.orderCount - a.orderCount || comparePtBr(a.supplierName, b.supplierName) || (a.supplierExternalId ?? 0) - (b.supplierExternalId ?? 0)
  );
  priceEvolution.sort((a, b) => comparePtBr(a.supplierName, b.supplierName) || (a.unit ?? "").localeCompare(b.unit ?? ""));

  const singleMaterialMap = new Map<DashboardMaterialKey, MaterialAgg>([[materialKey, material]]);
  const dispersion = buildDispersionRows(singleMaterialMap, agg.suppliers, population.currency.selected).rows;
  const units = [...material.units].sort();
  let quantity: number | null = null;
  if (units.length === 1) {
    quantity = 0;
    for (const pair of material.pairs.values()) {
      for (const unitAgg of pair.units.values()) quantity += unitAgg.quantity;
    }
    quantity = roundPrice(quantity);
  }

  return {
    material: {
      materialKey,
      productExternalId: material.productExternalId,
      productCode: material.productCode,
      description: material.description,
      group: material.group,
      unitsObserved: units,
    },
    currency: population.currency.selected,
    period: filters.period,
    totals: {
      spend: roundMoney(material.spend),
      orderCount: material.orderIds.size,
      lineCount: material.lineCount,
      supplierCountObserved: concentration.supplierCountObserved,
      singleSourceObserved: concentration.singleSourceObserved,
      quantity,
      unit: units.length === 1 ? units[0]! : null,
    },
    concentration,
    suppliers,
    priceEvolution,
    dispersion,
    monthly: monthRange(population, [...monthly.keys()]).map((month) => {
      const entry = monthly.get(month);
      return { month, spend: roundMoney(entry?.spend ?? 0), orderCount: entry?.orderIds.size ?? 0, lineCount: entry?.lineCount ?? 0 };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Busca de materiais (opções de filtro) — identidade oficial, sem fuzzy
 * ------------------------------------------------------------------ */

export type DashboardMaterialOption = {
  materialKey: DashboardMaterialKey;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  lineCount: number;
};

export function buildDashboardMaterialOptions(
  lines: readonly Pick<DashboardLineInput, "productExternalId" | "productCode" | "description">[],
  limit = 20
): DashboardMaterialOption[] {
  const map = new Map<string, DashboardMaterialOption>();
  for (const line of lines) {
    const key = resolveDashboardMaterialKey(line);
    if (!key) continue;
    const entry = map.get(key) ?? {
      materialKey: key,
      productExternalId: line.productExternalId,
      productCode: line.productCode,
      description: line.description,
      lineCount: 0,
    };
    entry.lineCount += 1;
    if (!entry.productCode && line.productCode) entry.productCode = line.productCode;
    if (!entry.description && line.description) entry.description = line.description;
    map.set(key, entry);
  }
  return [...map.values()]
    .sort((a, b) => b.lineCount - a.lineCount || comparePtBr(a.productCode, b.productCode) || a.materialKey.localeCompare(b.materialKey))
    .slice(0, limit);
}
