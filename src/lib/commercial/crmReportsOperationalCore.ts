/**
 * Núcleo PURO das listas operacionais de CRM > Relatórios.
 *
 * Sem Prisma, sem Express, sem React. Recebe dados já carregados pelo shell
 * (`crmReportsOperationalService.server.ts`) e devolve universo, indicadores,
 * listas ordenadas e DTOs. Tudo que é compra/recompra sai do motor
 * `crmRepurchaseEngine`; nada aqui decide se um pedido é válido.
 *
 * Ordem do pipeline (a mesma para cards, listas e exportações futuras):
 *   clientes autorizados (escopo)
 *     → filtros de inclusão (responsável, cidade, UF)
 *     → pedidos canônicos por cliente → agregação → motor de recompra
 *     → filtro "vendedor do último pedido"
 *     → seleção analítica (EXCLUDE / ONLY)
 *     → indicadores + 3 listas sobre o MESMO universo analisado
 */

import { computeTicketAverage } from "@/src/lib/salesOrderDashboardRules.js";
import { normalizeSearchString } from "@/src/lib/utils.js";
import {
  CRM_REPORTS_CUSTOMER_SELECTION_MODES,
  CRM_REPORTS_DEFAULT_VIEWS,
  CRM_REPORTS_LIST_KEYS,
  CRM_REPORTS_LIST_SORT,
  CRM_REPORTS_MAX_SELECTION_IDS,
  CRM_REPORTS_OVERDUE_SEVERITIES,
  CRM_REPORTS_OVERDUE_SORTS,
  CRM_REPORTS_PAGE_DEFAULT_LIMIT,
  CRM_REPORTS_PAGE_MAX_LIMIT,
  CRM_REPORTS_RECENT_WINDOW_DAYS,
  CRM_REPORTS_ROLLING_MONTHS,
  CRM_REPURCHASE_STATUSES,
  type CrmReportsNormalizedViews,
  type CrmReportsOverdueSeverity,
  type CrmReportsOverdueSort,
  type CrmRepurchaseStatus,
  type CrmReportsCadenceFields,
  type CrmReportsCadenceRow,
  type CrmReportsCustomerIdentity,
  type CrmReportsCustomerSelection,
  type CrmReportsCustomerSelectionMode,
  type CrmReportsIndicators,
  type CrmReportsLastOrderSellerFields,
  type CrmReportsListKey,
  type CrmReportsNormalizedFilters,
  type CrmReportsNormalizedPage,
  type CrmReportsNormalizedRequest,
  type CrmReportsOverdueRow,
  type CrmReportsPage,
  type CrmReportsRecent60dRow,
  type CrmReportsSelectionInfo,
  type CrmReportsUniverse,
  type CrmReportsWindows,
} from "@/src/lib/commercial/crmReportsTypes.js";
import {
  REPURCHASE_DUE_SOON_DAYS,
  REPURCHASE_SEVERE_OVERDUE_DAYS,
  businessDaysBetween,
  buildDistinctPurchaseOccasions,
  computeRepurchaseCadence,
  isBusinessDateWithin,
  microsToMoney,
  moneyToMicros,
  resolveRollingDaysWindow,
  resolveRollingMonthsWindow,
  toBusinessDate,
  type PurchaseOccasion,
  type RepurchaseCadence,
} from "@/src/lib/commercial/crmRepurchaseEngine.js";

// ---------------------------------------------------------------------------
// Registros de entrada (shape mínimo carregado pelo shell)
// ---------------------------------------------------------------------------

export type CrmReportsCustomerRecord = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
};

/** Pedido canônico — só os campos que o relatório precisa. */
export type CrmReportsOrderRecord = {
  id: string;
  customerId: string;
  orderCode: string;
  issueDate: Date;
  totalNetValue: number;
  externalSellerId: number | null;
  nomusSellerName: string | null;
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELLER_KEY_NO_SELLER = "__NO_SELLER__";
const MAX_LOCATION_VALUES = 200;

export type CrmReportsRequestParseResult =
  | { ok: true; request: CrmReportsNormalizedRequest }
  | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function positiveIntOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Normaliza texto de localização para comparação (sem acento/caixa, espaços colapsados). */
export function normalizeCrmReportsLocationToken(value: string | null | undefined): string {
  return normalizeSearchString(value ?? "").replace(/\s+/g, " ").trim();
}

function parseLocationList(raw: unknown, label: string, errors: string[]): string[] {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value == null) continue;
    if (typeof value !== "string") {
      errors.push(`${label} aceita texto ou lista de textos.`);
      return [];
    }
    const trimmed = value.trim().replace(/\s+/g, " ");
    const token = normalizeCrmReportsLocationToken(trimmed);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(trimmed);
  }
  if (out.length > MAX_LOCATION_VALUES) {
    errors.push(`${label}: no máximo ${MAX_LOCATION_VALUES} valores.`);
    return [];
  }
  return out;
}

function parsePage(raw: unknown): CrmReportsNormalizedPage {
  const page = isPlainObject(raw) ? raw : {};
  const limitRaw = typeof page.limit === "number" ? page.limit : Number(page.limit);
  const offsetRaw = typeof page.offset === "number" ? page.offset : Number(page.offset);
  let limit = Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : CRM_REPORTS_PAGE_DEFAULT_LIMIT;
  if (limit < 1) limit = CRM_REPORTS_PAGE_DEFAULT_LIMIT;
  limit = Math.min(limit, CRM_REPORTS_PAGE_MAX_LIMIT);
  let offset = Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0;
  if (offset < 0) offset = 0;
  return { limit, offset };
}

/** Lista de UUIDs de cliente: minúsculo, sem duplicata, teto explícito. `null` = inválida. */
function parseCustomerIdList(raw: unknown[], label: string, errors: string[]): string[] | null {
  if (raw.length > CRM_REPORTS_MAX_SELECTION_IDS) {
    errors.push(`${label} aceita no máximo ${CRM_REPORTS_MAX_SELECTION_IDS} IDs (recebido ${raw.length}).`);
    return null;
  }
  const ids = new Set<string>();
  let invalid = 0;
  for (const value of raw) {
    const id = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!UUID_RE.test(id)) {
      invalid += 1;
      continue;
    }
    ids.add(id);
  }
  if (invalid > 0) {
    errors.push(`${label} contém ${invalid} ID(s) inválido(s) (esperado UUID).`);
    return null;
  }
  return [...ids];
}

function parseCustomerSelection(raw: unknown, errors: string[]): CrmReportsCustomerSelection {
  if (raw == null) return { mode: "ALL", customerIds: [] };
  if (!isPlainObject(raw)) {
    errors.push("customerSelection precisa ser um objeto { mode, customerIds }.");
    return { mode: "ALL", customerIds: [] };
  }
  const modeRaw = raw.mode == null ? "ALL" : String(raw.mode).trim().toUpperCase();
  if (!(CRM_REPORTS_CUSTOMER_SELECTION_MODES as readonly string[]).includes(modeRaw)) {
    errors.push(
      `customerSelection.mode inválido: use ${CRM_REPORTS_CUSTOMER_SELECTION_MODES.join(", ")}.`
    );
    return { mode: "ALL", customerIds: [] };
  }
  const mode = modeRaw as CrmReportsCustomerSelectionMode;
  if (mode === "ALL") return { mode, customerIds: [] };

  if (!Array.isArray(raw.customerIds)) {
    errors.push(`customerSelection.customerIds é obrigatório (lista) no modo ${mode}.`);
    return { mode: "ALL", customerIds: [] };
  }
  const ids = parseCustomerIdList(raw.customerIds, "customerSelection.customerIds", errors);
  return ids ? { mode, customerIds: ids } : { mode: "ALL", customerIds: [] };
}

/** Visões das listas (status da cadência, severidade e ordenação dos atrasados). */
export function parseCrmReportsViews(raw: unknown, errors: string[]): CrmReportsNormalizedViews {
  if (raw == null) return structuredCloneViews(CRM_REPORTS_DEFAULT_VIEWS);
  if (!isPlainObject(raw)) {
    errors.push("views precisa ser um objeto.");
    return structuredCloneViews(CRM_REPORTS_DEFAULT_VIEWS);
  }
  const views = structuredCloneViews(CRM_REPORTS_DEFAULT_VIEWS);

  if (raw.cadence != null) {
    const cadence = isPlainObject(raw.cadence) ? raw.cadence : null;
    const statuses = cadence?.statuses;
    if (!cadence || (statuses != null && !Array.isArray(statuses))) {
      errors.push("views.cadence.statuses precisa ser uma lista de status.");
    } else if (Array.isArray(statuses)) {
      const valid = new Set<CrmRepurchaseStatus>();
      for (const value of statuses) {
        const status = typeof value === "string" ? value.trim().toUpperCase() : "";
        if (!(CRM_REPURCHASE_STATUSES as readonly string[]).includes(status)) {
          errors.push(`views.cadence.statuses: status desconhecido "${String(value)}".`);
          continue;
        }
        valid.add(status as CrmRepurchaseStatus);
      }
      views.cadence.statuses = CRM_REPURCHASE_STATUSES.filter((s) => valid.has(s));
    }
  }

  if (raw.overdue != null) {
    if (!isPlainObject(raw.overdue)) {
      errors.push("views.overdue precisa ser um objeto.");
    } else {
      const severity = raw.overdue.severity == null ? "ALL" : String(raw.overdue.severity).trim().toUpperCase();
      if (!(CRM_REPORTS_OVERDUE_SEVERITIES as readonly string[]).includes(severity)) {
        errors.push(`views.overdue.severity inválido: use ${CRM_REPORTS_OVERDUE_SEVERITIES.join(", ")}.`);
      } else {
        views.overdue.severity = severity as CrmReportsOverdueSeverity;
      }
      const sort = raw.overdue.sort == null ? "DELAY_DESC" : String(raw.overdue.sort).trim().toUpperCase();
      if (!(CRM_REPORTS_OVERDUE_SORTS as readonly string[]).includes(sort)) {
        errors.push(`views.overdue.sort inválido: use ${CRM_REPORTS_OVERDUE_SORTS.join(", ")}.`);
      } else {
        views.overdue.sort = sort as CrmReportsOverdueSort;
      }
    }
  }
  return views;
}

function structuredCloneViews(views: CrmReportsNormalizedViews): CrmReportsNormalizedViews {
  return {
    cadence: { statuses: [...views.cadence.statuses] },
    overdue: { ...views.overdue },
  };
}

/**
 * Valida e normaliza o corpo do POST /api/crm/reports/operational.
 * Erro de filtro vira 400 — nunca é ignorado em silêncio (um filtro ignorado
 * mudaria o universo sem o usuário saber).
 */
export function parseCrmReportsOperationalRequest(body: unknown): CrmReportsRequestParseResult {
  const errors: string[] = [];
  if (body != null && !isPlainObject(body)) {
    return { ok: false, errors: ["Corpo da requisição precisa ser um objeto JSON."] };
  }
  const root = isPlainObject(body) ? body : {};
  const filters = parseCrmReportsFilters(root.filters, errors);
  const views = parseCrmReportsViews(root.views, errors);

  if (root.pagination != null && !isPlainObject(root.pagination)) {
    errors.push("pagination precisa ser um objeto.");
  }
  const paginationRaw = isPlainObject(root.pagination) ? root.pagination : {};
  const pagination = Object.fromEntries(
    CRM_REPORTS_LIST_KEYS.map((key) => [key, parsePage(paginationRaw[key])])
  ) as Record<CrmReportsListKey, CrmReportsNormalizedPage>;

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, request: { filters, views, pagination } };
}

/**
 * Filtros globais — os MESMOS para cards, listas, relatório personalizado e
 * exportações. Erros vão para `errors` (a request inteira vira 400).
 */
export function parseCrmReportsFilters(raw: unknown, errors: string[]): CrmReportsNormalizedFilters {
  if (raw != null && !isPlainObject(raw)) {
    errors.push("filters precisa ser um objeto.");
  }
  const filtersRaw = isPlainObject(raw) ? raw : {};

  let customerIds: string[] = [];
  if (filtersRaw.customerIds != null) {
    if (!Array.isArray(filtersRaw.customerIds)) {
      errors.push("filters.customerIds precisa ser lista de UUIDs.");
    } else {
      customerIds = parseCustomerIdList(filtersRaw.customerIds, "filters.customerIds", errors) ?? [];
    }
  }

  let commercialOwner: CrmReportsNormalizedFilters["commercialOwner"] = null;
  if (filtersRaw.commercialOwner != null) {
    if (!isPlainObject(filtersRaw.commercialOwner)) {
      errors.push("filters.commercialOwner precisa ser um objeto.");
    } else {
      const co = filtersRaw.commercialOwner;
      const sellerIdentityKey = trimmedOrNull(co.sellerIdentityKey);
      const externalSellerId = co.externalSellerId == null ? null : positiveIntOrNull(co.externalSellerId);
      if (co.externalSellerId != null && externalSellerId == null) {
        errors.push("filters.commercialOwner.externalSellerId precisa ser inteiro positivo.");
      }
      let externalSellerIds: number[] = [];
      if (co.externalSellerIds != null) {
        if (!Array.isArray(co.externalSellerIds)) {
          errors.push("filters.commercialOwner.externalSellerIds precisa ser lista.");
        } else {
          const parsed = co.externalSellerIds.map(positiveIntOrNull);
          if (parsed.some((id) => id == null)) {
            errors.push("filters.commercialOwner.externalSellerIds aceita só inteiros positivos.");
          } else {
            externalSellerIds = [...new Set(parsed as number[])].sort((a, b) => a - b);
          }
        }
      }
      if (sellerIdentityKey || externalSellerId != null || externalSellerIds.length > 0) {
        commercialOwner = { sellerIdentityKey, externalSellerId, externalSellerIds };
      }
    }
  }

  let lastOrderSeller: CrmReportsNormalizedFilters["lastOrderSeller"] = null;
  if (filtersRaw.lastOrderSeller != null) {
    if (!isPlainObject(filtersRaw.lastOrderSeller)) {
      errors.push("filters.lastOrderSeller precisa ser um objeto.");
    } else {
      const sellerKey = trimmedOrNull(
        typeof filtersRaw.lastOrderSeller.sellerKey === "number"
          ? String(filtersRaw.lastOrderSeller.sellerKey)
          : filtersRaw.lastOrderSeller.sellerKey
      );
      const sellerName = trimmedOrNull(filtersRaw.lastOrderSeller.sellerName);
      if (sellerKey && sellerKey !== SELLER_KEY_NO_SELLER && positiveIntOrNull(sellerKey) == null) {
        errors.push(
          `filters.lastOrderSeller.sellerKey inválido: use o ID Nomus numérico ou ${SELLER_KEY_NO_SELLER}.`
        );
      } else if (sellerKey || sellerName) {
        lastOrderSeller = { sellerKey, sellerName };
      }
    }
  }

  const cities = parseLocationList(filtersRaw.city, "filters.city", errors);
  const states = parseLocationList(filtersRaw.state, "filters.state", errors);
  const customerSelection = parseCustomerSelection(filtersRaw.customerSelection, errors);

  return { customerIds, commercialOwner, lastOrderSeller, cities, states, customerSelection };
}

// ---------------------------------------------------------------------------
// Janelas
// ---------------------------------------------------------------------------

/** Janelas do relatório a partir do dia de referência (calendário local). */
export function resolveCrmReportsWindows(now: Date): CrmReportsWindows {
  const today = toBusinessDate(now);
  if (!today) throw new RangeError("Data de referência inválida para o relatório.");
  const recent = resolveRollingDaysWindow(today, CRM_REPORTS_RECENT_WINDOW_DAYS);
  const rolling = resolveRollingMonthsWindow(today, CRM_REPORTS_ROLLING_MONTHS);
  return {
    today,
    recent60d: { from: recent.from, to: recent.to, days: recent.days },
    rolling12m: { from: rolling.from, to: rolling.to, months: rolling.months },
  };
}

// ---------------------------------------------------------------------------
// Filtros de inclusão (cadastro do cliente)
// ---------------------------------------------------------------------------

/**
 * Aplica cliente(s), responsável (IDs já resolvidos pela carteira canônica),
 * cidade e UF. Nunca amplia: só recorta a lista de clientes autorizados.
 */
export function selectCrmReportsInclusionCandidates(args: {
  authorizedCustomers: readonly CrmReportsCustomerRecord[];
  /** Vazio/ausente = sem filtro de cliente. */
  customerIds?: readonly string[];
  /** `null` = sem filtro de responsável. */
  ownerFilterCustomerIds: ReadonlySet<string> | null;
  cities: readonly string[];
  states: readonly string[];
}): CrmReportsCustomerRecord[] {
  const onlyCustomers = args.customerIds && args.customerIds.length > 0 ? new Set(args.customerIds) : null;
  const cityTokens = new Set(args.cities.map(normalizeCrmReportsLocationToken).filter(Boolean));
  const stateTokens = new Set(args.states.map(normalizeCrmReportsLocationToken).filter(Boolean));
  return args.authorizedCustomers.filter((customer) => {
    if (onlyCustomers && !onlyCustomers.has(customer.id)) return false;
    if (args.ownerFilterCustomerIds && !args.ownerFilterCustomerIds.has(customer.id)) return false;
    if (cityTokens.size > 0 && !cityTokens.has(normalizeCrmReportsLocationToken(customer.city))) {
      return false;
    }
    if (stateTokens.size > 0 && !stateTokens.has(normalizeCrmReportsLocationToken(customer.state))) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Agregação por cliente
// ---------------------------------------------------------------------------

export type CrmReportsLastOrder = {
  id: string;
  orderCode: string;
  issueDate: Date;
  businessDate: string;
  externalSellerId: number | null;
  nomusSellerName: string | null;
};

export type CrmReportsCustomerFacts = {
  customer: CrmReportsCustomerRecord;
  /** Pedidos canônicos considerados (emissão até hoje). */
  totalOrders: number;
  /** Pedidos com emissão depois de hoje — fora de janelas e cadência. */
  futureDatedOrders: number;
  lastPurchaseDate: string | null;
  daysSinceLastPurchase: number | null;
  lastOrder: CrmReportsLastOrder | null;
  orders60d: number;
  purchaseValue60d: number;
  averageTicket60d: number;
  orders12m: number;
  purchaseValue12m: number;
  averageTicket12m: number;
  occasions: PurchaseOccasion[];
  cadence: RepurchaseCadence;
};

/** Último pedido: maior `issueDate`; empate → maior `orderCode`, depois maior `id`. */
function isLaterOrder(candidate: CrmReportsOrderRecord, current: CrmReportsOrderRecord): boolean {
  const a = candidate.issueDate.getTime();
  const b = current.issueDate.getTime();
  if (a !== b) return a > b;
  if (candidate.orderCode !== current.orderCode) return candidate.orderCode > current.orderCode;
  return candidate.id > current.id;
}

/**
 * Agrega os pedidos canônicos de UM cliente. A cadência usa TODAS as compras
 * válidas do cliente — nenhum filtro de vendedor/responsável entra aqui.
 */
export function aggregateCrmReportsCustomerFacts(
  customer: CrmReportsCustomerRecord,
  orders: readonly CrmReportsOrderRecord[],
  windows: CrmReportsWindows
): CrmReportsCustomerFacts {
  let futureDatedOrders = 0;
  let totalOrders = 0;
  let orders60d = 0;
  let micros60d = 0;
  let orders12m = 0;
  let micros12m = 0;
  let lastOrder: CrmReportsOrderRecord | null = null;
  const occasionInputs: Array<{ issueDate: string; totalNetValue: number }> = [];

  for (const order of orders) {
    const businessDate = toBusinessDate(order.issueDate);
    if (!businessDate) continue;
    if (businessDate > windows.today) {
      futureDatedOrders += 1;
      continue;
    }
    totalOrders += 1;
    const micros = moneyToMicros(order.totalNetValue);
    if (isBusinessDateWithin(businessDate, windows.recent60d)) {
      orders60d += 1;
      micros60d += micros;
    }
    if (isBusinessDateWithin(businessDate, windows.rolling12m)) {
      orders12m += 1;
      micros12m += micros;
    }
    if (!lastOrder || isLaterOrder(order, lastOrder)) lastOrder = order;
    occasionInputs.push({ issueDate: businessDate, totalNetValue: order.totalNetValue });
  }

  const occasions = buildDistinctPurchaseOccasions(occasionInputs);
  const cadence = computeRepurchaseCadence(occasions, windows.today);
  const lastPurchaseDate = cadence.lastPurchaseDate;
  const purchaseValue60d = microsToMoney(micros60d);
  const purchaseValue12m = microsToMoney(micros12m);

  return {
    customer,
    totalOrders,
    futureDatedOrders,
    lastPurchaseDate,
    daysSinceLastPurchase:
      lastPurchaseDate != null ? businessDaysBetween(lastPurchaseDate, windows.today) : null,
    lastOrder: lastOrder
      ? {
          id: lastOrder.id,
          orderCode: lastOrder.orderCode,
          issueDate: lastOrder.issueDate,
          businessDate: toBusinessDate(lastOrder.issueDate)!,
          externalSellerId: lastOrder.externalSellerId,
          nomusSellerName: lastOrder.nomusSellerName,
        }
      : null,
    orders60d,
    purchaseValue60d,
    averageTicket60d: computeTicketAverage(purchaseValue60d, orders60d) ?? 0,
    orders12m,
    purchaseValue12m,
    averageTicket12m: computeTicketAverage(purchaseValue12m, orders12m) ?? 0,
    occasions,
    cadence,
  };
}

// ---------------------------------------------------------------------------
// Vendedor do último pedido (fragmento canônico de Pedidos de Venda)
// ---------------------------------------------------------------------------

/**
 * Avalia, sobre o ÚLTIMO pedido, o fragmento `where` produzido pelos
 * construtores canônicos de vendedor da tela Pedidos de Venda
 * (`buildSalesOrderNomusSellerWhereFromSellerKey` /
 * `buildSalesOrderNomusSellerWhereFilter`). Não reinterpreta a regra: só
 * executa em memória as formas que esses construtores emitem. Forma
 * desconhecida lança erro — filtro nunca é ignorado em silêncio.
 */
export function lastOrderMatchesSellerWhere(
  lastOrder: Pick<CrmReportsLastOrder, "id" | "externalSellerId"> | null,
  fragment: Record<string, unknown>
): boolean {
  const keys = Object.keys(fragment);
  if (keys.length !== 1) {
    throw new Error(`Fragmento de vendedor não suportado: ${JSON.stringify(fragment)}`);
  }
  if (!lastOrder) return false;
  const [key] = keys as [string];
  const condition = fragment[key];
  if (key !== "externalSellerId" && key !== "id") {
    throw new Error(`Fragmento de vendedor não suportado: ${JSON.stringify(fragment)}`);
  }
  const value = key === "id" ? lastOrder.id : lastOrder.externalSellerId;
  if (condition === null) return value == null;
  if (typeof condition === "number" || typeof condition === "string") return value === condition;
  if (isPlainObject(condition) && Array.isArray(condition.in) && Object.keys(condition).length === 1) {
    return value != null && (condition.in as unknown[]).includes(value);
  }
  throw new Error(`Fragmento de vendedor não suportado: ${JSON.stringify(fragment)}`);
}

// ---------------------------------------------------------------------------
// Análise completa (universo → indicadores → listas)
// ---------------------------------------------------------------------------

const displayNameCollator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareCrmReportsDisplayName(
  a: CrmReportsCustomerFacts,
  b: CrmReportsCustomerFacts
): number {
  const byName = displayNameCollator.compare(a.customer.companyName, b.customer.companyName);
  return byName !== 0 ? byName : compareIds(a.customer.id, b.customer.id);
}

/** RECENT_60D: última compra DESC, nome ASC. */
export function compareCrmReportsRecent(a: CrmReportsCustomerFacts, b: CrmReportsCustomerFacts): number {
  const da = a.lastPurchaseDate ?? "";
  const db = b.lastPurchaseDate ?? "";
  if (da !== db) return da > db ? -1 : 1;
  return compareCrmReportsDisplayName(a, b);
}

/** OVERDUE: atraso DESC, valor 12m DESC, nome ASC. */
export function compareCrmReportsOverdue(a: CrmReportsCustomerFacts, b: CrmReportsCustomerFacts): number {
  const delta = (b.cadence.deltaDays ?? 0) - (a.cadence.deltaDays ?? 0);
  if (delta !== 0) return delta;
  const value = moneyToMicros(b.purchaseValue12m) - moneyToMicros(a.purchaseValue12m);
  if (value !== 0) return value;
  return compareCrmReportsDisplayName(a, b);
}

/** OVERDUE (opção "maior venda 12m"): valor 12m DESC, atraso DESC, nome ASC. */
export function compareCrmReportsOverdueByValue(
  a: CrmReportsCustomerFacts,
  b: CrmReportsCustomerFacts
): number {
  const value = moneyToMicros(b.purchaseValue12m) - moneyToMicros(a.purchaseValue12m);
  if (value !== 0) return value;
  const delta = (b.cadence.deltaDays ?? 0) - (a.cadence.deltaDays ?? 0);
  if (delta !== 0) return delta;
  return compareCrmReportsDisplayName(a, b);
}

export function isCrmReportsOverdue(facts: CrmReportsCustomerFacts): boolean {
  return facts.cadence.status === "OVERDUE" || facts.cadence.status === "SEVERELY_OVERDUE";
}

export type CrmReportsAnalysis = {
  windows: CrmReportsWindows;
  universe: CrmReportsUniverse;
  selection: CrmReportsSelectionInfo;
  indicators: CrmReportsIndicators;
  /** Universo analisado (após exclusões), ordem de nome. */
  analyzed: CrmReportsCustomerFacts[];
  recent60d: CrmReportsCustomerFacts[];
  cadence: CrmReportsCustomerFacts[];
  overdue: CrmReportsCustomerFacts[];
  /** Pedidos com emissão futura no universo analisado (fora de janelas e cadência). */
  futureDatedOrdersIgnored: number;
};

export function buildCrmReportsAnalysis(args: {
  windows: CrmReportsWindows;
  authorizedCustomers: number;
  candidates: readonly CrmReportsCustomerRecord[];
  ordersByCustomer: ReadonlyMap<string, readonly CrmReportsOrderRecord[]>;
  /** Fragmento canônico de vendedor (Pedidos de Venda). `null` = sem filtro. */
  lastOrderSellerWhere: Record<string, unknown> | null;
  customerSelection: CrmReportsCustomerSelection;
}): CrmReportsAnalysis {
  const { windows } = args;
  const allFacts = args.candidates.map((customer) =>
    aggregateCrmReportsCustomerFacts(customer, args.ordersByCustomer.get(customer.id) ?? [], windows)
  );

  const sellerWhere = args.lastOrderSellerWhere;
  const matched = sellerWhere
    ? allFacts.filter((facts) => lastOrderMatchesSellerWhere(facts.lastOrder, sellerWhere))
    : allFacts;

  const selectedIds = new Set(args.customerSelection.customerIds);
  const matchedIds = new Set(matched.map((facts) => facts.customer.id));
  let analyzed = matched;
  if (args.customerSelection.mode === "EXCLUDE") {
    analyzed = matched.filter((facts) => !selectedIds.has(facts.customer.id));
  } else if (args.customerSelection.mode === "ONLY") {
    analyzed = matched.filter((facts) => selectedIds.has(facts.customer.id));
  }
  let idsOutsideUniverse = 0;
  for (const id of selectedIds) if (!matchedIds.has(id)) idsOutsideUniverse += 1;

  analyzed = [...analyzed].sort(compareCrmReportsDisplayName);

  const recent60d = analyzed
    .filter(
      (facts) =>
        facts.lastPurchaseDate != null && isBusinessDateWithin(facts.lastPurchaseDate, windows.recent60d)
    )
    .sort(compareCrmReportsRecent);
  const cadence = analyzed.filter((facts) => facts.cadence.totalOccasions > 0);
  // OVERDUE não recalcula nada: filtra o resultado do mesmo motor.
  const overdue = analyzed.filter(isCrmReportsOverdue).sort(compareCrmReportsOverdue);

  const indicators: CrmReportsIndicators = {
    customersPurchased60d: recent60d.length,
    repurchaseDueNext15d: analyzed.filter(
      (facts) =>
        facts.cadence.deltaDays != null &&
        facts.cadence.deltaDays >= -REPURCHASE_DUE_SOON_DAYS &&
        facts.cadence.deltaDays <= 0
    ).length,
    overdueRepurchase: overdue.length,
    severelyOverdueRepurchase: overdue.filter(
      (facts) => (facts.cadence.deltaDays ?? 0) > REPURCHASE_SEVERE_OVERDUE_DAYS
    ).length,
    insufficientCadence: cadence.filter((facts) => facts.cadence.status === "INSUFFICIENT_HISTORY")
      .length,
  };

  return {
    windows,
    universe: {
      authorizedCustomers: args.authorizedCustomers,
      matchedBeforeExclusions: matched.length,
      manuallyExcluded: matched.length - analyzed.length,
      analyzedCustomers: analyzed.length,
    },
    selection: {
      mode: args.customerSelection.mode,
      requestedIds: selectedIds.size,
      idsOutsideUniverse,
    },
    indicators,
    analyzed,
    recent60d,
    cadence,
    overdue,
    futureDatedOrdersIgnored: analyzed.reduce((acc, facts) => acc + facts.futureDatedOrders, 0),
  };
}

/**
 * Visões das listas sobre o resultado JÁ calculado pelo motor: filtram por
 * status e reordenam. Não recalculam nada e não mexem nos indicadores — por
 * isso "card clicado" = "lista filtrada pelo mesmo status" reconcilia.
 */
export function applyCrmReportsViews(
  analysis: Pick<CrmReportsAnalysis, "cadence" | "overdue">,
  views: CrmReportsNormalizedViews
): { cadence: CrmReportsCustomerFacts[]; overdue: CrmReportsCustomerFacts[] } {
  const statuses = new Set(views.cadence.statuses);
  const cadence =
    statuses.size === 0
      ? [...analysis.cadence]
      : analysis.cadence.filter((facts) => statuses.has(facts.cadence.status));
  const severe = views.overdue.severity === "SEVERE";
  const overdue = analysis.overdue.filter(
    (facts) => !severe || facts.cadence.status === "SEVERELY_OVERDUE"
  );
  overdue.sort(
    views.overdue.sort === "VALUE_12M_DESC" ? compareCrmReportsOverdueByValue : compareCrmReportsOverdue
  );
  return { cadence, overdue };
}

// ---------------------------------------------------------------------------
// Paginação e DTOs
// ---------------------------------------------------------------------------

export type CrmReportsPaginated<T> = {
  slice: T[];
  /** Tamanho da lista inteira — nunca o da página. */
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
};

export function paginateCrmReportsRows<T>(
  rows: readonly T[],
  page: CrmReportsNormalizedPage
): CrmReportsPaginated<T> {
  const slice = rows.slice(page.offset, page.offset + page.limit);
  return {
    slice,
    total: rows.length,
    limit: page.limit,
    offset: page.offset,
    returned: slice.length,
    hasMore: page.offset + slice.length < rows.length,
  };
}

export function buildCrmReportsPage<Facts, Row>(
  paginated: CrmReportsPaginated<Facts>,
  listKey: CrmReportsListKey,
  toRow: (facts: Facts) => Row,
  sort: readonly string[] = CRM_REPORTS_LIST_SORT[listKey]
): CrmReportsPage<Row> {
  return {
    rows: paginated.slice.map(toRow),
    total: paginated.total,
    limit: paginated.limit,
    offset: paginated.offset,
    returned: paginated.returned,
    hasMore: paginated.hasMore,
    sort,
  };
}

/** Dinheiro de apresentação (centavos). A soma interna é exata em micro-unidades. */
export function roundCrmReportsMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundTwoDecimals(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type CrmReportsOwnerDisplay = { name: string | null; externalSellerId: number | null } | null;

export type CrmReportsSellerDisplay = {
  externalSellerId: number | null;
  name: string | null;
  label: string;
  resolution: CrmReportsLastOrderSellerFields["lastOrderSellerResolution"];
};

export type CrmReportsFollowUpDisplay = {
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  hasOverdueFollowUp: boolean;
};

function identityFields(
  facts: CrmReportsCustomerFacts,
  owner: CrmReportsOwnerDisplay
): CrmReportsCustomerIdentity {
  return {
    customerId: facts.customer.id,
    displayName: facts.customer.companyName,
    tradeName: facts.customer.tradeName ?? null,
    taxId: facts.customer.taxId,
    city: facts.customer.city ?? null,
    state: facts.customer.state ?? null,
    commercialOwnerName: owner?.name ?? null,
    commercialOwnerExternalId: owner?.externalSellerId ?? null,
  };
}

function cadenceFields(facts: CrmReportsCustomerFacts): CrmReportsCadenceFields {
  const c = facts.cadence;
  return {
    totalOccasions: c.totalOccasions,
    occasionsUsed: c.occasionsUsed,
    intervalsUsed: c.intervalsUsed,
    averageRepurchaseDays: roundTwoDecimals(c.averageRepurchaseDays),
    averageRepurchaseDaysRounded: c.averageRepurchaseDaysRounded,
    expectedRepurchaseDate: c.expectedRepurchaseDate,
    deltaDays: c.deltaDays,
    repurchaseStatus: c.status,
    cadenceConfidence: c.cadenceConfidence,
  };
}

function sellerFields(
  facts: CrmReportsCustomerFacts,
  seller: CrmReportsSellerDisplay | null
): CrmReportsLastOrderSellerFields {
  return {
    lastOrderId: facts.lastOrder?.id ?? null,
    lastOrderCode: facts.lastOrder?.orderCode ?? null,
    lastOrderSellerExternalId: seller?.externalSellerId ?? facts.lastOrder?.externalSellerId ?? null,
    lastOrderSellerName: seller?.name ?? null,
    lastOrderSellerLabel: seller?.label ?? "—",
    lastOrderSellerResolution: seller?.resolution ?? "NO_SELLER",
  };
}

export function toCrmReportsRecent60dRow(
  facts: CrmReportsCustomerFacts,
  owner: CrmReportsOwnerDisplay,
  seller: CrmReportsSellerDisplay | null
): CrmReportsRecent60dRow {
  return {
    ...identityFields(facts, owner),
    ...sellerFields(facts, seller),
    ...cadenceFields(facts),
    lastPurchaseDate: facts.lastPurchaseDate!,
    daysSinceLastPurchase: facts.daysSinceLastPurchase!,
    orders60d: facts.orders60d,
    purchaseValue60d: roundCrmReportsMoney(facts.purchaseValue60d),
    averageTicket60d: roundCrmReportsMoney(facts.averageTicket60d),
  };
}

export function toCrmReportsCadenceRow(
  facts: CrmReportsCustomerFacts,
  owner: CrmReportsOwnerDisplay
): CrmReportsCadenceRow {
  return {
    ...identityFields(facts, owner),
    ...cadenceFields(facts),
    lastPurchaseDate: facts.lastPurchaseDate!,
    daysSinceLastPurchase: facts.daysSinceLastPurchase!,
    orders12m: facts.orders12m,
    purchaseValue12m: roundCrmReportsMoney(facts.purchaseValue12m),
    averageTicket12m: roundCrmReportsMoney(facts.averageTicket12m),
  };
}

export function toCrmReportsOverdueRow(
  facts: CrmReportsCustomerFacts,
  owner: CrmReportsOwnerDisplay,
  seller: CrmReportsSellerDisplay | null,
  followUp: CrmReportsFollowUpDisplay | null
): CrmReportsOverdueRow {
  return {
    ...identityFields(facts, owner),
    ...sellerFields(facts, seller),
    ...cadenceFields(facts),
    lastPurchaseDate: facts.lastPurchaseDate!,
    daysSinceLastPurchase: facts.daysSinceLastPurchase!,
    overdueDays: facts.cadence.deltaDays!,
    orders12m: facts.orders12m,
    purchaseValue12m: roundCrmReportsMoney(facts.purchaseValue12m),
    averageTicket12m: roundCrmReportsMoney(facts.averageTicket12m),
    lastContactAt: followUp?.lastContactAt ? followUp.lastContactAt.toISOString() : null,
    nextFollowUpAt: followUp?.nextFollowUpAt ? followUp.nextFollowUpAt.toISOString() : null,
    hasOverdueFollowUp: followUp?.hasOverdueFollowUp ?? false,
  };
}
