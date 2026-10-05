import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "../financeCivilDate.js";
import { PRODUCTION_COST_PUBLICATION_SOURCE } from "../productionCostPublication.js";
import {
  generateProductionCostTableDraftFromProducts,
} from "../productionCostPublication.server.js";
import type {
  AnalysisCache,
  ProductCostAnalysisEngine,
} from "../productCostAnalysisEngine.server.js";
import {
  UNITARY_PRODUCTION_COST_DRAFT_NOTES_MARKER,
  UNITARY_PRODUCTION_COST_DRAFT_SOURCE,
  mapUnitaryCostComposition,
  parseUnitaryProductionCostDraftRequest,
} from "./unitaryFormationProductionCost.js";
import { createUnitaryProductionCostDraftFromLive } from "./unitaryFormationProductionCost.server.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

type VersionRow = {
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

type ItemRow = {
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

function createMockDb(
  products: Array<{ id: string; sku: string; name: string; type?: string; status?: string | null }>
) {
  const normalized = products.map((p) => ({
    ...p,
    type: p.type ?? "PRODUCT",
    status: p.status === undefined ? "ACTIVE" : p.status,
  }));
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;
  const itemKey = (versionId: string, productId: string) => `${versionId}:${productId}`;

  const materialVersions = new Map([
    [
      "mp-ver-default",
      {
        id: "mp-ver-default",
        code: "2026-01",
        name: "MP default",
        effectiveDate: civilDateToLocalDate("2026-01-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [
          {
            materialId: "mp-default",
            materialCodeSnapshot: "MP-DEFAULT",
            currentCostSnapshot: 10,
            freightSnapshot: 0,
            landedCostSnapshot: 10,
            standardLossSnapshot: 0,
            unitSnapshot: "kg",
            costSource: "CURRENT_MATERIAL",
          },
        ],
      },
    ],
  ]);

  const db = {
    materialCostTableVersion: {
      findFirst: async ({
        where,
        include,
      }: {
        where: { status?: string; effectiveDate?: { lte: Date } };
        include?: { items?: unknown };
      }) => {
        let rows = [...materialVersions.values()];
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        if (where.effectiveDate?.lte) {
          const lte = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lte);
        }
        rows.sort((a, b) => {
          const eff = b.effectiveDate.getTime() - a.effectiveDate.getTime();
          if (eff !== 0) return eff;
          return b.revision - a.revision;
        });
        const row = rows[0] ?? null;
        if (!row) return null;
        if (include?.items) return { ...row, items: row.items };
        return row;
      },
    },
    productionCostTableVersion: {
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where: { code?: string; status?: string };
        orderBy?: Array<Record<string, string>> | Record<string, string>;
        select?: Record<string, boolean>;
      }) => {
        let rows = [...versions.values()];
        if (where.code) rows = rows.filter((v) => v.code === where.code);
        if (where.status) rows = rows.filter((v) => v.status === where.status);
        const order = Array.isArray(orderBy) ? orderBy[0] : orderBy;
        if (order && "revision" in order && order.revision === "desc") {
          rows.sort((a, b) => b.revision - a.revision);
        }
        const row = rows[0] ?? null;
        if (!row) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return row;
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = versions.get(where.id) ?? null;
        if (!row) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return row;
      },
      create: async ({ data }: { data: Partial<VersionRow> }) => {
        versionSeq += 1;
        const now = new Date(Date.now() + versionSeq * 2);
        const id = `ver-${versionSeq}`;
        const row: VersionRow = {
          id,
          code: String(data.code),
          name: String(data.name),
          effectiveDate: data.effectiveDate as Date,
          status: "DRAFT",
          revision: Number(data.revision),
          supersedesVersionId: data.supersedesVersionId ?? null,
          materialCostTableVersionId: data.materialCostTableVersionId ?? null,
          source: data.source ?? null,
          notes: data.notes ?? null,
          publishedAt: null,
          publishedBy: null,
          createdBy: data.createdBy ?? null,
          createdAt: now,
          updatedAt: now,
        };
        versions.set(id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("not found");
        for (const [key, item] of [...items.entries()]) {
          if (item.costTableVersionId === where.id) items.delete(key);
        }
        versions.delete(where.id);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<VersionRow>;
      }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: new Date() });
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
        create: Omit<ItemRow, "id" | "createdAt" | "updatedAt">;
        update: Partial<ItemRow>;
      }) => {
        const key = itemKey(
          where.costTableVersionId_productId.costTableVersionId,
          where.costTableVersionId_productId.productId
        );
        const existing = items.get(key);
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return existing;
        }
        itemSeq += 1;
        const row: ItemRow = {
          id: `item-${itemSeq}`,
          createdAt: new Date(Date.now() + itemSeq),
          updatedAt: new Date(Date.now() + itemSeq),
          ...create,
        };
        items.set(key, row);
        return row;
      },
      findMany: async ({
        where,
        select,
      }: {
        where: { costTableVersionId?: string; productId?: string };
        select?: Record<string, boolean>;
      }) => {
        let rows = [...items.values()];
        if (where.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        if (where.productId) rows = rows.filter((i) => i.productId === where.productId);
        if (!select) return rows;
        return rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        });
      },
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { productId: string; costTableVersion?: { status: string } };
        orderBy?: { createdAt: string };
      }) => {
        let rows = [...items.values()].filter((i) => i.productId === where.productId);
        if (where.costTableVersion?.status) {
          rows = rows.filter((i) => versions.get(i.costTableVersionId)?.status === where.costTableVersion!.status);
        }
        if (orderBy?.createdAt === "desc") {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return rows[0] ?? null;
      },
    },
    product: {
      findFirst: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = normalized.find((p) => p.id === where.id) ?? null;
        if (!row) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = (row as Record<string, unknown>)[key];
        }
        return out;
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const row = normalized.find((p) => p.id === where.id) ?? null;
        if (!row) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = (row as Record<string, unknown>)[key];
        }
        return out;
      },
      findMany: async ({
        where,
        select,
      }: {
        where: {
          id?: { in: string[] };
          status?: string;
          type?: string | { in: string[] };
        };
        select?: Record<string, unknown>;
      }) => {
        let rows = normalized;
        if (where.status) {
          rows = rows.filter(
            (p) => p.status === where.status || (where.status === "ACTIVE" && p.status == null)
          );
        }
        const typeFilter = where.type;
        if (typeFilter && typeof typeFilter === "object" && Array.isArray(typeFilter.in)) {
          rows = rows.filter((p) => typeFilter.in.includes(p.type));
        } else if (typeof typeFilter === "string") {
          rows = rows.filter((p) => p.type === typeFilter);
        }
        if (where.id?.in) rows = rows.filter((p) => where.id!.in.includes(p.id));
        return rows.map((p) => {
          const out: Record<string, unknown> = {
            id: p.id,
            sku: p.sku,
            name: p.name,
            type: p.type,
            status: p.status,
          };
          if (select?.ProductBOM) out.ProductBOM = [];
          return out;
        });
      },
      count: async () => 0,
    },
  };

  return { db, versions, items };
}

function emptyAnalysisCache(): AnalysisCache {
  return {
    indirectCosts: [],
    factoryHoursMonthly: 0,
    globalHhCost: 0,
    energyCost: 0,
    workingHours: 0,
    opexRatePerHour: 0,
  };
}

function createMockEngine(
  map: Record<string, { total: number; partial?: boolean } | "FAIL" | "ZERO" | "NULL">
): ProductCostAnalysisEngine {
  return {
    initAnalysisCache: async () => emptyAnalysisCache(),
    getProductCostAnalysis: async (productId) => {
      const entry = map[productId];
      if (entry === "NULL") return null;
      if (entry === "FAIL") return { error: "CONFIG_MISSING", message: "FACTORY_HOURS inválido." };
      if (entry === "ZERO") {
        return {
          productId,
          sku: "X",
          summary: {
            totalIndustrialCost: 0,
            totalMaterialCost: 0,
            totalHH_Unit: 0,
            totalHM_Unit: 0,
            totalCIF_Unit: 0,
            totalOPEX_Unit: 0,
          },
        };
      }
      if (!entry || typeof entry === "string") return null;
      const material = entry.total * 0.5;
      const hh = entry.total * 0.2;
      const hm = entry.total * 0.2;
      const cif = entry.total * 0.05;
      const opex = entry.total * 0.05;
      return {
        productId,
        sku: "X",
        summary: {
          totalIndustrialCost: entry.total,
          totalMaterialCost: material,
          totalHH_Unit: hh,
          totalHM_Unit: hm,
          totalCIF_Unit: cif,
          totalOPEX_Unit: opex,
          costAnalysisPartial: entry.partial === true,
        },
      };
    },
    isCostAnalysisFailure: (x: unknown): x is { error: string; message?: string } =>
      !!x && typeof x === "object" && "error" in x,
    describeCostAnalysisFailure: (failure: unknown) =>
      String((failure as { message?: string }).message ?? "Erro"),
  };
}

describe("unitaryFormationProductionCost pure", () => {
  it("composition usa processTotal = HH + HM", () => {
    const c = mapUnitaryCostComposition({
      materialCost: 1,
      laborCost: 0.3,
      machineCost: 0.2,
      overheadCost: 0.1,
      otherCost: 0,
      unitProductionCost: 1.6,
    });
    assert.equal(c.processTotal, 0.5);
    assert.equal(c.hh, 0.3);
    assert.equal(c.hm, 0.2);
  });

  it("parse ignora custos enviados pelo frontend", () => {
    const parsed = parseUnitaryProductionCostDraftRequest({
      productId: PRODUCT_ID,
      body: {
        effectiveDate: "2026-10-05",
        unitCost: 999,
        unitProductionCost: 999,
        material: 999,
        calculationHash: "hack",
      },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.effectiveDateKey, "2026-10-05");
      assert.equal(parsed.productId, PRODUCT_ID);
    }
  });

  it("source oficial de Pricing é preservado", () => {
    assert.equal(UNITARY_PRODUCTION_COST_DRAFT_SOURCE, PRODUCTION_COST_PUBLICATION_SOURCE);
  });
});

describe("createUnitaryProductionCostDraftFromLive", () => {
  it("produto válido: cria DRAFT com exatamente 1 item, hash e source corretos", async () => {
    const { db, versions, items } = createMockDb([
      { id: PRODUCT_ID, sku: "320.03AA", name: "Tampa" },
    ]);
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 10 } });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      createdBy: "tester@example.com",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, "DRAFT");
    assert.equal(result.data.code, "2026-10");
    assert.equal(result.data.revision, 1);
    assert.equal(result.data.source, PRODUCTION_COST_PUBLICATION_SOURCE);
    assert.equal(result.data.unitCost, 10);
    assert.ok(result.data.calculationHash);
    assert.equal(result.data.composition.processTotal != null, true);
    assert.equal(result.data.published, false);
    assert.match(versions.get(result.data.draftVersionId)?.notes ?? "", new RegExp(UNITARY_PRODUCTION_COST_DRAFT_NOTES_MARKER));

    const draftItems = [...items.values()].filter(
      (i) => i.costTableVersionId === result.data.draftVersionId
    );
    assert.equal(draftItems.length, 1);
    assert.equal(draftItems[0]?.productId, PRODUCT_ID);
  });

  it("múltiplos DRAFTs permitidos; o novo é o mais recente", async () => {
    const { db, items } = createMockDb([{ id: PRODUCT_ID, sku: "320.03AA", name: "Tampa" }]);
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 10 } });
    const first = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    const second = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.data.revision, 1);
    assert.equal(second.data.revision, 2);
    assert.notEqual(first.data.draftVersionId, second.data.draftVersionId);

    const latest = await db.productionCostTableItem.findFirst({
      where: { productId: PRODUCT_ID, costTableVersion: { status: "DRAFT" } },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(latest?.costTableVersionId, second.data.draftVersionId);
    assert.equal(
      [...items.values()].filter((i) => i.productId === PRODUCT_ID).length,
      2
    );
  });

  it("nenhum PUBLISHED é alterado", async () => {
    const { db, versions } = createMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    // seed published
    versions.set("pub-1", {
      id: "pub-1",
      code: "2026-10",
      name: "pub",
      effectiveDate: civilDateToLocalDate("2026-10-01"),
      status: "PUBLISHED",
      revision: 1,
      supersedesVersionId: null,
      materialCostTableVersionId: "mp-ver-default",
      source: PRODUCTION_COST_PUBLICATION_SOURCE,
      notes: null,
      publishedAt: new Date(),
      publishedBy: "admin",
      createdBy: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const before = { ...versions.get("pub-1")! };
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 12 } });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.revision, 2);
    assert.equal(versions.get("pub-1")?.status, "PUBLISHED");
    assert.equal(versions.get("pub-1")?.publishedAt?.getTime(), before.publishedAt?.getTime());
    assert.equal(versions.get(result.data.draftVersionId)?.status, "DRAFT");
  });

  it("frontend não força custo — LIVE do motor prevalece", async () => {
    const { db } = createMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 7.5 } });
    const parsed = parseUnitaryProductionCostDraftRequest({
      productId: PRODUCT_ID,
      body: { effectiveDate: "2026-10-05", unitCost: 1, material: 1 },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: parsed.productId,
      effectiveDate: parsed.effectiveDate,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.unitCost, 7.5);
  });

  it("produto inexistente", async () => {
    const { db } = createMockDb([]);
    const engine = createMockEngine({});
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "PRODUCT_NOT_FOUND");
  });

  it("produto inativo", async () => {
    const { db } = createMockDb([
      { id: PRODUCT_ID, sku: "PA", name: "A", status: "INACTIVE" },
    ]);
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 10 } });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "INACTIVE_PRODUCT");
  });

  it("custo inválido (<= 0)", async () => {
    const { db, versions } = createMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    const engine = createMockEngine({ [PRODUCT_ID]: "ZERO" });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "LIVE_COST_INVALID");
    assert.equal(versions.size, 0);
  });

  it("erro de motor", async () => {
    const { db, versions } = createMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    const engine = createMockEngine({ [PRODUCT_ID]: "FAIL" });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "LIVE_COST_ERROR");
    assert.equal(versions.size, 0);
  });

  it("snapshot/hash congelado no item", async () => {
    const { db, items } = createMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 10 } });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = [...items.values()][0]!;
    assert.ok(item.calculationHash);
    assert.equal(item.calculationHash, result.data.calculationHash);
    assert.ok(item.calculationSnapshot);
    const snap = item.calculationSnapshot as { publicationSource?: string; finalUnitCost?: number };
    assert.equal(snap.publicationSource, PRODUCTION_COST_PUBLICATION_SOURCE);
    assert.equal(snap.finalUnitCost, 10);
  });

  it("custo parcial gera DRAFT com warning (semântica do lote)", async () => {
    const { db } = createMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    const engine = createMockEngine({ [PRODUCT_ID]: { total: 10, partial: true } });
    const result = await createUnitaryProductionCostDraftFromLive(db as never, engine, {
      productId: PRODUCT_ID,
      effectiveDate: civilDateToLocalDate("2026-10-05"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.costAnalysisPartial, true);
    assert.ok(result.data.warnings.some((w) => w.code === "COST_ANALYSIS_PARTIAL"));
  });
});

describe("unitary draft wiring / regressão bulk", () => {
  it("rota POST draft existe com auth generate_tables; view/publish não bastam", () => {
    const server = read("server.ts");
    const idx = server.indexOf(
      '"/api/pricing/unitary-formation/products/:productId/production-cost/draft"'
    );
    assert.ok(idx > 0);
    const block = server.slice(idx, idx + 1200);
    assert.match(block, /requireAppAuth/);
    assert.match(block, /pricing\.generate_tables/);
    assert.match(block, /settings\.price_tables\.manage/);
    assert.match(block, /createUnitaryProductionCostDraftFromLive/);
    assert.doesNotMatch(block, /publishProductionCostVersionFromDraft/);
    assert.doesNotMatch(block, /status:\s*["']PUBLISHED["']/);
    assert.doesNotMatch(block, /requireResource\("commercial\.pricing", "view"\)/);
    assert.doesNotMatch(block, /pricing\.publish_tables/);
  });

  it("regressão: generate em lote continua criando multi-item", async () => {
    const { db, items } = createMockDb([
      { id: PRODUCT_ID, sku: "PA", name: "A" },
      { id: PRODUCT_B, sku: "PB", name: "B" },
    ]);
    const engine = createMockEngine({
      [PRODUCT_ID]: { total: 10 },
      [PRODUCT_B]: { total: 20 },
    });
    const gen = await generateProductionCostTableDraftFromProducts(db as never, engine, {
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      productIds: [PRODUCT_ID, PRODUCT_B],
    });
    assert.equal(gen.summary.itemsCreated, 2);
    const count = [...items.values()].filter((i) => i.costTableVersionId === gen.version!.id).length;
    assert.equal(count, 2);
  });

  it("libs unitárias reusam helpers oficiais; publish só via publisher oficial", () => {
    const serverLib = read("src/lib/pricing/unitaryFormationProductionCost.server.ts");
    const bulk = read("src/lib/productionCostBulkPublish.server.ts");
    assert.match(serverLib, /createProductionCostTableDraft/);
    assert.match(serverLib, /buildProductionCostDraftItemFromAnalysis/);
    assert.match(serverLib, /publishProductionCostVersionFromDraft/);
    assert.doesNotMatch(serverLib, /executeProductionCostBulkPublish/);
    assert.doesNotMatch(bulk, /unitaryFormationProductionCost/);
  });
});
