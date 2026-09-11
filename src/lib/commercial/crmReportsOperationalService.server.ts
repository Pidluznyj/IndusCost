/**
 * CRM > Relatórios — serviço operacional (shell de I/O do núcleo puro).
 *
 * Pipeline (todas as consultas em LOTE — nunca um pedido por cliente):
 *
 *   AUTH (rota)
 *     → CrmCommercialAccessScope (global | own; none = proibido)
 *     → clientes autorizados: ativos, fora do grupo econômico e, no `own`, só
 *       a carteira do Responsável Comercial (CrmCustomerCommercialOwner)
 *     → filtros de inclusão (responsável — só global —, cidade, UF)
 *     → pedidos canônicos: `crmCanonicalSalesOrderWhere` + customerId em lote
 *     → agregação por cliente → ocasiões → `crmRepurchaseEngine`
 *     → filtro "vendedor do último pedido" (fragmento canônico de Pedidos)
 *     → seleção analítica (EXCLUDE / ONLY) → indicadores + 3 listas
 *     → enriquecimento SÓ das linhas da página (responsável, vendedor,
 *       follow-up) → DTO
 *
 * Não decide validade de pedido, não escreve nada, não cria cache.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { CRM_NO_COMMERCIAL_ACCESS_MESSAGE } from "@/src/lib/crmCommercialAccessScope.js";
import {
  aggregateCustomerActivities,
  fetchCrmManualOwnerCustomerIds,
  parseCrmCustomerListSellerQuery,
  resolveCrmCustomerListSellerScopeFilter,
  type CrmCustomerListSellerQuery,
  type CrmSellerScopeFilter,
} from "@/src/lib/crmCustomersList.js";
import { crmCanonicalSalesOrderWhere } from "@/src/lib/commercial/crmCanonicalSalesOrderScope.server.js";
import { crmEligibleCustomerWhere } from "@/src/lib/commercial/crmManagementOrderFacts.server.js";
import {
  resolveCommercialResponsibleMap,
  type CommercialResponsibleMap,
} from "@/src/lib/commercial/crmCommercialResponsibleResolver.js";
import { loadCommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.server.js";
import type { CommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.js";
import {
  buildSalesOrderNomusSellerDto,
  buildSalesOrderNomusSellerWhereFilter,
  buildSalesOrderNomusSellerWhereFromSellerKey,
  formatSalesOrderNomusSellerListLabel,
} from "@/src/lib/salesOrderNomusSellerDisplay.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import {
  CRM_REPURCHASE_ENGINE_VERSION,
  type CrmReportsNormalizedFilters,
  type CrmReportsNormalizedRequest,
  type CrmReportsOperationalResponse,
  type CrmReportsScopeInfo,
  type CrmReportsSourceInfo,
} from "@/src/lib/commercial/crmReportsTypes.js";
import {
  buildCrmReportsAnalysis,
  buildCrmReportsPage,
  paginateCrmReportsRows,
  resolveCrmReportsWindows,
  selectCrmReportsInclusionCandidates,
  toCrmReportsCadenceRow,
  toCrmReportsOverdueRow,
  toCrmReportsRecent60dRow,
  type CrmReportsAnalysis,
  type CrmReportsCustomerFacts,
  type CrmReportsCustomerRecord,
  type CrmReportsFollowUpDisplay,
  type CrmReportsLastOrder,
  type CrmReportsOrderRecord,
  type CrmReportsOwnerDisplay,
  type CrmReportsSellerDisplay,
} from "@/src/lib/commercial/crmReportsOperationalCore.js";

/** IDs por consulta `IN` (clientes e pedidos). */
export const CRM_REPORTS_ID_CHUNK_SIZE = 1000;
/**
 * Proteção de memória. Não é teto de exibição: se a carga passar disso a
 * request FALHA com erro explícito — nunca devolve número subestimado.
 */
export const CRM_REPORTS_MAX_ORDERS_LOADED = 400_000;

export const CRM_REPORTS_VALIDITY_SOURCE =
  "crmCanonicalSalesOrderWhere → buildSalesOrderListWhere (população oficial da tela Pedidos de Venda, grupo econômico excluído)";

export class CrmReportsForbiddenError extends Error {
  constructor() {
    super(CRM_NO_COMMERCIAL_ACCESS_MESSAGE);
    this.name = "CrmReportsForbiddenError";
  }
}

export class CrmReportsCapacityError extends Error {
  constructor(
    readonly ordersLoaded: number,
    readonly limit: number
  ) {
    super(
      `O universo filtrado passa de ${limit.toLocaleString("pt-BR")} pedidos. Refine os filtros (responsável, cidade, UF ou seleção de clientes).`
    );
    this.name = "CrmReportsCapacityError";
  }
}

export type CrmReportsActivityRecord = {
  customerId: string;
  contactDate: Date | null;
  createdAt: Date;
  nextActionAt: Date | null;
  status: string | null;
};

/**
 * Fonte de dados do relatório. Cada método é UMA consulta em lote; o serviço
 * compõe os `where` (sempre a partir dos construtores canônicos).
 */
export type CrmReportsDataSource = {
  findCustomers(where: Prisma.CustomerWhereInput): Promise<CrmReportsCustomerRecord[]>;
  /** Carteira = CrmCustomerCommercialOwner ativo (nunca vendedor do pedido). */
  findManualOwnerCustomerIds(filter: CrmSellerScopeFilter): Promise<string[]>;
  findSalesOrders(where: Prisma.SalesOrderWhereInput): Promise<CrmReportsOrderRecord[]>;
  resolveCommercialOwners(customerIds: readonly string[]): Promise<CommercialResponsibleMap>;
  findActivities(customerIds: readonly string[]): Promise<CrmReportsActivityRecord[]>;
  loadSellerIdentityContext(): Promise<CommissionSellerIdentityContext>;
};

export const CRM_REPORTS_CUSTOMER_SELECT = {
  id: true,
  companyName: true,
  tradeName: true,
  taxId: true,
  city: true,
  state: true,
} as const;

/** Mínimo necessário do pedido — nada de NF, proposta, comissão ou payload bruto. */
export const CRM_REPORTS_ORDER_SELECT = {
  id: true,
  customerId: true,
  orderCode: true,
  issueDate: true,
  totalNetValue: true,
  externalSellerId: true,
  nomusSellerName: true,
} as const;

export const CRM_REPORTS_ACTIVITY_SELECT = {
  customerId: true,
  contactDate: true,
  createdAt: true,
  nextActionAt: true,
  status: true,
} as const;

export function createPrismaCrmReportsDataSource(prisma: PrismaClient): CrmReportsDataSource {
  return {
    async findCustomers(where) {
      return prisma.customer.findMany({ where, select: CRM_REPORTS_CUSTOMER_SELECT });
    },
    findManualOwnerCustomerIds(filter) {
      return fetchCrmManualOwnerCustomerIds(prisma, filter);
    },
    async findSalesOrders(where) {
      const rows = await prisma.salesOrder.findMany({ where, select: CRM_REPORTS_ORDER_SELECT });
      return rows.map((row) => ({
        id: row.id,
        customerId: row.customerId,
        orderCode: row.orderCode,
        issueDate: row.issueDate,
        totalNetValue: decimalToNumber(row.totalNetValue) ?? 0,
        externalSellerId: row.externalSellerId,
        nomusSellerName: row.nomusSellerName,
      }));
    },
    resolveCommercialOwners(customerIds) {
      return resolveCommercialResponsibleMap(prisma, customerIds);
    },
    async findActivities(customerIds) {
      if (customerIds.length === 0) return [];
      return prisma.commercialActivity.findMany({
        where: { customerId: { in: [...customerIds] } },
        select: CRM_REPORTS_ACTIVITY_SELECT,
      });
    },
    loadSellerIdentityContext() {
      return loadCommissionSellerIdentityContext(prisma);
    },
  };
}

function chunkIds<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const NO_OWNER_QUERY: CrmCustomerListSellerQuery = {
  externalSellerId: null,
  externalSellerIds: [],
  sellerIdentityKey: null,
};

function assertReportableScope(scope: CrmCommercialAccessScope): "global" | "own" {
  if (scope.dataScope === "global" || scope.dataScope === "own") return scope.dataScope;
  throw new CrmReportsForbiddenError();
}

/**
 * Clientes autorizados: ativos ∧ fora do grupo econômico ∧ carteira do escopo.
 * `own` sem vínculo → carteira vazia (nunca cai no universo global).
 */
async function loadAuthorizedCustomers(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope
): Promise<CrmReportsCustomerRecord[]> {
  const decision = resolveCrmCustomerListSellerScopeFilter(scope, NO_OWNER_QUERY);
  if (decision === "none") return [];
  if (decision === "all") return ds.findCustomers(crmEligibleCustomerWhere());

  const portfolioIds = await ds.findManualOwnerCustomerIds(decision);
  if (portfolioIds.length === 0) return [];
  const customers: CrmReportsCustomerRecord[] = [];
  for (const ids of chunkIds([...new Set(portfolioIds)], CRM_REPORTS_ID_CHUNK_SIZE)) {
    customers.push(...(await ds.findCustomers({ AND: [crmEligibleCustomerWhere(), { id: { in: ids } }] })));
  }
  return customers;
}

/**
 * Filtro de Responsável Comercial. Só escopo global o aplica; no `own` ele é
 * ignorado (a carteira do usuário já foi forçada) — nunca amplia acesso.
 */
async function resolveOwnerFilter(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope,
  filters: CrmReportsNormalizedFilters
): Promise<{ ids: Set<string> | null; applied: boolean; ignored: boolean }> {
  const requested = filters.commercialOwner;
  if (!requested) return { ids: null, applied: false, ignored: false };
  if (scope.dataScope !== "global") return { ids: null, applied: false, ignored: true };

  const sellerQuery = parseCrmCustomerListSellerQuery(
    requested.externalSellerId,
    requested.sellerIdentityKey,
    requested.externalSellerIds
  );
  const decision = resolveCrmCustomerListSellerScopeFilter(scope, sellerQuery);
  if (decision === "all") return { ids: null, applied: false, ignored: false };
  if (decision === "none") return { ids: new Set(), applied: true, ignored: false };
  return { ids: new Set(await ds.findManualOwnerCustomerIds(decision)), applied: true, ignored: false };
}

/** Pedidos canônicos (histórico inteiro) dos clientes informados, em lotes. */
async function loadCanonicalOrdersByCustomer(
  ds: CrmReportsDataSource,
  customerIds: readonly string[]
): Promise<{ byCustomer: Map<string, CrmReportsOrderRecord[]>; loaded: number }> {
  const byCustomer = new Map<string, CrmReportsOrderRecord[]>();
  if (customerIds.length === 0) return { byCustomer, loaded: 0 };
  const wanted = new Set(customerIds);
  // Histórico inteiro: a recompra precisa achar as últimas 6 ocasiões reais,
  // sem o horizonte de meses do cockpit.
  const canonicalWhere = crmCanonicalSalesOrderWhere({ allYears: true }, { ignorePeriod: true });
  let loaded = 0;
  for (const ids of chunkIds([...wanted], CRM_REPORTS_ID_CHUNK_SIZE)) {
    const rows = await ds.findSalesOrders({ AND: [canonicalWhere, { customerId: { in: ids } }] });
    loaded += rows.length;
    if (loaded > CRM_REPORTS_MAX_ORDERS_LOADED) {
      throw new CrmReportsCapacityError(loaded, CRM_REPORTS_MAX_ORDERS_LOADED);
    }
    for (const row of rows) {
      if (!wanted.has(row.customerId)) continue;
      const list = byCustomer.get(row.customerId);
      if (list) list.push(row);
      else byCustomer.set(row.customerId, [row]);
    }
  }
  return { byCustomer, loaded };
}

function createSellerContextLoader(ds: CrmReportsDataSource) {
  let pending: Promise<CommissionSellerIdentityContext> | null = null;
  return () => {
    pending ??= ds.loadSellerIdentityContext();
    return pending;
  };
}

/**
 * "Vendedor do último pedido": fragmento dos construtores canônicos da tela
 * Pedidos de Venda. `sellerKey` tem prioridade sobre o nome (mesma ordem de
 * `resolveSalesOrderListSellerWhere`).
 */
async function resolveLastOrderSellerWhere(
  filters: CrmReportsNormalizedFilters,
  loadSellerContext: () => Promise<CommissionSellerIdentityContext>
): Promise<Record<string, unknown> | null> {
  const requested = filters.lastOrderSeller;
  if (!requested) return null;
  const byKey = buildSalesOrderNomusSellerWhereFromSellerKey(requested.sellerKey);
  if (byKey !== null) return byKey as Record<string, unknown>;
  if (!requested.sellerName) return null;
  const ctx = await loadSellerContext();
  return buildSalesOrderNomusSellerWhereFilter(requested.sellerName, ctx) as Record<string, unknown> | null;
}

export type CrmReportsRunOptions = { now?: Date };

export type CrmReportsRun = {
  now: Date;
  analysis: CrmReportsAnalysis;
  scope: CrmReportsScopeInfo;
  ordersLoaded: number;
  loadSellerContext: () => Promise<CommissionSellerIdentityContext>;
};

/**
 * Executa o pipeline até a análise completa (universo, indicadores e listas
 * inteiras, sem paginação). Base do endpoint e do verificador.
 */
export async function runCrmReportsAnalysis(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope,
  filters: CrmReportsNormalizedFilters,
  options: CrmReportsRunOptions = {}
): Promise<CrmReportsRun> {
  const dataScope = assertReportableScope(scope);
  const now = options.now ?? new Date();
  const windows = resolveCrmReportsWindows(now);
  const loadSellerContext = createSellerContextLoader(ds);

  const authorized = await loadAuthorizedCustomers(ds, scope);
  const owner = await resolveOwnerFilter(ds, scope, filters);
  const candidates = selectCrmReportsInclusionCandidates({
    authorizedCustomers: authorized,
    customerIds: filters.customerIds,
    ownerFilterCustomerIds: owner.ids,
    cities: filters.cities,
    states: filters.states,
  });

  // Sem filtro de vendedor, quem sai pela seleção analítica não precisa de
  // pedidos: `matchedBeforeExclusions` já é o total de candidatos. Com o
  // filtro, todos os candidatos precisam do último pedido.
  const selection = filters.customerSelection;
  const selectedIds = new Set(selection.customerIds);
  const orderCustomerIds = candidates
    .filter((customer) => {
      if (filters.lastOrderSeller || selection.mode === "ALL") return true;
      return selection.mode === "ONLY" ? selectedIds.has(customer.id) : !selectedIds.has(customer.id);
    })
    .map((customer) => customer.id);
  const orders = await loadCanonicalOrdersByCustomer(ds, orderCustomerIds);

  const lastOrderSellerWhere = await resolveLastOrderSellerWhere(filters, loadSellerContext);
  const analysis = buildCrmReportsAnalysis({
    windows,
    authorizedCustomers: authorized.length,
    candidates,
    ordersByCustomer: orders.byCustomer,
    lastOrderSellerWhere,
    customerSelection: selection,
  });

  return {
    now,
    analysis,
    scope: {
      dataScope,
      sellerLinked: scope.sellerLinked,
      blockedReason: scope.blockedReason,
      blockedMessage: scope.blockedMessage,
      commercialOwnerFilterApplied: owner.applied,
      commercialOwnerFilterIgnored: owner.ignored,
    },
    ordersLoaded: orders.loaded,
    loadSellerContext,
  };
}

function resolveServerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "LOCAL";
  } catch {
    return "LOCAL";
  }
}

function toSellerDisplay(
  lastOrder: CrmReportsLastOrder | null,
  ctx: CommissionSellerIdentityContext | null
): CrmReportsSellerDisplay | null {
  if (!lastOrder || !ctx) return null;
  const dto = buildSalesOrderNomusSellerDto(
    { externalSellerId: lastOrder.externalSellerId, issueDate: lastOrder.issueDate },
    ctx
  );
  return {
    externalSellerId: dto.externalSellerId,
    name: dto.name,
    label: formatSalesOrderNomusSellerListLabel(dto),
    resolution: dto.resolutionStatus,
  };
}

function toOwnerDisplay(map: CommercialResponsibleMap, customerId: string): CrmReportsOwnerDisplay {
  const owner = map.get(customerId);
  if (!owner) return null;
  return { name: owner.sellerCanonicalName, externalSellerId: owner.sellerExternalId };
}

/** POST /api/crm/reports/operational — universo, indicadores e 3 listas paginadas. */
export async function loadCrmReportsOperational(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope,
  request: CrmReportsNormalizedRequest,
  options: CrmReportsRunOptions = {}
): Promise<CrmReportsOperationalResponse> {
  const run = await runCrmReportsAnalysis(ds, scope, request.filters, options);
  const { analysis } = run;

  const recent = paginateCrmReportsRows(analysis.recent60d, request.pagination.recent);
  const cadence = paginateCrmReportsRows(analysis.cadence, request.pagination.cadence);
  const overdue = paginateCrmReportsRows(analysis.overdue, request.pagination.overdue);

  // Enriquecimento só do que vai para a tela (≤ 3 páginas), em lote.
  const pageFacts: CrmReportsCustomerFacts[] = [...recent.slice, ...cadence.slice, ...overdue.slice];
  const pageCustomerIds = [...new Set(pageFacts.map((facts) => facts.customer.id))];
  const owners: CommercialResponsibleMap =
    pageCustomerIds.length > 0 ? await ds.resolveCommercialOwners(pageCustomerIds) : new Map();
  const sellerCtx =
    recent.slice.length + overdue.slice.length > 0 ? await run.loadSellerContext() : null;
  const overdueIds = overdue.slice.map((facts) => facts.customer.id);
  const followUps =
    overdueIds.length > 0
      ? aggregateCustomerActivities(await ds.findActivities(overdueIds), run.now)
      : new Map<string, CrmReportsFollowUpDisplay>();

  const sourceInfo: CrmReportsSourceInfo = {
    orderSource: "SalesOrder",
    dateAxis: "SalesOrder.issueDate",
    businessDateAxis: "LOCAL_CALENDAR_DAY",
    businessTimeZone: resolveServerTimeZone(),
    validitySource: CRM_REPORTS_VALIDITY_SOURCE,
    portfolioAxis: "RESPONSAVEL_COMERCIAL_CLIENTE",
    orderSellerAxis: "AUDIT_ONLY",
    relationshipSource: "CommercialActivity (enriquecimento; não cria compra)",
    repurchaseVersion: CRM_REPURCHASE_ENGINE_VERSION,
    historyWindow: "FULL_HISTORY",
    proposalsUsedAsPurchase: false,
    invoicesUsedAsPurchase: false,
    commissionsUsedAsPurchase: false,
    truncated: false,
    ordersLoaded: run.ordersLoaded,
    futureDatedOrdersIgnored: analysis.futureDatedOrdersIgnored,
  };

  return {
    asOf: run.now.toISOString(),
    windows: analysis.windows,
    scope: run.scope,
    selection: analysis.selection,
    appliedFilters: request.filters,
    sourceInfo,
    universe: analysis.universe,
    indicators: analysis.indicators,
    recent60d: buildCrmReportsPage(recent, "recent", (facts) =>
      toCrmReportsRecent60dRow(
        facts,
        toOwnerDisplay(owners, facts.customer.id),
        toSellerDisplay(facts.lastOrder, sellerCtx)
      )
    ),
    repurchaseCadence: buildCrmReportsPage(cadence, "cadence", (facts) =>
      toCrmReportsCadenceRow(facts, toOwnerDisplay(owners, facts.customer.id))
    ),
    overdueRepurchase: buildCrmReportsPage(overdue, "overdue", (facts) =>
      toCrmReportsOverdueRow(
        facts,
        toOwnerDisplay(owners, facts.customer.id),
        toSellerDisplay(facts.lastOrder, sellerCtx),
        followUps.get(facts.customer.id) ?? null
      )
    ),
  };
}
