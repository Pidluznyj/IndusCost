/**
 * Contratos read-only dos motores oficiais — tipos puros, sem Prisma.
 * Provedores concretos: officialDataProviders.server.ts
 *
 * Sem previsão de demanda nesta superfície (OP-04).
 */

/** Filtro comum de catálogo (somente leitura). */
export type OfficialCatalogQuery = {
  /** Busca em código / descrição / nome. */
  q?: string;
  /** Máximo de linhas (default 50, teto 200). */
  limit?: number;
  /** Se true, só registros ativos/publicáveis. Default true. */
  activeOnly?: boolean;
};

export type OfficialMaterialRef = {
  id: string;
  code: string;
  description: string;
  unit: string;
  status: string | null;
  category: string | null;
};

export type OfficialProductRef = {
  id: string;
  /** SKU oficial (= código de produto). */
  sku: string;
  name: string;
  description: string | null;
  status: string | null;
  /** PRODUCT | COMPONENT */
  type: string;
  unit: string | null;
};

export type OfficialBomComponentRef = {
  id: string;
  productId: string;
  childProductId: string | null;
  materialId: string | null;
  quantity: number;
  unit: string | null;
  notes: string | null;
};

export type OfficialSupplierRef = {
  id: string;
  displayName: string;
  document: string | null;
  status: string;
  legalName: string | null;
  tradeName: string | null;
};

/** Centro de custo operacional (compras/estoque) — leitura via provider. */
export type OfficialOpsCostCenterRef = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

/** Centro de custo financeiro (AP) — somente leitura. */
export type OfficialFinancialCostCenterRef = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
};

export type OfficialSalesOrderRef = {
  id: string;
  orderCode: string;
  status: string;
  customerId: string;
};

export type OfficialProductionOrderRef = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  productCode: string | null;
  productDescription: string | null;
  quantity: number | null;
  unit: string | null;
};

export type OfficialProjectRef = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  customerName: string;
  projectType: string;
};

/** Custo publicado de MP (tabela MaterialCost* PUBLISHED). */
export type OfficialPublishedMaterialCostRef = {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  unit: string;
  landedCost: number;
  currentCost: number;
  versionId: string;
  versionCode: string;
  versionRevision: number;
  publishedAt: string | null;
  effectiveDate: string | null;
};

/** Custo publicado de produto/componente (ProductionCost* PUBLISHED). */
export type OfficialPublishedProductCostRef = {
  productId: string;
  productCode: string;
  productName: string;
  unitProductionCost: number;
  materialCost: number;
  currency: string;
  versionId: string;
  versionCode: string;
  versionRevision: number;
  publishedAt: string | null;
  effectiveDate: string | null;
};

/**
 * Cotação oficial de mercado (MI) — referência de preço, não cotação SC.
 * Somente leitura; SC não muta MaterialMarketQuote.
 */
export type OfficialMarketQuoteRef = {
  id: string;
  materialId: string;
  unit: string;
  netPrice: number;
  currency: string;
  quoteDate: string;
  supplierName: string | null;
  isOfficialReference: boolean;
};

export type OfficialNomusStockDocumentRef = {
  id: string;
  externalId: number;
  documentNumber: string | null;
  tipoDocumentoEstoque: string | null;
  statusRaw: string | null;
  personName: string | null;
  movementDate: string | null;
};

export type OfficialNomusNfeRef = {
  id: string;
  externalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  cnpjEmitente: string | null;
  isFornecedor: number | null;
};

export type OfficialMaterialReader = {
  findById(id: string): Promise<OfficialMaterialRef | null>;
  findByCode(code: string): Promise<OfficialMaterialRef | null>;
  list(query?: OfficialCatalogQuery): Promise<OfficialMaterialRef[]>;
};

export type OfficialProductBomReader = {
  findProductById(id: string): Promise<OfficialProductRef | null>;
  findProductBySku(sku: string): Promise<OfficialProductRef | null>;
  listProducts(query?: OfficialCatalogQuery & { type?: string }): Promise<OfficialProductRef[]>;
  listBomByProductId(productId: string): Promise<OfficialBomComponentRef[]>;
};

export type OfficialSupplierReader = {
  findById(id: string): Promise<OfficialSupplierRef | null>;
  list(query?: OfficialCatalogQuery): Promise<OfficialSupplierRef[]>;
};

export type OfficialOpsCostCenterReader = {
  findById(id: string): Promise<OfficialOpsCostCenterRef | null>;
  list(query?: OfficialCatalogQuery): Promise<OfficialOpsCostCenterRef[]>;
};

export type OfficialFinancialCostCenterReader = {
  findById(id: string): Promise<OfficialFinancialCostCenterRef | null>;
  list(query?: OfficialCatalogQuery): Promise<OfficialFinancialCostCenterRef[]>;
};

export type OfficialSalesOrderReader = {
  findById(id: string): Promise<OfficialSalesOrderRef | null>;
  findByOrderCode(orderCode: string): Promise<OfficialSalesOrderRef | null>;
};

export type OfficialProductionOrderReader = {
  findById(id: string): Promise<OfficialProductionOrderRef | null>;
  findByExternalId(externalId: number): Promise<OfficialProductionOrderRef | null>;
  list(query?: OfficialCatalogQuery): Promise<OfficialProductionOrderRef[]>;
};

export type OfficialProjectReader = {
  findById(id: string): Promise<OfficialProjectRef | null>;
  findByCode(code: string): Promise<OfficialProjectRef | null>;
  list(query?: OfficialCatalogQuery): Promise<OfficialProjectRef[]>;
};

export type OfficialPublishedCostReader = {
  findPublishedMaterialCost(materialId: string): Promise<OfficialPublishedMaterialCostRef | null>;
  findPublishedProductCost(productId: string): Promise<OfficialPublishedProductCostRef | null>;
  findOfficialMarketQuote(materialId: string): Promise<OfficialMarketQuoteRef | null>;
};

export type OfficialNomusCrossRefReader = {
  findStockDocumentById(id: string): Promise<OfficialNomusStockDocumentRef | null>;
  findStockDocumentByExternalId(externalId: number): Promise<OfficialNomusStockDocumentRef | null>;
  findNfeById(id: string): Promise<OfficialNomusNfeRef | null>;
  findNfeByExternalId(externalId: number): Promise<OfficialNomusNfeRef | null>;
};

/**
 * Superfície agregada — apenas métodos de leitura.
 * Serviços/telas SC devem depender desta superfície, não de Prisma oficial direto.
 */
export type OfficialDataProviders = {
  materials: OfficialMaterialReader;
  productsBom: OfficialProductBomReader;
  suppliers: OfficialSupplierReader;
  opsCostCenters: OfficialOpsCostCenterReader;
  financialCostCenters: OfficialFinancialCostCenterReader;
  salesOrders: OfficialSalesOrderReader;
  productionOrders: OfficialProductionOrderReader;
  projects: OfficialProjectReader;
  publishedCosts: OfficialPublishedCostReader;
  nomusCrossRefs: OfficialNomusCrossRefReader;
};

/** @deprecated Use OfficialDataProviders — alias de compatibilidade OP-03. */
export type OfficialEngineReadOnlySurface = OfficialDataProviders;
