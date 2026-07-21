/**
 * OP-03 — Fronteira dos motores oficiais para a Cadeia de Suprimentos.
 * Fase 1: SC só lê; create/update/delete/upsert nos protegidos é proibido.
 */

/** Delegates Prisma (camelCase) protegidos contra escrita pela SC. */
export const OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS = [
  // Matérias-primas
  "material",
  // Produtos / BOM / engenharia
  "product",
  "productBOM",
  "productRouting",
  // Custos publicados / precificação
  "productPricing",
  "productionCostTableVersion",
  "productionCostTableItem",
  "materialCostTableVersion",
  "materialCostTableItem",
  "priceTable",
  "priceTableVersion",
  "priceTableItem",
  // Inteligência de Mercado / cotações de mercado (≠ cotação SC)
  "materialMarketQuote",
  "materialMarketQuoteAttachment",
  "materialMarketPurchaseLink",
  "materialMarketAlert",
  "materialMarketAlertConfig",
  "materialMarketAlertGlobalConfig",
  "materialMarketAuditEvent",
  // Pedidos de venda
  "salesOrder",
  "salesOrderItem",
  // Projetos (referência SC — só leitura)
  "project",
  // OPs oficiais Nomus
  "nomusProductionOrder",
  "nomusProductionOrderSalesLink",
  // Financeiro oficial / AP / fornecedor / CC financeiro
  "financialSupplier",
  "financialSupplierAlias",
  "financialCostCenter",
  "nomusAccountsPayable",
  "nomusAccountsReceivable",
  "accountsPayableCostCenterAllocation",
  // Comissões
  "commissionOrderSnapshot",
  "commissionOrderItemSnapshot",
  "commissionRecord",
  "commissionPaymentSchedule",
  // Stage Nomus (estoque/NFe) — leitura só; sync fora da SC
  "nomusStockDocument",
  "nomusStockDocumentItem",
  "nomusNfe",
] as const;

export type OfficialEngineProtectedPrismaModel =
  (typeof OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS)[number];

export const OFFICIAL_ENGINE_PROTECTED_MODEL_SET = new Set<string>(
  OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS
);

/** Métodos Prisma de escrita proibidos nos modelos protegidos. */
export const OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS = [
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
] as const;

export type OfficialEngineForbiddenWriteMethod =
  (typeof OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS)[number];

export const OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHOD_SET = new Set<string>(
  OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS
);

/**
 * Paths de módulos oficiais com capacidade de mutação.
 * SC não deve importá-los (use adaptadores read-only).
 */
export const OFFICIAL_ENGINE_FORBIDDEN_MUTABLE_IMPORT_PATTERNS: readonly RegExp[] = [
  /materialCostPublication\.server/,
  /materialCostTables\.server/,
  /productionCostPublication\.server/,
  /productionCostTables\.server/,
  /priceTablePublication\.server/,
  /commercialPublishedPrices\.server/,
  /salesOrderNomusSync/,
  /nomusProductionOrdersPersist/,
  /nomusBomApply/,
  /financeSuppliersRoutes/,
  /financeCostCentersRoutes/,
  /accountsPayable.*Routes/,
  /materialMarketQuote(?!AttachmentRoutes)/,
  /materialMarketAlert/,
  /productEngineering.*\.server/,
];

/**
 * Imports permitidos para leitura oficial a partir do domínio SC.
 * Qualquer outro caminho “oficial mutável” deve falhar no scanner.
 */
export const OFFICIAL_ENGINE_ALLOWED_READ_IMPORT_SUFFIXES = [
  "supply-chain/officialEngineReadAdapters.server",
  "supply-chain/officialEngineReadOnlyContracts",
  "supply-chain/officialEngineBoundary",
  "supply-chain/officialEngineWriteGuard",
  "supply-chain/officialEngineRoutesPolicy",
  "supply-chain/officialEngineBoundaryScan",
] as const;

/** Árvores / arquivos donos da SC (fase atual + futuros sob supply-chain/). */
export const SUPPLY_CHAIN_DOMAIN_GLOBS = [
  "src/lib/supply-chain/**/*.{ts,tsx}",
  "src/lib/inventory/**/*.{ts,tsx}",
  "src/lib/inventory*.ts",
  "src/components/inventory/**/*.{ts,tsx}",
  "src/components/PurchaseModule.tsx",
  "src/components/contextual/PurchaseIndicatorsDashboard.tsx",
] as const;

/** Rotas HTTP oficiais que a SC não pode mutar (POST/PUT/PATCH/DELETE). */
export const OFFICIAL_ENGINE_MUTATION_FORBIDDEN_API_PREFIXES = [
  "/api/materials",
  "/api/products",
  "/api/pricing",
  "/api/price-tables",
  "/api/production-cost",
  "/api/material-cost",
  "/api/sales-orders",
  "/api/commercial/sales-orders",
  "/api/operations/production-orders",
  "/api/finance/suppliers",
  "/api/finance/cost-centers",
  "/api/finance/accounts-payable",
  "/api/nomus/",
  "/api/commissions",
] as const;

export class OfficialEngineWriteForbiddenError extends Error {
  readonly code = "OFFICIAL_ENGINE_WRITE_FORBIDDEN" as const;
  readonly model: string;
  readonly method: string;

  constructor(model: string, method: string) {
    super(
      `Cadeia de Suprimentos não pode ${method} em motor oficial protegido: ${model}`
    );
    this.name = "OfficialEngineWriteForbiddenError";
    this.model = model;
    this.method = method;
  }
}

export function isOfficialEngineProtectedModel(model: string): boolean {
  return OFFICIAL_ENGINE_PROTECTED_MODEL_SET.has(model);
}

export function isOfficialEngineForbiddenWriteMethod(method: string): boolean {
  return OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHOD_SET.has(method);
}
