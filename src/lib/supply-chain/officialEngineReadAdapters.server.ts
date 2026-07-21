/**
 * Adaptadores read-only dos motores oficiais — separados de repositórios mutáveis.
 * Somente findUnique/findMany/list; nunca create/update/delete/upsert.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  OfficialBomComponentRef,
  OfficialEngineReadOnlySurface,
  OfficialFinancialCostCenterRef,
  OfficialMaterialRef,
  OfficialProductRef,
  OfficialProductionOrderRef,
  OfficialSalesOrderRef,
  OfficialSupplierRef,
} from "./officialEngineReadOnlyContracts.js";
import { createOfficialEngineReadOnlyDelegateProxy } from "./officialEngineWriteGuard.js";

type PrismaLike = Pick<
  PrismaClient,
  | "material"
  | "product"
  | "productBOM"
  | "financialSupplier"
  | "salesOrder"
  | "nomusProductionOrder"
  | "financialCostCenter"
>;

function mapMaterial(row: {
  id: string;
  code: string;
  description: string;
  unit: string;
  status: string | null;
}): OfficialMaterialRef {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    status: row.status,
  };
}

function mapProduct(row: {
  id: string;
  sku: string;
  name: string;
  status: string | null;
}): OfficialProductRef {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    status: row.status,
  };
}

/**
 * Cria a superfície read-only oficial. Delegates protegidos passam pelo proxy
 * que rejeita create/update/delete/upsert em runtime.
 */
export function createOfficialEngineReadAdapters(
  prisma: PrismaLike
): OfficialEngineReadOnlySurface {
  const material = createOfficialEngineReadOnlyDelegateProxy("material", prisma.material);
  const product = createOfficialEngineReadOnlyDelegateProxy("product", prisma.product);
  const productBOM = createOfficialEngineReadOnlyDelegateProxy("productBOM", prisma.productBOM);
  const financialSupplier = createOfficialEngineReadOnlyDelegateProxy(
    "financialSupplier",
    prisma.financialSupplier
  );
  const salesOrder = createOfficialEngineReadOnlyDelegateProxy("salesOrder", prisma.salesOrder);
  const nomusProductionOrder = createOfficialEngineReadOnlyDelegateProxy(
    "nomusProductionOrder",
    prisma.nomusProductionOrder
  );
  const financialCostCenter = createOfficialEngineReadOnlyDelegateProxy(
    "financialCostCenter",
    prisma.financialCostCenter
  );

  return {
    materials: {
      async findById(id: string): Promise<OfficialMaterialRef | null> {
        const row = await material.findUnique({
          where: { id },
          select: { id: true, code: true, description: true, unit: true, status: true },
        });
        return row ? mapMaterial(row) : null;
      },
      async findByCode(code: string): Promise<OfficialMaterialRef | null> {
        const row = await material.findUnique({
          where: { code },
          select: { id: true, code: true, description: true, unit: true, status: true },
        });
        return row ? mapMaterial(row) : null;
      },
    },
    productsBom: {
      async findProductById(id: string): Promise<OfficialProductRef | null> {
        const row = await product.findUnique({
          where: { id },
          select: { id: true, sku: true, name: true, status: true },
        });
        return row ? mapProduct(row) : null;
      },
      async listBomByProductId(productId: string): Promise<OfficialBomComponentRef[]> {
        const rows = await productBOM.findMany({
          where: { productId },
          select: {
            id: true,
            productId: true,
            childProductId: true,
            materialId: true,
            quantity: true,
          },
        });
        return rows.map((row) => ({
          id: row.id,
          productId: row.productId,
          childProductId: row.childProductId,
          materialId: row.materialId,
          quantity: Number(row.quantity),
        }));
      },
    },
    suppliers: {
      async findById(id: string): Promise<OfficialSupplierRef | null> {
        const row = await financialSupplier.findUnique({
          where: { id },
          select: { id: true, displayName: true, document: true, status: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          displayName: row.displayName,
          document: row.document,
          status: row.status,
        };
      },
    },
    salesOrders: {
      async findById(id: string): Promise<OfficialSalesOrderRef | null> {
        const row = await salesOrder.findUnique({
          where: { id },
          select: { id: true, orderCode: true, status: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          orderCode: row.orderCode,
          status: row.status,
        };
      },
    },
    productionOrders: {
      async findById(id: string): Promise<OfficialProductionOrderRef | null> {
        const row = await nomusProductionOrder.findUnique({
          where: { id },
          select: { id: true, externalId: true, name: true, status: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          externalId: row.externalId,
          name: row.name,
          status: row.status,
        };
      },
    },
    financialCostCenters: {
      async findById(id: string): Promise<OfficialFinancialCostCenterRef | null> {
        const row = await financialCostCenter.findUnique({
          where: { id },
          select: { id: true, code: true, name: true, status: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          status: row.status,
        };
      },
    },
  };
}
