/**
 * Provedores read-only dos motores oficiais para a Cadeia de Suprimentos (OP-04).
 *
 * Único ponto de consulta oficial recomendado para serviços/telas SC.
 * Não expõe create/update/delete/upsert. Sem motor de previsão nesta etapa.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  OfficialBomComponentRef,
  OfficialCatalogQuery,
  OfficialDataProviders,
  OfficialFinancialCostCenterRef,
  OfficialMarketQuoteRef,
  OfficialMaterialRef,
  OfficialNomusNfeRef,
  OfficialNomusStockDocumentRef,
  OfficialOpsCostCenterRef,
  OfficialProductRef,
  OfficialProductionOrderRef,
  OfficialProjectRef,
  OfficialPublishedMaterialCostRef,
  OfficialPublishedProductCostRef,
  OfficialSalesOrderRef,
  OfficialSupplierRef,
} from "./officialEngineReadOnlyContracts.js";
import { createOfficialEngineReadOnlyDelegateProxy } from "./officialEngineWriteGuard.js";

export type OfficialDataProviderPrisma = Pick<
  PrismaClient,
  | "material"
  | "product"
  | "productBOM"
  | "financialSupplier"
  | "costCenter"
  | "financialCostCenter"
  | "salesOrder"
  | "nomusProductionOrder"
  | "project"
  | "materialCostTableItem"
  | "productionCostTableItem"
  | "materialMarketQuote"
  | "nomusStockDocument"
  | "nomusNfe"
>;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit?: number): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeQ(q?: string): string | undefined {
  const t = q?.trim();
  return t ? t : undefined;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapMaterial(row: {
  id: string;
  code: string;
  description: string;
  unit: string;
  status: string | null;
  category: string;
}): OfficialMaterialRef {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    status: row.status,
    category: row.category ?? null,
  };
}

function mapProduct(row: {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  status: string | null;
  type: string;
}): OfficialProductRef {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    status: row.status,
    type: row.type,
    unit: null,
  };
}

function mapProductionOrder(row: {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  productCode: string | null;
  productDescription: string | null;
  quantity: unknown;
  unit: string | null;
}): OfficialProductionOrderRef {
  return {
    id: row.id,
    externalId: row.externalId,
    name: row.name,
    status: row.status,
    productCode: row.productCode,
    productDescription: row.productDescription,
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: row.unit,
  };
}

/**
 * Cria a superfície de provedores read-only.
 * Aceita PrismaClient ou cliente de transação com os delegates necessários.
 */
export function createOfficialDataProviders(
  prisma: OfficialDataProviderPrisma
): OfficialDataProviders {
  const material = createOfficialEngineReadOnlyDelegateProxy("material", prisma.material);
  const product = createOfficialEngineReadOnlyDelegateProxy("product", prisma.product);
  const productBOM = createOfficialEngineReadOnlyDelegateProxy("productBOM", prisma.productBOM);
  const financialSupplier = createOfficialEngineReadOnlyDelegateProxy(
    "financialSupplier",
    prisma.financialSupplier
  );
  const financialCostCenter = createOfficialEngineReadOnlyDelegateProxy(
    "financialCostCenter",
    prisma.financialCostCenter
  );
  const salesOrder = createOfficialEngineReadOnlyDelegateProxy("salesOrder", prisma.salesOrder);
  const nomusProductionOrder = createOfficialEngineReadOnlyDelegateProxy(
    "nomusProductionOrder",
    prisma.nomusProductionOrder
  );
  const project = createOfficialEngineReadOnlyDelegateProxy("project", prisma.project);
  const materialCostTableItem = createOfficialEngineReadOnlyDelegateProxy(
    "materialCostTableItem",
    prisma.materialCostTableItem
  );
  const productionCostTableItem = createOfficialEngineReadOnlyDelegateProxy(
    "productionCostTableItem",
    prisma.productionCostTableItem
  );
  const materialMarketQuote = createOfficialEngineReadOnlyDelegateProxy(
    "materialMarketQuote",
    prisma.materialMarketQuote
  );
  const nomusStockDocument = createOfficialEngineReadOnlyDelegateProxy(
    "nomusStockDocument",
    prisma.nomusStockDocument
  );
  const nomusNfe = createOfficialEngineReadOnlyDelegateProxy("nomusNfe", prisma.nomusNfe);
  // CostCenter ops: dono SC pode escrever via rotas próprias; nesta superfície só lemos.
  const costCenter = prisma.costCenter;

  return {
    materials: {
      async findById(id) {
        const row = await material.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            description: true,
            unit: true,
            status: true,
            category: true,
          },
        });
        return row ? mapMaterial(row) : null;
      },
      async findByCode(code) {
        const row = await material.findUnique({
          where: { code },
          select: {
            id: true,
            code: true,
            description: true,
            unit: true,
            status: true,
            category: true,
          },
        });
        return row ? mapMaterial(row) : null;
      },
      async list(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const activeOnly = query.activeOnly !== false;
        const where: Prisma.MaterialWhereInput = {
          ...(activeOnly ? { status: "ACTIVE" } : {}),
          ...(q
            ? {
                OR: [
                  { code: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        const rows = await material.findMany({
          where,
          take,
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            description: true,
            unit: true,
            status: true,
            category: true,
          },
        });
        return rows.map(mapMaterial);
      },
    },

    productsBom: {
      async findProductById(id) {
        const row = await product.findUnique({
          where: { id },
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            status: true,
            type: true,
          },
        });
        return row ? mapProduct(row) : null;
      },
      async findProductBySku(sku) {
        const row = await product.findUnique({
          where: { sku },
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            status: true,
            type: true,
          },
        });
        return row ? mapProduct(row) : null;
      },
      async listProducts(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const activeOnly = query.activeOnly !== false;
        const where: Prisma.ProductWhereInput = {
          ...(activeOnly ? { status: "ACTIVE" } : {}),
          ...(query.type ? { type: query.type as "PRODUCT" | "COMPONENT" } : {}),
          ...(q
            ? {
                OR: [
                  { sku: { contains: q, mode: "insensitive" } },
                  { name: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        const rows = await product.findMany({
          where,
          take,
          orderBy: { sku: "asc" },
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            status: true,
            type: true,
          },
        });
        return rows.map(mapProduct);
      },
      async listBomByProductId(productId) {
        const rows = await productBOM.findMany({
          where: { productId },
          orderBy: { id: "asc" },
          select: {
            id: true,
            productId: true,
            childProductId: true,
            materialId: true,
            quantity: true,
            notes: true,
          },
        });
        return rows.map(
          (row): OfficialBomComponentRef => ({
            id: row.id,
            productId: row.productId,
            childProductId: row.childProductId,
            materialId: row.materialId,
            quantity: Number(row.quantity),
            unit: null,
            notes: row.notes,
          })
        );
      },
    },

    suppliers: {
      async findById(id) {
        const row = await financialSupplier.findUnique({
          where: { id },
          select: {
            id: true,
            displayName: true,
            document: true,
            status: true,
            legalName: true,
            tradeName: true,
          },
        });
        if (!row) return null;
        return {
          id: row.id,
          displayName: row.displayName,
          document: row.document,
          status: row.status,
          legalName: row.legalName,
          tradeName: row.tradeName,
        } satisfies OfficialSupplierRef;
      },
      async list(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const activeOnly = query.activeOnly !== false;
        const where: Prisma.FinancialSupplierWhereInput = {
          ...(activeOnly ? { status: "ACTIVE" } : {}),
          ...(q
            ? {
                OR: [
                  { displayName: { contains: q, mode: "insensitive" } },
                  { document: { contains: q, mode: "insensitive" } },
                  { legalName: { contains: q, mode: "insensitive" } },
                  { tradeName: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        const rows = await financialSupplier.findMany({
          where,
          take,
          orderBy: { displayName: "asc" },
          select: {
            id: true,
            displayName: true,
            document: true,
            status: true,
            legalName: true,
            tradeName: true,
          },
        });
        return rows.map(
          (row): OfficialSupplierRef => ({
            id: row.id,
            displayName: row.displayName,
            document: row.document,
            status: row.status,
            legalName: row.legalName,
            tradeName: row.tradeName,
          })
        );
      },
    },

    opsCostCenters: {
      async findById(id) {
        const row = await costCenter.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            isActive: true,
          },
        });
        if (!row) return null;
        return row satisfies OfficialOpsCostCenterRef;
      },
      async list(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const activeOnly = query.activeOnly !== false;
        const where: Prisma.CostCenterWhereInput = {
          ...(activeOnly ? { isActive: true } : {}),
          ...(q
            ? {
                OR: [
                  { code: { contains: q, mode: "insensitive" } },
                  { name: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        return costCenter.findMany({
          where,
          take,
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            isActive: true,
          },
        });
      },
    },

    financialCostCenters: {
      async findById(id) {
        const row = await financialCostCenter.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            status: true,
          },
        });
        if (!row) return null;
        return row satisfies OfficialFinancialCostCenterRef;
      },
      async list(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const activeOnly = query.activeOnly !== false;
        const where: Prisma.FinancialCostCenterWhereInput = {
          ...(activeOnly ? { status: "ACTIVE" } : {}),
          ...(q
            ? {
                OR: [
                  { code: { contains: q, mode: "insensitive" } },
                  { name: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        return financialCostCenter.findMany({
          where,
          take,
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            name: true,
            description: true,
            status: true,
          },
        });
      },
    },

    salesOrders: {
      async findById(id) {
        const row = await salesOrder.findUnique({
          where: { id },
          select: { id: true, orderCode: true, status: true, customerId: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          orderCode: row.orderCode,
          status: row.status,
          customerId: row.customerId,
        } satisfies OfficialSalesOrderRef;
      },
      async findByOrderCode(orderCode) {
        const row = await salesOrder.findUnique({
          where: { orderCode },
          select: { id: true, orderCode: true, status: true, customerId: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          orderCode: row.orderCode,
          status: row.status,
          customerId: row.customerId,
        } satisfies OfficialSalesOrderRef;
      },
    },

    productionOrders: {
      async findById(id) {
        const row = await nomusProductionOrder.findUnique({
          where: { id },
          select: {
            id: true,
            externalId: true,
            name: true,
            status: true,
            productCode: true,
            productDescription: true,
            quantity: true,
            unit: true,
          },
        });
        return row ? mapProductionOrder(row) : null;
      },
      async findByExternalId(externalId) {
        const row = await nomusProductionOrder.findUnique({
          where: { externalId },
          select: {
            id: true,
            externalId: true,
            name: true,
            status: true,
            productCode: true,
            productDescription: true,
            quantity: true,
            unit: true,
          },
        });
        return row ? mapProductionOrder(row) : null;
      },
      async list(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const where: Prisma.NomusProductionOrderWhereInput = q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { productCode: { contains: q, mode: "insensitive" } },
                { productDescription: { contains: q, mode: "insensitive" } },
                { status: { contains: q, mode: "insensitive" } },
              ],
            }
          : {};
        const rows = await nomusProductionOrder.findMany({
          where,
          take,
          orderBy: { lastSeenAt: "desc" },
          select: {
            id: true,
            externalId: true,
            name: true,
            status: true,
            productCode: true,
            productDescription: true,
            quantity: true,
            unit: true,
          },
        });
        return rows.map(mapProductionOrder);
      },
    },

    projects: {
      async findById(id) {
        const row = await project.findUnique({
          where: { id },
          select: {
            id: true,
            code: true,
            title: true,
            description: true,
            status: true,
            customerName: true,
            projectType: true,
          },
        });
        if (!row) return null;
        return {
          id: row.id,
          code: row.code,
          title: row.title,
          description: row.description,
          status: row.status,
          customerName: row.customerName,
          projectType: row.projectType,
        } satisfies OfficialProjectRef;
      },
      async findByCode(code) {
        const row = await project.findUnique({
          where: { code },
          select: {
            id: true,
            code: true,
            title: true,
            description: true,
            status: true,
            customerName: true,
            projectType: true,
          },
        });
        if (!row) return null;
        return {
          id: row.id,
          code: row.code,
          title: row.title,
          description: row.description,
          status: row.status,
          customerName: row.customerName,
          projectType: row.projectType,
        } satisfies OfficialProjectRef;
      },
      async list(query = {}) {
        const q = normalizeQ(query.q);
        const take = clampLimit(query.limit);
        const where: Prisma.ProjectWhereInput = q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
                { customerName: { contains: q, mode: "insensitive" } },
              ],
            }
          : {};
        const rows = await project.findMany({
          where,
          take,
          orderBy: { code: "asc" },
          select: {
            id: true,
            code: true,
            title: true,
            description: true,
            status: true,
            customerName: true,
            projectType: true,
          },
        });
        return rows.map(
          (row): OfficialProjectRef => ({
            id: row.id,
            code: row.code,
            title: row.title,
            description: row.description,
            status: row.status,
            customerName: row.customerName,
            projectType: row.projectType,
          })
        );
      },
    },

    publishedCosts: {
      async findPublishedMaterialCost(materialId) {
        const row = await materialCostTableItem.findFirst({
          where: {
            materialId,
            materialCostTableVersion: { status: "PUBLISHED" },
          },
          orderBy: [
            { materialCostTableVersion: { publishedAt: "desc" } },
            { materialCostTableVersion: { revision: "desc" } },
          ],
          select: {
            materialId: true,
            materialCodeSnapshot: true,
            materialDescriptionSnapshot: true,
            unitSnapshot: true,
            landedCostSnapshot: true,
            currentCostSnapshot: true,
            materialCostTableVersion: {
              select: {
                id: true,
                code: true,
                revision: true,
                publishedAt: true,
                effectiveDate: true,
              },
            },
          },
        });
        if (!row) return null;
        const v = row.materialCostTableVersion;
        return {
          materialId: row.materialId,
          materialCode: row.materialCodeSnapshot,
          materialDescription: row.materialDescriptionSnapshot,
          unit: row.unitSnapshot,
          landedCost: Number(row.landedCostSnapshot),
          currentCost: Number(row.currentCostSnapshot),
          versionId: v.id,
          versionCode: v.code,
          versionRevision: v.revision,
          publishedAt: toIsoDate(v.publishedAt),
          effectiveDate: toIsoDate(v.effectiveDate),
        } satisfies OfficialPublishedMaterialCostRef;
      },
      async findPublishedProductCost(productId) {
        const row = await productionCostTableItem.findFirst({
          where: {
            productId,
            costTableVersion: { status: "PUBLISHED" },
          },
          orderBy: [
            { costTableVersion: { publishedAt: "desc" } },
            { costTableVersion: { revision: "desc" } },
          ],
          select: {
            productId: true,
            productCodeSnapshot: true,
            productNameSnapshot: true,
            unitProductionCost: true,
            materialCost: true,
            currency: true,
            costTableVersion: {
              select: {
                id: true,
                code: true,
                revision: true,
                publishedAt: true,
                effectiveDate: true,
              },
            },
          },
        });
        if (!row) return null;
        const v = row.costTableVersion;
        return {
          productId: row.productId,
          productCode: row.productCodeSnapshot,
          productName: row.productNameSnapshot,
          unitProductionCost: Number(row.unitProductionCost),
          materialCost: Number(row.materialCost),
          currency: row.currency,
          versionId: v.id,
          versionCode: v.code,
          versionRevision: v.revision,
          publishedAt: toIsoDate(v.publishedAt),
          effectiveDate: toIsoDate(v.effectiveDate),
        } satisfies OfficialPublishedProductCostRef;
      },
      async findOfficialMarketQuote(materialId) {
        const row = await materialMarketQuote.findFirst({
          where: {
            materialId,
            isOfficialReference: true,
            status: "ACTIVE",
          },
          orderBy: { quoteDate: "desc" },
          select: {
            id: true,
            materialId: true,
            unit: true,
            netPrice: true,
            currency: true,
            quoteDate: true,
            supplierName: true,
            isOfficialReference: true,
          },
        });
        if (!row) return null;
        return {
          id: row.id,
          materialId: row.materialId,
          unit: row.unit,
          netPrice: Number(row.netPrice),
          currency: row.currency,
          quoteDate: toIsoDate(row.quoteDate) ?? "",
          supplierName: row.supplierName,
          isOfficialReference: row.isOfficialReference,
        } satisfies OfficialMarketQuoteRef;
      },
    },

    nomusCrossRefs: {
      async findStockDocumentById(id) {
        const row = await nomusStockDocument.findUnique({
          where: { id },
          select: {
            id: true,
            externalId: true,
            documentNumber: true,
            tipoDocumentoEstoque: true,
            statusRaw: true,
            personName: true,
            movementDate: true,
          },
        });
        if (!row) return null;
        return {
          id: row.id,
          externalId: row.externalId,
          documentNumber: row.documentNumber,
          tipoDocumentoEstoque: row.tipoDocumentoEstoque,
          statusRaw: row.statusRaw,
          personName: row.personName,
          movementDate: toIsoDate(row.movementDate),
        } satisfies OfficialNomusStockDocumentRef;
      },
      async findStockDocumentByExternalId(externalId) {
        const row = await nomusStockDocument.findUnique({
          where: { externalId },
          select: {
            id: true,
            externalId: true,
            documentNumber: true,
            tipoDocumentoEstoque: true,
            statusRaw: true,
            personName: true,
            movementDate: true,
          },
        });
        if (!row) return null;
        return {
          id: row.id,
          externalId: row.externalId,
          documentNumber: row.documentNumber,
          tipoDocumentoEstoque: row.tipoDocumentoEstoque,
          statusRaw: row.statusRaw,
          personName: row.personName,
          movementDate: toIsoDate(row.movementDate),
        } satisfies OfficialNomusStockDocumentRef;
      },
      async findNfeById(id) {
        const row = await nomusNfe.findUnique({
          where: { id },
          select: {
            id: true,
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            cnpjEmitente: true,
            isFornecedor: true,
          },
        });
        if (!row) return null;
        return row satisfies OfficialNomusNfeRef;
      },
      async findNfeByExternalId(externalId) {
        const row = await nomusNfe.findUnique({
          where: { externalId },
          select: {
            id: true,
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            cnpjEmitente: true,
            isFornecedor: true,
          },
        });
        if (!row) return null;
        return row satisfies OfficialNomusNfeRef;
      },
    },
  };
}

/** Alias OP-03 — mesma fábrica. */
export function createOfficialEngineReadAdapters(
  prisma: OfficialDataProviderPrisma
): OfficialDataProviders {
  return createOfficialDataProviders(prisma);
}
