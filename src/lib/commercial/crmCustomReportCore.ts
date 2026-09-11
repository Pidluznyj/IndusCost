/**
 * Relatório personalizado da aba CRM > Relatórios — núcleo PURO.
 *
 * Sem Prisma/Express/React. Recebe o universo JÁ analisado pelo mesmo
 * pipeline das listas (mesmos filtros, carteira e exclusões) e os pedidos
 * canônicos já carregados; só agrega. Nenhuma regra de compra nasce aqui:
 *   - venda (valor, pedidos, clientes, ticket) = pedidos canônicos com
 *     emissão (dia civil) dentro do período;
 *   - recência (última compra, dias sem compra) = fatos do motor de recompra
 *     (histórico inteiro até hoje);
 *   - cadência (tempo médio, dias de atraso) = saída do motor, 1 linha por
 *     cliente.
 * Combinação sem significado seguro (ex.: cadência por mês) é recusada no
 * parser com o motivo — nunca devolve número ambíguo.
 */

import { computeTicketAverage } from "@/src/lib/salesOrderDashboardRules.js";
import {
  CRM_CUSTOM_REPORT_CUSTOMER_STATUSES,
  CRM_CUSTOM_REPORT_DIMENSION_LABELS,
  CRM_CUSTOM_REPORT_DIMENSIONS,
  CRM_CUSTOM_REPORT_MAX_DIMENSIONS,
  CRM_CUSTOM_REPORT_MAX_ROWS,
  CRM_CUSTOM_REPORT_METRIC_LABELS,
  CRM_CUSTOM_REPORT_METRICS,
  CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT,
  CRM_CUSTOM_REPORT_PAGE_MAX_LIMIT,
  type CrmCustomReportCell,
  type CrmCustomReportColumn,
  type CrmCustomReportColumnFormat,
  type CrmCustomReportCustomerStatus,
  type CrmCustomReportDimension,
  type CrmCustomReportGroup,
  type CrmCustomReportMetric,
  type CrmCustomReportMetricValues,
  type CrmCustomReportRow,
  type CrmCustomReportSortDirection,
  type CrmCustomReportSortKey,
  type CrmCustomReportSpec,
} from "@/src/lib/commercial/crmReportsTypes.js";
import {
  normalizeCrmReportsLocationToken,
  parseCrmReportsFilters,
  roundCrmReportsMoney,
  type CrmReportsCustomerFacts,
  type CrmReportsOrderRecord,
} from "@/src/lib/commercial/crmReportsOperationalCore.js";
import {
  businessDaysBetween,
  isBusinessDateWithin,
  isValidBusinessDate,
  microsToMoney,
  moneyToMicros,
  toBusinessDate,
} from "@/src/lib/commercial/crmRepurchaseEngine.js";
import {
  CRM_CUSTOM_REPORT_WITHOUT_PURCHASE_ORDER_DIM_REASON,
  describeCrmCustomReportMetricAvailability,
  isCrmCustomReportOrderDimension,
} from "@/src/lib/commercial/crmCustomReportContract.js";

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export class CrmCustomReportTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(
      `O relatório passa de ${limit.toLocaleString("pt-BR")} linhas. Reduza o período, as dimensões ou filtre o universo.`
    );
    this.name = "CrmCustomReportTooLargeError";
  }
}

// Disponibilidade por granularidade: contrato único com a UI.
export { describeCrmCustomReportMetricAvailability, isCrmCustomReportOrderDimension };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isMetric(value: string): value is CrmCustomReportMetric {
  return (CRM_CUSTOM_REPORT_METRICS as readonly string[]).includes(value);
}

function isDimension(value: string): value is CrmCustomReportDimension {
  return (CRM_CUSTOM_REPORT_DIMENSIONS as readonly string[]).includes(value);
}

export type CrmCustomReportParseResult =
  | { ok: true; spec: CrmCustomReportSpec }
  | { ok: false; errors: string[] };

/**
 * POST /api/crm/reports/custom (e exportação): valida e normaliza o spec.
 * A exportação usa o mesmo spec e ignora só a paginação (todas as linhas,
 * com o teto `CRM_CUSTOM_REPORT_MAX_ROWS`).
 */
export function parseCrmCustomReportRequest(body: unknown): CrmCustomReportParseResult {
  const errors: string[] = [];
  if (!isPlainObject(body)) return { ok: false, errors: ["Corpo da requisição precisa ser um objeto JSON."] };

  const filters = parseCrmReportsFilters(body.filters, errors);

  let period: CrmCustomReportSpec["period"] = null;
  if (body.period != null) {
    if (!isPlainObject(body.period)) {
      errors.push("period precisa ser { from, to }.");
    } else {
      const from = typeof body.period.from === "string" ? body.period.from.trim() : "";
      const to = typeof body.period.to === "string" ? body.period.to.trim() : "";
      if (!isValidBusinessDate(from) || !isValidBusinessDate(to)) {
        errors.push("period.from e period.to precisam ser datas YYYY-MM-DD válidas.");
      } else if (from > to) {
        errors.push("period.from não pode ser depois de period.to.");
      } else {
        period = { from, to };
      }
    }
  }

  const statusRaw = body.customerStatus == null ? "ALL" : String(body.customerStatus).trim().toUpperCase();
  let customerStatus: CrmCustomReportCustomerStatus = "ALL";
  if (!(CRM_CUSTOM_REPORT_CUSTOMER_STATUSES as readonly string[]).includes(statusRaw)) {
    errors.push(`customerStatus inválido: use ${CRM_CUSTOM_REPORT_CUSTOMER_STATUSES.join(", ")}.`);
  } else {
    customerStatus = statusRaw as CrmCustomReportCustomerStatus;
  }

  const dimensions: CrmCustomReportDimension[] = [];
  if (!Array.isArray(body.dimensions) || body.dimensions.length === 0) {
    errors.push("Escolha ao menos uma dimensão.");
  } else {
    for (const value of body.dimensions) {
      const dimension = typeof value === "string" ? value.trim() : "";
      if (!isDimension(dimension)) {
        errors.push(`Dimensão desconhecida: "${String(value)}".`);
      } else if (!dimensions.includes(dimension)) {
        dimensions.push(dimension);
      }
    }
    if (dimensions.length > CRM_CUSTOM_REPORT_MAX_DIMENSIONS) {
      errors.push(`No máximo ${CRM_CUSTOM_REPORT_MAX_DIMENSIONS} dimensões.`);
    }
  }

  const metrics: CrmCustomReportMetric[] = [];
  if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
    errors.push("Escolha ao menos uma métrica.");
  } else {
    for (const value of body.metrics) {
      const metric = typeof value === "string" ? value.trim() : "";
      if (!isMetric(metric)) {
        errors.push(`Métrica desconhecida: "${String(value)}".`);
      } else if (!metrics.includes(metric)) {
        metrics.push(metric);
      }
    }
  }
  for (const metric of metrics) {
    const availability = describeCrmCustomReportMetricAvailability(metric, dimensions);
    if (!availability.available) {
      errors.push(`${CRM_CUSTOM_REPORT_METRIC_LABELS[metric]}: ${availability.reason}`);
    }
  }
  if (customerStatus === "WITHOUT_PURCHASE" && dimensions.some(isCrmCustomReportOrderDimension)) {
    errors.push(CRM_CUSTOM_REPORT_WITHOUT_PURCHASE_ORDER_DIM_REASON);
  }

  let groupBy: CrmCustomReportDimension | null = null;
  if (body.groupBy != null && body.groupBy !== "") {
    const value = String(body.groupBy).trim();
    if (!isDimension(value) || !dimensions.includes(value)) {
      errors.push("Agrupar por precisa ser uma das dimensões escolhidas.");
    } else {
      groupBy = value;
    }
  }

  let sort: CrmCustomReportSpec["sort"] = {
    by: metrics[0] ?? dimensions[0] ?? "soldValue",
    direction: metrics.length > 0 ? "desc" : "asc",
  };
  if (body.sort != null) {
    if (!isPlainObject(body.sort)) {
      errors.push("sort precisa ser { by, direction }.");
    } else {
      const by = String(body.sort.by ?? "").trim();
      const known = (isDimension(by) && dimensions.includes(by)) || (isMetric(by) && metrics.includes(by));
      if (!known) {
        errors.push("Ordenação precisa ser uma dimensão ou métrica escolhida.");
      } else {
        const directionRaw = body.sort.direction == null ? null : String(body.sort.direction).trim().toLowerCase();
        if (directionRaw != null && directionRaw !== "asc" && directionRaw !== "desc") {
          errors.push("sort.direction inválido: use asc ou desc.");
        }
        sort = {
          by: by as CrmCustomReportSortKey,
          direction: (directionRaw as CrmCustomReportSortDirection | null) ?? (isMetric(by) ? "desc" : "asc"),
        };
      }
    }
  }

  const pageRaw = isPlainObject(body.pagination) ? body.pagination : {};
  const limitRaw = Number(pageRaw.limit);
  const offsetRaw = Number(pageRaw.offset);
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, CRM_CUSTOM_REPORT_PAGE_MAX_LIMIT)
      : CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT;
  const offset = Number.isInteger(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    spec: { filters, period, customerStatus, dimensions, metrics, groupBy, sort, pagination: { limit, offset } },
  };
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

export type CrmCustomReportOwner = { key: string; label: string };

export type CrmCustomReportContext = {
  today: string;
  /** Universo analisado (mesmo das listas). */
  facts: readonly CrmReportsCustomerFacts[];
  ordersByCustomer: ReadonlyMap<string, readonly CrmReportsOrderRecord[]>;
  ownerOf: (customerId: string) => CrmCustomReportOwner | null;
  sellerLabelOf: (externalSellerId: number | null) => string;
};

type Accumulator = {
  micros: number;
  orders: number;
  customers: Set<string>;
  lastPurchase: string | null;
  cadence: { average: number | null; delta: number | null } | null;
};

type InternalRow = {
  key: string;
  customerId: string | null;
  cells: Partial<Record<CrmCustomReportDimension, CrmCustomReportCell>>;
  acc: Accumulator;
};

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function newAccumulator(): Accumulator {
  return { micros: 0, orders: 0, customers: new Set(), lastPurchase: null, cadence: null };
}

function mergeLastPurchase(current: string | null, next: string | null): string | null {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
}

function customerCell(facts: CrmReportsCustomerFacts): CrmCustomReportCell {
  return { key: facts.customer.id, label: facts.customer.companyName, sublabel: facts.customer.taxId || null };
}

function ownerCell(owner: CrmCustomReportOwner | null): CrmCustomReportCell {
  return owner
    ? { key: `o:${owner.key}`, label: owner.label, sublabel: null }
    : { key: "o:__NONE__", label: "Sem responsável comercial", sublabel: null };
}

function cityCell(city: string | null): CrmCustomReportCell {
  const token = normalizeCrmReportsLocationToken(city);
  return token
    ? { key: `c:${token}`, label: (city ?? "").trim().replace(/\s+/g, " "), sublabel: null }
    : { key: "c:__NONE__", label: "Sem cidade", sublabel: null };
}

function stateCell(state: string | null): CrmCustomReportCell {
  const value = (state ?? "").trim().toUpperCase();
  return value ? { key: `u:${value}`, label: value, sublabel: null } : { key: "u:__NONE__", label: "Sem UF", sublabel: null };
}

function monthCell(businessDate: string): CrmCustomReportCell {
  return {
    key: businessDate.slice(0, 7),
    label: `${businessDate.slice(5, 7)}/${businessDate.slice(0, 4)}`,
    sublabel: null,
  };
}

function yearCell(businessDate: string): CrmCustomReportCell {
  const year = businessDate.slice(0, 4);
  return { key: year, label: year, sublabel: null };
}

function sellerCell(externalSellerId: number | null, labelOf: (id: number | null) => string): CrmCustomReportCell {
  const id = externalSellerId != null && externalSellerId > 0 ? externalSellerId : null;
  return {
    key: id != null ? `s:${id}` : "s:__NO_SELLER__",
    label: labelOf(id),
    sublabel: id != null ? `ID Nomus ${id}` : null,
  };
}

/** Pedidos do cliente com emissão no período (e nunca depois de hoje). */
function periodOrdersOf(
  facts: CrmReportsCustomerFacts,
  ctx: CrmCustomReportContext,
  period: CrmCustomReportSpec["period"]
): Array<{ order: CrmReportsOrderRecord; businessDate: string }> {
  const out: Array<{ order: CrmReportsOrderRecord; businessDate: string }> = [];
  for (const order of ctx.ordersByCustomer.get(facts.customer.id) ?? []) {
    const businessDate = toBusinessDate(order.issueDate);
    if (!businessDate || businessDate > ctx.today) continue;
    if (period && !isBusinessDateWithin(businessDate, period)) continue;
    out.push({ order, businessDate });
  }
  return out;
}

function passesCustomerStatus(
  facts: CrmReportsCustomerFacts,
  status: CrmCustomReportCustomerStatus,
  periodOrderCount: number
): boolean {
  switch (status) {
    case "WITH_PURCHASE":
      return periodOrderCount > 0;
    case "WITHOUT_PURCHASE":
      return periodOrderCount === 0;
    case "REPURCHASE_OVERDUE":
      return facts.cadence.status === "OVERDUE" || facts.cadence.status === "SEVERELY_OVERDUE";
    case "REPURCHASE_DUE_SOON":
      return facts.cadence.status === "DUE_SOON";
    case "ALL":
    default:
      return true;
  }
}

function metricValues(
  acc: Accumulator,
  metrics: readonly CrmCustomReportMetric[],
  today: string
): CrmCustomReportMetricValues {
  const soldValue = microsToMoney(acc.micros);
  const out: CrmCustomReportMetricValues = {};
  for (const metric of metrics) {
    switch (metric) {
      case "soldValue":
        out.soldValue = roundCrmReportsMoney(soldValue);
        break;
      case "orders":
        out.orders = acc.orders;
        break;
      case "customers":
        out.customers = acc.customers.size;
        break;
      case "averageTicket":
        out.averageTicket = acc.orders > 0 ? roundCrmReportsMoney(computeTicketAverage(soldValue, acc.orders) ?? 0) : null;
        break;
      case "lastPurchaseDate":
        out.lastPurchaseDate = acc.lastPurchase;
        break;
      case "daysSinceLastPurchase":
        out.daysSinceLastPurchase = acc.lastPurchase ? businessDaysBetween(acc.lastPurchase, today) : null;
        break;
      case "averageRepurchaseDays":
        out.averageRepurchaseDays =
          acc.cadence?.average != null ? Math.round((acc.cadence.average + Number.EPSILON) * 100) / 100 : null;
        break;
      case "overdueDays":
        out.overdueDays = acc.cadence?.delta ?? null;
        break;
    }
  }
  return out;
}

export type CrmCustomReportComputed = {
  columns: CrmCustomReportColumn[];
  /** Todas as linhas, ordenadas (paginação é recorte). */
  rows: CrmCustomReportRow[];
  totals: CrmCustomReportMetricValues;
  groupsByKey: Map<string, CrmCustomReportGroup>;
};

function columnFormat(key: CrmCustomReportSortKey): CrmCustomReportColumnFormat {
  switch (key) {
    case "soldValue":
    case "averageTicket":
      return "money";
    case "orders":
    case "customers":
      return "integer";
    case "lastPurchaseDate":
      return "date";
    case "daysSinceLastPurchase":
    case "overdueDays":
      return "days";
    case "averageRepurchaseDays":
      return "decimal-days";
    default:
      return "text";
  }
}

export function buildCrmCustomReportColumns(spec: Pick<CrmCustomReportSpec, "dimensions" | "metrics">): CrmCustomReportColumn[] {
  return [
    ...spec.dimensions.map((dimension) => ({
      key: dimension,
      label: CRM_CUSTOM_REPORT_DIMENSION_LABELS[dimension],
      kind: "dimension" as const,
      format: "text" as const,
    })),
    ...spec.metrics.map((metric) => ({
      key: metric,
      label: CRM_CUSTOM_REPORT_METRIC_LABELS[metric],
      kind: "metric" as const,
      format: columnFormat(metric),
    })),
  ];
}

function compareCells(
  a: CrmCustomReportCell | undefined,
  b: CrmCustomReportCell | undefined,
  dimension: CrmCustomReportDimension
): number {
  if (!a || !b) return 0;
  if (dimension === "month" || dimension === "year") return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const byLabel = collator.compare(a.label, b.label);
  return byLabel !== 0 ? byLabel : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function compareMetric(a: unknown, b: unknown, direction: CrmCustomReportSortDirection): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // nulos sempre por último
  const cmp =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a) < String(b)
        ? -1
        : String(a) > String(b)
          ? 1
          : 0;
  return direction === "asc" ? cmp : -cmp;
}

/**
 * Monta TODAS as linhas do relatório (ordenadas), os totais e os subtotais.
 * Lança `CrmCustomReportTooLargeError` assim que passar do teto.
 */
export function computeCrmCustomReport(
  spec: CrmCustomReportSpec,
  ctx: CrmCustomReportContext
): CrmCustomReportComputed {
  const hasOrderDimension = spec.dimensions.some(isCrmCustomReportOrderDimension);
  const customerGrain = spec.dimensions.includes("customer") && !hasOrderDimension;
  const rowsByKey = new Map<string, InternalRow>();
  const totals = newAccumulator();

  const touch = (cells: InternalRow["cells"], customerId: string | null): InternalRow => {
    const key = spec.dimensions.map((d) => cells[d]?.key ?? "").join("|");
    let row = rowsByKey.get(key);
    if (!row) {
      if (rowsByKey.size >= CRM_CUSTOM_REPORT_MAX_ROWS) throw new CrmCustomReportTooLargeError(CRM_CUSTOM_REPORT_MAX_ROWS);
      row = { key, customerId: spec.dimensions.includes("customer") ? customerId : null, cells, acc: newAccumulator() };
      rowsByKey.set(key, row);
    }
    return row;
  };

  for (const facts of ctx.facts) {
    const periodOrders = periodOrdersOf(facts, ctx, spec.period);
    if (!passesCustomerStatus(facts, spec.customerStatus, periodOrders.length)) continue;

    const customerCells: InternalRow["cells"] = {};
    if (spec.dimensions.includes("customer")) customerCells.customer = customerCell(facts);
    if (spec.dimensions.includes("commercialOwner")) {
      customerCells.commercialOwner = ownerCell(ctx.ownerOf(facts.customer.id));
    }
    if (spec.dimensions.includes("city")) customerCells.city = cityCell(facts.customer.city);
    if (spec.dimensions.includes("state")) customerCells.state = stateCell(facts.customer.state);

    if (hasOrderDimension) {
      // Linha = recorte de PEDIDOS: cada pedido cai em exatamente uma linha.
      for (const { order, businessDate } of periodOrders) {
        const cells = { ...customerCells };
        if (spec.dimensions.includes("orderSeller")) cells.orderSeller = sellerCell(order.externalSellerId, ctx.sellerLabelOf);
        if (spec.dimensions.includes("month")) cells.month = monthCell(businessDate);
        if (spec.dimensions.includes("year")) cells.year = yearCell(businessDate);
        const row = touch(cells, facts.customer.id);
        const micros = moneyToMicros(order.totalNetValue);
        row.acc.micros += micros;
        row.acc.orders += 1;
        row.acc.customers.add(facts.customer.id);
        totals.micros += micros;
        totals.orders += 1;
        totals.customers.add(facts.customer.id);
      }
      continue;
    }

    // Linha = recorte de CLIENTES. Sem filtro de situação, só entra quem
    // comprou no período (relatório de venda); com filtro, entra quem casar.
    if (spec.customerStatus === "ALL" && periodOrders.length === 0) continue;
    const row = touch(customerCells, facts.customer.id);
    for (const { order } of periodOrders) {
      const micros = moneyToMicros(order.totalNetValue);
      row.acc.micros += micros;
      row.acc.orders += 1;
      totals.micros += micros;
      totals.orders += 1;
    }
    row.acc.customers.add(facts.customer.id);
    totals.customers.add(facts.customer.id);
    row.acc.lastPurchase = mergeLastPurchase(row.acc.lastPurchase, facts.lastPurchaseDate);
    totals.lastPurchase = mergeLastPurchase(totals.lastPurchase, facts.lastPurchaseDate);
    if (customerGrain) {
      row.acc.cadence = {
        average: facts.cadence.averageRepurchaseDays,
        delta: facts.cadence.deltaDays,
      };
    }
  }

  const groupBy = spec.groupBy;
  const internalRows = [...rowsByKey.values()];
  const valuesByKey = new Map(internalRows.map((row) => [row.key, metricValues(row.acc, spec.metrics, ctx.today)]));
  internalRows.sort((a, b) => {
    if (groupBy) {
      const byGroup = compareCells(a.cells[groupBy], b.cells[groupBy], groupBy);
      if (byGroup !== 0) return byGroup;
    }
    const by = spec.sort.by;
    const primary = isMetricKey(by)
      ? compareMetric(valuesByKey.get(a.key)?.[by], valuesByKey.get(b.key)?.[by], spec.sort.direction)
      : compareCells(a.cells[by], b.cells[by], by) * (spec.sort.direction === "asc" ? 1 : -1);
    if (primary !== 0) return primary;
    for (const dimension of spec.dimensions) {
      const cmp = compareCells(a.cells[dimension], b.cells[dimension], dimension);
      if (cmp !== 0) return cmp;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const groupsByKey = new Map<string, CrmCustomReportGroup>();
  if (groupBy) {
    const groupAcc = new Map<string, { label: string; rowCount: number; acc: Accumulator }>();
    for (const row of internalRows) {
      const cell = row.cells[groupBy]!;
      const group = groupAcc.get(cell.key) ?? { label: cell.label, rowCount: 0, acc: newAccumulator() };
      group.rowCount += 1;
      group.acc.micros += row.acc.micros;
      group.acc.orders += row.acc.orders;
      for (const id of row.acc.customers) group.acc.customers.add(id);
      group.acc.lastPurchase = mergeLastPurchase(group.acc.lastPurchase, row.acc.lastPurchase);
      groupAcc.set(cell.key, group);
    }
    for (const [key, group] of groupAcc) {
      groupsByKey.set(key, {
        key,
        label: group.label,
        rowCount: group.rowCount,
        metrics: metricValues(group.acc, spec.metrics, ctx.today),
      });
    }
  }

  return {
    columns: buildCrmCustomReportColumns(spec),
    rows: internalRows.map((row) => ({
      key: row.key,
      customerId: row.customerId,
      dimensions: row.cells,
      metrics: valuesByKey.get(row.key)!,
    })),
    totals: metricValues(totals, spec.metrics, ctx.today),
    groupsByKey,
  };
}

function isMetricKey(key: CrmCustomReportSortKey): key is CrmCustomReportMetric {
  return (CRM_CUSTOM_REPORT_METRICS as readonly string[]).includes(key);
}

/** Página + subtotais dos grupos que aparecem nela (na ordem da página). */
export function pageCrmCustomReport(
  computed: CrmCustomReportComputed,
  spec: Pick<CrmCustomReportSpec, "groupBy" | "pagination">
): {
  rows: CrmCustomReportRow[];
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  groups: CrmCustomReportGroup[] | null;
} {
  const { limit, offset } = spec.pagination;
  const rows = computed.rows.slice(offset, offset + limit);
  let groups: CrmCustomReportGroup[] | null = null;
  if (spec.groupBy) {
    const seen = new Set<string>();
    groups = [];
    for (const row of rows) {
      const key = row.dimensions[spec.groupBy]?.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const group = computed.groupsByKey.get(key);
      if (group) groups.push(group);
    }
  }
  return {
    rows,
    total: computed.rows.length,
    limit,
    offset,
    returned: rows.length,
    hasMore: offset + rows.length < computed.rows.length,
    groups,
  };
}
