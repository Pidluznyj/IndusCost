/**
 * Validação integrada service-level — Operações > Performance (fluxo ponta a ponta).
 *
 * Simula: componente → custo publicado congelado → alteração de performance →
 * histórico auditável → novo DRAFT com ciclo/cavidades novos → publicado intacto.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { computeStandardProcessUnitCosts } from "./componentStandardProcessCost.js";
import {
  ComponentPerformanceValidationError,
  listComponentPerformanceHistory,
  patchComponentPerformanceProduct,
} from "./componentPerformanceChange.server.js";
import {
  buildProductionCostCalculationSnapshot,
  buildProductionCostDraftItemFromAnalysis,
} from "./productionCostPublication.js";
import type { OfficialProductFinalCostSuccess } from "./productOfficialFinalCost.js";
import { resolveSalesOrderItemCostFromVersionedProduction } from "./salesOrderMarginResolver.js";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const HH_HM = {
  globalHhCostPerHour: 25,
  machineHourCostPerHour: 50000 / 220,
};

const PROCESS_BASE = {
  efficiencyExpectedPercent: 100,
  setupTimeMin: 0,
  lotSize: 1,
  ...HH_HM,
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  status: string | null;
  type: "PRODUCT" | "COMPONENT";
  cycleTimeSeconds: number | null;
  cavities: number | null;
  setupTimeMin: number | null;
  efficiencyExpected: number | null;
  costingMode: string;
  defaultLotSize: number;
  updatedAt: Date;
};

type LogRow = {
  id: string;
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  productTypeSnapshot: "COMPONENT";
  changedAt: Date;
  changedByUserId: string;
  changedByUserName: string;
  changedByUserEmail: string;
  responsiblePersonName: string;
  note: string | null;
  oldCycleTimeSeconds: number | null;
  newCycleTimeSeconds: number | null;
  oldCavities: number | null;
  newCavities: number | null;
  oldValuesJson: unknown;
  newValuesJson: unknown;
  changedFieldsJson: string[];
  source: string;
  createdAt: Date;
};

function buildComponentAnalysis(
  productId: string,
  sku: string,
  name: string,
  cycle: number,
  cavities: number
) {
  const computed = computeStandardProcessUnitCosts({
    cycleTimeSeconds: cycle,
    cavities,
    ...PROCESS_BASE,
  });
  assert.equal(computed.ok, true);
  if (!computed.ok) throw new Error("compute failed");

  const finalUnitCost = computed.totalHH_Unit + computed.totalHM_Unit;
  return {
    productId,
    sku,
    name,
    productType: "COMPONENT" as const,
    totalMaterialCost: 0,
    totalHH_Unit: computed.totalHH_Unit,
    totalHM_Unit: computed.totalHM_Unit,
    totalIndustrialCost: finalUnitCost,
    costAnalysisPartial: false,
    warnings: [],
    details: {
      materials: [],
      processBreakdown: [
        {
          source: "STANDARD_PROCESS",
          description: "Processo Padrão do Componente",
          laborCost: computed.totalHH_Unit,
          machineCost: computed.totalHM_Unit,
          total: computed.totalStepCost,
          calculationDetails: {
            cycle,
            cavities,
            efficiency: 100,
            setupTimeMin: 0,
            netPph: computed.netPph,
          },
        },
      ],
    },
  };
}

function resolvedFromAnalysis(analysis: ReturnType<typeof buildComponentAnalysis>): OfficialProductFinalCostSuccess {
  return {
    ok: true,
    productId: analysis.productId,
    sku: analysis.sku,
    finalUnitCost: analysis.totalIndustrialCost,
    source: "PRODUCT_ENGINEERING_FINAL_COST",
    costAnalysisPartial: false,
    breakdown: {
      totalMaterialCost: 0,
      totalHH_Unit: analysis.totalHH_Unit,
      totalHM_Unit: analysis.totalHM_Unit,
      totalCIF_Unit: 0,
      totalOPEX_Unit: 0,
    },
  };
}

function createFlowMockDb(initialCycle = 64, initialCavities = 24) {
  const productId = randomUUID();
  const sku = "309.86AA";
  const products = new Map<string, ProductRow>([
    [
      productId,
      {
        id: productId,
        sku,
        name: "Mangote fluxo E2E",
        status: "ACTIVE",
        type: "COMPONENT",
        cycleTimeSeconds: initialCycle,
        cavities: initialCavities,
        setupTimeMin: 0,
        efficiencyExpected: 100,
        costingMode: "OWN_PROCESS",
        defaultLotSize: 1,
        updatedAt: new Date("2026-06-01T08:00:00.000Z"),
      },
    ],
  ]);
  const logs: LogRow[] = [];
  let logSeq = 0;

  const publishedAt = new Date("2026-06-01T08:00:00.000Z");
  const analysisBefore = buildComponentAnalysis(productId, sku, "Mangote fluxo E2E", initialCycle, initialCavities);
  const publishedDraftItem = buildProductionCostDraftItemFromAnalysis(
    { id: productId, sku, name: "Mangote fluxo E2E", type: "COMPONENT" },
    resolvedFromAnalysis(analysisBefore),
    analysisBefore,
    publishedAt
  );
  const frozenPublishedJson = JSON.stringify(publishedDraftItem.calculationSnapshot);
  const frozenPublishedCost = publishedDraftItem.unitProductionCost;
  const frozenPublishedHash = publishedDraftItem.calculationHash;

  const db = {
    product: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: unknown }) => {
        const row = products.get(where.id);
        if (!row) return null;
        if (select && typeof select === "object" && select !== null && "_count" in select) {
          return { ...row, _count: { SalesOrderItem: 0, ProductRouting: 0 } };
        }
        if (select && typeof select === "object" && select !== null && "type" in select && !("cycleTimeSeconds" in select)) {
          return { id: row.id, type: row.type };
        }
        return { ...row };
      },
      update: async ({
        where,
        data,
        select,
      }: {
        where: { id: string };
        data: Partial<ProductRow>;
        select?: unknown;
      }) => {
        const row = products.get(where.id);
        if (!row) throw new Error("not found");
        const updated = { ...row, ...data, updatedAt: new Date() };
        products.set(where.id, updated);
        if (select && typeof select === "object" && select !== null && "_count" in select) {
          return { ...updated, _count: { SalesOrderItem: 0, ProductRouting: 0 } };
        }
        return updated;
      },
    },
    componentPerformanceChangeLog: {
      count: async ({ where }: { where: { productId: string } }) =>
        logs.filter((l) => l.productId === where.productId).length,
      findMany: async ({
        where,
        orderBy,
        take,
        skip,
      }: {
        where: { productId: string };
        orderBy?: { changedAt: "asc" | "desc" };
        take?: number;
        skip?: number;
      }) => {
        let rows = logs.filter((l) => l.productId === where.productId);
        if (orderBy?.changedAt === "desc") {
          rows = [...rows].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
        } else if (orderBy?.changedAt === "asc") {
          rows = [...rows].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
        }
        const start = skip ?? 0;
        const end = take != null ? start + take : undefined;
        return rows.slice(start, end);
      },
      create: async ({ data }: { data: Omit<LogRow, "id" | "changedAt" | "createdAt"> }) => {
        const row: LogRow = {
          id: `log-${++logSeq}`,
          changedAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        logs.push(row);
        return row;
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
    _products: products,
    _logs: logs,
    _published: {
      item: publishedDraftItem,
      json: frozenPublishedJson,
      cost: frozenPublishedCost,
      hash: frozenPublishedHash,
    },
    productId,
    sku,
  };

  return db;
}

const actor = {
  userId: randomUUID(),
  userName: "Operador IndusCost",
  userEmail: "operador@induscost.local",
};

describe("operationsPerformanceFlow — integrado service-level", () => {
  it("fluxo completo: publica → altera performance → log → novo DRAFT → publicado congelado", async () => {
    const db = createFlowMockDb(64, 24);
    const { productId, sku } = db;

    const patchResult = await patchComponentPerformanceProduct(
      db as never,
      productId,
      {
        cycleTimeSeconds: 90,
        cavities: 16,
        responsiblePersonName: "João da Produção",
        note: "Melhoria após setup",
      },
      actor
    );

    assert.equal(patchResult.ok, true);
    assert.equal(patchResult.changed, true);
    assert.equal(patchResult.changeLog.oldCycleTimeSeconds, 64);
    assert.equal(patchResult.changeLog.newCycleTimeSeconds, 90);
    assert.equal(patchResult.changeLog.oldCavities, 24);
    assert.equal(patchResult.changeLog.newCavities, 16);
    assert.equal(patchResult.changeLog.changedByUserId, actor.userId);
    assert.equal(patchResult.changeLog.changedByUserName, actor.userName);
    assert.equal(patchResult.changeLog.responsiblePersonName, "João da Produção");
    assert.ok(patchResult.changeLog.changedAt);

    const liveProduct = db._products.get(productId)!;
    const analysisAfter = buildComponentAnalysis(
      productId,
      sku,
      liveProduct.name,
      Number(liveProduct.cycleTimeSeconds),
      Number(liveProduct.cavities)
    );
    const newDraftItem = buildProductionCostDraftItemFromAnalysis(
      { id: productId, sku, name: liveProduct.name, type: "COMPONENT" },
      resolvedFromAnalysis(analysisAfter),
      analysisAfter,
      new Date("2026-07-02T10:00:00.000Z")
    );

    assert.notEqual(newDraftItem.unitProductionCost, db._published.cost);
    assert.notEqual(newDraftItem.calculationHash, db._published.hash);

    const newSnap = newDraftItem.calculationSnapshot as {
      processPerformance: { cycleTimeSeconds: number; cavities: number };
    };
    const oldSnap = db._published.item.calculationSnapshot as {
      processPerformance: { cycleTimeSeconds: number; cavities: number };
    };
    assert.equal(oldSnap.processPerformance.cycleTimeSeconds, 64);
    assert.equal(oldSnap.processPerformance.cavities, 24);
    assert.equal(newSnap.processPerformance.cycleTimeSeconds, 90);
    assert.equal(newSnap.processPerformance.cavities, 16);

    assert.equal(JSON.stringify(db._published.item.calculationSnapshot), db._published.json);
    assert.equal(db._published.item.unitProductionCost, db._published.cost);
    assert.equal(db._published.item.calculationHash, db._published.hash);

    const history = await listComponentPerformanceHistory(db as never, productId, { limit: 10 });
    assert.notEqual(history, null);
    assert.equal(history!.total, 1);
    assert.equal(history!.items[0]?.newCycleTimeSeconds, 90);
  });

  it("histórico ordenado do mais recente para o mais antigo", async () => {
    const db = createFlowMockDb(50, 4);
    const { productId } = db;

    await patchComponentPerformanceProduct(
      db as never,
      productId,
      { cycleTimeSeconds: 48, responsiblePersonName: "Ana Produção" },
      actor
    );
    await new Promise((r) => setTimeout(r, 5));
    await patchComponentPerformanceProduct(
      db as never,
      productId,
      { cavities: 6, responsiblePersonName: "Ana Produção" },
      actor
    );

    const history = await listComponentPerformanceHistory(db as never, productId, { limit: 10 });
    assert.equal(history!.items.length, 2);
    const first = Date.parse(history!.items[0]!.changedAt);
    const second = Date.parse(history!.items[1]!.changedAt);
    assert.ok(first >= second);
    assert.equal(history!.items[0]?.newCavities, 6);
  });

  it("margem de pedido antigo permanece no custo publicado após alteração de performance", () => {
    const db = createFlowMockDb(64, 24);
    const publishedCost = db._published.cost;

    const catalog: ProductionCostTableVersionWithItems[] = [
      {
        id: "v-pub",
        code: "2026-06",
        name: "Jun/2026",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        publishedAt: civilDateToLocalDate("2026-06-01"),
        createdAt: civilDateToLocalDate("2026-06-01"),
        items: [
          {
            id: "item-1",
            costTableVersionId: "v-pub",
            productId: db.productId,
            productCodeSnapshot: db.sku,
            productNameSnapshot: "Mangote",
            unitProductionCost: publishedCost,
            currency: "BRL",
            calculationHash: db._published.hash,
            calculationSnapshot: db._published.item.calculationSnapshot,
            createdAt: civilDateToLocalDate("2026-06-01"),
            breakdown: {
              materialCost: 0,
              processCost: 0,
              laborCost: 0,
              machineCost: 0,
              overheadCost: 0,
              otherCost: 0,
            },
          },
        ],
      },
    ];

    const effective = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      db.productId,
      civilDateToLocalDate("2026-06-15")
    );
    assert.equal(effective.status, "OK");

    const marginCost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "so-line-1",
      productId: db.productId,
      referenceDate: civilDateToLocalDate("2026-06-15"),
      effectiveCost: effective.status === "OK" ? effective : null,
    });

    assert.equal(marginCost.unitCost, publishedCost);
    assert.equal(marginCost.costSource, "VERSIONED_PRODUCTION_COST");
  });
});

describe("operationsPerformanceFlow — travas de validação", () => {
  it("bloqueia alteração sem responsável", async () => {
    const db = createFlowMockDb();
    await assert.rejects(
      () =>
        patchComponentPerformanceProduct(
          db as never,
          db.productId,
          { cycleTimeSeconds: 40, responsiblePersonName: "" },
          actor
        ),
      ComponentPerformanceValidationError
    );
    assert.equal(db._logs.length, 0);
  });

  it("bloqueia ciclo inválido", async () => {
    const db = createFlowMockDb();
    await assert.rejects(
      () =>
        patchComponentPerformanceProduct(
          db as never,
          db.productId,
          { cycleTimeSeconds: 0, responsiblePersonName: "João" },
          actor
        ),
      (e: unknown) => e instanceof ComponentPerformanceValidationError && e.code === "INVALID_CYCLE"
    );
  });

  it("sem mudança real não gera log falso", async () => {
    const db = createFlowMockDb(64, 24);
    const result = await patchComponentPerformanceProduct(
      db as never,
      db.productId,
      { cycleTimeSeconds: 64, cavities: 24, responsiblePersonName: "João" },
      actor
    );
    assert.equal(result.changed, false);
    assert.equal(db._logs.length, 0);
  });
});

describe("operationsPerformanceFlow — revisão de arquitetura (rg)", () => {
  it("usa ComponentPerformanceChangeLog (não ProductPerformanceChangeLog)", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model ComponentPerformanceChangeLog/);
    assert.doesNotMatch(schema, /ProductPerformanceChangeLog/);
  });

  it("motor único getProductCostAnalysis lê cycleTimeSeconds/cavities do Product", () => {
    const engine = read("src/lib/productCostAnalysisEngine.server.ts");
    assert.match(engine, /product\.cycleTimeSeconds/);
    assert.match(engine, /product\.cavities/);
    assert.match(engine, /getProductCostAnalysis/);
  });

  it("patch de performance não toca ProductionCostTableItem nem BOM/Nomus", () => {
    const service = read("src/lib/componentPerformanceChange.server.ts");
    assert.doesNotMatch(service, /productionCostTableItem\.update/);
    assert.doesNotMatch(service, /PriceTableItem/);
    assert.doesNotMatch(service, /nomus/i);
    assert.doesNotMatch(service, /ProductBOM/);
  });

  it("calculationSnapshot congela processPerformance na geração", () => {
    const publication = read("src/lib/productionCostPublication.ts");
    assert.match(publication, /processPerformance/);
    assert.match(publication, /extractProductionCostProcessPerformanceFromAnalysis/);
  });

  it("UI Operações > Performance registrada com permissões", () => {
    assert.match(read("src/App.tsx"), /operations-performance/);
    assert.match(read("src/lib/navigationGroups.ts"), /operations-performance/);
    assert.match(read("src/lib/permissionCatalog.ts"), /operations\.component-performance/);
    assert.match(read("src/components/operations/OperationsPerformanceModule.tsx"), /performance-coverage-cards/);
  });
});
