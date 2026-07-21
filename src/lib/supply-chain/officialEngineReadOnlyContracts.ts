/**
 * Contratos read-only dos motores oficiais — tipos puros, sem Prisma.
 * Adaptadores concretos vivem em officialEngineReadAdapters.server.ts.
 */

export type OfficialMaterialRef = {
  id: string;
  code: string;
  description: string;
  unit: string;
  status: string | null;
};

export type OfficialProductRef = {
  id: string;
  sku: string;
  name: string;
  status: string | null;
};

export type OfficialBomComponentRef = {
  id: string;
  productId: string;
  childProductId: string | null;
  materialId: string | null;
  quantity: number;
};

export type OfficialSupplierRef = {
  id: string;
  displayName: string;
  document: string | null;
  status: string;
};

export type OfficialSalesOrderRef = {
  id: string;
  orderCode: string | null;
  status: string | null;
};

export type OfficialProductionOrderRef = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
};

export type OfficialFinancialCostCenterRef = {
  id: string;
  code: string;
  name: string;
  status: string;
};

/** Leitura de matérias-primas oficiais. */
export type OfficialMaterialReader = {
  findById(id: string): Promise<OfficialMaterialRef | null>;
  findByCode(code: string): Promise<OfficialMaterialRef | null>;
};

/** Leitura de produtos e BOM. */
export type OfficialProductBomReader = {
  findProductById(id: string): Promise<OfficialProductRef | null>;
  listBomByProductId(productId: string): Promise<OfficialBomComponentRef[]>;
};

/** Leitura de fornecedor financeiro (AP). */
export type OfficialSupplierReader = {
  findById(id: string): Promise<OfficialSupplierRef | null>;
};

/** Leitura de pedido de venda. */
export type OfficialSalesOrderReader = {
  findById(id: string): Promise<OfficialSalesOrderRef | null>;
};

/** Leitura de OP oficial Nomus. */
export type OfficialProductionOrderReader = {
  findById(id: string): Promise<OfficialProductionOrderRef | null>;
};

/** Leitura de centro de custo financeiro (≠ CostCenter ops). */
export type OfficialFinancialCostCenterReader = {
  findById(id: string): Promise<OfficialFinancialCostCenterRef | null>;
};

/**
 * Superfície agregada — apenas métodos de leitura.
 * Não inclui create/update/delete/upsert.
 */
export type OfficialEngineReadOnlySurface = {
  materials: OfficialMaterialReader;
  productsBom: OfficialProductBomReader;
  suppliers: OfficialSupplierReader;
  salesOrders: OfficialSalesOrderReader;
  productionOrders: OfficialProductionOrderReader;
  financialCostCenters: OfficialFinancialCostCenterReader;
};
