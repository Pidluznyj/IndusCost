/**
 * Fixture compartilhada dos testes da aba Performance (sem banco).
 * Cobre: identidade por ID (nomes/descrições parecidas NÃO agrupam), cancelado,
 * fora do período, moeda diferente, pedido sem valor, unidade mista, linha sem
 * material, fornecedor não identificado, avaliações V1 e V2.
 */

import type {
  DashboardCatalogInput,
  DashboardEvaluationInput,
  DashboardLineInput,
  DashboardOrderInput,
  DashboardSupplierIdentityInput,
  SupplierPerformanceDashboardFilters,
  SupplierPerformanceDashboardInput,
} from "./supplierPerformanceDashboard.js";

export const S1 = 101; // Alfa Metais
export const S2 = 102; // Alfa Metais Ltda (nome parecido, ID diferente)
export const S3 = 103; // Beta Químicos

function d(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function order(partial: Partial<DashboardOrderInput> & { id: string; externalId: number }): DashboardOrderInput {
  return {
    orderNumber: `PC-${partial.externalId}`,
    supplierExternalId: null,
    supplierName: null,
    supplierTaxId: null,
    stage: "RECEIVED",
    canceled: false,
    issuedAt: null,
    firstSeenAt: d("2026-01-01"),
    expectedAt: null,
    currency: null,
    totalAmount: null,
    paymentTerms: null,
    ...partial,
  };
}

function line(partial: Partial<DashboardLineInput> & { purchaseOrderId: string; lineIndex: number }): DashboardLineInput {
  return {
    lineExternalId: null,
    productExternalId: null,
    productCode: null,
    description: null,
    unit: null,
    orderedQuantity: null,
    receivedQuantity: null,
    unitPrice: null,
    totalAmount: null,
    ...partial,
  };
}

export const FIXTURE_ORDERS: DashboardOrderInput[] = [
  order({ id: "o1", externalId: 1, supplierExternalId: S1, supplierName: "ALFA METAIS", supplierTaxId: "11.111.111/0001-11", issuedAt: d("2026-01-10"), expectedAt: d("2026-01-20"), totalAmount: 1000, paymentTerms: "30 dias", stage: "RECEIVED" }),
  order({ id: "o2", externalId: 2, supplierExternalId: S1, supplierName: "ALFA METAIS", issuedAt: d("2026-02-15"), expectedAt: d("2026-02-25"), totalAmount: 600, paymentTerms: "30 dias", stage: "PARTIALLY_RECEIVED" }),
  order({ id: "o3", externalId: 3, supplierExternalId: S2, supplierName: "ALFA METAIS LTDA", issuedAt: d("2026-02-20"), totalAmount: 300, stage: "RECEIVED" }),
  order({ id: "o4", externalId: 4, supplierExternalId: S3, supplierName: "BETA QUIMICOS", issuedAt: d("2026-03-05"), expectedAt: d("2026-03-15"), totalAmount: 2000, paymentTerms: "45 dias", stage: "OPEN" }),
  // cancelado (excluído por padrão pelo predicado oficial)
  order({ id: "o5", externalId: 5, supplierExternalId: S3, supplierName: "BETA QUIMICOS", issuedAt: d("2026-03-20"), totalAmount: 9999, canceled: true, stage: "CANCELED" }),
  // fornecedor não identificado no pedido
  order({ id: "o6", externalId: 6, supplierExternalId: null, supplierName: "SEM ID", issuedAt: d("2026-01-25"), totalAmount: 100 }),
  // fora do período 2026
  order({ id: "o7", externalId: 7, supplierExternalId: S1, supplierName: "ALFA METAIS", issuedAt: d("2025-12-01"), totalAmount: 50 }),
  // outra moeda
  order({ id: "o8", externalId: 8, supplierExternalId: S3, supplierName: "BETA QUIMICOS", issuedAt: d("2026-04-01"), currency: "USD", totalAmount: 700 }),
  // sem valor de cabeçalho
  order({ id: "o9", externalId: 9, supplierExternalId: S2, supplierName: "ALFA METAIS LTDA", issuedAt: d("2026-04-10"), totalAmount: null }),
  // unidade diferente para o mesmo material
  order({ id: "o10", externalId: 10, supplierExternalId: S1, supplierName: "ALFA METAIS", issuedAt: d("2026-05-01"), totalAmount: 200 }),
  // linha sem identificação de material
  order({ id: "o11", externalId: 11, supplierExternalId: S3, supplierName: "BETA QUIMICOS", issuedAt: d("2026-05-02"), totalAmount: 150 }),
  // sem issuedAt: cai em firstSeenAt (dentro do período)
  order({ id: "o12", externalId: 12, supplierExternalId: S2, supplierName: "ALFA METAIS LTDA", issuedAt: null, firstSeenAt: d("2026-06-01"), totalAmount: 120 }),
];

export const FIXTURE_LINES: DashboardLineInput[] = [
  line({ purchaseOrderId: "o1", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "kg", orderedQuantity: 10, receivedQuantity: 10, unitPrice: 50, totalAmount: 500 }),
  line({ purchaseOrderId: "o1", lineIndex: 1, productExternalId: 2, productCode: "MP-002", description: "Resina", unit: "KG", orderedQuantity: 5, receivedQuantity: 5, unitPrice: 100, totalAmount: 500 }),
  line({ purchaseOrderId: "o2", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "KG", orderedQuantity: 10, receivedQuantity: 5, unitPrice: 60, totalAmount: 600 }),
  line({ purchaseOrderId: "o3", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "KG", orderedQuantity: 5, receivedQuantity: 5, unitPrice: 60, totalAmount: 300 }),
  line({ purchaseOrderId: "o4", lineIndex: 0, productExternalId: 2, productCode: "MP-002", description: "Resina", unit: "KG", orderedQuantity: 10, receivedQuantity: 0, unitPrice: 120, totalAmount: 1200 }),
  // descrição idêntica à MP-001, ID diferente → material distinto
  line({ purchaseOrderId: "o4", lineIndex: 1, productExternalId: 3, productCode: "MP-003", description: "Aço 1020", unit: "UN", orderedQuantity: 2, unitPrice: 400, totalAmount: 800 }),
  line({ purchaseOrderId: "o5", lineIndex: 0, productExternalId: 2, productCode: "MP-002", description: "Resina", unit: "KG", orderedQuantity: 99, unitPrice: 101, totalAmount: 9999 }),
  // só código oficial (sem ID Nomus)
  line({ purchaseOrderId: "o6", lineIndex: 0, productExternalId: null, productCode: "MP-004", description: "Parafuso", unit: "UN", orderedQuantity: 1, unitPrice: 100, totalAmount: 100 }),
  line({ purchaseOrderId: "o7", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "KG", orderedQuantity: 1, unitPrice: 50, totalAmount: 50 }),
  line({ purchaseOrderId: "o8", lineIndex: 0, productExternalId: 2, productCode: "MP-002", description: "Resina", unit: "KG", orderedQuantity: 7, unitPrice: 100, totalAmount: 700 }),
  line({ purchaseOrderId: "o9", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "KG", orderedQuantity: 4, unitPrice: 70, totalAmount: 280 }),
  line({ purchaseOrderId: "o10", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "L", orderedQuantity: 2, unitPrice: 100, totalAmount: 200 }),
  // sem ID e sem código → UNRESOLVED
  line({ purchaseOrderId: "o11", lineIndex: 0, productExternalId: null, productCode: null, description: "Item avulso", unit: "UN", orderedQuantity: 1, unitPrice: 150, totalAmount: 150 }),
  // linha sem valor (quantidade sem totalAmount nem unitPrice) — mesma MP-001 de S2
  line({ purchaseOrderId: "o12", lineIndex: 0, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "KG", orderedQuantity: 3, unitPrice: null, totalAmount: null }),
];

export const FIXTURE_EVALUATIONS: DashboardEvaluationInput[] = [
  { nomusPurchaseOrderId: "o1", overallScore: 4, qualityScore: 4, deliveryScore: 4, conformityScore: 4, serviceScore: 4, methodologyVersion: 2, revision: 1, createdAt: d("2026-01-12"), updatedAt: d("2026-01-12"), updatedByUserName: "Ana" },
  { nomusPurchaseOrderId: "o2", overallScore: 4, qualityScore: 5, deliveryScore: 4, conformityScore: 3, serviceScore: 4, methodologyVersion: 2, revision: 2, createdAt: d("2026-02-16"), updatedAt: d("2026-02-18"), updatedByUserName: "Ana" },
  // V1 legado (0–10) — nunca convertido nem misturado
  { nomusPurchaseOrderId: "o3", overallScore: 8, qualityScore: 8, deliveryScore: 8, conformityScore: 8, serviceScore: 8, methodologyVersion: 1, revision: 1, createdAt: d("2026-02-21"), updatedAt: d("2026-02-21"), updatedByUserName: "Bruno" },
  { nomusPurchaseOrderId: "o4", overallScore: 2.5, qualityScore: 2, deliveryScore: 3, conformityScore: 2, serviceScore: 3, methodologyVersion: 2, revision: 1, createdAt: d("2026-03-06"), updatedAt: d("2026-03-06"), updatedByUserName: "Ana" },
  // cancelado: avaliação existe mas o pedido sai da população por padrão
  { nomusPurchaseOrderId: "o5", overallScore: 1, qualityScore: 1, deliveryScore: 1, conformityScore: 1, serviceScore: 1, methodologyVersion: 2, revision: 1, createdAt: d("2026-03-21"), updatedAt: d("2026-03-21"), updatedByUserName: "Ana" },
];

export const FIXTURE_CATALOG: DashboardCatalogInput[] = [
  { externalProductId: "1", code: "MP-001", description: "Aço 1020", groupName: "AÇOS", familyName: null },
  { externalProductId: "2", code: "MP-002", description: "Resina", groupName: "QUÍMICOS", familyName: null },
  { externalProductId: "3", code: "MP-003", description: "Aço 1020", groupName: "AÇOS", familyName: null },
];

export const FIXTURE_IDENTITIES: DashboardSupplierIdentityInput[] = [
  { supplierExternalId: S1, resolvedName: "Alfa Metais", resolvedDocument: "11.111.111/0001-11", financialSupplierId: "fs-1", matchMethod: "SUPPLIER_ALIAS", matchConfidence: "EXACT", registryStatus: "ACTIVE" },
  { supplierExternalId: S2, resolvedName: "Alfa Metais Ltda", resolvedDocument: null, financialSupplierId: null, matchMethod: "NAME_FALLBACK", matchConfidence: "FALLBACK", registryStatus: null },
  { supplierExternalId: S3, resolvedName: "Beta Químicos", resolvedDocument: "22.222.222/0001-22", financialSupplierId: "fs-3", matchMethod: "SUPPLIER_DOCUMENT", matchConfidence: "EXACT", registryStatus: "ACTIVE" },
];

export const FIXTURE_NOW = d("2026-09-07");

export function buildFixtureInput(
  overrides: Partial<SupplierPerformanceDashboardInput> = {}
): SupplierPerformanceDashboardInput {
  return {
    orders: FIXTURE_ORDERS,
    lines: FIXTURE_LINES,
    evaluations: FIXTURE_EVALUATIONS,
    catalog: FIXTURE_CATALOG,
    supplierIdentities: FIXTURE_IDENTITIES,
    evaluationFeatureEnabled: true,
    lastSyncedAt: d("2026-09-06"),
    availableYears: [2026, 2025],
    now: FIXTURE_NOW,
    ...overrides,
  };
}

export const FIXTURE_FILTERS_2026: SupplierPerformanceDashboardFilters = {
  period: { from: "2026-01-01", to: "2026-12-31" },
  supplierExternalId: null,
  materialKey: null,
  materialGroup: null,
  currency: null,
  includeCanceled: false,
};

export function approx(actual: number | null | undefined, expected: number, epsilon = 1e-6): boolean {
  return actual != null && Math.abs(actual - expected) <= epsilon;
}
