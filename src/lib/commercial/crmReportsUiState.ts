/**
 * CRM > Relatórios — estado da tela e montagem dos requests (módulo puro).
 *
 * A UI só ESCOLHE filtros, visões e página; todo número vem do backend
 * (universo, cards, totais das listas, relatório personalizado). Aqui não há
 * cálculo de recompra, de janela nem de total: os cards apenas selecionam a
 * visão correspondente, que o backend já reconcilia com o próprio card.
 */

import {
  CRM_CUSTOM_REPORT_CUSTOMER_STATUSES,
  CRM_CUSTOM_REPORT_DIMENSIONS,
  CRM_CUSTOM_REPORT_MAX_DIMENSIONS,
  CRM_CUSTOM_REPORT_METRICS,
  CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT,
  CRM_REPORTS_CUSTOMER_SELECTION_MODES,
  CRM_REPORTS_LIST_KEYS,
  CRM_REPORTS_MAX_SELECTION_IDS,
  CRM_REPORTS_OVERDUE_SEVERITIES,
  CRM_REPORTS_OVERDUE_SORTS,
  CRM_REPURCHASE_STATUSES,
  type CrmCustomReportCustomerStatus,
  type CrmCustomReportDimension,
  type CrmCustomReportMetric,
  type CrmCustomReportRequest,
  type CrmCustomReportSortDirection,
  type CrmCustomReportSortKey,
  type CrmReportsCustomerIdentity,
  type CrmReportsCustomerOption,
  type CrmReportsCustomerSelection,
  type CrmReportsCustomerSelectionMode,
  type CrmReportsFilters,
  type CrmReportsIndicators,
  type CrmReportsListKey,
  type CrmReportsNormalizedViews,
  type CrmReportsOperationalRequest,
  type CrmReportsWindows,
  type CrmRepurchaseStatus,
} from "@/src/lib/commercial/crmReportsTypes";
import {
  CRM_CUSTOM_REPORT_WITHOUT_PURCHASE_ORDER_DIM_REASON,
  describeCrmCustomReportMetricAvailability,
  isCrmCustomReportOrderDimension,
} from "@/src/lib/commercial/crmCustomReportContract";
import { formatCrmReportsCustomerSublabel } from "@/src/lib/commercial/crmReportsFormat";

// ---------------------------------------------------------------------------
// Estado das listas
// ---------------------------------------------------------------------------

export type CrmReportsCustomerChip = { id: string; label: string; sublabel: string | null };

/** Responsável Comercial escolhido (eixo carteira) — payload pronto do filter-options. */
export type CrmReportsOwnerChoice = {
  key: string;
  label: string;
  filter: { sellerIdentityKey?: string; externalSellerId?: number };
};

/** Vendedor do último pedido escolhido (eixo Nomus — auditoria/filtro). */
export type CrmReportsSellerChoice = { sellerKey: string; label: string };

export type CrmReportsUiFilters = {
  /** Filtro de inclusão "Cliente". */
  customers: CrmReportsCustomerChip[];
  commercialOwner: CrmReportsOwnerChoice | null;
  lastOrderSeller: CrmReportsSellerChoice | null;
  city: string | null;
  state: string | null;
};

/** "Ocultar clientes": modo + clientes marcados (rótulos para os chips). */
export type CrmReportsUiSelection = {
  mode: CrmReportsCustomerSelectionMode;
  customers: CrmReportsCustomerChip[];
};

export type CrmReportsUiState = {
  filters: CrmReportsUiFilters;
  selection: CrmReportsUiSelection;
  views: CrmReportsNormalizedViews;
  offsets: Record<CrmReportsListKey, number>;
  pageSize: number;
};

export const CRM_REPORTS_UI_PAGE_SIZES = [25, 50, 100] as const;
export const CRM_REPORTS_UI_DEFAULT_PAGE_SIZE = 25;

const ZERO_OFFSETS: Record<CrmReportsListKey, number> = { recent: 0, cadence: 0, overdue: 0 };

export const CRM_REPORTS_UI_DEFAULT_VIEWS: CrmReportsNormalizedViews = {
  cadence: { statuses: [] },
  overdue: { severity: "ALL", sort: "DELAY_DESC" },
};

export function createDefaultCrmReportsUiState(): CrmReportsUiState {
  return {
    filters: { customers: [], commercialOwner: null, lastOrderSeller: null, city: null, state: null },
    selection: { mode: "ALL", customers: [] },
    views: {
      cadence: { statuses: [] },
      overdue: { ...CRM_REPORTS_UI_DEFAULT_VIEWS.overdue },
    },
    offsets: { ...ZERO_OFFSETS },
    pageSize: CRM_REPORTS_UI_DEFAULT_PAGE_SIZE,
  };
}

/** Seleção efetiva enviada: EXCLUDE/ONLY sem nenhum cliente não recorta nada. */
export function effectiveCrmReportsSelection(selection: CrmReportsUiSelection): CrmReportsCustomerSelection {
  if (selection.mode === "ALL" || selection.customers.length === 0) return { mode: "ALL", customerIds: [] };
  return { mode: selection.mode, customerIds: selection.customers.map((c) => c.id) };
}

/** Filtros globais no vocabulário do backend (mesmo corpo para tela, personalizado e exportação). */
export function buildCrmReportsFiltersPayload(
  state: Pick<CrmReportsUiState, "filters" | "selection">
): CrmReportsFilters {
  const { filters } = state;
  return {
    customerIds: filters.customers.map((c) => c.id),
    commercialOwner: filters.commercialOwner ? { ...filters.commercialOwner.filter } : null,
    lastOrderSeller: filters.lastOrderSeller ? { sellerKey: filters.lastOrderSeller.sellerKey } : null,
    city: filters.city ? [filters.city] : [],
    state: filters.state ? [filters.state] : [],
    customerSelection: effectiveCrmReportsSelection(state.selection),
  };
}

/** POST /api/crm/reports/operational — filtros + visões + página de cada lista. */
export function buildCrmReportsOperationalRequest(state: CrmReportsUiState): CrmReportsOperationalRequest {
  const pagination: NonNullable<CrmReportsOperationalRequest["pagination"]> = {};
  for (const list of CRM_REPORTS_LIST_KEYS) {
    pagination[list] = { limit: state.pageSize, offset: state.offsets[list] };
  }
  return {
    filters: buildCrmReportsFiltersPayload(state),
    views: {
      cadence: { statuses: [...state.views.cadence.statuses] },
      overdue: { severity: state.views.overdue.severity, sort: state.views.overdue.sort },
    },
    pagination,
  };
}

export function hasActiveCrmReportsFilters(state: Pick<CrmReportsUiState, "filters" | "selection">): boolean {
  const { filters } = state;
  return (
    filters.customers.length > 0 ||
    filters.commercialOwner != null ||
    filters.lastOrderSeller != null ||
    filters.city != null ||
    filters.state != null ||
    effectiveCrmReportsSelection(state.selection).mode !== "ALL"
  );
}

/** Qualquer mudança de filtro volta todas as listas para a 1ª página. */
export function withCrmReportsFilters(state: CrmReportsUiState, patch: Partial<CrmReportsUiFilters>): CrmReportsUiState {
  return { ...state, filters: { ...state.filters, ...patch }, offsets: { ...ZERO_OFFSETS } };
}

export function withCrmReportsSelection(state: CrmReportsUiState, selection: CrmReportsUiSelection): CrmReportsUiState {
  return { ...state, selection, offsets: { ...ZERO_OFFSETS } };
}

export function withCrmReportsCadenceStatuses(
  state: CrmReportsUiState,
  statuses: readonly CrmRepurchaseStatus[]
): CrmReportsUiState {
  const ordered = CRM_REPURCHASE_STATUSES.filter((s) => statuses.includes(s));
  return {
    ...state,
    views: { ...state.views, cadence: { statuses: ordered } },
    offsets: { ...state.offsets, cadence: 0 },
  };
}

export function withCrmReportsOverdueView(
  state: CrmReportsUiState,
  patch: Partial<CrmReportsNormalizedViews["overdue"]>
): CrmReportsUiState {
  return {
    ...state,
    views: { ...state.views, overdue: { ...state.views.overdue, ...patch } },
    offsets: { ...state.offsets, overdue: 0 },
  };
}

export function withCrmReportsOffset(state: CrmReportsUiState, list: CrmReportsListKey, offset: number): CrmReportsUiState {
  return { ...state, offsets: { ...state.offsets, [list]: Math.max(0, Math.trunc(offset)) } };
}

export function withCrmReportsPageSize(state: CrmReportsUiState, pageSize: number): CrmReportsUiState {
  const valid = (CRM_REPORTS_UI_PAGE_SIZES as readonly number[]).includes(pageSize)
    ? pageSize
    : CRM_REPORTS_UI_DEFAULT_PAGE_SIZE;
  return { ...state, pageSize: valid, offsets: { ...ZERO_OFFSETS } };
}

/** Limpa filtros, seleção e visões (mantém o tamanho de página). */
export function clearCrmReportsFilters(state: CrmReportsUiState): CrmReportsUiState {
  return { ...createDefaultCrmReportsUiState(), pageSize: state.pageSize };
}

// ---------------------------------------------------------------------------
// Cards — só selecionam a visão; o número é do backend (indicators)
// ---------------------------------------------------------------------------

export type CrmReportsCardKey =
  | "purchased60d"
  | "dueNext15d"
  | "overdue"
  | "severelyOverdue"
  | "insufficientCadence";

export type CrmReportsCardTone = "positive" | "info" | "warning" | "danger" | "muted";

export type CrmReportsCardDefinition = {
  key: CrmReportsCardKey;
  label: string;
  description: string;
  indicator: keyof CrmReportsIndicators;
  target: CrmReportsListKey;
  tone: CrmReportsCardTone;
};

export const CRM_REPORTS_CARDS: readonly CrmReportsCardDefinition[] = [
  {
    key: "purchased60d",
    label: "Compraram nos últimos 60 dias",
    description: "Última compra (Pedido de Venda) nos últimos 60 dias.",
    indicator: "customersPurchased60d",
    target: "recent",
    tone: "positive",
  },
  {
    key: "dueNext15d",
    label: "Recompra nos próximos 15 dias",
    description: "Data esperada de recompra entre hoje e os próximos 15 dias.",
    indicator: "repurchaseDueNext15d",
    target: "cadence",
    tone: "info",
  },
  {
    key: "overdue",
    label: "Recompra atrasada",
    description: "Passou da data esperada de recompra.",
    indicator: "overdueRepurchase",
    target: "overdue",
    tone: "warning",
  },
  {
    key: "severelyOverdue",
    label: "Atrasados > 30 dias",
    description: "Mais de 30 dias depois da data esperada.",
    indicator: "severelyOverdueRepurchase",
    target: "overdue",
    tone: "danger",
  },
  {
    key: "insufficientCadence",
    label: "Sem cadência suficiente",
    description: "Uma única ocasião de compra — sem intervalo para prever.",
    indicator: "insufficientCadence",
    target: "cadence",
    tone: "muted",
  },
];

/**
 * Clique no card → visão da lista correspondente (sem cálculo novo). O
 * backend garante que a lista filtrada tem exatamente o número do card.
 */
export function applyCrmReportsCard(
  state: CrmReportsUiState,
  key: CrmReportsCardKey
): { state: CrmReportsUiState; target: CrmReportsListKey } {
  switch (key) {
    case "purchased60d":
      return { state: withCrmReportsOffset(state, "recent", 0), target: "recent" };
    case "dueNext15d":
      return { state: withCrmReportsCadenceStatuses(state, ["DUE_SOON"]), target: "cadence" };
    case "insufficientCadence":
      return { state: withCrmReportsCadenceStatuses(state, ["INSUFFICIENT_HISTORY"]), target: "cadence" };
    case "overdue":
      return { state: withCrmReportsOverdueView(state, { severity: "ALL" }), target: "overdue" };
    case "severelyOverdue":
      return { state: withCrmReportsOverdueView(state, { severity: "SEVERE" }), target: "overdue" };
  }
}

/** Card cuja visão está aplicada nas listas (destaque visual). */
export function activeCrmReportsCards(views: CrmReportsNormalizedViews): Set<CrmReportsCardKey> {
  const active = new Set<CrmReportsCardKey>();
  const statuses = views.cadence.statuses;
  if (statuses.length === 1 && statuses[0] === "DUE_SOON") active.add("dueNext15d");
  if (statuses.length === 1 && statuses[0] === "INSUFFICIENT_HISTORY") active.add("insufficientCadence");
  if (views.overdue.severity === "SEVERE") active.add("severelyOverdue");
  return active;
}

// ---------------------------------------------------------------------------
// Seleção de clientes (chips + marcação por linha)
// ---------------------------------------------------------------------------

export function crmReportsChipFromRow(row: CrmReportsCustomerIdentity): CrmReportsCustomerChip {
  return { id: row.customerId, label: row.displayName, sublabel: formatCrmReportsCustomerSublabel(row) || null };
}

export function crmReportsChipFromOption(option: CrmReportsCustomerOption): CrmReportsCustomerChip {
  return { id: option.id, label: option.displayName, sublabel: formatCrmReportsCustomerSublabel(option) || null };
}

function uniqueChips(chips: readonly CrmReportsCustomerChip[]): CrmReportsCustomerChip[] {
  const seen = new Set<string>();
  const out: CrmReportsCustomerChip[] = [];
  for (const chip of chips) {
    if (seen.has(chip.id)) continue;
    seen.add(chip.id);
    out.push(chip);
    if (out.length >= CRM_REPORTS_MAX_SELECTION_IDS) break;
  }
  return out;
}

export function toggleCrmReportsChecked(
  checked: ReadonlyMap<string, CrmReportsCustomerChip>,
  chip: CrmReportsCustomerChip
): Map<string, CrmReportsCustomerChip> {
  const next = new Map(checked);
  if (next.has(chip.id)) next.delete(chip.id);
  else next.set(chip.id, chip);
  return next;
}

export function setCrmReportsCheckedMany(
  checked: ReadonlyMap<string, CrmReportsCustomerChip>,
  chips: readonly CrmReportsCustomerChip[],
  on: boolean
): Map<string, CrmReportsCustomerChip> {
  const next = new Map(checked);
  for (const chip of chips) {
    if (on) next.set(chip.id, chip);
    else next.delete(chip.id);
  }
  return next;
}

/**
 * "Ocultar selecionados": vira EXCLUDE (somando aos já ocultados). No modo
 * "Somente selecionados", tira os marcados da lista mantida.
 */
export function hideCheckedCrmReportsCustomers(
  selection: CrmReportsUiSelection,
  checked: readonly CrmReportsCustomerChip[]
): CrmReportsUiSelection {
  const ids = new Set(checked.map((c) => c.id));
  if (selection.mode === "ONLY") {
    const remaining = selection.customers.filter((c) => !ids.has(c.id));
    if (remaining.length > 0) return { mode: "ONLY", customers: remaining };
    return { mode: "EXCLUDE", customers: uniqueChips(checked) };
  }
  const base = selection.mode === "EXCLUDE" ? selection.customers : [];
  return { mode: "EXCLUDE", customers: uniqueChips([...base, ...checked]) };
}

/** "Mostrar somente selecionados": vira ONLY com os marcados. */
export function showOnlyCheckedCrmReportsCustomers(checked: readonly CrmReportsCustomerChip[]): CrmReportsUiSelection {
  return { mode: "ONLY", customers: uniqueChips(checked) };
}

export function addCrmReportsSelectionCustomer(
  selection: CrmReportsUiSelection,
  chip: CrmReportsCustomerChip
): CrmReportsUiSelection {
  // Adicionar pela busca de "Ocultar clientes" parte do modo Excluir.
  const mode = selection.mode === "ALL" ? "EXCLUDE" : selection.mode;
  return { mode, customers: uniqueChips([...selection.customers, chip]) };
}

export function removeCrmReportsSelectionCustomer(selection: CrmReportsUiSelection, id: string): CrmReportsUiSelection {
  return { ...selection, customers: selection.customers.filter((c) => c.id !== id) };
}

// ---------------------------------------------------------------------------
// Persistência leve (sessionStorage) — volta do Cliente 360 com o mesmo recorte
// ---------------------------------------------------------------------------

export const CRM_REPORTS_UI_STORAGE_KEY = "crm.reports.ui.v1";

export function serializeCrmReportsUiState(state: CrmReportsUiState): string {
  return JSON.stringify({
    filters: state.filters,
    selection: state.selection,
    views: state.views,
    pageSize: state.pageSize,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseChips(value: unknown): CrmReportsCustomerChip[] {
  if (!Array.isArray(value)) return [];
  const chips: CrmReportsCustomerChip[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !UUID_RE.test(item.id)) continue;
    if (typeof item.label !== "string") continue;
    chips.push({ id: item.id, label: item.label, sublabel: typeof item.sublabel === "string" ? item.sublabel : null });
  }
  return uniqueChips(chips);
}

function parseOwner(value: unknown): CrmReportsOwnerChoice | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.label !== "string") return null;
  const filter = isRecord(value.filter) ? value.filter : null;
  if (!filter) return null;
  const out: CrmReportsOwnerChoice["filter"] = {};
  if (typeof filter.sellerIdentityKey === "string" && filter.sellerIdentityKey.trim()) {
    out.sellerIdentityKey = filter.sellerIdentityKey;
  }
  if (typeof filter.externalSellerId === "number" && Number.isInteger(filter.externalSellerId)) {
    out.externalSellerId = filter.externalSellerId;
  }
  return out.sellerIdentityKey || out.externalSellerId != null ? { key: value.key, label: value.label, filter: out } : null;
}

function parseSeller(value: unknown): CrmReportsSellerChoice | null {
  if (!isRecord(value) || typeof value.sellerKey !== "string" || typeof value.label !== "string") return null;
  return value.sellerKey.trim() ? { sellerKey: value.sellerKey, label: value.label } : null;
}

function parseText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Lê o estado salvo; qualquer campo inválido volta ao padrão (nunca quebra a tela). */
export function parseCrmReportsUiState(raw: string | null | undefined): CrmReportsUiState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const base = createDefaultCrmReportsUiState();
  const filters = isRecord(data.filters) ? data.filters : {};
  const selection = isRecord(data.selection) ? data.selection : {};
  const views = isRecord(data.views) ? data.views : {};
  const cadence = isRecord(views.cadence) ? views.cadence : {};
  const overdue = isRecord(views.overdue) ? views.overdue : {};

  const mode = (CRM_REPORTS_CUSTOMER_SELECTION_MODES as readonly unknown[]).includes(selection.mode)
    ? (selection.mode as CrmReportsCustomerSelectionMode)
    : "ALL";
  const statuses = Array.isArray(cadence.statuses)
    ? CRM_REPURCHASE_STATUSES.filter((s) => (cadence.statuses as unknown[]).includes(s))
    : [];
  const severity = (CRM_REPORTS_OVERDUE_SEVERITIES as readonly unknown[]).includes(overdue.severity)
    ? (overdue.severity as CrmReportsNormalizedViews["overdue"]["severity"])
    : base.views.overdue.severity;
  const sort = (CRM_REPORTS_OVERDUE_SORTS as readonly unknown[]).includes(overdue.sort)
    ? (overdue.sort as CrmReportsNormalizedViews["overdue"]["sort"])
    : base.views.overdue.sort;
  const pageSize = (CRM_REPORTS_UI_PAGE_SIZES as readonly unknown[]).includes(data.pageSize)
    ? (data.pageSize as number)
    : base.pageSize;

  return {
    filters: {
      customers: parseChips(filters.customers),
      commercialOwner: parseOwner(filters.commercialOwner),
      lastOrderSeller: parseSeller(filters.lastOrderSeller),
      city: parseText(filters.city),
      state: parseText(filters.state),
    },
    selection: { mode, customers: parseChips(selection.customers) },
    views: { cadence: { statuses }, overdue: { severity, sort } },
    offsets: { ...ZERO_OFFSETS },
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Construtor (relatório personalizado) — só monta o spec; executa ao clicar
// ---------------------------------------------------------------------------

export const CRM_REPORT_PERIOD_PRESETS = [
  "LAST_60_DAYS",
  "LAST_12_MONTHS",
  "CURRENT_YEAR",
  "PREVIOUS_YEAR",
  "FULL_HISTORY",
  "CUSTOM",
] as const;
export type CrmReportPeriodPreset = (typeof CRM_REPORT_PERIOD_PRESETS)[number];

export const CRM_REPORT_PERIOD_PRESET_LABELS: Record<CrmReportPeriodPreset, string> = {
  LAST_60_DAYS: "Últimos 60 dias",
  LAST_12_MONTHS: "Últimos 12 meses",
  CURRENT_YEAR: "Ano atual",
  PREVIOUS_YEAR: "Ano anterior",
  FULL_HISTORY: "Histórico inteiro",
  CUSTOM: "Período personalizado",
};

export type CrmReportBuilderState = {
  templateId: string | null;
  periodPreset: CrmReportPeriodPreset;
  customFrom: string;
  customTo: string;
  customerStatus: CrmCustomReportCustomerStatus;
  /** Na ordem escolhida (define as colunas). */
  dimensions: CrmCustomReportDimension[];
  metrics: CrmCustomReportMetric[];
  groupBy: CrmCustomReportDimension | null;
  /** `null` = padrão do backend (1ª métrica ↓, senão 1ª dimensão ↑). */
  sortBy: CrmCustomReportSortKey | null;
  sortDirection: CrmCustomReportSortDirection;
};

export function createEmptyCrmReportBuilderState(): CrmReportBuilderState {
  return {
    templateId: null,
    periodPreset: "LAST_12_MONTHS",
    customFrom: "",
    customTo: "",
    customerStatus: "ALL",
    dimensions: [],
    metrics: [],
    groupBy: null,
    sortBy: null,
    sortDirection: "desc",
  };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Período do spec a partir das janelas DO BACKEND (`windows`): nenhuma conta
 * de data no navegador. "Ano atual/anterior" só recortam o texto do dia.
 */
export function resolveCrmReportPeriod(
  builder: Pick<CrmReportBuilderState, "periodPreset" | "customFrom" | "customTo">,
  windows: CrmReportsWindows | null
): { ok: true; period: { from: string; to: string } | null } | { ok: false; error: string } {
  if (builder.periodPreset === "FULL_HISTORY") return { ok: true, period: null };
  if (builder.periodPreset === "CUSTOM") {
    const from = builder.customFrom.trim();
    const to = builder.customTo.trim();
    if (!YMD_RE.test(from) || !YMD_RE.test(to)) return { ok: false, error: "Informe as datas de início e fim do período." };
    if (from > to) return { ok: false, error: "A data inicial não pode ser depois da final." };
    return { ok: true, period: { from, to } };
  }
  if (!windows) return { ok: false, error: "Aguardando a data de referência do servidor." };
  switch (builder.periodPreset) {
    case "LAST_60_DAYS":
      return { ok: true, period: { from: windows.recent60d.from, to: windows.recent60d.to } };
    case "LAST_12_MONTHS":
      return { ok: true, period: { from: windows.rolling12m.from, to: windows.rolling12m.to } };
    case "CURRENT_YEAR":
      return { ok: true, period: { from: `${windows.today.slice(0, 4)}-01-01`, to: windows.today } };
    case "PREVIOUS_YEAR": {
      const year = String(Number(windows.today.slice(0, 4)) - 1);
      return { ok: true, period: { from: `${year}-01-01`, to: `${year}-12-31` } };
    }
  }
}

/** Disponibilidade da métrica para as dimensões escolhidas — mesmo contrato do backend. */
export function crmReportMetricAvailability(
  metric: CrmCustomReportMetric,
  dimensions: readonly CrmCustomReportDimension[]
): { available: boolean; reason: string | null } {
  return describeCrmCustomReportMetricAvailability(metric, dimensions);
}

/** Tira o que deixou de valer (métrica indisponível, agrupamento/ordenação órfãos). */
export function normalizeCrmReportBuilder(builder: CrmReportBuilderState): CrmReportBuilderState {
  const metrics = builder.metrics.filter((m) => crmReportMetricAvailability(m, builder.dimensions).available);
  // Subtotal por grupo só faz sentido com 2+ dimensões.
  const groupBy =
    builder.groupBy && builder.dimensions.length >= 2 && builder.dimensions.includes(builder.groupBy)
      ? builder.groupBy
      : null;
  const sortValid =
    builder.sortBy != null &&
    ((builder.dimensions as readonly string[]).includes(builder.sortBy) ||
      (metrics as readonly string[]).includes(builder.sortBy));
  return { ...builder, metrics, groupBy, sortBy: sortValid ? builder.sortBy : null };
}

export function toggleCrmReportDimension(
  builder: CrmReportBuilderState,
  dimension: CrmCustomReportDimension
): CrmReportBuilderState {
  const has = builder.dimensions.includes(dimension);
  if (!has && builder.dimensions.length >= CRM_CUSTOM_REPORT_MAX_DIMENSIONS) return builder;
  const dimensions = has ? builder.dimensions.filter((d) => d !== dimension) : [...builder.dimensions, dimension];
  return normalizeCrmReportBuilder({ ...builder, templateId: null, dimensions });
}

export function toggleCrmReportMetric(builder: CrmReportBuilderState, metric: CrmCustomReportMetric): CrmReportBuilderState {
  const has = builder.metrics.includes(metric);
  if (!has && !crmReportMetricAvailability(metric, builder.dimensions).available) return builder;
  const metrics = has
    ? builder.metrics.filter((m) => m !== metric)
    : CRM_CUSTOM_REPORT_METRICS.filter((m) => m === metric || builder.metrics.includes(m));
  return normalizeCrmReportBuilder({ ...builder, templateId: null, metrics });
}

/** Problemas que impedem "Gerar relatório" (o backend valida de novo). */
export function describeCrmReportBuilderIssues(builder: CrmReportBuilderState): string[] {
  const issues: string[] = [];
  if (builder.dimensions.length === 0) issues.push("Escolha ao menos uma dimensão.");
  if (builder.metrics.length === 0) issues.push("Escolha ao menos uma métrica.");
  if (builder.customerStatus === "WITHOUT_PURCHASE" && builder.dimensions.some(isCrmCustomReportOrderDimension)) {
    issues.push(CRM_CUSTOM_REPORT_WITHOUT_PURCHASE_ORDER_DIM_REASON);
  }
  return issues;
}

/** POST /api/crm/reports/custom — os MESMOS filtros globais da aba + o spec do construtor. */
export function buildCrmCustomReportRequestBody(args: {
  builder: CrmReportBuilderState;
  ui: Pick<CrmReportsUiState, "filters" | "selection">;
  period: { from: string; to: string } | null;
  offset?: number;
  limit?: number;
}): CrmCustomReportRequest {
  const { builder } = args;
  return {
    filters: buildCrmReportsFiltersPayload(args.ui),
    period: args.period,
    customerStatus: builder.customerStatus,
    dimensions: [...builder.dimensions],
    metrics: [...builder.metrics],
    groupBy: builder.groupBy,
    sort: builder.sortBy ? { by: builder.sortBy, direction: builder.sortDirection } : null,
    pagination: { limit: args.limit ?? CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT, offset: args.offset ?? 0 },
  };
}

/** Chave do spec (sem paginação) — detecta resultado desatualizado sem reexecutar nada. */
export function crmCustomReportSpecKey(request: CrmCustomReportRequest): string {
  const { pagination: _pagination, ...spec } = request;
  return JSON.stringify(spec);
}

export const CRM_REPORT_BUILDER_CUSTOMER_STATUS_OPTIONS: readonly CrmCustomReportCustomerStatus[] =
  CRM_CUSTOM_REPORT_CUSTOMER_STATUSES.filter((s) => s !== "WITH_PURCHASE");

export const CRM_REPORT_BUILDER_DIMENSIONS: readonly CrmCustomReportDimension[] = CRM_CUSTOM_REPORT_DIMENSIONS;
