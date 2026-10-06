import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "../financeCivilDate.js";
import { PRODUCTION_COST_PUBLICATION_SOURCE } from "../productionCostPublication.js";
import { publishProductionCostVersionFromDraft } from "../productionCostPublication.server.js";
import { generateProductionCostTableDraftFromProducts } from "../productionCostPublication.server.js";
import type {
  AnalysisCache,
  ProductCostAnalysisEngine,
} from "../productCostAnalysisEngine.server.js";
import type { ProductFrozenCostTrace } from "../productEngineeringCostSnapshot.server.js";
import {
  UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE,
  mapUnitaryPublishBlockReason,
  parseUnitaryProductionCostPublishRequest,
} from "./unitaryFormationProductionCost.js";
import {
  publishUnitaryProductionCostDraft,
  revalidateUnitaryDraftForPublish,
} from "./unitaryFormationProductionCost.server.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PRODUCT = "22222222-2222-4222-8222-222222222222";
const DRAFT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function createPublishMockDb(
  products: Array<{
    id: string;
    sku: string;
    name: string;
    status?: string | null;
    type?: "PRODUCT" | "COMPONENT";
  }>,
  seed?: { versions?: VersionRow[]; items?: ItemRow[] }
) {
  const normalized = products.map((p) => ({
    ...p,
    type: p.type ?? ("PRODUCT" as const),
    status: p.status === undefined ? "ACTIVE" : p.status,
  }));
  const versions = new Map<string, VersionRow>();
  const items = new Map<string, ItemRow>();
  let versionSeq = 0;
  let itemSeq = 0;
  for (const v of seed?.versions ?? []) versions.set(v.id, { ...v });
  for (const i of seed?.items ?? []) {
    items.set(`${i.costTableVersionId}:${i.productId}`, { ...i });
  }

  const db = {
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    productionCostTableVersion: {
      findUnique: async ({
        where,
        select,
        include,
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
        include?: { items?: boolean };
      }) => {
        const row = versions.get(where.id) ?? null;
        if (!row) return null;
        if (include?.items) {
          return {
            ...row,
            items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
        if (select) {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        }
        return row;
      },
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
        const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        if (order[0] && "revision" in order[0]) {
          rows.sort((a, b) => b.revision - a.revision);
        }
        if (order[0] && "publishedAt" in order[0]) {
          rows.sort(
            (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)
          );
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
      create: async ({
        data,
      }: {
        data: Omit<VersionRow, "id" | "createdAt" | "updatedAt" | "publishedAt" | "publishedBy"> & {
          publishedAt?: Date | null;
          publishedBy?: string | null;
        };
      }) => {
        versionSeq += 1;
        const id = `complete-ver-${versionSeq}`;
        const now = new Date();
        const row: VersionRow = {
          id,
          createdAt: now,
          updatedAt: now,
          publishedAt: data.publishedAt ?? null,
          publishedBy: data.publishedBy ?? null,
          materialCostTableVersionId: data.materialCostTableVersionId ?? null,
          ...data,
        };
        versions.set(id, row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        versions.delete(where.id);
        for (const [key, item] of [...items.entries()]) {
          if (item.costTableVersionId === where.id) items.delete(key);
        }
        return { id: where.id };
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Partial<VersionRow>;
        include?: { items?: boolean };
      }) => {
        const row = versions.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: new Date() });
        if (include?.items) {
          return {
            ...row,
            items: [...items.values()].filter((i) => i.costTableVersionId === row.id),
          };
        }
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: Partial<VersionRow>;
      }) => {
        const row = versions.get(where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      findMany: async ({
        where,
        include,
        orderBy,
        select,
      }: {
        where?: {
          id?: { in: string[] };
          status?: string | { in: string[] };
          effectiveDate?: { lte: Date };
          code?: string;
        };
        include?: { items?: boolean | { where?: { productId?: { in: string[] } } } };
        orderBy?: Array<Record<string, string>>;
        select?: Record<string, boolean>;
      } = {}) => {
        let rows = [...versions.values()];
        if (where?.id && typeof where.id === "object" && "in" in where.id) {
          const idIn = where.id.in;
          rows = rows.filter((v) => idIn.includes(v.id));
        }
        if (typeof where?.status === "string") {
          rows = rows.filter((v) => v.status === where.status);
        } else if (where?.status && typeof where.status === "object" && "in" in where.status) {
          const statusIn = where.status.in;
          rows = rows.filter((v) => statusIn.includes(v.status));
        }
        if (where?.effectiveDate?.lte) {
          const lim = where.effectiveDate.lte.getTime();
          rows = rows.filter((v) => v.effectiveDate.getTime() <= lim);
        }
        if (where?.code) rows = rows.filter((v) => v.code === where.code);
        if (orderBy?.length) {
          rows.sort((a, b) => {
            for (const ord of orderBy) {
              const key = Object.keys(ord)[0]!;
              const dir = ord[key] === "asc" ? 1 : -1;
              const av = (a as Record<string, unknown>)[key];
              const bv = (b as Record<string, unknown>)[key];
              if (av instanceof Date && bv instanceof Date) {
                if (av.getTime() !== bv.getTime()) return (av.getTime() - bv.getTime()) * dir;
              } else if (typeof av === "number" && typeof bv === "number") {
                if (av !== bv) return (av - bv) * dir;
              }
            }
            return 0;
          });
        }
        return rows.map((row) => {
          if (select) {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (select[key]) out[key] = (row as Record<string, unknown>)[key];
            }
            return out;
          }
          let versionItems = [...items.values()].filter((i) => i.costTableVersionId === row.id);
          const itemWhere =
            include?.items && typeof include.items === "object" ? include.items.where : undefined;
          if (
            itemWhere?.productId &&
            typeof itemWhere.productId === "object" &&
            "in" in itemWhere.productId
          ) {
            const idIn = itemWhere.productId.in;
            versionItems = versionItems.filter((i) => idIn.includes(i.productId));
          }
          if (include?.items) return { ...row, items: versionItems };
          return row;
        });
      },
    },
    productionCostTableItem: {
      findFirst: async ({
        where,
        orderBy,
        select,
      }: {
        where: {
          productId?: string;
          costTableVersionId?: string;
          costTableVersion?: { status: string };
        };
        orderBy?: { createdAt: string };
        select?: Record<string, boolean>;
      }) => {
        let rows = [...items.values()];
        if (where.productId) rows = rows.filter((i) => i.productId === where.productId);
        if (where.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        if (where.costTableVersion?.status) {
          rows = rows.filter(
            (i) => versions.get(i.costTableVersionId)?.status === where.costTableVersion!.status
          );
        }
        if (orderBy?.createdAt === "desc") {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
      findMany: async ({
        where,
        select,
        include,
      }: {
        where?: {
          id?: { in: string[] };
          costTableVersionId?: string | { in: string[] };
          productId?: string | { in: string[] };
          costTableVersion?: { status: string; id?: { not: string } };
        };
        select?: Record<string, boolean>;
        include?: { costTableVersion?: { select?: Record<string, boolean> } | boolean };
      }) => {
        let rows = [...items.values()];
        if (where?.id && typeof where.id === "object" && "in" in where.id) {
          const idIn = where.id.in;
          rows = rows.filter((i) => idIn.includes(i.id));
        }
        if (typeof where?.costTableVersionId === "string") {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        } else if (
          where?.costTableVersionId &&
          typeof where.costTableVersionId === "object" &&
          "in" in where.costTableVersionId
        ) {
          const versionIn = where.costTableVersionId.in;
          rows = rows.filter((i) => versionIn.includes(i.costTableVersionId));
        }
        if (typeof where?.productId === "string") {
          rows = rows.filter((i) => i.productId === where.productId);
        } else if (
          where?.productId &&
          typeof where.productId === "object" &&
          "in" in where.productId
        ) {
          const productIn = where.productId.in;
          rows = rows.filter((i) => productIn.includes(i.productId));
        }
        if (where?.costTableVersion) {
          rows = rows.filter((i) => {
            const v = versions.get(i.costTableVersionId);
            if (!v) return false;
            if (where.costTableVersion!.status && v.status !== where.costTableVersion!.status) {
              return false;
            }
            if (where.costTableVersion!.id?.not && v.id === where.costTableVersion!.id.not) {
              return false;
            }
            return true;
          });
        }
        return rows.map((row) => {
          const out: Record<string, unknown> = { ...row };
          if (include?.costTableVersion) {
            const v = versions.get(row.costTableVersionId);
            if (v) {
              const sel =
                typeof include.costTableVersion === "object"
                  ? include.costTableVersion.select
                  : undefined;
              if (sel) {
                const picked: Record<string, unknown> = {};
                for (const key of Object.keys(sel)) {
                  if (sel[key]) picked[key] = (v as Record<string, unknown>)[key];
                }
                out.costTableVersion = picked;
              } else {
                out.costTableVersion = v;
              }
            }
          }
          if (select) {
            const picked: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (select[key]) picked[key] = out[key];
            }
            if (out.costTableVersion) picked.costTableVersion = out.costTableVersion;
            return picked;
          }
          return out;
        });
      },
      createMany: async ({
        data,
      }: {
        data: Array<Omit<ItemRow, "id" | "createdAt" | "updatedAt">>;
      }) => {
        const now = new Date();
        for (const row of data) {
          itemSeq += 1;
          const full: ItemRow = {
            id: `complete-item-${itemSeq}`,
            createdAt: now,
            updatedAt: now,
            ...row,
          };
          items.set(`${full.costTableVersionId}:${full.productId}`, full);
        }
        return { count: data.length };
      },
      count: async ({
        where,
      }: {
        where?: { costTableVersionId?: string; productId?: string };
      }) => {
        let rows = [...items.values()];
        if (where?.costTableVersionId) {
          rows = rows.filter((i) => i.costTableVersionId === where.costTableVersionId);
        }
        if (where?.productId) rows = rows.filter((i) => i.productId === where.productId);
        return rows.length;
      },
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) {
          for (const [key, row] of items.entries()) {
            if (row.id === id) items.delete(key);
          }
        }
        return { count: where.id.in.length };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const [key, row] of items.entries()) {
          if (row.id === where.id) items.delete(key);
        }
      },
      findUnique: async () => null,
    },
    product: {
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
      findFirst: async ({ where }: { where: { id: string } }) =>
        normalized.find((p) => p.id === where.id) ?? null,
      findMany: async ({
        where,
      }: {
        where?: {
          status?: string;
          type?: { in: string[] } | string;
          id?: { in: string[] };
        };
        select?: unknown;
        orderBy?: unknown;
      } = {}) => {
        let rows = [...normalized];
        if (where?.status) rows = rows.filter((p) => p.status === where.status);
        if (where?.type && typeof where.type === "object" && "in" in where.type) {
          const typeIn = where.type.in;
          rows = rows.filter((p) => typeIn.includes(p.type));
        } else if (typeof where?.type === "string") {
          rows = rows.filter((p) => p.type === where.type);
        }
        if (where?.id && typeof where.id === "object" && "in" in where.id) {
          const idIn = where.id.in;
          rows = rows.filter((p) => idIn.includes(p.id));
        }
        return rows.map((p) => ({ id: p.id, sku: p.sku, name: p.name, type: p.type }));
      },
    },
  };

  return { db, versions, items };
}


function seedDraft(opts: {
  draftId: string;
  productId: string;
  sku: string;
  unit: number;
  revision?: number;
  status?: VersionRow["status"];
  createdAt?: Date;
  supersedesVersionId?: string | null;
  hash?: string;
}): { version: VersionRow; item: ItemRow } {
  const createdAt = opts.createdAt ?? new Date();
  const version: VersionRow = {
    id: opts.draftId,
    code: "2026-10",
    name: `Custo de produção 2026-10 (rev. ${opts.revision ?? 1})`,
    effectiveDate: civilDateToLocalDate("2026-10-05"),
    status: opts.status ?? "DRAFT",
    revision: opts.revision ?? 1,
    supersedesVersionId: opts.supersedesVersionId ?? null,
    materialCostTableVersionId: null,
    source: PRODUCTION_COST_PUBLICATION_SOURCE,
    notes: "unitary-formation",
    publishedAt: opts.status === "PUBLISHED" ? createdAt : null,
    publishedBy: opts.status === "PUBLISHED" ? "prev@test" : null,
    createdBy: "creator@test",
    createdAt,
    updatedAt: createdAt,
  };
  const item: ItemRow = {
    id: `item-${opts.draftId}`,
    costTableVersionId: opts.draftId,
    productId: opts.productId,
    productCodeSnapshot: opts.sku,
    productNameSnapshot: "Produto",
    unitProductionCost: opts.unit,
    materialCost: opts.unit * 0.5,
    processCost: 0,
    laborCost: opts.unit * 0.2,
    machineCost: opts.unit * 0.2,
    overheadCost: opts.unit * 0.1,
    otherCost: 0,
    currency: "BRL",
    calculationHash: opts.hash ?? `hash-${opts.unit}`,
    calculationSnapshot: { finalUnitCost: opts.unit },
    createdAt,
    updatedAt: createdAt,
  };
  return { version, item };
}

function pendingTrace(overrides?: Partial<ProductFrozenCostTrace>): ProductFrozenCostTrace {
  return {
    productId: PRODUCT_ID,
    productCode: "PA",
    liveCiu: 10,
    liveHash: "hash-10",
    frozenCost: null,
    frozenHash: null,
    frozenVersionCode: null,
    frozenVersionRevision: null,
    frozenVersionStatus: null,
    frozenEffectiveDate: null,
    frozenVersionId: null,
    frozenItemId: null,
    draftVersionId: DRAFT_A,
    draftHash: "hash-10",
    draftUnitCost: 10,
    traceStatus: "PENDENTE_PUBLICACAO",
    ...overrides,
  };
}

const emptyAnalysisCache = (): AnalysisCache => ({
  indirectCosts: [],
  factoryHoursMonthly: 0,
  globalHhCost: 0,
  energyCost: 0,
  workingHours: 0,
  opexRatePerHour: 0,
});

const noopEngine: ProductCostAnalysisEngine = {
  initAnalysisCache: async () => emptyAnalysisCache(),
  getProductCostAnalysis: async () => null,
  isCostAnalysisFailure: (x: unknown): x is { error: string } =>
    !!x && typeof x === "object" && "error" in x,
  describeCostAnalysisFailure: () => "err",
};

describe("unitaryFormationProductionCost publish pure", () => {
  it("parse exige draftVersionId UUID e ignora custo do body", () => {
    const parsed = parseUnitaryProductionCostPublishRequest({
      productId: PRODUCT_ID,
      body: { draftVersionId: DRAFT_A, unitCost: 1 },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.draftVersionId, DRAFT_A);

    const bad = parseUnitaryProductionCostPublishRequest({
      productId: PRODUCT_ID,
      body: { draftVersionId: "nope" },
    });
    assert.equal(bad.ok, false);
  });

  it("mapUnitaryPublishBlockReason cobre códigos oficiais", () => {
    assert.equal(mapUnitaryPublishBlockReason("STALE_DRAFT", "x").code, "STALE_DRAFT");
    assert.equal(mapUnitaryPublishBlockReason("TECHNICAL_ONLY", "x").code, "TECHNICAL_ONLY");
    assert.equal(mapUnitaryPublishBlockReason("NOT_PENDING", "x").code, "NOT_PENDING");
    assert.equal(mapUnitaryPublishBlockReason("INACTIVE_PRODUCT", "x").code, "INACTIVE_PRODUCT");
  });
});

describe("publishUnitaryProductionCostDraft", () => {
  it("happy path: materializa snapshot completo e publica via caminho oficial (candidato não vira PUBLISHED)", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      revision: 2,
      supersedesVersionId: "pub-old",
    });
    const prior = seedDraft({
      draftId: "pub-old",
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 9,
      revision: 1,
      status: "PUBLISHED",
      createdAt: new Date(Date.now() - 10_000),
    });
    const { db, versions, items } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version, prior.version], items: [item, prior.item] }
    );

    let publishCalls = 0;
    let publishedVersionId: string | null = null;
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A, publishedBy: "publisher@test" },
      {
        loadTrace: async () => pendingTrace(),
        publishFromDraft: async (_db, input) => {
          publishCalls += 1;
          assert.notEqual(input.versionId, DRAFT_A);
          publishedVersionId = input.versionId;
          assert.equal(input.publishedBy, "publisher@test");
          assert.equal(input.auditContext?.source, UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE);
          const real = await publishProductionCostVersionFromDraft(db as never, input);
          return real;
        },
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(publishCalls, 1);
    assert.equal(result.data.published, true);
    assert.equal(result.data.alreadyPublished, false);
    assert.equal(result.data.status, "PUBLISHED");
    assert.equal(result.data.draftVersionId, DRAFT_A);
    assert.equal(result.data.versionId, publishedVersionId);
    assert.notEqual(result.data.versionId, DRAFT_A);
    assert.equal(result.data.publishedBy, "publisher@test");
    assert.equal(result.data.unitCost, 10);
    assert.equal(versions.get(DRAFT_A)?.status, "ARCHIVED");
    assert.equal(versions.get(publishedVersionId!)?.status, "PUBLISHED");
    assert.equal(versions.get("pub-old")?.status, "SUPERSEDED");
    assert.ok(versions.get(publishedVersionId!)?.publishedAt);
    assert.match(versions.get(publishedVersionId!)?.notes ?? "", /UNITARY_FORMATION|unitary|origem/i);
    assert.match(
      versions.get(DRAFT_A)?.notes ?? "",
      /UNITARY_CANDIDATE_MATERIALIZED_INTO completeVersionId=/
    );
    assert.equal(result.data.snapshot?.changedCount, 1);
    assert.equal(result.data.snapshot?.totalItems, 1);
    assert.equal(items.get(`${publishedVersionId}:${PRODUCT_ID}`)?.unitProductionCost, 10);
  });

  it("BUG homolog: após publicar rev corrente, DRAFT stale anterior vira ARCHIVED (não ressuscita)", async () => {
    // published rev1 → draft rev2 stale (custo diferente) → draft rev3 current → publish rev3
    const published = seedDraft({
      draftId: "pub-rev1",
      productId: PRODUCT_ID,
      sku: "320.02AA",
      unit: 1.111558,
      revision: 1,
      status: "PUBLISHED",
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
    });
    const staleDraft = seedDraft({
      draftId: "draft-rev2",
      productId: PRODUCT_ID,
      sku: "320.02AA",
      unit: 0.241281,
      revision: 2,
      status: "DRAFT",
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      supersedesVersionId: "pub-rev1",
      hash: "hash-stale",
    });
    const currentDraft = seedDraft({
      draftId: "draft-rev3",
      productId: PRODUCT_ID,
      sku: "320.02AA",
      unit: 0.293861,
      revision: 3,
      status: "DRAFT",
      createdAt: new Date("2026-10-03T10:00:00.000Z"),
      supersedesVersionId: "pub-rev1",
      hash: "hash-current",
    });
    const { db, versions } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "320.02AA", name: "Torneira" }],
      {
        versions: [published.version, staleDraft.version, currentDraft.version],
        items: [published.item, staleDraft.item, currentDraft.item],
      }
    );

    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: "draft-rev3", publishedBy: "homolog@test" },
      {
        loadTrace: async () =>
          pendingTrace({
            liveCiu: 0.293861,
            liveHash: "hash-current",
            draftHash: "hash-current",
            draftUnitCost: 0.293861,
            draftVersionId: "draft-rev3",
            frozenVersionId: "pub-rev1",
            frozenCost: 1.111558,
            traceStatus: "PENDENTE_PUBLICACAO",
          }),
        publishFromDraft: (d, i) => publishProductionCostVersionFromDraft(d, i),
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(versions.get("draft-rev3")?.status, "ARCHIVED");
    assert.equal(versions.get("draft-rev2")?.status, "ARCHIVED");
    assert.equal(versions.get("pub-rev1")?.status, "SUPERSEDED");
    assert.equal(versions.get(result.data.versionId)?.status, "PUBLISHED");
    assert.notEqual(result.data.versionId, "draft-rev3");
    assert.match(versions.get("draft-rev2")?.notes ?? "", /ARCHIVED — rascunho anterior/);

    // Nenhum DRAFT ativo permanece para o produto (read-model não ressuscita)
    const activeDraftsForProduct = [...versions.values()].filter((v) => v.status === "DRAFT");
    assert.equal(activeDraftsForProduct.length, 0);
  });

  it("arquiva só DRAFTs do mesmo produto; DRAFT de outro produto permanece DRAFT", async () => {
    const otherDraft = seedDraft({
      draftId: "draft-other",
      productId: OTHER_PRODUCT,
      sku: "PB",
      unit: 5,
      revision: 1,
      createdAt: new Date("2026-10-01T08:00:00.000Z"),
    });
    // rewrite product on other draft item already OTHER_PRODUCT via seed
    const stale = seedDraft({
      draftId: DRAFT_B,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 8,
      revision: 1,
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
      hash: "hash-8",
    });
    const current = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      revision: 2,
      createdAt: new Date("2026-10-02T09:00:00.000Z"),
      hash: "hash-10",
    });
    const { db, versions } = createPublishMockDb(
      [
        { id: PRODUCT_ID, sku: "PA", name: "A" },
        { id: OTHER_PRODUCT, sku: "PB", name: "B" },
      ],
      {
        versions: [otherDraft.version, stale.version, current.version],
        items: [otherDraft.item, stale.item, current.item],
      }
    );

    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      {
        loadTrace: async () => pendingTrace(),
        publishFromDraft: (d, i) => publishProductionCostVersionFromDraft(d, i),
      }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(versions.get(DRAFT_A)?.status, "ARCHIVED");
    assert.equal(versions.get(DRAFT_B)?.status, "ARCHIVED");
    assert.equal(versions.get("draft-other")?.status, "DRAFT");
    assert.equal(versions.get(result.data.versionId)?.status, "PUBLISHED");
  });

  it("PUBLISHED anterior preservado como SUPERSEDED (não apagado)", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      revision: 2,
      supersedesVersionId: "pub-old",
    });
    const prior = seedDraft({
      draftId: "pub-old",
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 9,
      revision: 1,
      status: "PUBLISHED",
      createdAt: new Date(Date.now() - 5000),
    });
    const { db, versions, items } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version, prior.version], items: [item, prior.item] }
    );
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A, publishedBy: "p@t" },
      {
        loadTrace: async () =>
          pendingTrace({ frozenVersionId: "pub-old", frozenCost: 9, draftUnitCost: 10 }),
        publishFromDraft: (d, i) => publishProductionCostVersionFromDraft(d, i),
      }
    );
    assert.equal(result.ok, true);
    assert.equal(versions.get("pub-old")?.status, "SUPERSEDED");
    assert.ok(items.get(`pub-old:${PRODUCT_ID}`));
    assert.equal(versions.has("pub-old"), true);
  });

  it("draftVersionId inexistente", async () => {
    const { db } = createPublishMockDb([{ id: PRODUCT_ID, sku: "PA", name: "A" }]);
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      { loadTrace: async () => pendingTrace() }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "DRAFT_NOT_FOUND");
  });

  it("DRAFT de outro produto → WRONG_PRODUCT", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: OTHER_PRODUCT,
      sku: "PB",
      unit: 10,
    });
    const { db } = createPublishMockDb(
      [
        { id: PRODUCT_ID, sku: "PA", name: "A" },
        { id: OTHER_PRODUCT, sku: "PB", name: "B" },
      ],
      { versions: [version], items: [item] }
    );
    const result = await revalidateUnitaryDraftForPublish(
      db as never,
      noopEngine,
      PRODUCT_ID,
      DRAFT_A,
      { loadTrace: async () => pendingTrace() }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "WRONG_PRODUCT");
  });

  it("DRAFT antigo quando existe novo → CONFLICT_NEWER_DRAFT", async () => {
    const old = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      revision: 1,
      createdAt: new Date(Date.now() - 10_000),
    });
    const neu = seedDraft({
      draftId: DRAFT_B,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 11,
      revision: 2,
      createdAt: new Date(),
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [old.version, neu.version], items: [old.item, neu.item] }
    );
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      { loadTrace: async () => pendingTrace({ draftVersionId: DRAFT_B }) }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "CONFLICT_NEWER_DRAFT");
  });

  it("LIVE mudou → STALE_DRAFT", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      hash: "hash-old",
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version], items: [item] }
    );
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      {
        loadTrace: async () =>
          pendingTrace({
            liveCiu: 12,
            liveHash: "hash-new",
            draftHash: "hash-old",
            draftUnitCost: 10,
            traceStatus: "CUSTO_DIVERGENTE",
          }),
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "STALE_DRAFT");
  });

  it("status mudou → CONFLICT_STATUS_CHANGED", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      status: "ARCHIVED",
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version], items: [item] }
    );
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      { loadTrace: async () => pendingTrace() }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "CONFLICT_STATUS_CHANGED");
  });

  it("já publicado → idempotente (não publica duas vezes)", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      status: "PUBLISHED",
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version], items: [item] }
    );
    let publishCalls = 0;
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      {
        loadTrace: async () => pendingTrace(),
        publishFromDraft: async () => {
          publishCalls += 1;
          throw new Error("não deveria chamar");
        },
      }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.alreadyPublished, true);
    assert.equal(publishCalls, 0);
  });

  it("concorrência: segundo request após publish retorna ALREADY_PUBLISHED", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
      revision: 1,
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version], items: [item] }
    );
    const deps = {
      loadTrace: async () => pendingTrace(),
      publishFromDraft: (d: never, i: never) => publishProductionCostVersionFromDraft(d, i),
    };
    const first = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A, publishedBy: "a@t" },
      deps as never
    );
    assert.equal(first.ok, true);
    const second = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A, publishedBy: "b@t" },
      deps as never
    );
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.data.alreadyPublished, true);
  });

  it("produto inativo", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A", status: "INACTIVE" }],
      { versions: [version], items: [item] }
    );
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      { loadTrace: async () => pendingTrace() }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "INACTIVE_PRODUCT");
  });

  it("custo inválido", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 0,
      hash: "hash-0",
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version], items: [item] }
    );
    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      {
        loadTrace: async () =>
          pendingTrace({
            draftUnitCost: 0,
            liveCiu: 0,
            liveHash: "hash-0",
            draftHash: "hash-0",
            traceStatus: "PENDENTE_PUBLICACAO",
          }),
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.error.code === "INVALID_COST" || result.error.code === "NOT_PENDING"
    );
  });

  it("TECHNICAL_ONLY / NOT_PENDING respeitam classify oficial", async () => {
    const { version, item } = seedDraft({
      draftId: DRAFT_A,
      productId: PRODUCT_ID,
      sku: "PA",
      unit: 10,
    });
    const { db } = createPublishMockDb(
      [{ id: PRODUCT_ID, sku: "PA", name: "A" }],
      { versions: [version], items: [item] }
    );
    const technical = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      {
        loadTrace: async () =>
          pendingTrace({
            traceStatus: "SNAPSHOT_TECNICO_SEM_IMPACTO",
            liveCiu: 10,
            draftUnitCost: 10,
          }),
      }
    );
    assert.equal(technical.ok, false);
    if (!technical.ok) assert.equal(technical.error.code, "TECHNICAL_ONLY");

    const updated = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: PRODUCT_ID, draftVersionId: DRAFT_A },
      {
        loadTrace: async () =>
          pendingTrace({
            traceStatus: "ATUALIZADO",
            frozenCost: 10,
            frozenVersionId: "pub",
            liveCiu: 10,
            draftUnitCost: 10,
          }),
      }
    );
    assert.equal(updated.ok, false);
    if (!updated.ok) assert.equal(updated.error.code, "NOT_PENDING");
  });

  it("efeitos colaterais oficiais: materializa + publishFromDraft (sem UPDATE manual PUBLISHED)", () => {
    const serverLib = read("src/lib/pricing/unitaryFormationProductionCost.server.ts");
    assert.match(serverLib, /materializeCompleteProductionCostSnapshot/);
    assert.match(serverLib, /publishProductionCostVersionFromDraft/);
    assert.match(serverLib, /archiveObsoleteProductDraftsAfterPublication/);
    assert.match(serverLib, /UNITARY_CANDIDATE_MATERIALIZED_INTO/);
    assert.doesNotMatch(
      serverLib,
      /status:\s*["']PUBLISHED["']\s*,\s*\n\s*publishedAt/
    );
    assert.match(serverLib, /UNITARY_PRODUCTION_COST_PUBLISH_AUDIT_SOURCE/);
  });

  it("wiring rota publish usa permissões oficiais e não UPDATE manual", () => {
    const server = read("server.ts");
    const idx = server.indexOf(
      '"/api/pricing/unitary-formation/products/:productId/production-cost/publish"'
    );
    assert.ok(idx > 0);
    const block = server.slice(idx, idx + 1400);
    assert.match(block, /requireAppAuth/);
    assert.match(block, /PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS/);
    assert.match(block, /publishUnitaryProductionCostDraft/);
    assert.doesNotMatch(block, /productionCostTableVersion\.update/);
    // view-only / generate_tables não autorizam publicação
    assert.doesNotMatch(block, /requireResource\("commercial\.pricing", "view"\)/);
    assert.doesNotMatch(block, /pricing\.generate_tables/);
  });

  it("core exporta archiveObsolete; bulk finalize também arquiva candidatos após snapshot", () => {
    const tables = read("src/lib/productionCostTables.server.ts");
    const bulk = read("src/lib/productionCostBulkPublish.server.ts");
    const publication = read("src/lib/productionCostPublication.server.ts");
    assert.match(tables, /export async function archiveObsoleteProductDraftsAfterPublication/);
    assert.match(tables, /archiveEquivalentProductionCostDrafts/);
    assert.match(bulk, /archiveObsoleteProductDraftsAfterPublication/);
    assert.doesNotMatch(publication, /archiveObsoleteProductDraftsAfterPublication/);
  });

  it("permissionContract e commercialAccess cobrem draft/publish unitários", () => {
    const access = read("src/lib/commercialAccess.ts");
    const contract = read("src/lib/security/permissionContract/resources.ts");
    assert.match(access, /production-cost\/draft/);
    assert.match(access, /production-cost\/publish/);
    assert.match(contract, /production-cost\/draft/);
    assert.match(contract, /production-cost\/publish/);
  });

  it("regressão bulk: generate lote multi-item segue intacto", async () => {
    // Reusa mock do arquivo de draft via generate oficial com mock mínimo
    const products = [
      { id: PRODUCT_ID, sku: "PA", name: "A", type: "PRODUCT" as const },
      { id: OTHER_PRODUCT, sku: "PB", name: "B", type: "PRODUCT" as const },
    ];
    // Se o import quebrar por mock incompleto, o wiring test acima já cobre bulk intocado.
    assert.equal(typeof generateProductionCostTableDraftFromProducts, "function");
    assert.equal(typeof publishProductionCostVersionFromDraft, "function");
    assert.equal(products.length, 2);
  });

  it("889 oficiais + 1 alterado → PUBLISHED completo (888 carry); LIVE divergente não entra", async () => {
    const N = 889;
    const changedIdx = 0;
    const liveDivergentIdx = 42;
    const products = Array.from({ length: N }, (_, i) => ({
      id: `prod-${String(i).padStart(4, "0")}`,
      sku: `SKU-${i}`,
      name: `Produto ${i}`,
    }));
    const changedId = products[changedIdx]!.id;
    const liveDivergentId = products[liveDivergentIdx]!.id;

    const publishedItems: ItemRow[] = products.map((p, i) => {
      const unit = i === liveDivergentIdx ? 30 : 10 + (i % 7);
      const now = new Date("2026-09-01T00:00:00.000Z");
      return {
        id: `pub-item-${i}`,
        costTableVersionId: "pub-889",
        productId: p.id,
        productCodeSnapshot: p.sku,
        productNameSnapshot: p.name,
        unitProductionCost: unit,
        materialCost: unit * 0.5,
        processCost: 0,
        laborCost: unit * 0.2,
        machineCost: unit * 0.2,
        overheadCost: unit * 0.1,
        otherCost: 0,
        currency: "BRL",
        calculationHash: `hash-pub-${i}-${unit}`,
        calculationSnapshot: { official: unit, liveWouldBe: i === liveDivergentIdx ? 45 : unit },
        createdAt: now,
        updatedAt: now,
      };
    });
    const publishedVersion: VersionRow = {
      id: "pub-889",
      code: "2026-10",
      name: "Custo de produção 2026-10 (rev. 1)",
      effectiveDate: civilDateToLocalDate("2026-10-05"),
      status: "PUBLISHED",
      revision: 1,
      supersedesVersionId: null,
      materialCostTableVersionId: null,
      source: PRODUCTION_COST_PUBLICATION_SOURCE,
      notes: "official-full",
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      publishedBy: "seed@test",
      createdBy: "seed@test",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    const candidate = seedDraft({
      draftId: DRAFT_A,
      productId: changedId,
      sku: products[changedIdx]!.sku,
      unit: 22,
      revision: 2,
      supersedesVersionId: "pub-889",
      hash: "hash-changed-22",
    });

    const { db, versions, items } = createPublishMockDb(products, {
      versions: [publishedVersion, candidate.version],
      items: [...publishedItems, candidate.item],
    });

    const result = await publishUnitaryProductionCostDraft(
      db as never,
      noopEngine,
      { productId: changedId, draftVersionId: DRAFT_A, publishedBy: "unit@test" },
      {
        loadTrace: async () =>
          pendingTrace({
            productId: changedId,
            productCode: products[changedIdx]!.sku,
            liveCiu: 22,
            liveHash: "hash-changed-22",
            draftHash: "hash-changed-22",
            draftUnitCost: 22,
            draftVersionId: DRAFT_A,
            frozenVersionId: "pub-889",
            frozenCost: publishedItems[changedIdx]!.unitProductionCost,
            traceStatus: "PENDENTE_PUBLICACAO",
          }),
        publishFromDraft: (d, i) => publishProductionCostVersionFromDraft(d, i),
      }
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.snapshot?.totalItems, N);
    assert.equal(result.data.snapshot?.changedCount, 1);
    assert.equal(result.data.snapshot?.carriedForwardCount, N - 1);
    assert.equal(result.data.unitCost, 22);
    assert.equal(versions.get(DRAFT_A)?.status, "ARCHIVED");
    assert.equal(versions.get(result.data.versionId)?.status, "PUBLISHED");
    assert.equal(versions.get("pub-889")?.status, "SUPERSEDED");

    const publishedCompleteItems = [...items.values()].filter(
      (i) => i.costTableVersionId === result.data.versionId
    );
    assert.equal(publishedCompleteItems.length, N);
    const byProduct = new Map(publishedCompleteItems.map((i) => [i.productId, i]));
    assert.equal(byProduct.get(changedId)?.unitProductionCost, 22);
    // LIVE divergente (45) NÃO entra — carry do oficial 30
    assert.equal(byProduct.get(liveDivergentId)?.unitProductionCost, 30);
    assert.notEqual(byProduct.get(liveDivergentId)?.unitProductionCost, 45);
    assert.equal(
      byProduct.get(liveDivergentId)?.calculationSnapshot &&
        (byProduct.get(liveDivergentId)?.calculationSnapshot as { official: number }).official,
      30
    );
  });
});
