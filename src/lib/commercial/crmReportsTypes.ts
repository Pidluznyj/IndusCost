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

export type CrmReportsOperationalRequest = {
  filters?: CrmReportsFilters | null;
  pagination?: Partial<Record<CrmReportsListKey, CrmReportsPageRequest | null>> | null;
};

/** Request já validado/normalizado pelo parser do backend. */
export type CrmReportsNormalizedFilters = {
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
  pagination: Record<CrmReportsListKey, CrmReportsNormalizedPage>;
};

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type CrmReportsUniverse = {
  /** Clientes que o usuário pode ver: escopo CRM ∧ ativo ∧ fora do grupo econômico. */
  authorizedCustomers: number;
  /** Após filtros de inclusão (responsável, cidade, UF, vendedor do último pedido). */
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
  sourceInfo: CrmReportsSourceInfo;
  universe: CrmReportsUniverse;
  indicators: CrmReportsIndicators;
  recent60d: CrmReportsPage<CrmReportsRecent60dRow>;
  repurchaseCadence: CrmReportsPage<CrmReportsCadenceRow>;
  overdueRepurchase: CrmReportsPage<CrmReportsOverdueRow>;
};

export const CRM_REPORTS_LIST_SORT: Record<CrmReportsListKey, readonly string[]> = {
  recent: ["lastPurchaseDate:desc", "displayName:asc"],
  cadence: ["displayName:asc"],
  overdue: ["deltaDays:desc", "purchaseValue12m:desc", "displayName:asc"],
};
