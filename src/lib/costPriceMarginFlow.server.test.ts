/**
 * Testes integrados ponta a ponta: MP → produção → preço → margem.
 * Reutiliza funções server reais com mock Prisma in-memory (Map).
 *
 * Cenários A–E conforme docs/architecture/versioned-cost-price-margin.md
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  generateMaterialCostTableDraftFromMaterials,
  publishMaterialCostVersionFromDraft,
} from "./materialCostPublication.server.js";
import { getEffectiveMaterialCost } from "./materialCostTables.server.js";
import {
  generateProductionCostTableDraftFromProducts,
  publishProductionCostVersionFromDraft,
} from "./productionCostPublication.server.js";
import { getEffectiveProductProductionCost } from "./productionCostTables.server.js";
import {
  generatePriceTableVersionDraftFromProductionCosts,
  resolvePublishedPriceTableVersionForDate,
} from "./priceTablePublication.server.js";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  calculateSalesOrderMarginsForOrders,
} from "./salesOrderMarginService.server.js";
import { setSalesOrderMarginProductCostResolver } from "./salesOrderMarginProductCostResolver.js";
import { classifySoldItemForIntegratedAudit } from "./costPriceMarginIntegratedAudit.js";

const PRICE_TABLE_ID = "price-table-e2e";
const PROPOSAL_ID = "proposal-e2e";
const ORDER_ID = "order-e2e";

type MaterialRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  currentCost: number;
  freight: number;
  averageCost: number | null;
  standardCost: number | null;
  standardLoss: number | null;
  status: string;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  type: "PRODUCT" | "COMPONENT";
  status: string;
};

/** Arestas de BOM do fixture (pai → filho). Ausente ⇒ ProductBOM = []. */
type ProductBomEdge = {
  parentProductId: string;
  childProductId: string;
};

type MpVersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  revision: number;
  supersedesVersionId: string | null;
  source: string | null;
  notes: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MpItemRow = {
  id: string;
  materialCostTableVersionId: string;
  materialId: string;
  materialCodeSnapshot: string;
  materialDescriptionSnapshot: string;
  unitSnapshot: string;
  currentCostSnapshot: number;
  freightSnapshot: number;
  landedCostSnapshot: number;
  averageCostSnapshot: number | null;
  standardCostSnapshot: number | null;
  standardLossSnapshot: number | null;
  costSource: string;
  warningsJson: unknown;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ProdVersionRow = {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | "ARCHIVED";
  revision: number;
  supersedesVersionId: string | null;
  materialCostTableVersionId: string | null;
  source: string | null;
  notes: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ProdItemRow = {
  id: string;
  costTableVersionId: string;
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitProductionCost: number;
  materialCost: number;
  processCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  otherCost: number;
  currency: string;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type PriceVersionRow = {
  id: string;
  priceTableId: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  taxRuleId: string | null;
  productionCostTableVersionId: string | null;
  generatedAt: Date;
  notes: string | null;
  commissionPerc: number | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  publishedAt: Date | null;
  generationSummaryJson: unknown;
};

type PriceItemRow = {
  id: string;
  priceTableVersionId: string;
  productId: string;
  sku: string;
  productName: string;
  frozenTotalCost: number;
  frozenMaterialCost: number;
  frozenHhCost: number;
  frozenHmCost: number;
  frozenTaxCost: number;
  frozenOtherCost: number;
  marginPct: number;
  salePrice: number;
  commissionPerc: number;
  commissionValue: number;
  costSnapshotJson: unknown;
  formulaSnapshotJson: unknown;
};

function createEndToEndFlowDb(input: {
  materials: MaterialRow[];
  products: ProductRow[];
  /** Relações ProductBOM do fixture; sem edges o Prisma devolveria []. */
  bomEdges?: ProductBomEdge[];
  defaultMarginPct?: number;
}) {
  const materials = input.materials.map((m) => ({ ...m }));
  const products = input.products.map((p) => ({ ...p }));
  const bomEdges = (input.bomEdges ?? []).map((e) => ({ ...e }));
  const mpVersions = new Map<string, MpVersionRow>();
  const mpItems = new Map<string, MpItemRow>();
  const prodVersions = new Map<string, ProdVersionRow>();
  const prodItems = new Map<string, ProdItemRow>();
  const priceVersions = new Map<string, PriceVersionRow>();
  const priceItems = new Map<string, PriceItemRow>();
  let mpVerSeq = 0;
  let mpItemSeq = 0;
  let prodVerSeq = 0;
  let prodItemSeq = 0;
  let priceVerSeq = 0;
  let priceItemSeq = 0;
  const defaultMarginPct = input.defaultMarginPct ?? 25;

  const childrenOf = (parentProductId: string) =>
    bomEdges
      .filter((e) => e.parentProductId === parentProductId)
      .map((e) => ({ childProductId: e.childProductId }));

  /**
   * Projeta o `select` do Prisma o suficiente para os caminhos exercitados
   * (produção, BOM health, margem). ProductBOM só entra quando selecionado.
   */
  const projectProductRow = (
    p: ProductRow,
    select?: Record<string, unknown> | null
  ): Record<string, unknown> => {
    if (!select) {
      return { id: p.id, sku: p.sku, name: p.name, type: p.type, sourceExternalId: null };
    }
    const out: Record<string, unknown> = {};
    if (select.id) out.id = p.id;
    if (select.sku) out.sku = p.sku;
    if (select.name) out.name = p.name;
    if (select.type) out.type = p.type;
    if (select.status) out.status = p.status;
    if (select.sourceExternalId) out.sourceExternalId = null;
    if (select.ProductBOM) {
      out.ProductBOM = childrenOf(p.id);
    }
    return out;
  };

  const mpItemKey = (vId: string, mId: string) => `${vId}:${mId}`;
  const prodItemKey = (vId: string, pId: string) => `${vId}:${pId}`;
  const priceItemKey = (vId: string, pId: string) => `${vId}:${pId}`;

  const db = {
    material: {
      findMany: async ({ where }: { where?: { status?: string; id?: { in: string[] } } }) => {
        let rows = materials;
        if (where?.status) rows = rows.filter((m) => m.status === where.status);
        if (where?.id?.in) rows = rows.filter((m) => where.id!.in.includes(m.id));
        return rows;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        materials.find((m) => m.id === where.id) ?? null,
    },
    materialCostTableVersion: {
      findFirst: async ({
        where,
        orderBy,
        include,
      }: {
        where: Record<string, unknown>;
        orderBy?: Array<Record<string, string>>;
        include?: { items?: unknown };
      }) => {
        let rows = [...mpVersions.values()];
        if (where.code) rows = rows.filter((v) => v.code === where.code);
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        if (where.effectiveDate && typeof where.effectiveDate === "object" && "lte" in where.effectiveDate) {
          const lte = (where.effectiveDate as { lte: Date }).lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        const orderList = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        if (orderList.some((o) => o && typeof o === "object" && "revision" in o && o.revision === "desc")) {
          rows.sort((a, b) => b.revision - a.revision);
        }
        rows.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime() || b.revision - a.revision);
        const row = rows[0] ?? null;
        if (!row) return null;
        if (include?.items) {
          return {
            ...row,
            items: [...mpItems.values()].filter((i) => i.materialCostTableVersionId === row.id),
          };
        }
        return row;
      },
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const row = mpVersions.get(where.id);
        if (!row) return null;
        if (include && typeof include === "object" && "items" in include) {
          return {
            ...row,
            items: [...mpItems.values()].filter((i) => i.materialCostTableVersionId === row.id),
          };
        }
        return row;
      },
      findMany: async ({
        where,
        include,
      }: {
        where?: { status?: { in: string[] }; effectiveDate?: { lte: Date } };
        include?: { items?: { where?: { materialId?: { in: string[] } } } };
      }) => {
        let rows = [...mpVersions.values()];
        if (where?.status?.in) rows = rows.filter((v) => where.status!.in.includes(v.status));
        if (where?.effectiveDate?.lte) {
          const lte = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        return rows.map((row) => {
          if (include?.items) {
            let items = [...mpItems.values()].filter((i) => i.materialCostTableVersionId === row.id);
            const matFilter = include.items.where?.materialId?.in;
            if (matFilter) items = items.filter((i) => matFilter.includes(i.materialId));
            return { ...row, items };
          }
          return row;
        });
      },
      create: async ({ data }: { data: Omit<MpVersionRow, "id" | "createdAt" | "updatedAt"> }) => {
        mpVerSeq += 1;
        const id = `mp-ver-${mpVerSeq}`;
        const now = new Date();
        const row: MpVersionRow = { id, createdAt: now, updatedAt: now, ...data };
        mpVersions.set(id, row);
        return row;
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Partial<MpVersionRow>;
        include?: unknown;
      }) => {
        const row = mpVersions.get(where.id);
        if (!row) throw new Error("mp version not found");
        Object.assign(row, data, { updatedAt: new Date() });
        if (include) {
          return {
            ...row,
            items: [...mpItems.values()].filter((i) => i.materialCostTableVersionId === row.id),
          };
        }
        return row;
      },
    },
    materialCostTableItem: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { materialCostTableVersionId_materialId: { materialCostTableVersionId: string; materialId: string } };
        create: Omit<MpItemRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<MpItemRow>;
      }) => {
        const key = mpItemKey(
          where.materialCostTableVersionId_materialId.materialCostTableVersionId,
          where.materialCostTableVersionId_materialId.materialId
        );
        const existing = mpItems.get(key);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        mpItemSeq += 1;
        const row: MpItemRow = { id: `mp-item-${mpItemSeq}`, createdAt: now, updatedAt: now, ...create };
        mpItems.set(key, row);
        return row;
      },
    },
    productionCostTableVersion: {
      findFirst: async ({
        where,
        orderBy,
        include,
        select,
      }: {
        where: Record<string, unknown>;
        orderBy?: Array<Record<string, string>>;
        include?: { items?: unknown };
        select?: unknown;
      }) => {
        let rows = [...prodVersions.values()];
        if (where.code) rows = rows.filter((v) => v.code === where.code);
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        if (where.effectiveDate && typeof where.effectiveDate === "object" && "lte" in where.effectiveDate) {
          const lte = (where.effectiveDate as { lte: Date }).lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        const orderList = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        if (orderList.some((o) => o && typeof o === "object" && "revision" in o && o.revision === "desc")) {
          rows.sort((a, b) => b.revision - a.revision);
        }
        rows.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime() || b.revision - a.revision);
        const row = rows[0] ?? null;
        if (!row) return null;
        if (include?.items) {
          return { ...row, items: [...prodItems.values()].filter((i) => i.costTableVersionId === row.id) };
        }
        if (select) return row;
        return row;
      },
      findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) => {
        const row = prodVersions.get(where.id);
        if (!row) return null;
        if (include && typeof include === "object") {
          const result: Record<string, unknown> = { ...row };
          if ("items" in include) {
            result.items = [...prodItems.values()].filter((i) => i.costTableVersionId === row.id);
          }
          if ("_count" in include) {
            result._count = {
              items: [...prodItems.values()].filter((i) => i.costTableVersionId === row.id).length,
            };
          }
          return result;
        }
        return row;
      },
      findMany: async ({
        where,
        include,
      }: {
        where?: { status?: { in: string[] }; effectiveDate?: { lte: Date } };
        include?: { items?: { where?: { productId?: { in: string[] } } } };
      }) => {
        let rows = [...prodVersions.values()];
        if (where?.status?.in) rows = rows.filter((v) => where.status!.in.includes(v.status));
        if (where?.effectiveDate?.lte) {
          const lte = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        return rows.map((row) => {
          if (include?.items) {
            let items = [...prodItems.values()].filter((i) => i.costTableVersionId === row.id);
            const prodFilter = include.items.where?.productId?.in;
            if (prodFilter) items = items.filter((i) => prodFilter.includes(i.productId));
            return { ...row, items };
          }
          return row;
        });
      },
      create: async ({ data }: { data: Omit<ProdVersionRow, "id" | "createdAt" | "updatedAt"> }) => {
        prodVerSeq += 1;
        const id = `prod-ver-${prodVerSeq}`;
        const now = new Date();
        const row: ProdVersionRow = { id, createdAt: now, updatedAt: now, ...data };
        prodVersions.set(id, row);
        return row;
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Partial<ProdVersionRow>;
        include?: unknown;
      }) => {
        const row = prodVersions.get(where.id);
        if (!row) throw new Error("prod version not found");
        Object.assign(row, data, { updatedAt: new Date() });
        if (include) {
          return {
            ...row,
            items: [...prodItems.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
        return row;
      },
    },
    productionCostTableItem: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { costTableVersionId_productId: { costTableVersionId: string; productId: string } };
        create: Omit<ProdItemRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<ProdItemRow>;
      }) => {
        const key = prodItemKey(
          where.costTableVersionId_productId.costTableVersionId,
          where.costTableVersionId_productId.productId
        );
        const existing = prodItems.get(key);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        prodItemSeq += 1;
        const row: ProdItemRow = { id: `prod-item-${prodItemSeq}`, createdAt: now, updatedAt: now, ...create };
        prodItems.set(key, row);
        return row;
      },
      findMany: async ({
        where,
        include,
        select,
      }: {
        where?: {
          productId?: string;
          costTableVersionId?: string;
          costTableVersion?: { status?: string; id?: { not: string } };
        };
        include?: { costTableVersion?: { select?: { id?: boolean; code?: boolean } } };
        select?: { productId?: boolean; unitProductionCost?: boolean };
      } = {}) => {
        let rows = [...prodItems.values()];
        if (where?.productId) rows = rows.filter((i) => i.productId === where.productId);
        if (where?.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        if (where?.costTableVersion) {
          const cvWhere = where.costTableVersion;
          rows = rows.filter((i) => {
            const ver = prodVersions.get(i.costTableVersionId);
            if (!ver) return false;
            if (cvWhere.status && ver.status !== cvWhere.status) return false;
            if (cvWhere.id?.not && ver.id === cvWhere.id.not) return false;
            return true;
          });
        }
        if (select) {
          return rows.map((i) => {
            const out: Record<string, unknown> = {};
            if (select.productId) out.productId = i.productId;
            if (select.unitProductionCost) out.unitProductionCost = i.unitProductionCost;
            return out;
          });
        }
        if (include?.costTableVersion) {
          return rows.map((i) => {
            const ver = prodVersions.get(i.costTableVersionId);
            const cvSelect = include.costTableVersion?.select;
            const costTableVersion = ver
              ? cvSelect
                ? {
                    ...(cvSelect.id ? { id: ver.id } : {}),
                    ...(cvSelect.code ? { code: ver.code } : {}),
                  }
                : { id: ver.id, code: ver.code }
              : null;
            return { ...i, costTableVersion };
          });
        }
        return rows;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const [key, row] of prodItems) {
          if (row.id === where.id) {
            prodItems.delete(key);
            return row;
          }
        }
        throw new Error("prod item not found");
      },
    },
    product: {
      findMany: async ({
        where,
        select,
      }: {
        where?: {
          status?: string;
          type?: string | { in: string[] };
          id?: { in: string[] };
          sku?: { in: string[] };
          sourceExternalId?: { in: string[] };
        };
        select?: Record<string, unknown>;
      }) => {
        let rows = products;
        if (where?.status) rows = rows.filter((p) => p.status === where.status);
        const typeFilter = where?.type;
        if (typeFilter && typeof typeFilter === "object" && Array.isArray(typeFilter.in)) {
          rows = rows.filter((p) => typeFilter.in.includes(p.type));
        } else if (typeof typeFilter === "string") {
          rows = rows.filter((p) => p.type === typeFilter);
        }
        if (where?.id?.in) rows = rows.filter((p) => where.id!.in.includes(p.id));
        if (where?.sku?.in) rows = rows.filter((p) => where.sku!.in.includes(p.sku));
        return rows.map((p) => projectProductRow(p, select ?? null));
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, unknown>;
      }) => {
        const p = products.find((x) => x.id === where.id);
        return p ? projectProductRow(p, select ?? null) : null;
      },
      count: async () => products.length,
    },
    priceTable: {
      findMany: async ({
        where,
      }: {
        where?: { id?: { in: string[] }; code?: { in: string[] }; status?: string };
      }) => {
        const table = {
          id: PRICE_TABLE_ID,
          status: "ACTIVE",
          defaultMarginPct,
          code: "ATACADO",
          name: "Atacado E2E",
        };
        if (where?.id?.in && !where.id.in.includes(table.id)) return [];
        if (where?.code?.in && !where.code.in.includes(table.code)) return [];
        if (where?.status && where.status !== table.status) return [];
        return [table];
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id !== PRICE_TABLE_ID) return null;
        return {
          id: PRICE_TABLE_ID,
          status: "ACTIVE",
          defaultMarginPct,
          code: "ATACADO",
          name: "Atacado E2E",
        };
      },
    },
    priceTableVersion: {
      findMany: async ({
        where,
      }: {
        where?: {
          priceTableId?: string | { in: string[] };
          status?: string | { in: string[] };
        };
      }) => {
        let rows = [...priceVersions.values()];
        if (typeof where?.priceTableId === "string") {
          rows = rows.filter((v) => v.priceTableId === where.priceTableId);
        } else if (where?.priceTableId && typeof where.priceTableId === "object") {
          const allowed = where.priceTableId.in;
          rows = rows.filter((v) => allowed.includes(v.priceTableId));
        }
        if (typeof where?.status === "string") {
          rows = rows.filter((v) => v.status === where.status);
        } else if (where?.status && typeof where.status === "object") {
          const allowed = where.status.in;
          rows = rows.filter((v) => allowed.includes(v.status));
        }
        return rows.map((v) => ({ ...v }));
      },
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: Array<Record<string, string>> | Record<string, string>;
      }) => {
        let rows = [...priceVersions.values()];
        if (where.priceTableId) rows = rows.filter((v) => v.priceTableId === where.priceTableId);
        if (typeof where.status === "string") rows = rows.filter((v) => v.status === where.status);
        if (typeof where.status === "object" && where.status !== null && "in" in where.status) {
          const allowed = (where.status as { in: string[] }).in;
          rows = rows.filter((v) => allowed.includes(v.status));
        }
        const andClauses = where.AND as Array<{ OR: Array<Record<string, unknown>> }> | undefined;
        if (andClauses) {
          for (const clause of andClauses) {
            for (const or of clause.OR ?? []) {
              if (or.effectiveFrom && typeof or.effectiveFrom === "object" && "lte" in or.effectiveFrom) {
                const ref = (or.effectiveFrom as { lte: Date }).lte.getTime();
                rows = rows.filter((v) => !v.effectiveFrom || v.effectiveFrom.getTime() <= ref);
              }
              if (or.effectiveTo && typeof or.effectiveTo === "object" && "gt" in or.effectiveTo) {
                const ref = (or.effectiveTo as { gt: Date }).gt.getTime();
                rows = rows.filter((v) => !v.effectiveTo || v.effectiveTo.getTime() > ref);
              }
            }
          }
        }
        const orderList = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        for (const order of [...orderList].reverse()) {
          if (order.effectiveFrom === "desc") {
            rows.sort((a, b) => (b.effectiveFrom?.getTime() ?? 0) - (a.effectiveFrom?.getTime() ?? 0));
          }
          if (order.versionNumber === "desc") rows.sort((a, b) => b.versionNumber - a.versionNumber);
        }
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        priceVerSeq += 1;
        const row: PriceVersionRow = {
          id: `price-ver-${priceVerSeq}`,
          priceTableId: String(data.priceTableId),
          versionNumber: Number(data.versionNumber),
          status: data.status as PriceVersionRow["status"],
          taxRuleId: (data.taxRuleId as string | null) ?? null,
          productionCostTableVersionId: (data.productionCostTableVersionId as string | null) ?? null,
          generatedAt: (data.generatedAt as Date) ?? new Date(),
          notes: (data.notes as string | null) ?? null,
          commissionPerc: (data.commissionPerc as number | null) ?? null,
          effectiveFrom: null,
          effectiveTo: null,
          publishedAt: null,
          generationSummaryJson: null,
        };
        priceVersions.set(row.id, row);
        return row;
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: { generationSummaryJson?: unknown };
        include?: { PriceTable?: boolean; TaxRule?: boolean };
      }) => {
        const row = priceVersions.get(where.id);
        if (!row) throw new Error("price version not found");
        if (data.generationSummaryJson !== undefined) row.generationSummaryJson = data.generationSummaryJson;
        return {
          ...row,
          PriceTable: include?.PriceTable
            ? { id: PRICE_TABLE_ID, code: "ATACADO", name: "Atacado E2E", defaultMarginPct }
            : undefined,
          TaxRule: include?.TaxRule ? null : undefined,
        };
      },
    },
    priceTableItem: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        priceItemSeq += 1;
        const row: PriceItemRow = {
          id: `price-item-${priceItemSeq}`,
          priceTableVersionId: String(data.priceTableVersionId),
          productId: String(data.productId),
          sku: String(data.sku),
          productName: String(data.productName),
          frozenTotalCost: Number(data.frozenTotalCost),
          frozenMaterialCost: Number(data.frozenMaterialCost),
          frozenHhCost: Number(data.frozenHhCost),
          frozenHmCost: Number(data.frozenHmCost),
          frozenTaxCost: Number(data.frozenTaxCost),
          frozenOtherCost: Number(data.frozenOtherCost),
          marginPct: Number(data.marginPct),
          salePrice: Number(data.salePrice),
          commissionPerc: Number(data.commissionPerc),
          commissionValue: Number(data.commissionValue),
          costSnapshotJson: data.costSnapshotJson,
          formulaSnapshotJson: data.formulaSnapshotJson,
        };
        priceItems.set(priceItemKey(row.priceTableVersionId, row.productId), row);
        return row;
      },
      findMany: async ({
        where,
      }: {
        where: { priceTableVersionId: string; productId?: { in: string[] } };
      }) => {
        let rows = [...priceItems.values()].filter((i) => i.priceTableVersionId === where.priceTableVersionId);
        if (where.productId?.in) rows = rows.filter((i) => where.productId!.in.includes(i.productId));
        return rows;
      },
      findUnique: async ({
        where,
      }: {
        where: { priceTableVersionId_productId: { priceTableVersionId: string; productId: string } };
      }) => {
        const key = priceItemKey(
          where.priceTableVersionId_productId.priceTableVersionId,
          where.priceTableVersionId_productId.productId
        );
        return priceItems.get(key) ?? null;
      },
    },
    proposal: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        if (!where.id.in.includes(PROPOSAL_ID)) return [];
        return [{ id: PROPOSAL_ID, priceTableId: PRICE_TABLE_ID, priceTableCode: "ATACADO" }];
      },
    },
    proposalItem: { findMany: async () => [] },
    nomusProductCatalog: { findMany: async () => [] },
    costCalculationLog: { findMany: async () => [] },
    indirectCost: { findFirst: async () => null },
    taxRule: { findMany: async () => [], findFirst: async () => null, findUnique: async () => null },
    productPricing: {
      findFirst: async () => ({ commission: 5, otherVariables: 0, freightOut: 0, taxRuleId: null }),
      findUnique: async () => null,
      findMany: async () => [],
    },
    salesOrderItem: { findMany: async () => [] },
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };

  return {
    db,
    materials,
    mpVersions,
    mpItems,
    prodVersions,
    prodItems,
    priceVersions,
    priceItems,
    publishPriceVersion(versionId: string, effectiveFrom: string) {
      const row = priceVersions.get(versionId);
      if (!row) throw new Error("price version not found");
      for (const v of priceVersions.values()) {
        if (v.priceTableId === row.priceTableId && v.status === "PUBLISHED" && v.id !== versionId) {
          v.status = "ARCHIVED";
          v.effectiveTo = civilDateToLocalDate(effectiveFrom);
        }
      }
      row.status = "PUBLISHED";
      row.effectiveFrom = civilDateToLocalDate(effectiveFrom);
      row.publishedAt = new Date();
    },
  };
}

function createMockEngine(
  costs: Record<string, { total: number } | "FAIL">
): ProductCostAnalysisEngine {
  return {
    initAnalysisCache: async () => ({}),
    getProductCostAnalysis: async (productId: string) => {
      const entry = costs[productId];
      if (entry === "FAIL") return { error: "CONFIG_MISSING", message: "Config ausente." };
      if (!entry) return null;
      return {
        productId,
        sku: productId,
        summary: {
          totalIndustrialCost: entry.total,
          totalMaterialCost: entry.total * 0.5,
          totalHH_Unit: entry.total * 0.2,
          totalHM_Unit: entry.total * 0.15,
          totalCIF_Unit: entry.total * 0.1,
          totalOPEX_Unit: entry.total * 0.05,
        },
      };
    },
    isCostAnalysisFailure: (x: unknown): x is { error: string; message?: string } =>
      !!x && typeof x === "object" && "error" in x,
    describeCostAnalysisFailure: (failure: unknown) =>
      String((failure as { message?: string }).message ?? "Erro"),
  };
}

async function runFullPublicationFlow(
  ctx: ReturnType<typeof createEndToEndFlowDb>,
  input: {
    effectiveDate: string;
    productIds: string[];
    engineCosts: Record<string, { total: number }>;
    includeAllActiveProducts?: boolean;
    itemScope?: "PRODUCT_AND_COMPONENT";
  }
) {
  const refDate = civilDateToLocalDate(input.effectiveDate);

  const mpGen = await generateMaterialCostTableDraftFromMaterials(ctx.db as never, {
    effectiveDate: refDate,
    includeAllActiveMaterials: true,
  });
  await publishMaterialCostVersionFromDraft(ctx.db as never, { versionId: mpGen.version!.id });

  const prodGen = await generateProductionCostTableDraftFromProducts(
    ctx.db as never,
    createMockEngine(input.engineCosts),
    {
      effectiveDate: refDate,
      productIds: input.productIds,
      includeAllActiveProducts: input.includeAllActiveProducts,
      itemScope: input.itemScope,
    }
  );
  await publishProductionCostVersionFromDraft(ctx.db as never, { versionId: prodGen.version!.id });

  const priceGen = await generatePriceTableVersionDraftFromProductionCosts(ctx.db as never, {
    priceTableId: PRICE_TABLE_ID,
    effectiveDate: refDate,
    includeAllActiveProducts: input.includeAllActiveProducts ?? input.productIds.length === 0,
    productIds: input.productIds.length > 0 ? input.productIds : undefined,
    itemScope: input.itemScope,
  });
  ctx.publishPriceVersion(priceGen.version.id, input.effectiveDate);

  return { mpGen, prodGen, priceGen, refDate };
}

function buildMarginOrder(input: {
  productId: string;
  sku: string;
  name: string;
  unitCostNomus?: number;
  soldPrice: number;
  quantity: number;
  issueDate: Date;
}) {
  return {
    id: ORDER_ID,
    proposalId: PROPOSAL_ID,
    issueDate: input.issueDate,
    nomusRawResponse: null,
    items: [
      {
        id: "so-item-1",
        salesOrderId: ORDER_ID,
        productId: input.productId,
        proposalItemId: null,
        externalProductId: null,
        skuSnapshot: input.sku,
        productNameSnapshot: input.name,
        quantity: input.quantity,
        negotiatedPrice: input.soldPrice,
        totalNetValue: input.soldPrice * input.quantity,
        unitCost: input.unitCostNomus ?? 999,
      },
    ],
  };
}

describe("costPriceMarginFlow — E2E integrado MP → produção → preço → margem", () => {
  before(() => {
    setSalesOrderMarginProductCostResolver(null);
  });

  after(() => {
    setSalesOrderMarginProductCostResolver(null);
  });

  it("Cenário A — produto: fluxo completo com margem e preço oficial", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [
        {
          id: "mp-1",
          code: "PP H503",
          description: "Polímero",
          unit: "kg",
          currentCost: 16.5,
          freight: 0,
          averageCost: null,
          standardCost: null,
          standardLoss: null,
          status: "ACTIVE",
        },
      ],
      products: [
        { id: "prod-a", sku: "100.01AA", name: "Produto A", type: "PRODUCT", status: "ACTIVE" },
      ],
    });

    const { mpGen, prodGen, priceGen, refDate } = await runFullPublicationFlow(ctx, {
      effectiveDate: "2026-06-01",
      productIds: ["prod-a"],
      engineCosts: { "prod-a": { total: 100 } },
    });

    assert.equal(prodGen.version?.materialCostTableVersionId, mpGen.version!.id);
    assert.equal(priceGen.version.productionCostTableVersionId, prodGen.version!.id);

    const prodItem = [...ctx.prodItems.values()].find(
      (i) => i.costTableVersionId === prodGen.version!.id && i.productId === "prod-a"
    );
    assert.ok(prodItem);
    assert.equal(prodItem!.unitProductionCost, 100);

    const priceItem = ctx.priceItems.get(`${priceGen.version.id}:prod-a`);
    assert.ok(priceItem);
    assert.equal(priceItem!.frozenTotalCost, 100);
    assert.ok(priceItem!.salePrice > 100);

    const order = buildMarginOrder({
      productId: "prod-a",
      sku: "100.01AA",
      name: "Produto A",
      soldPrice: 150,
      quantity: 10,
      issueDate: civilDateToLocalDate("2026-06-15"),
    });

    const margins = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [order]);
    const result = margins.get(ORDER_ID);
    assert.ok(result);
    const itemMargin = result!.itemMargins.get("so-item-1");
    assert.ok(itemMargin);
    assert.equal(itemMargin!.status, "OK");
    assert.equal(itemMargin!.unitCost, 100);
    assert.equal(itemMargin!.costSource, "VERSIONED_PRODUCTION_COST");
    assert.notEqual(itemMargin!.unitCost, order.items[0]!.unitCost);

    const ref = itemMargin!.commercialReference;
    assert.ok(ref);
    assert.equal(ref!.referenceStatus, "OK");
    assert.equal(ref!.officialUnitPrice, priceItem!.salePrice);
    assert.equal(ref!.realizedMarginAmount, itemMargin!.marginValue);
    assert.ok(ref!.marginLeakageAmount != null);

    const effective = await getEffectiveProductProductionCost(
      ctx.db as never,
      "prod-a",
      refDate
    );
    assert.equal(effective.status, "OK");
    if (effective.status === "OK") assert.equal(effective.unitProductionCost, 100);
  });

  it("Cenário B — componente vendável com custo e preço oficiais", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [
        {
          id: "mp-1",
          code: "MP-C",
          description: "MP comp",
          unit: "kg",
          currentCost: 8,
          freight: 0,
          averageCost: null,
          standardCost: null,
          standardLoss: null,
          status: "ACTIVE",
        },
      ],
      products: [
        {
          id: "comp-b",
          sku: "309.86AA",
          name: "Componente B",
          type: "COMPONENT",
          status: "ACTIVE",
        },
      ],
    });

    const { prodGen, priceGen } = await runFullPublicationFlow(ctx, {
      effectiveDate: "2026-06-01",
      productIds: ["comp-b"],
      engineCosts: { "comp-b": { total: 50 } },
      itemScope: "PRODUCT_AND_COMPONENT",
    });

    assert.equal(prodGen.summary.componentsCalculated, 1);
    assert.equal(priceGen.summary.componentsEvaluated, 1);
    assert.equal(priceGen.summary.itemsCreated, 1);

    const order = buildMarginOrder({
      productId: "comp-b",
      sku: "309.86AA",
      name: "Componente B",
      soldPrice: 80,
      quantity: 5,
      issueDate: civilDateToLocalDate("2026-06-20"),
    });

    const margins = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [order]);
    const itemMargin = margins.get(ORDER_ID)!.itemMargins.get("so-item-1");
    assert.equal(itemMargin!.status, "OK");
    assert.equal(itemMargin!.unitCost, 50);
    assert.equal(itemMargin!.commercialReference?.productType, "COMPONENT");
    assert.equal(itemMargin!.commercialReference?.referenceStatus, "OK");
  });

  it("Cenário C — mudança de MP viva não altera publicações antigas", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [
        {
          id: "mp-1",
          code: "PP H503",
          description: "Polímero",
          unit: "kg",
          currentCost: 16.5,
          freight: 0,
          averageCost: null,
          standardCost: null,
          standardLoss: null,
          status: "ACTIVE",
        },
      ],
      products: [
        { id: "prod-a", sku: "100.01AA", name: "Produto A", type: "PRODUCT", status: "ACTIVE" },
      ],
    });

    const v1 = await runFullPublicationFlow(ctx, {
      effectiveDate: "2026-06-01",
      productIds: ["prod-a"],
      engineCosts: { "prod-a": { total: 100 } },
    });
    const v1PriceItem = ctx.priceItems.get(`${v1.priceGen.version.id}:prod-a`)!;
    const v1ProdItem = [...ctx.prodItems.values()].find(
      (i) => i.costTableVersionId === v1.prodGen.version!.id
    )!;

    ctx.materials[0]!.currentCost = 999;

    const mpResolved = await getEffectiveMaterialCost(
      ctx.db as never,
      "mp-1",
      civilDateToLocalDate("2026-06-15")
    );
    assert.equal(mpResolved.status, "OK");
    if (mpResolved.status === "OK") {
      assert.equal(mpResolved.landedCostSnapshot, 16.5);
      assert.notEqual(mpResolved.landedCostSnapshot, 999);
    }

    const prodResolved = await getEffectiveProductProductionCost(
      ctx.db as never,
      "prod-a",
      civilDateToLocalDate("2026-06-15")
    );
    assert.equal(prodResolved.status, "OK");
    if (prodResolved.status === "OK") assert.equal(prodResolved.unitProductionCost, 100);

    assert.equal(v1ProdItem.unitProductionCost, 100);
    assert.equal(v1PriceItem.frozenTotalCost, 100);

    const v2 = await runFullPublicationFlow(ctx, {
      effectiveDate: "2026-07-01",
      productIds: ["prod-a"],
      engineCosts: { "prod-a": { total: 200 } },
    });

    const oldPriceAfter = ctx.priceItems.get(`${v1.priceGen.version.id}:prod-a`)!;
    assert.equal(oldPriceAfter.frozenTotalCost, 100);
    assert.equal(oldPriceAfter.salePrice, v1PriceItem.salePrice);

    const v2PriceItem = ctx.priceItems.get(`${v2.priceGen.version.id}:prod-a`)!;
    assert.equal(v2PriceItem.frozenTotalCost, 200);
    assert.notEqual(v2PriceItem.salePrice, v1PriceItem.salePrice);
  });

  it("Cenário D — mudança de BOM (motor) só afeta novo DRAFT; publicado antigo congelado", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [
        {
          id: "mp-1",
          code: "MP",
          description: "MP",
          unit: "kg",
          currentCost: 10,
          freight: 0,
          averageCost: null,
          standardCost: null,
          standardLoss: null,
          status: "ACTIVE",
        },
      ],
      products: [
        { id: "prod-a", sku: "PA", name: "Produto A", type: "PRODUCT", status: "ACTIVE" },
      ],
    });

    const v1 = await runFullPublicationFlow(ctx, {
      effectiveDate: "2026-06-01",
      productIds: ["prod-a"],
      engineCosts: { "prod-a": { total: 80 } },
    });

    const orderOld = buildMarginOrder({
      productId: "prod-a",
      sku: "PA",
      name: "Produto A",
      soldPrice: 120,
      quantity: 1,
      issueDate: civilDateToLocalDate("2026-06-10"),
    });
    const marginOld = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [orderOld]);
    assert.equal(marginOld.get(ORDER_ID)!.itemMargins.get("so-item-1")!.unitCost, 80);

    const v2 = await runFullPublicationFlow(ctx, {
      effectiveDate: "2026-07-01",
      productIds: ["prod-a"],
      engineCosts: { "prod-a": { total: 150 } },
    });
    assert.equal(
      [...ctx.prodItems.values()].find((i) => i.costTableVersionId === v2.prodGen.version!.id)!.unitProductionCost,
      150
    );

    const marginOldAgain = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [orderOld]);
    assert.equal(marginOldAgain.get(ORDER_ID)!.itemMargins.get("so-item-1")!.unitCost, 80);

    const orderNew = buildMarginOrder({
      productId: "prod-a",
      sku: "PA",
      name: "Produto A",
      soldPrice: 200,
      quantity: 1,
      issueDate: civilDateToLocalDate("2026-07-15"),
    });
    const marginNew = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [orderNew]);
    assert.equal(marginNew.get(ORDER_ID)!.itemMargins.get("so-item-1")!.unitCost, 150);
  });

  it("Cenário E — pendências explícitas, sem custo zero silencioso", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [
        {
          id: "mp-1",
          code: "MP",
          description: "MP",
          unit: "kg",
          currentCost: 10,
          freight: 0,
          averageCost: null,
          standardCost: null,
          standardLoss: null,
          status: "ACTIVE",
        },
      ],
      products: [
        { id: "prod-ok", sku: "OK", name: "Com custo", type: "PRODUCT", status: "ACTIVE" },
        { id: "prod-no", sku: "NO", name: "Sem custo", type: "PRODUCT", status: "ACTIVE" },
        { id: "comp-no", sku: "CN", name: "Comp sem custo", type: "COMPONENT", status: "ACTIVE" },
      ],
    });

    const mpGen = await generateMaterialCostTableDraftFromMaterials(ctx.db as never, {
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      includeAllActiveMaterials: true,
    });
    await publishMaterialCostVersionFromDraft(ctx.db as never, { versionId: mpGen.version!.id });

    const prodDraft = await generateProductionCostTableDraftFromProducts(
      ctx.db as never,
      createMockEngine({ "prod-ok": { total: 40 } }),
      {
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        productIds: ["prod-ok"],
      }
    );
    await publishProductionCostVersionFromDraft(ctx.db as never, { versionId: prodDraft.version!.id });

    const order = {
      id: ORDER_ID,
      proposalId: null,
      issueDate: civilDateToLocalDate("2026-06-15"),
      nomusRawResponse: null,
      items: [
        {
          id: "i-no",
          salesOrderId: ORDER_ID,
          productId: "prod-no",
          proposalItemId: null,
          externalProductId: null,
          skuSnapshot: "NO",
          productNameSnapshot: "Sem custo",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 50,
        },
        {
          id: "i-comp",
          salesOrderId: ORDER_ID,
          productId: "comp-no",
          proposalItemId: null,
          externalProductId: null,
          skuSnapshot: "CN",
          productNameSnapshot: "Comp sem custo",
          quantity: 2,
          negotiatedPrice: 30,
          totalNetValue: 60,
          unitCost: 10,
        },
      ],
    };

    const margins = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [order]);
    const noCost = margins.get(ORDER_ID)!.itemMargins.get("i-no");
    const compNoCost = margins.get(ORDER_ID)!.itemMargins.get("i-comp");

    assert.equal(noCost!.status, "SEM_CUSTO");
    assert.equal(noCost!.unitCost, null);
    assert.notEqual(noCost!.unitCost, 0);
    assert.equal(classifySoldItemForIntegratedAudit({ marginStatus: noCost!.status }), "SEM_CUSTO");

    assert.equal(compNoCost!.status, "SEM_CUSTO");
    assert.equal(compNoCost!.unitCost, null);

    const priceDraft = await generatePriceTableVersionDraftFromProductionCosts(ctx.db as never, {
      priceTableId: PRICE_TABLE_ID,
      effectiveDate: civilDateToLocalDate("2026-06-15"),
      includeAllActiveProducts: true,
      itemScope: "PRODUCT_AND_COMPONENT",
    });
    assert.equal(priceDraft.summary.itemsCreated, 1);
    assert.ok(priceDraft.summary.errors.some((e) => e.code === "SEM_CUSTO_PRODUCAO_OFICIAL"));
  });

  it("compatibilidade — versão produção legada sem materialCostTableVersionId ainda resolve margem", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [],
      products: [{ id: "prod-legacy", sku: "LEG", name: "Legado", type: "PRODUCT", status: "ACTIVE" }],
    });

    const now = new Date();
    const legacyVerId = "legacy-prod-ver";
    ctx.prodVersions.set(legacyVerId, {
      id: legacyVerId,
      code: "2025-12",
      name: "Legado",
      effectiveDate: civilDateToLocalDate("2025-12-01"),
      status: "PUBLISHED",
      revision: 1,
      supersedesVersionId: null,
      materialCostTableVersionId: null,
      source: null,
      notes: null,
      publishedAt: now,
      publishedBy: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
    ctx.prodItems.set(`${legacyVerId}:prod-legacy`, {
      id: "legacy-item",
      costTableVersionId: legacyVerId,
      productId: "prod-legacy",
      productCodeSnapshot: "LEG",
      productNameSnapshot: "Legado",
      unitProductionCost: 55,
      materialCost: 20,
      processCost: 0,
      laborCost: 15,
      machineCost: 10,
      overheadCost: 10,
      otherCost: 0,
      currency: "BRL",
      calculationHash: "legacy",
      calculationSnapshot: null,
      createdAt: now,
      updatedAt: now,
    });

    const order = buildMarginOrder({
      productId: "prod-legacy",
      sku: "LEG",
      name: "Legado",
      soldPrice: 100,
      quantity: 1,
      issueDate: civilDateToLocalDate("2025-12-15"),
    });

    const margins = await calculateSalesOrderMarginsForOrders(ctx.db as unknown as PrismaClient, [order]);
    const item = margins.get(ORDER_ID)!.itemMargins.get("so-item-1");
    assert.equal(item!.status, "OK");
    assert.equal(item!.unitCost, 55);
  });

  it("compatibilidade — versão preço legada sem productionCostTableVersionId ainda é legível", async () => {
    const ctx = createEndToEndFlowDb({
      materials: [],
      products: [{ id: "prod-a", sku: "PA", name: "A", type: "PRODUCT", status: "ACTIVE" }],
    });

    const now = new Date();
    const legacyPriceVerId = "legacy-price-ver";
    ctx.priceVersions.set(legacyPriceVerId, {
      id: legacyPriceVerId,
      priceTableId: PRICE_TABLE_ID,
      versionNumber: 1,
      status: "PUBLISHED",
      taxRuleId: null,
      productionCostTableVersionId: null,
      generatedAt: now,
      notes: null,
      commissionPerc: 5,
      effectiveFrom: civilDateToLocalDate("2025-12-01"),
      effectiveTo: null,
      publishedAt: now,
      generationSummaryJson: null,
    });
    ctx.priceItems.set(`${legacyPriceVerId}:prod-a`, {
      id: "legacy-pti",
      priceTableVersionId: legacyPriceVerId,
      productId: "prod-a",
      sku: "PA",
      productName: "A",
      frozenTotalCost: 70,
      frozenMaterialCost: 30,
      frozenHhCost: 15,
      frozenHmCost: 15,
      frozenTaxCost: 5,
      frozenOtherCost: 5,
      marginPct: 25,
      salePrice: 93.33,
      commissionPerc: 5,
      commissionValue: 4.67,
      costSnapshotJson: { legacy: true },
      formulaSnapshotJson: {},
    });

    const resolved = await resolvePublishedPriceTableVersionForDate(
      ctx.db as never,
      PRICE_TABLE_ID,
      civilDateToLocalDate("2025-12-15")
    );
    assert.ok(resolved);
    assert.equal(resolved!.id, legacyPriceVerId);
    assert.equal(resolved!.productionCostTableVersionId, null);
  });
});
