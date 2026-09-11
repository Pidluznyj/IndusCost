/**
 * Contratos da aba CRM > Relatórios — listas operacionais de recompra (V1).
 *
 * Módulo de TIPOS e CONSTANTES, sem Prisma/Express/React: o frontend importa
 * daqui. Nenhuma regra de negócio mora neste arquivo.
 *
 * Eixos (não misturar):
 *   - COMPRA         → Pedido de Venda canônico. Data = `SalesOrder.issueDate`.
 *                      População = `crmCanonicalSalesOrderWhere` (mesma da tela
 *                      Pedidos de Venda). NF, proposta, atividade e comissão
 *                      NUNCA criam compra.
 *   - CARTEIRA       → Responsável Comercial do cliente
 *                      (`CrmCustomerCommercialOwner` ativo). Define o escopo.
 *   - VENDEDOR NOMUS → vendedor do ÚLTIMO pedido canônico. Só exibição/filtro;
 *                      nunca concede acesso nem recorta a cadência.
 *   - RELACIONAMENTO → `CommercialActivity`. Só enriquecimento (contato e
 *                      follow-up); não interfere em compra/recompra.
 *
 * Norma: docs/commercial/crm-reports-repurchase-engine.md
 */

/** Versão do motor — muda se a regra da cadência mudar. */
export const CRM_REPURCHASE_ENGINE_VERSION = "LAST_6_DISTINCT_PURCHASE_DAYS_MEAN_V1" as const;
export type CrmRepurchaseEngineVersion = typeof CRM_REPURCHASE_ENGINE_VERSION;

export const CRM_REPURCHASE_STATUSES = [
  "NO_HISTORY",
  "INSUFFICIENT_HISTORY",
  "ON_TIME",
  "DUE_SOON",
  "OVERDUE",
  "SEVERELY_OVERDUE",
] as const;
export type CrmRepurchaseStatus = (typeof CRM_REPURCHASE_STATUSES)[number];

/** Status que só existem quando há previsão (≥ 2 ocasiões). */
export type CrmRepurchaseForecastStatus = Exclude<
  CrmRepurchaseStatus,
  "NO_HISTORY" | "INSUFFICIENT_HISTORY"
>;

export const CRM_CADENCE_CONFIDENCE_LEVELS = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;
export type CrmCadenceConfidence = (typeof CRM_CADENCE_CONFIDENCE_LEVELS)[number];

export const CRM_REPORTS_CUSTOMER_SELECTION_MODES = ["ALL", "EXCLUDE", "ONLY"] as const;
export type CrmReportsCustomerSelectionMode =
  (typeof CRM_REPORTS_CUSTOMER_SELECTION_MODES)[number];

/** Janela "comprou recentemente": hoje + 59 dias anteriores. */
export const CRM_REPORTS_RECENT_WINDOW_DAYS = 60;
/** Janela móvel própria de valor/ticket: hoje e os 12 meses anteriores. */
export const CRM_REPORTS_ROLLING_MONTHS = 12;

export const CRM_REPORTS_PAGE_DEFAULT_LIMIT = 50;
export const CRM_REPORTS_PAGE_MAX_LIMIT = 100;
/** Teto de IDs aceitos em `customerSelection` — acima disso a request é recusada (400), nunca truncada. */
export const CRM_REPORTS_MAX_SELECTION_IDS = 20000;

export const CRM_REPORTS_LIST_KEYS = ["recent", "cadence", "overdue"] as const;
export type CrmReportsListKey = (typeof CRM_REPORTS_LIST_KEYS)[number];

/** Ordenação da lista de atrasados: maior atraso (padrão) ou maior venda 12m. */
export const CRM_REPORTS_OVERDUE_SORTS = ["DELAY_DESC", "VALUE_12M_DESC"] as const;
export type CrmReportsOverdueSort = (typeof CRM_REPORTS_OVERDUE_SORTS)[number];

/** Recorte da lista de atrasados: todos (> 0 dia) ou só os graves (> 30 dias). */
export const CRM_REPORTS_OVERDUE_SEVERITIES = ["ALL", "SEVERE"] as const;
export type CrmReportsOverdueSeverity = (typeof CRM_REPORTS_OVERDUE_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Seleção analítica de clientes. Não altera Customer nem carteira: só recorta
 * o universo ANTES de calcular cards, listas e exportações.
 *   - ALL     → sem recorte (customerIds ignorado)
 *   - EXCLUDE → remove os IDs informados
 *   - ONLY    → mantém só os IDs informados (e que já estejam no escopo)
 */
export type CrmReportsCustomerSelection = {
  mode: CrmReportsCustomerSelectionMode;
  customerIds: string[];
};

/**
 * Filtro de Responsável Comercial (eixo carteira). Mesmo vocabulário do
 * GET /api/crm/customers. Só vale para escopo global — no escopo `own` é
 * ignorado e a carteira do próprio usuário é forçada.
 */
export type CrmReportsCommercialOwnerFilter = {
  sellerIdentityKey?: string | null;
  externalSellerId?: number | null;
  externalSellerIds?: number[] | null;
};

/**
 * "Vendedor do último pedido" (vendedor Nomus). Mesmo vocabulário do filtro
 * de vendedor da tela Pedidos de Venda:
 *   - sellerKey  → ID Nomus numérico ou `__NO_SELLER__` (prioridade)
 *   - sellerName → nome/ID resolvido por CommissionPerson/Alias
 * Seleciona clientes cujo ÚLTIMO pedido canônico é desse vendedor; a cadência
 * continua usando TODAS as compras válidas do cliente.
 */
export type CrmReportsLastOrderSellerFilter = {
  sellerKey?: string | null;
  sellerName?: string | null;
};

export type CrmReportsFilters = {
  /**
   * Filtro de INCLUSÃO por cliente(s): recorta o universo antes das
   * exclusões (conta em `matchedBeforeExclusions`). Ausente/vazio = sem
   * filtro. ID fora do escopo é ignorado — nunca amplia acesso.
   */
  customerIds?: string[] | null;
  commercialOwner?: CrmReportsCommercialOwnerFilter | null;
  lastOrderSeller?: CrmReportsLastOrderSellerFilter | null;
  /** Cidade(s) do cadastro do cliente — igualdade sem caixa/acento. */
  city?: string | string[] | null;
  /** UF(s) do cadastro do cliente — igualdade sem caixa/acento. */
  state?: string | string[] | null;
  customerSelection?: CrmReportsCustomerSelection | null;
};

export type CrmReportsPageRequest = {
  limit?: number | null;
  offset?: number | null;
};

/**
 * Visões das listas: SÓ selecionam/ordenam o resultado do motor — nunca
 * recalculam. Não mudam o universo nem os indicadores (cards).
 */
export type CrmReportsViewsRequest = {
  /** Status da cadência a mostrar na lista CADENCE (vazio = todos). */
  cadence?: { statuses?: CrmRepurchaseStatus[] | null } | null;
  overdue?: {
    severity?: CrmReportsOverdueSeverity | null;
    sort?: CrmReportsOverdueSort | null;
  } | null;
};

export type CrmReportsNormalizedViews = {
  cadence: { statuses: CrmRepurchaseStatus[] };
  overdue: { severity: CrmReportsOverdueSeverity; sort: CrmReportsOverdueSort };
};

export type CrmReportsOperationalRequest = {
  filters?: CrmReportsFilters | null;
  views?: CrmReportsViewsRequest | null;
  pagination?: Partial<Record<CrmReportsListKey, CrmReportsPageRequest | null>> | null;
};

/** Request já validado/normalizado pelo parser do backend. */
export type CrmReportsNormalizedFilters = {
  /** Vazio = sem filtro de cliente. */
  customerIds: string[];
  commercialOwner: {
    sellerIdentityKey: string | null;
    externalSellerId: number | null;
    externalSellerIds: number[];
  } | null;
  lastOrderSeller: {
    sellerKey: string | null;
    sellerName: string | null;
  } | null;
  cities: string[];
  states: string[];
  customerSelection: CrmReportsCustomerSelection;
};

export type CrmReportsNormalizedPage = { limit: number; offset: number };

export type CrmReportsNormalizedRequest = {
  filters: CrmReportsNormalizedFilters;
  views: CrmReportsNormalizedViews;
  pagination: Record<CrmReportsListKey, CrmReportsNormalizedPage>;
};

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type CrmReportsUniverse = {
  /** Clientes que o usuário pode ver: escopo CRM ∧ ativo ∧ fora do grupo econômico. */
  authorizedCustomers: number;
  /** Após filtros de inclusão (cliente(s), responsável, cidade, UF, vendedor do último pedido). */
  matchedBeforeExclusions: number;
  /** Removidos pela seleção analítica (EXCLUDE, ou fora da lista em ONLY). */
  manuallyExcluded: number;
  /** Universo efetivamente analisado = matchedBeforeExclusions − manuallyExcluded. */
  analyzedCustomers: number;
};

export type CrmReportsIndicators = {
  /** Última compra dentro dos últimos 60 dias (hoje + 59 anteriores). */
  customersPurchased60d: number;
  /** Recompra prevista para os próximos 15 dias: −15 ≤ deltaDays ≤ 0. */
  repurchaseDueNext15d: number;
  /** Recompra atrasada: deltaDays > 0 (inclui os gravemente atrasados). */
  overdueRepurchase: number;
  /** Recompra gravemente atrasada: deltaDays > 30. */
  severelyOverdueRepurchase: number;
  /** Uma única ocasião de compra — sem intervalo para prever. */
  insufficientCadence: number;
};

export type CrmReportsWindows = {
  /** Dia de referência do relatório (calendário local do servidor). */
  today: string;
  recent60d: { from: string; to: string; days: number };
  rolling12m: { from: string; to: string; months: number };
};

export type CrmReportsSourceInfo = {
  orderSource: "SalesOrder";
  dateAxis: "SalesOrder.issueDate";
  /** Dia de compra = dia civil de `issueDate` no fuso operacional do servidor. */
  businessDateAxis: "LOCAL_CALENDAR_DAY";
  businessTimeZone: string;
  validitySource: string;
  portfolioAxis: "RESPONSAVEL_COMERCIAL_CLIENTE";
  orderSellerAxis: "AUDIT_ONLY";
  relationshipSource: "CommercialActivity (enriquecimento; não cria compra)";
  repurchaseVersion: typeof CRM_REPURCHASE_ENGINE_VERSION;
  /** Histórico de recompra sem teto de meses (não herda o horizonte de 24m do cockpit). */
  historyWindow: "FULL_HISTORY";
  proposalsUsedAsPurchase: false;
  invoicesUsedAsPurchase: false;
  commissionsUsedAsPurchase: false;
  /** Sempre explícito: a carga não tem teto silencioso. */
  truncated: false;
  /** Pedidos canônicos carregados do banco para montar o relatório. */
  ordersLoaded: number;
  /** Pedidos do universo analisado com emissão posterior a `today` — fora das janelas e da cadência. */
  futureDatedOrdersIgnored: number;
};

export type CrmReportsScopeInfo = {
  dataScope: "global" | "own";
  sellerLinked: boolean;
  blockedReason: "SELLER_NOT_LINKED" | "FORBIDDEN" | null;
  blockedMessage: string | null;
  /** Filtro de responsável aplicado (só escopo global). */
  commercialOwnerFilterApplied: boolean;
  /** Filtro de responsável enviado por usuário `own` — ignorado, carteira forçada. */
  commercialOwnerFilterIgnored: boolean;
};

export type CrmReportsSelectionInfo = {
  mode: CrmReportsCustomerSelectionMode;
  requestedIds: number;
  /** IDs enviados que não estão no universo filtrado — ignorados (nunca ampliam acesso). */
  idsOutsideUniverse: number;
};

export type CrmReportsLastOrderSellerResolution =
  | "RESOLVED"
  | "RESOLVED_BY_ALIAS"
  | "SELLER_UNRESOLVED"
  | "NO_SELLER";

/** Identidade do cliente + Responsável Comercial (eixo carteira). */
export type CrmReportsCustomerIdentity = {
  customerId: string;
  displayName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
  /** Responsável Comercial ativo do cliente. `null` = sem responsável. */
  commercialOwnerName: string | null;
  commercialOwnerExternalId: number | null;
};

/** Vendedor Nomus do último pedido canônico — auditoria/filtro, nunca carteira. */
export type CrmReportsLastOrderSellerFields = {
  /** Abre o modal canônico de Pedido de Venda (SalesOrderDetailDialog). */
  lastOrderId: string | null;
  lastOrderCode: string | null;
  lastOrderSellerExternalId: number | null;
  lastOrderSellerName: string | null;
  /** Mesmo rótulo da coluna Vendedor em Pedidos de Venda. */
  lastOrderSellerLabel: string;
  lastOrderSellerResolution: CrmReportsLastOrderSellerResolution;
};

export type CrmReportsCadenceFields = {
  /** Ocasiões (dias distintos de compra) no histórico inteiro. */
  totalOccasions: number;
  /** Ocasiões usadas na média (as últimas, no máximo 6). */
  occasionsUsed: number;
  intervalsUsed: number;
  /** Média dos intervalos (apresentação: 2 casas). `null` sem intervalo. */
  averageRepurchaseDays: number | null;
  /** Média arredondada — é a que soma à última compra para achar a esperada. */
  averageRepurchaseDaysRounded: number | null;
  expectedRepurchaseDate: string | null;
  /** hoje − data esperada, em dias de calendário. Positivo = atrasado. */
  deltaDays: number | null;
  repurchaseStatus: CrmRepurchaseStatus;
  cadenceConfidence: CrmCadenceConfidence;
};

export type CrmReportsRecent60dRow = CrmReportsCustomerIdentity &
  CrmReportsLastOrderSellerFields &
  CrmReportsCadenceFields & {
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    orders60d: number;
    purchaseValue60d: number;
    averageTicket60d: number;
  };

export type CrmReportsCadenceRow = CrmReportsCustomerIdentity &
  CrmReportsCadenceFields & {
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    orders12m: number;
    purchaseValue12m: number;
    averageTicket12m: number;
  };

export type CrmReportsOverdueRow = CrmReportsCustomerIdentity &
  CrmReportsLastOrderSellerFields &
  CrmReportsCadenceFields & {
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    /** Dias de atraso = deltaDays (> 0). */
    overdueDays: number;
    orders12m: number;
    purchaseValue12m: number;
    averageTicket12m: number;
    /** Enriquecimento de relacionamento (CommercialActivity). */
    lastContactAt: string | null;
    nextFollowUpAt: string | null;
    hasOverdueFollowUp: boolean;
  };

export type CrmReportsPage<Row> = {
  rows: Row[];
  /** Total da lista no universo analisado — nunca o tamanho da página. */
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  /** Ordenação aplicada, na ordem de prioridade (`campo:asc|desc`). */
  sort: readonly string[];
};

export type CrmReportsOperationalResponse = {
  /** Instante de geração (ISO). */
  asOf: string;
  windows: CrmReportsWindows;
  scope: CrmReportsScopeInfo;
  selection: CrmReportsSelectionInfo;
  appliedFilters: CrmReportsNormalizedFilters;
  appliedViews: CrmReportsNormalizedViews;
  sourceInfo: CrmReportsSourceInfo;
  universe: CrmReportsUniverse;
  indicators: CrmReportsIndicators;
  recent60d: CrmReportsPage<CrmReportsRecent60dRow>;
  repurchaseCadence: CrmReportsPage<CrmReportsCadenceRow>;
  overdueRepurchase: CrmReportsPage<CrmReportsOverdueRow>;
};

// ---------------------------------------------------------------------------
// Opções leves e escopadas (filtros)
// ---------------------------------------------------------------------------

/** Busca de clientes para os filtros — só devolve clientes do escopo do usuário. */
export const CRM_REPORTS_CUSTOMER_OPTIONS_DEFAULT_LIMIT = 20;
export const CRM_REPORTS_CUSTOMER_OPTIONS_MAX_LIMIT = 50;
/** Resolução de rótulos por ID (chips selecionados). */
export const CRM_REPORTS_CUSTOMER_OPTIONS_MAX_IDS = 200;
/** Termo mínimo para buscar (evita varrer a carteira a cada tecla). */
export const CRM_REPORTS_CUSTOMER_SEARCH_MIN_CHARS = 2;

export type CrmReportsCustomerOption = {
  id: string;
  displayName: string;
  tradeName: string | null;
  taxId: string;
  city: string | null;
  state: string | null;
};

export type CrmReportsCustomerOptionsResponse = {
  options: CrmReportsCustomerOption[];
  /** Há mais resultados além do limite — refinar a busca. */
  hasMore: boolean;
  /** Modo da consulta: busca textual ou resolução de IDs. */
  mode: "search" | "ids";
};

export type CrmReportsCommercialOwnerOption = {
  key: string;
  label: string;
  /** Clientes autorizados com este Responsável Comercial ativo. */
  customerCount: number;
  /** Payload pronto para `filters.commercialOwner`. */
  filter: { sellerIdentityKey?: string; externalSellerId?: number };
};

export type CrmReportsLastOrderSellerOption = {
  /** Vocabulário da tela Pedidos de Venda (`__NO_SELLER__` ou ID Nomus). */
  sellerKey: string;
  label: string;
  /** Pedidos canônicos do escopo com este vendedor Nomus. */
  orderCount: number;
};

export type CrmReportsLocationOption = { value: string; customerCount: number };

export type CrmReportsFilterOptionsResponse = {
  scope: CrmReportsScopeInfo;
  /** Só escopo global filtra por responsável; no `own` a carteira é forçada. */
  commercialOwnerFilterEnabled: boolean;
  commercialOwners: CrmReportsCommercialOwnerOption[];
  lastOrderSellers: CrmReportsLastOrderSellerOption[];
  cities: CrmReportsLocationOption[];
  states: CrmReportsLocationOption[];
};

// ---------------------------------------------------------------------------
// Relatório personalizado (construtor) — executa SÓ ao clicar "Gerar"
// ---------------------------------------------------------------------------

export const CRM_CUSTOM_REPORT_DIMENSIONS = [
  "customer",
  "commercialOwner",
  "orderSeller",
  "month",
  "year",
  "city",
  "state",
] as const;
export type CrmCustomReportDimension = (typeof CRM_CUSTOM_REPORT_DIMENSIONS)[number];

/** Dimensões do PEDIDO (a linha passa a ser um recorte de pedidos, não de clientes). */
export const CRM_CUSTOM_REPORT_ORDER_DIMENSIONS: readonly CrmCustomReportDimension[] = [
  "orderSeller",
  "month",
  "year",
];

export const CRM_CUSTOM_REPORT_METRICS = [
  "soldValue",
  "orders",
  "customers",
  "averageTicket",
  "lastPurchaseDate",
  "daysSinceLastPurchase",
  "averageRepurchaseDays",
  "overdueDays",
] as const;
export type CrmCustomReportMetric = (typeof CRM_CUSTOM_REPORT_METRICS)[number];

/**
 * Onde cada métrica é segura:
 *   ALWAYS         → venda do período (valor, pedidos, clientes, ticket)
 *   NO_ORDER_DIM   → recência do cliente (histórico inteiro) — sem dimensão de pedido
 *   CUSTOMER_GRAIN → cadência do motor — 1 linha por cliente, sem dimensão de pedido
 */
export type CrmCustomReportMetricAvailability = "ALWAYS" | "NO_ORDER_DIM" | "CUSTOMER_GRAIN";

export const CRM_CUSTOM_REPORT_METRIC_AVAILABILITY: Record<
  CrmCustomReportMetric,
  CrmCustomReportMetricAvailability
> = {
  soldValue: "ALWAYS",
  orders: "ALWAYS",
  customers: "ALWAYS",
  averageTicket: "ALWAYS",
  lastPurchaseDate: "NO_ORDER_DIM",
  daysSinceLastPurchase: "NO_ORDER_DIM",
  averageRepurchaseDays: "CUSTOMER_GRAIN",
  overdueDays: "CUSTOMER_GRAIN",
};

export const CRM_CUSTOM_REPORT_DIMENSION_LABELS: Record<CrmCustomReportDimension, string> = {
  customer: "Cliente",
  commercialOwner: "Responsável Comercial",
  orderSeller: "Vendedor do pedido",
  month: "Mês",
  year: "Ano",
  city: "Cidade",
  state: "UF",
};

export const CRM_CUSTOM_REPORT_METRIC_LABELS: Record<CrmCustomReportMetric, string> = {
  soldValue: "Valor vendido",
  orders: "Pedidos",
  customers: "Clientes",
  averageTicket: "Ticket médio",
  lastPurchaseDate: "Última compra",
  daysSinceLastPurchase: "Dias sem compra",
  averageRepurchaseDays: "Tempo médio de recompra",
  overdueDays: "Dias de atraso",
};

export const CRM_CUSTOM_REPORT_CUSTOMER_STATUSES = [
  "ALL",
  "WITH_PURCHASE",
  "WITHOUT_PURCHASE",
  "REPURCHASE_OVERDUE",
  "REPURCHASE_DUE_SOON",
] as const;
export type CrmCustomReportCustomerStatus = (typeof CRM_CUSTOM_REPORT_CUSTOMER_STATUSES)[number];

export const CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS: Record<CrmCustomReportCustomerStatus, string> = {
  ALL: "Clientes com compra no período",
  WITH_PURCHASE: "Com compra no período",
  WITHOUT_PURCHASE: "Sem compra no período",
  REPURCHASE_OVERDUE: "Recompra atrasada",
  REPURCHASE_DUE_SOON: "Recompra nos próximos 15 dias",
};

export const CRM_CUSTOM_REPORT_MAX_DIMENSIONS = 3;
export const CRM_CUSTOM_REPORT_PAGE_DEFAULT_LIMIT = 100;
export const CRM_CUSTOM_REPORT_PAGE_MAX_LIMIT = 500;
/** Acima disso a request FALHA (422) — nunca devolve relatório truncado. */
export const CRM_CUSTOM_REPORT_MAX_ROWS = 50_000;

export type CrmCustomReportSortKey = CrmCustomReportDimension | CrmCustomReportMetric;
export type CrmCustomReportSortDirection = "asc" | "desc";

export type CrmCustomReportRequest = {
  /** Os MESMOS filtros globais da aba (universo, carteira, exclusões). */
  filters?: CrmReportsFilters | null;
  /** Recorte de emissão (dia civil) das métricas de venda. `null` = histórico inteiro. */
  period?: { from?: string | null; to?: string | null } | null;
  customerStatus?: CrmCustomReportCustomerStatus | null;
  dimensions: CrmCustomReportDimension[];
  metrics: CrmCustomReportMetric[];
  /** Subtotal por uma das dimensões escolhidas. */
  groupBy?: CrmCustomReportDimension | null;
  sort?: { by: CrmCustomReportSortKey; direction?: CrmCustomReportSortDirection | null } | null;
  pagination?: { limit?: number | null; offset?: number | null } | null;
};

export type CrmCustomReportSpec = {
  filters: CrmReportsNormalizedFilters;
  period: { from: string; to: string } | null;
  customerStatus: CrmCustomReportCustomerStatus;
  dimensions: CrmCustomReportDimension[];
  metrics: CrmCustomReportMetric[];
  groupBy: CrmCustomReportDimension | null;
  sort: { by: CrmCustomReportSortKey; direction: CrmCustomReportSortDirection };
  pagination: { limit: number; offset: number };
};

export type CrmCustomReportCell = { key: string; label: string; sublabel: string | null };
export type CrmCustomReportMetricValues = Partial<Record<CrmCustomReportMetric, number | string | null>>;

export type CrmCustomReportRow = {
  key: string;
  /** Presente quando a dimensão Cliente está no relatório (ação Cliente 360). */
  customerId: string | null;
  dimensions: Partial<Record<CrmCustomReportDimension, CrmCustomReportCell>>;
  metrics: CrmCustomReportMetricValues;
};

export type CrmCustomReportColumnFormat = "text" | "money" | "integer" | "date" | "days" | "decimal-days";

export type CrmCustomReportColumn = {
  key: CrmCustomReportSortKey;
  label: string;
  kind: "dimension" | "metric";
  format: CrmCustomReportColumnFormat;
};

export type CrmCustomReportGroup = {
  key: string;
  label: string;
  rowCount: number;
  metrics: CrmCustomReportMetricValues;
};

export type CrmCustomReportResponse = {
  asOf: string;
  today: string;
  spec: CrmCustomReportSpec;
  scope: CrmReportsScopeInfo;
  selection: CrmReportsSelectionInfo;
  universe: CrmReportsUniverse;
  sourceInfo: CrmReportsSourceInfo & {
    periodAxis: "SalesOrder.issueDate (dia civil local)";
    recencyAxis: "Histórico inteiro até hoje (motor de recompra)";
  };
  columns: CrmCustomReportColumn[];
  rows: CrmCustomReportRow[];
  /** Linhas do relatório inteiro — nunca o tamanho da página. */
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  /** Total geral (clientes = distintos, ticket = valor ÷ pedidos). */
  totals: CrmCustomReportMetricValues;
  /** Subtotais dos grupos presentes na página (quando `groupBy`). */
  groups: CrmCustomReportGroup[] | null;
};

export const CRM_REPORTS_LIST_SORT: Record<CrmReportsListKey, readonly string[]> = {
  recent: ["lastPurchaseDate:desc", "displayName:asc"],
  cadence: ["displayName:asc"],
  overdue: ["deltaDays:desc", "purchaseValue12m:desc", "displayName:asc"],
};

export const CRM_REPORTS_OVERDUE_SORT_FIELDS: Record<CrmReportsOverdueSort, readonly string[]> = {
  DELAY_DESC: CRM_REPORTS_LIST_SORT.overdue,
  VALUE_12M_DESC: ["purchaseValue12m:desc", "deltaDays:desc", "displayName:asc"],
};

export const CRM_REPORTS_DEFAULT_VIEWS: CrmReportsNormalizedViews = {
  cadence: { statuses: [] },
  overdue: { severity: "ALL", sort: "DELAY_DESC" },
};
