/**
 * Collector — ajustes e relatórios de Componentes / Produto acabado (39–49).
 *
 * Tudo passa pelas rotas reais do tablet (criar/continuar → lista cega →
 * contar → finalizar → aplicar ajustes) e pelo motor canônico real:
 * recordInventoryCount → finalize/approve → generateInventoryCountAdjustments →
 * createInventoryMovementInTx → InventoryBalance. Nenhuma regra é simulada: o
 * Prisma em memória (collectorCountFakeDb.ts) só guarda e devolve linhas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  aggregateInventoryPhysicalBalances,
  computeInventoryManagerialValuation,
} from "./../inventoryManagerialValuation.js";
import {
  buildInventoryPositionReport,
  type InventoryPositionReportSourceLine,
} from "./../inventoryPositionReport.js";
import { callCollectorRoute, createCollectorCountFakeDb } from "./collectorCountFakeDb.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const WH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOC_1 = "11111111-1111-4111-8111-111111111111";
const LOC_2 = "22222222-2222-4222-8222-222222222222";

/** ALM-A: componentes + MP; ALM-B: produto acabado. */
function fakeDb() {
  return createCollectorCountFakeDb({
    warehouses: [
      { id: WH_A, code: "ALM-A" },
      { id: WH_B, code: "ALM-B" },
    ],
    items: [
      { id: "cp-1", code: "CP-001", itemType: "COMPONENT", productId: "prod-cp-1" },
      { id: "cp-2", code: "CP-002", itemType: "COMPONENT", productId: "prod-cp-2", defaultWarehouseId: WH_A },
      { id: "cp-multi", code: "CP-004", itemType: "COMPONENT", productId: "prod-cp-4" },
      { id: "pa-1", code: "PA-001", itemType: "FINISHED_PRODUCT", productId: "prod-pa-1" },
      { id: "pa-2", code: "PA-002", itemType: "FINISHED_PRODUCT", productId: "prod-pa-2", defaultWarehouseId: WH_B },
      { id: "mp-1", code: "MP-001", itemType: "RAW_MATERIAL", materialId: "mat-1" },
    ],
    balances: [
      { itemId: "cp-1", warehouseId: WH_A, physicalQuantity: 100 },
      { itemId: "cp-multi", warehouseId: WH_A, locationId: LOC_1, physicalQuantity: 5 },
      { itemId: "cp-multi", warehouseId: WH_A, locationId: LOC_2, physicalQuantity: 3 },
      { itemId: "pa-1", warehouseId: WH_B, physicalQuantity: 50 },
      { itemId: "mp-1", warehouseId: WH_A, physicalQuantity: 20 },
    ],
  });
}

type Db = ReturnType<typeof fakeDb>;
type BlindItem = { lineId: string; itemId: string; locationId: string | null; version: number };

const itemKey = (item: { itemId: string; locationId: string | null }) =>
  item.locationId === LOC_1
    ? `${item.itemId}@L1`
    : item.locationId === LOC_2
      ? `${item.itemId}@L2`
      : item.itemId;

/**
 * Gesto do tablet, rota a rota: abre/continua a sessão do setor, lê a lista
 * cega, conta só as chaves informadas ("item" ou "item@L1"), finaliza e aplica.
 */
async function countViaTablet(
  db: Db,
  sector: "componentes" | "produto-acabado",
  counts: Record<string, number>,
  opts: { allowUncounted?: boolean } = {}
) {
  const opened = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count-sessions", {
    body: { sector, operationId: `open-${sector}` },
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const sessionId: string = opened.body.session.id;

  const listed = await callCollectorRoute(
    db.client,
    "get",
    "/api/inventory/collector/count-sessions/:id/items",
    { params: { id: sessionId } }
  );
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const items = listed.body.items as BlindItem[];
  for (const item of items) {
    assert.equal("systemQuantity" in item, false, "lista cega não revela saldo");
  }

  for (const item of items) {
    const key = itemKey(item);
    if (!(key in counts)) continue;
    const counted = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count", {
      body: {
        sessionId,
        lineId: item.lineId,
        countedQuantity: counts[key],
        expectedVersion: item.version,
        operationId: `count-${key}`,
      },
    });
    assert.equal(counted.status, 200, JSON.stringify(counted.body));
  }

  const finalized = await callCollectorRoute(
    db.client,
    "post",
    "/api/inventory/collector/count-sessions/:id/finalize",
    { params: { id: sessionId }, body: { allowUncounted: opts.allowUncounted === true } }
  );
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));

  const applied = await callCollectorRoute(
    db.client,
    "post",
    "/api/inventory/collector/count-sessions/:id/apply-adjustments",
    { params: { id: sessionId }, body: { confirm: true, operationId: `apply-${sector}` } }
  );
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  return { sessionId, items, finalized: finalized.body, applied: applied.body };
}

const movementsOf = (db: Db, itemId: string) => db.state.movements.filter((m) => m.itemId === itemId);

/** Mesmo mapeamento de loadInventoryPositionReport: todos os saldos + item. */
function positionReport(db: Db) {
  const lines: InventoryPositionReportSourceLine[] = db.state.balances.map((balance) => {
    const item = db.state.items.find((i) => i.id === balance.itemId)!;
    return {
      itemId: item.id,
      itemType: item.itemType,
      code: item.code,
      description: item.description,
      unit: item.unit,
      productId: item.productId,
      materialId: item.materialId,
      physicalQuantity: new Prisma.Decimal(String(balance.physicalQuantity)),
    };
  });
  return buildInventoryPositionReport({
    lines,
    generatedAt: new Date("2026-09-28T12:00:00Z"),
    retailPriceByProductId: RETAIL,
    factoryCostByProductId: FACTORY_COST,
    materialCostByMaterialId: new Map([["mat-1", new Prisma.Decimal(10)]]),
  });
}

/** Mesmo caminho do dashboard: saldos agregados por item → valorização gerencial. */
function dashboardValuation(db: Db) {
  const lines = aggregateInventoryPhysicalBalances(
    db.state.balances.map((balance) => {
      const item = db.state.items.find((i) => i.id === balance.itemId)!;
      return {
        itemId: item.id,
        itemType: item.itemType,
        productId: item.productId,
        materialId: item.materialId,
        physicalQuantity: balance.physicalQuantity,
      };
    })
  );
  return computeInventoryManagerialValuation({
    lines,
    retailPriceByProductId: RETAIL,
    industrialCostByProductId: FACTORY_COST,
    supplyCostByMaterialId: new Map([["mat-1", new Prisma.Decimal(10)]]),
  });
}

const RETAIL = new Map([
  ["prod-cp-1", new Prisma.Decimal(4)],
  ["prod-pa-1", new Prisma.Decimal(100)],
]);
const FACTORY_COST = new Map([
  ["prod-cp-1", new Prisma.Decimal("2.5")],
  ["prod-pa-1", new Prisma.Decimal(40)],
]);

const section = (report: ReturnType<typeof positionReport>, itemType: string) =>
  report.sections.find((s) => s.itemType === itemType)!;

// ===========================================================================
// 25) Ajustes (39–44)
// ===========================================================================

describe("ajustes pelo motor canônico", () => {
  it("39. COMPONENT: saldo 100, contado 92 → movimento −8 → saldo 92", async () => {
    const db = fakeDb();
    const flow = await countViaTablet(db, "componentes", {
      "cp-1": 92,
      "cp-2": 0,
      "cp-multi@L1": 5,
      "cp-multi@L2": 3,
    });
    const divergence = flow.finalized.divergences.find((d: { itemId: string }) => d.itemId === "cp-1");
    assert.equal(divergence.adjustmentDelta, -8, "diferença = −8");
    assert.equal(flow.applied.movementsCreated, 1);

    const [movement] = movementsOf(db, "cp-1");
    assert.equal(movement.movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(movement.quantity), 8);
    assert.equal(Number(movement.previousPhysicalBalance) - Number(movement.nextPhysicalBalance), 8);
    assert.equal(movement.sourceWarehouseId, WH_A);
    assert.equal(movement.originType, "COUNT_SESSION");
    assert.equal(movement.materialId, null, "produto não tem identidade de material");
    assert.equal(db.balanceOf("cp-1", WH_A), 92);

    const session = db.state.sessions.find((s) => s.id === flow.sessionId)!;
    assert.equal(session.status, "ADJUSTED");
    const line = db.state.lines.find((l) => l.sessionId === flow.sessionId && l.itemId === "cp-1")!;
    assert.equal(line.generatedMovementId, movement.id);
  });

  it("40. FINISHED_PRODUCT: saldo 50, contado 47 → movimento −3 → saldo 47", async () => {
    const db = fakeDb();
    const flow = await countViaTablet(db, "produto-acabado", { "pa-1": 47, "pa-2": 0 });
    assert.equal(flow.applied.movementsCreated, 1);
    const [movement] = movementsOf(db, "pa-1");
    assert.equal(movement.movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(movement.quantity), 3);
    assert.equal(movement.sourceWarehouseId, WH_B);
    assert.equal(db.balanceOf("pa-1", WH_B), 47);
  });

  it("41. sem divergência não gera movimento", async () => {
    const db = fakeDb();
    const flow = await countViaTablet(db, "componentes", {
      "cp-1": 100,
      "cp-2": 0,
      "cp-multi@L1": 5,
      "cp-multi@L2": 3,
    });
    assert.equal(flow.applied.movementsCreated, 0);
    assert.equal(db.state.movements.length, 0);
    assert.equal(db.balanceOf("cp-1", WH_A), 100);
    assert.equal(db.state.sessions.find((s) => s.id === flow.sessionId)!.status, "ADJUSTED");
  });

  it("42. quantidade zero é válida (e ajusta só o endereço contado)", async () => {
    const db = fakeDb();
    await countViaTablet(db, "componentes", {
      "cp-1": 100,
      "cp-2": 0,
      "cp-multi@L1": 5,
      "cp-multi@L2": 0,
    });
    const [movement] = movementsOf(db, "cp-multi");
    assert.equal(movement.movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(movement.quantity), 3);
    assert.equal(movement.sourceLocationId, LOC_2);
    assert.equal(db.balanceOf("cp-multi", WH_A, LOC_2), 0);
    assert.equal(db.balanceOf("cp-multi", WH_A, LOC_1), 5, "outro endereço intacto");
    // Zero sobre zero: sem movimento. O motor de contagem materializa o escopo
    // em 0 sob lock (getOrCreateInventoryBalanceForUpdate), como já faz em MP.
    assert.equal(movementsOf(db, "cp-2").length, 0);
    assert.equal(db.balanceOf("cp-2", WH_A) ?? 0, 0);
  });

  it("43. item não contado NÃO vira zero", async () => {
    const db = fakeDb();
    const flow = await countViaTablet(db, "componentes", { "cp-1": 92 }, { allowUncounted: true });
    assert.equal(flow.applied.movementsCreated, 1);
    assert.equal(db.balanceOf("cp-multi", WH_A, LOC_1), 5);
    assert.equal(db.balanceOf("cp-multi", WH_A, LOC_2), 3);
    assert.equal(movementsOf(db, "cp-multi").length, 0);
    assert.equal(movementsOf(db, "cp-2").length, 0);
    const pending = db.state.lines.filter(
      (l) => l.sessionId === flow.sessionId && l.itemId !== "cp-1"
    );
    assert.ok(pending.length > 0 && pending.every((l) => l.countedQuantity == null));
  });

  it("44. InventoryBalance só muda pelo motor: cada escrita de saldo sai do repositório canônico", async () => {
    const db = fakeDb();
    await countViaTablet(db, "componentes", { "cp-1": 92, "cp-2": 0, "cp-multi@L2": 0 }, { allowUncounted: true });
    await countViaTablet(db, "produto-acabado", { "pa-1": 47 }, { allowUncounted: true });
    assert.ok(db.state.balanceWriteStacks.length > 0);
    for (const stack of db.state.balanceWriteStacks) {
      assert.match(stack, /inventoryRepository\.server/, "escrita de saldo fora do motor");
    }
    const updates = db.state.writes.filter((w) => w === "inventoryBalance.update");
    assert.equal(updates.length, db.state.movements.length, "toda alteração de saldo tem movimento");
    for (const movement of db.state.movements) {
      const balance = db.state.balances.find((b) => b.lastMovementId === movement.id);
      assert.ok(balance, `saldo atualizado pelo movimento ${movement.id}`);
      assert.equal(Number(balance.physicalQuantity), Number(movement.nextPhysicalBalance));
    }
    for (const rel of [
      "src/lib/inventory/collector/collectorProductSectorCounting.server.ts",
      "src/lib/inventory/collector/collectorSessionCompatibility.server.ts",
      "src/lib/inventory/collector/collectorRoutes.server.ts",
    ]) {
      const src = codeOnly(read(rel));
      assert.doesNotMatch(src, /inventoryBalance\.(create|update|upsert|updateMany|delete)/, rel);
      assert.doesNotMatch(src, /\b(product|material)\.(create|update|upsert|updateMany)/, rel);
    }
  });
});

// ===========================================================================
// 26) Relatórios (45–49)
// ===========================================================================

describe("relatórios gerais refletem o saldo canônico", () => {
  async function adjustedDb() {
    const db = fakeDb();
    await countViaTablet(db, "componentes", { "cp-1": 92 }, { allowUncounted: true });
    await countViaTablet(db, "produto-acabado", { "pa-1": 47 }, { allowUncounted: true });
    return db;
  }

  it("45. após ajuste de COMPONENT, a posição de estoque mostra 92", async () => {
    const before = section(positionReport(fakeDb()), "COMPONENT");
    assert.equal(before.rows.find((r) => r.itemCode === "CP-001")?.physicalQuantity, "100");
    const report = positionReport(await adjustedDb());
    const row = section(report, "COMPONENT").rows.find((r) => r.itemCode === "CP-001");
    assert.equal(row?.physicalQuantity, "92");
  });

  it("46. após ajuste de FINISHED_PRODUCT, a posição de estoque mostra 47", async () => {
    const report = positionReport(await adjustedDb());
    const row = section(report, "FINISHED_PRODUCT").rows.find((r) => r.itemCode === "PA-001");
    assert.equal(row?.physicalQuantity, "47");
  });

  it("47. valor de estoque (custo, venda, cards do dashboard) usa o novo saldo", async () => {
    const db = await adjustedDb();
    const report = positionReport(db);
    const cp = section(report, "COMPONENT").rows.find((r) => r.itemCode === "CP-001")!;
    assert.equal(cp.totalCost, 230, "92 × 2,50");
    assert.equal(cp.totalSaleValue, 368, "92 × 4,00");
    const pa = section(report, "FINISHED_PRODUCT").rows.find((r) => r.itemCode === "PA-001")!;
    assert.equal(pa.totalCost, 1880, "47 × 40,00");
    assert.equal(pa.totalSaleValue, 4700, "47 × 100,00");

    const valuation = dashboardValuation(db);
    assert.equal(valuation.byItemType.component.salesPotential.value, 368);
    assert.equal(valuation.byItemType.finishedProduct.salesPotential.value, 4700);
    assert.equal(valuation.salesPotential.value, 5068);
    assert.equal(valuation.industrialCost.value, 2110);
    const antes = dashboardValuation(fakeDb());
    assert.equal(antes.salesPotential.value, 400 + 5000, "antes: 100 × 4 + 50 × 100");
  });

  it("48. relatório específico de MP continua exclusivo de MP", async () => {
    const report = positionReport(await adjustedDb());
    assert.deepEqual(
      section(report, "RAW_MATERIAL").rows.map((r) => r.itemCode),
      ["MP-001"],
      "seção de MP só com matéria-prima"
    );
    const dashboard = read("src/lib/inventory/inventoryDashboard.server.ts");
    assert.match(dashboard, /item\.itemType === "RAW_MATERIAL" && isCritical/);
    const snapshot = codeOnly(read("src/lib/materialStockValueSnapshot.server.ts"));
    assert.match(snapshot, /db\.material\.findMany/, "valor de MP vem do cadastro de Material");
    assert.doesNotMatch(snapshot, /inventoryItem|COMPONENT|FINISHED_PRODUCT/);
    const withdrawal = codeOnly(read("src/lib/inventory/collector/collectorWithdrawal.server.ts"));
    assert.match(withdrawal, /input\.sector !== "RAW_MATERIAL"/);
  });

  it("49. relatório geral inclui COMPONENT e FINISHED_PRODUCT (sem filtro de MP)", async () => {
    const report = positionReport(await adjustedDb());
    assert.deepEqual(report.sections.map((s) => s.itemType), [
      "RAW_MATERIAL",
      "COMPONENT",
      "FINISHED_PRODUCT",
    ]);
    assert.ok(section(report, "COMPONENT").itemCount > 0);
    assert.ok(section(report, "FINISHED_PRODUCT").itemCount > 0);

    const loader = codeOnly(read("src/lib/inventory/inventoryPositionReport.server.ts"));
    const query = loader.slice(loader.indexOf("inventoryBalance.findMany"), loader.indexOf("const lines"));
    assert.doesNotMatch(query, /where/, "posição lê todos os saldos");
    const dashboard = codeOnly(read("src/lib/inventory/inventoryDashboard.server.ts"));
    const balances = dashboard.slice(dashboard.indexOf("prisma.inventoryBalance.findMany"));
    assert.doesNotMatch(balances.slice(0, balances.indexOf("}),")), /where/, "dashboard lê todos os saldos");
  });
});

describe("auditoria do ciclo (mecanismo existente)", () => {
  it("registra setor, almoxarifado, sessão, dispositivo, linhas, contagens, finalização e ajustes", async () => {
    const db = fakeDb();
    const flow = await countViaTablet(db, "componentes", { "cp-1": 92 }, { allowUncounted: true });
    const ofSession = db.state.auditLogs.filter((log) => log.entityId === flow.sessionId);
    const actions = ofSession.map((log) => log.action);
    for (const action of [
      "COLLECTOR_COUNT_SESSION_CREATED",
      "COLLECTOR_COUNT_SESSION_STARTED",
      "FINALIZE",
      "APPROVE",
      "GENERATE_ADJUSTMENTS",
      "COLLECTOR_APPLY_ADJUSTMENTS",
    ]) {
      assert.ok(actions.includes(action), `sem auditoria ${action}`);
    }
    const created = ofSession.find((l) => l.action === "COLLECTOR_COUNT_SESSION_CREATED")!;
    assert.equal(created.afterJson.sector, "COMPONENT");
    assert.equal(created.afterJson.warehouseId, WH_A);
    assert.equal(created.afterJson.reused, false);
    assert.equal(created.afterJson.diagnostics.linesCreated, 4);
    const applied = ofSession.find((l) => l.action === "COLLECTOR_APPLY_ADJUSTMENTS")!;
    assert.equal(applied.afterJson.sector, "COMPONENT");
    assert.equal(applied.afterJson.warehouseId, WH_A);
    assert.equal(applied.afterJson.movementsCreated, 1);
    assert.ok(applied.afterJson.deviceId);
    assert.ok(db.state.auditLogs.some((l) => l.action === "COUNT_RECORDED"));
  });
});
