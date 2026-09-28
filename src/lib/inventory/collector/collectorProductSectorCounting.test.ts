/**
 * Collector — contagem de Componentes (COMPONENT) e Produto acabado
 * (FINISHED_PRODUCT), sem mudar o fluxo de Matéria-prima.
 *
 * Numeração = lista de testes obrigatórios do spec (1–38 aqui; 39–49 em
 * collectorProductSectorAdjustments.test.ts). O código de produção roda de
 * verdade sobre o Prisma em memória de collectorCountFakeDb.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { mapCollectorBootError } from "@/src/components/inventory/collector/collectorBootError.js";
import {
  isProductCollectorSectorCode,
  productSectorOperationalMessage,
} from "@/src/components/inventory/collector/collectorProductSectorMessages.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import { createAndStartCollectorSectorSession } from "./collectorAutonomousSession.server.js";
import { callCollectorRoute, createCollectorCountFakeDb } from "./collectorCountFakeDb.js";
import {
  createAndStartCollectorProductSectorSession,
  isCollectorProductSector,
  populateComponentCountLines,
  populateFinishedProductCountLines,
  prepareComponentSectorForCounting,
  prepareFinishedProductSectorForCounting,
  resolveCollectorProductSectorOperationalContext,
} from "./collectorProductSectorCounting.server.js";
import {
  buildSectorCollectorAbsoluteUrl,
  buildSectorCollectorPath,
  COLLECTOR_INVALID_SECTOR,
  COLLECTOR_SECTOR_CODES,
  COLLECTOR_SECTORS,
  parseCollectorSector,
} from "./collectorSectorContract.js";
import { populateRawMaterialCountLines } from "./collectorSectorPopulation.server.js";
import {
  prepareRawMaterialSectorForCounting,
  resolveCollectorSectorOperationalContext,
} from "./collectorSectorPrepare.server.js";
import { COLLECTOR_SECTOR_QR_OPTIONS } from "./collectorSectorQrUi.js";
import {
  COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE,
  collectorSectorFromSessionCode,
  evaluateCollectorSessionCompatibility,
  findCollectorSectorActiveSession,
} from "./collectorSessionCompatibility.server.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Só código: comentários citam os nomes proibidos ao explicar a regra. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PRODUCT_MODULE = "src/lib/inventory/collector/collectorProductSectorCounting.server.ts";
const ROUTES = "src/lib/inventory/collector/collectorRoutes.server.ts";

const WH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WH_EMPTY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WH_OFF = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const LOC_1 = "11111111-1111-4111-8111-111111111111";
const LOC_2 = "22222222-2222-4222-8222-222222222222";
const DEVICE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Nenhum acesso a banco permitido: prova que a recusa acontece antes de qualquer I/O. */
const NO_DB = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`acesso a banco inesperado: ${String(prop)}`);
    },
  }
) as never;

function isCode(code: string) {
  return (e: unknown) => e instanceof InventoryValidationError && e.code === code;
}

/**
 * Cenário base:
 * - ALM-A: componentes (saldo, só padrão, saldo + padrão, dois endereços) e
 *   inelegíveis (sem produto, sem controle de estoque, inativo), MP e semiacabado;
 * - ALM-B: produto acabado (saldo e só padrão) e PA "de material" sem productId;
 * - ALM-VAZIO: ativo, sem presença nenhuma; ALM-OFF: inativo, com saldo.
 */
function baseSeed() {
  return {
    warehouses: [
      { id: WH_A, code: "ALM-A" },
      { id: WH_B, code: "ALM-B" },
      { id: WH_EMPTY, code: "ALM-VAZIO" },
      { id: WH_OFF, code: "ALM-OFF", status: "INACTIVE" as const },
    ],
    items: [
      { id: "cp-1", code: "CP-001", itemType: "COMPONENT", productId: "prod-cp-1" },
      { id: "cp-2", code: "CP-002", itemType: "COMPONENT", productId: "prod-cp-2", defaultWarehouseId: WH_A },
      { id: "cp-3", code: "CP-003", itemType: "COMPONENT", productId: "prod-cp-3", defaultWarehouseId: WH_A },
      { id: "cp-multi", code: "CP-004", itemType: "COMPONENT", productId: "prod-cp-4" },
      { id: "cp-off", code: "CP-005", itemType: "COMPONENT", productId: "prod-cp-5" },
      { id: "cp-noproduct", code: "CP-900", itemType: "COMPONENT", productId: null },
      { id: "cp-nostock", code: "CP-901", itemType: "COMPONENT", productId: "prod-cp-901", controlsStock: false },
      { id: "cp-inactive", code: "CP-902", itemType: "COMPONENT", productId: "prod-cp-902", status: "INACTIVE" as const },
      { id: "pa-1", code: "PA-001", itemType: "FINISHED_PRODUCT", productId: "prod-pa-1" },
      { id: "pa-2", code: "PA-002", itemType: "FINISHED_PRODUCT", productId: "prod-pa-2", defaultWarehouseId: WH_B },
      { id: "pa-material", code: "PA-900", itemType: "FINISHED_PRODUCT", productId: null, materialId: "mat-9" },
      { id: "mp-1", code: "MP-001", itemType: "RAW_MATERIAL", materialId: "mat-1" },
      { id: "se-1", code: "SE-001", itemType: "SEMI_FINISHED", productId: "prod-se-1" },
    ],
    balances: [
      { itemId: "cp-1", warehouseId: WH_A, physicalQuantity: 100 },
      { itemId: "cp-3", warehouseId: WH_A, physicalQuantity: 7 },
      { itemId: "cp-multi", warehouseId: WH_A, locationId: LOC_1, physicalQuantity: 5 },
      { itemId: "cp-multi", warehouseId: WH_A, locationId: LOC_2, physicalQuantity: 3 },
      { itemId: "cp-off", warehouseId: WH_OFF, physicalQuantity: 11 },
      { itemId: "cp-noproduct", warehouseId: WH_A, physicalQuantity: 9 },
      { itemId: "cp-nostock", warehouseId: WH_A, physicalQuantity: 4 },
      { itemId: "cp-inactive", warehouseId: WH_A, physicalQuantity: 6 },
      { itemId: "pa-1", warehouseId: WH_B, physicalQuantity: 50 },
      { itemId: "pa-material", warehouseId: WH_B, physicalQuantity: 3 },
      { itemId: "mp-1", warehouseId: WH_A, physicalQuantity: 20 },
      { itemId: "se-1", warehouseId: WH_A, physicalQuantity: 2 },
    ],
  };
}

type Seed = ReturnType<typeof baseSeed>;

function fakeDb(over: Partial<Parameters<typeof createCollectorCountFakeDb>[0]> = {}) {
  const seed: Seed = baseSeed();
  return createCollectorCountFakeDb({ ...seed, ...over });
}

/** Linhas da sessão como "item@endereço=saldo", ordenadas — fácil de comparar. */
function lineKeys(db: ReturnType<typeof fakeDb>, sessionId: string): string[] {
  return db.state.lines
    .filter((line) => line.sessionId === sessionId)
    .map((line) => {
      const loc = line.locationId === LOC_1 ? "L1" : line.locationId === LOC_2 ? "L2" : "-";
      return `${line.itemId}@${loc}=${Number(line.systemQuantity)}`;
    })
    .sort();
}

async function populateInto(
  db: ReturnType<typeof fakeDb>,
  sector: "COMPONENT" | "FINISHED_PRODUCT",
  warehouseId: string
) {
  const session = await db.rawClient.inventoryCountSession.create({
    data: { code: `T-${sector}`, warehouseId, status: "COUNTING", startedAt: new Date() },
  });
  const populate =
    sector === "COMPONENT" ? populateComponentCountLines : populateFinishedProductCountLines;
  const diagnostics = await populate(db.client, {
    sessionId: session.id,
    warehouseId,
    sector,
  });
  return { sessionId: session.id as string, diagnostics };
}

// ===========================================================================
// 21) Regressão — Matéria-prima (1–9)
// ===========================================================================

describe("regressão RAW_MATERIAL", () => {
  it("1. contrato de MP intacto: code, slug, label e prefixo", () => {
    assert.deepEqual(COLLECTOR_SECTORS.RAW_MATERIAL, {
      code: "RAW_MATERIAL",
      slug: "raw-material",
      label: "Matéria-prima",
      sessionCodePrefix: "MP",
    });
    assert.equal(COLLECTOR_SECTOR_CODES[0], "RAW_MATERIAL");
  });

  it("2. QR de MP continua /collector/sector/raw-material (fixo, sem token)", () => {
    assert.equal(buildSectorCollectorPath("RAW_MATERIAL"), "/collector/sector/raw-material");
    const env = { INVENTORY_COLLECTOR_PUBLIC_BASE_URL: "https://ts.example" };
    const urls = Array.from({ length: 3 }, () => buildSectorCollectorAbsoluteUrl("RAW_MATERIAL", env));
    assert.deepEqual(new Set(urls), new Set(["https://ts.example/collector/sector/raw-material"]));
  });

  it('3. parseCollectorSector("RAW_MATERIAL")', () => {
    assert.equal(parseCollectorSector("RAW_MATERIAL"), "RAW_MATERIAL");
  });

  it('4. parseCollectorSector("raw-material")', () => {
    assert.equal(parseCollectorSector("raw-material"), "RAW_MATERIAL");
    assert.equal(parseCollectorSector("raw_material"), "RAW_MATERIAL");
  });

  it("5. prepareRawMaterialSectorForCounting recusa COMPONENT antes de qualquer I/O", async () => {
    await assert.rejects(
      () =>
        prepareRawMaterialSectorForCounting(NO_DB, {
          warehouseId: WH_A,
          deviceId: DEVICE,
          sector: "COMPONENT",
        }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
  });

  it("6. prepareRawMaterialSectorForCounting recusa FINISHED_PRODUCT", async () => {
    await assert.rejects(
      () =>
        prepareRawMaterialSectorForCounting(NO_DB, {
          warehouseId: WH_A,
          deviceId: DEVICE,
          sector: "FINISHED_PRODUCT",
        }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
  });

  it("7. populateRawMaterialCountLines recusa COMPONENT", async () => {
    await assert.rejects(
      () =>
        populateRawMaterialCountLines(NO_DB, {
          sessionId: "s",
          warehouseId: WH_A,
          sector: "COMPONENT",
        }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
  });

  it("8. populateRawMaterialCountLines recusa FINISHED_PRODUCT", async () => {
    await assert.rejects(
      () =>
        populateRawMaterialCountLines(NO_DB, {
          sessionId: "s",
          warehouseId: WH_A,
          sector: "FINISHED_PRODUCT",
        }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
  });

  it("9. código de MP não foi generalizado: resolvedor de MP recusa os setores novos e não importa o módulo de produto", async () => {
    for (const sector of ["COMPONENT", "FINISHED_PRODUCT"] as const) {
      await assert.rejects(
        () => resolveCollectorSectorOperationalContext(NO_DB, sector),
        isCode(COLLECTOR_INVALID_SECTOR)
      );
    }
    for (const rel of [
      "src/lib/inventory/collector/collectorSectorPrepare.server.ts",
      "src/lib/inventory/collector/collectorSectorPopulation.server.ts",
    ]) {
      const src = codeOnly(read(rel));
      assert.doesNotMatch(src, /collectorProductSectorCounting/, rel);
      assert.doesNotMatch(src, /productId/, `${rel} não ganha identidade de produto`);
    }
  });
});

// ===========================================================================
// 22) Componentes (10–24)
// ===========================================================================

const COMPONENT_LINES_WH_A = ["cp-1@-=100", "cp-2@-=0", "cp-3@-=7", "cp-multi@L1=5", "cp-multi@L2=3"];

describe("COMPONENT", () => {
  it("10. COMPONENT no contrato e nas opções de QR (derivadas do contrato)", () => {
    assert.deepEqual(COLLECTOR_SECTORS.COMPONENT, {
      code: "COMPONENT",
      slug: "componentes",
      label: "Componentes",
      sessionCodePrefix: "CP",
    });
    assert.deepEqual(
      COLLECTOR_SECTOR_QR_OPTIONS.map((o) => o.label),
      ["Matéria-prima", "Componentes", "Produto acabado"]
    );
    assert.equal(isCollectorProductSector("COMPONENT"), true);
    assert.equal(isCollectorProductSector("RAW_MATERIAL"), false);
  });

  it('11. "componentes" resolve para COMPONENT', () => {
    assert.equal(parseCollectorSector("componentes"), "COMPONENT");
    assert.equal(parseCollectorSector("COMPONENT"), "COMPONENT");
    assert.throws(() => parseCollectorSector("componente-x"), isCode(COLLECTOR_INVALID_SECTOR));
  });

  it("12. QR fixo /collector/sector/componentes", () => {
    assert.equal(buildSectorCollectorPath("COMPONENT"), "/collector/sector/componentes");
    const env = { INVENTORY_COLLECTOR_PUBLIC_BASE_URL: "https://ts.example" };
    const url = buildSectorCollectorAbsoluteUrl("COMPONENT", env);
    assert.equal(url, "https://ts.example/collector/sector/componentes");
    assert.equal(buildSectorCollectorAbsoluteUrl("COMPONENT", env), url, "sem token/data/sessão");
  });

  it("13. almoxarifado só por presença logística de COMPONENT (saldo ou padrão, ACTIVE)", async () => {
    const db = fakeDb();
    const ctx = await resolveCollectorProductSectorOperationalContext(db.client, "COMPONENT");
    assert.deepEqual(ctx.warehouses.map((w) => w.code), ["ALM-A"], "ALM-B (só PA), vazio e inativo fora");
    assert.equal(ctx.operationalState, "READY");
    assert.deepEqual(ctx.diagnostics, {
      sector: "COMPONENT",
      activeWarehouses: 3,
      warehousesWithPresence: 1,
      itemsTotal: 8,
      itemsEligible: 5,
      itemsWithBalance: 3,
      itemsWithoutBalance: 2,
      itemsWithoutPresence: 1,
    });
  });

  it("14. sem fallback indiscriminado: sem presença → CONFIGURATION_REQUIRED; 2 presenças → seleção", async () => {
    const semComponentes = fakeDb({
      items: baseSeed().items.filter((item) => item.itemType !== "COMPONENT"),
    });
    const vazio = await resolveCollectorProductSectorOperationalContext(semComponentes.client, "COMPONENT");
    assert.equal(vazio.operationalState, "CONFIGURATION_REQUIRED");
    assert.deepEqual(vazio.warehouses, [], "3 almoxarifados ACTIVE e nenhum oferecido");
    assert.equal(vazio.diagnostics.activeWarehouses, 3);
    assert.equal(vazio.diagnostics.itemsEligible, 0);

    // Contraste: MP mantém o fallback próprio para todos os ACTIVE (inalterado).
    const semMp = fakeDb({ items: baseSeed().items.filter((item) => item.itemType !== "RAW_MATERIAL") });
    const mp = await resolveCollectorSectorOperationalContext(semMp.client, "RAW_MATERIAL");
    assert.equal(mp.warehouses.length, 3);

    const duasPresencas = fakeDb({
      items: [
        ...baseSeed().items,
        { id: "cp-b", code: "CP-010", itemType: "COMPONENT", productId: "prod-cp-10", defaultWarehouseId: WH_B },
      ],
    });
    const ctx = await resolveCollectorProductSectorOperationalContext(duasPresencas.client, "COMPONENT");
    assert.deepEqual(ctx.warehouses.map((w) => w.code), ["ALM-A", "ALM-B"]);
    assert.equal(ctx.operationalState, "NEEDS_WAREHOUSE_SELECTION");
  });

  it("15. lista somente itemType COMPONENT (sem MP, PA ou semiacabado)", async () => {
    const db = fakeDb();
    const { sessionId } = await populateInto(db, "COMPONENT", WH_A);
    const types = new Set(
      db.state.lines
        .filter((line) => line.sessionId === sessionId)
        .map((line) => db.state.items.find((item) => item.id === line.itemId)?.itemType)
    );
    assert.deepEqual([...types], ["COMPONENT"]);
  });

  it("16–18. exige productId, controlsStock e status ACTIVE", async () => {
    const db = fakeDb();
    const { sessionId } = await populateInto(db, "COMPONENT", WH_A);
    const itemIds = new Set(db.state.lines.filter((l) => l.sessionId === sessionId).map((l) => l.itemId));
    assert.equal(itemIds.has("cp-noproduct"), false, "16. sem productId fica fora");
    assert.equal(itemIds.has("cp-nostock"), false, "17. sem controlsStock fica fora");
    assert.equal(itemIds.has("cp-inactive"), false, "18. INACTIVE fica fora");
  });

  it("19–20. saldo existente vira systemQuantity; só almoxarifado padrão entra com 0", async () => {
    const db = fakeDb();
    const { sessionId, diagnostics } = await populateInto(db, "COMPONENT", WH_A);
    // Uma linha por saldo (item × endereço): o ajuste cai no endereço certo.
    assert.deepEqual(lineKeys(db, sessionId), COMPONENT_LINES_WH_A);
    assert.deepEqual(diagnostics, {
      sector: "COMPONENT",
      warehouseId: WH_A,
      itemsEligibleInWarehouse: 4,
      itemsWithBalance: 3,
      itemsWithoutBalance: 1,
      itemsWithMultipleLocations: 1,
      balancesRead: 4,
      linesCreated: 5,
      existingLines: 0,
      skippedExistingLines: false,
    });
  });

  it("21. população nunca cria nem edita InventoryBalance", async () => {
    const db = fakeDb();
    const before = db.state.balances.length;
    await populateInto(db, "COMPONENT", WH_A);
    assert.equal(db.state.balances.length, before);
    assert.deepEqual(
      db.state.writes.filter((w) => w.startsWith("inventoryBalance")),
      [],
      "sem create/update de saldo"
    );
  });

  it("22–23. fluxo de produto não passa por prepare/populate de MP", async () => {
    const db = fakeDb();
    const result = await createAndStartCollectorProductSectorSession(db.client, {
      sector: "COMPONENT",
      warehouseId: WH_A,
      deviceId: DEVICE,
    });
    assert.equal(result.reused, false);
    assert.equal(db.state.materialReads, 0, "nenhuma leitura do cadastro de Material");
    const prepared = db.state.auditLogs.find((log) => log.action === "COLLECTOR_SECTOR_PREPARED");
    assert.equal(prepared?.afterJson.sector, "COMPONENT");
    assert.equal(prepared?.afterJson.readOnly, true);
    assert.equal("materialsTotal" in (prepared?.afterJson ?? {}), false);

    const src = codeOnly(read(PRODUCT_MODULE));
    assert.doesNotMatch(src, /prepareRawMaterialSectorForCounting/);
    assert.doesNotMatch(src, /populateRawMaterialCountLines/);
    assert.doesNotMatch(src, /materialId/, "identidade é productId");
  });

  it("24. item com saldo E almoxarifado padrão gera uma única linha", async () => {
    const db = fakeDb();
    const { sessionId } = await populateInto(db, "COMPONENT", WH_A);
    const cp3 = db.state.lines.filter((l) => l.sessionId === sessionId && l.itemId === "cp-3");
    assert.equal(cp3.length, 1);
    assert.equal(Number(cp3[0]!.systemQuantity), 7, "vale o saldo, não o zero do padrão");
    // Idempotente: repopular a mesma sessão não duplica nada.
    const again = await populateComponentCountLines(db.client, {
      sessionId,
      warehouseId: WH_A,
      sector: "COMPONENT",
    });
    assert.equal(again.skippedExistingLines, true);
    assert.equal(again.linesCreated, 0);
    assert.deepEqual(lineKeys(db, sessionId), COMPONENT_LINES_WH_A);

    // Saldo em endereço + padrão no mesmo almoxarifado: nada de linha extra sem
    // endereço (ela lançaria o ajuste no escopo errado).
    const located = fakeDb({
      items: [
        ...baseSeed().items,
        { id: "cp-loc", code: "CP-020", itemType: "COMPONENT", productId: "prod-cp-20", defaultWarehouseId: WH_A },
      ],
      balances: [
        ...baseSeed().balances,
        { itemId: "cp-loc", warehouseId: WH_A, locationId: LOC_1, physicalQuantity: 4 },
      ],
    });
    const run = await populateInto(located, "COMPONENT", WH_A);
    assert.deepEqual(
      lineKeys(located, run.sessionId).filter((key) => key.startsWith("cp-loc@")),
      ["cp-loc@L1=4"]
    );
  });

  it("prepare de COMPONENT: diagnóstico sem escrita; recusa outro setor", async () => {
    const db = fakeDb();
    const prepare = await prepareComponentSectorForCounting(db.client, {
      warehouseId: WH_A,
      deviceId: DEVICE,
    });
    assert.deepEqual(prepare, {
      sector: "COMPONENT",
      warehouseId: WH_A,
      itemsTotal: 8,
      itemsEligible: 5,
      itemsWithoutProductId: 1,
      itemsWithoutStockControl: 1,
    });
    assert.deepEqual(db.state.writes, [], "prepare só lê (a auditoria é o único registro)");
    await assert.rejects(
      () => prepareComponentSectorForCounting(NO_DB, { warehouseId: WH_A, deviceId: DEVICE, sector: "RAW_MATERIAL" }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
    await assert.rejects(
      () => populateComponentCountLines(NO_DB, { sessionId: "s", warehouseId: WH_A, sector: "FINISHED_PRODUCT" }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
    await assert.rejects(
      () => prepareComponentSectorForCounting(db.client, { warehouseId: WH_OFF, deviceId: DEVICE }),
      isCode("WAREHOUSE_INACTIVE")
    );
  });
});

// ===========================================================================
// 23) Produto acabado (25–32)
// ===========================================================================

describe("FINISHED_PRODUCT", () => {
  it("25. FINISHED_PRODUCT no contrato e na UI de QR", () => {
    assert.deepEqual(COLLECTOR_SECTORS.FINISHED_PRODUCT, {
      code: "FINISHED_PRODUCT",
      slug: "produto-acabado",
      label: "Produto acabado",
      sessionCodePrefix: "PA",
    });
    assert.ok(
      COLLECTOR_SECTOR_QR_OPTIONS.some(
        (o) => o.code === "FINISHED_PRODUCT" && o.label === "Produto acabado"
      )
    );
  });

  it('26. "produto-acabado" resolve para FINISHED_PRODUCT', () => {
    assert.equal(parseCollectorSector("produto-acabado"), "FINISHED_PRODUCT");
    assert.equal(parseCollectorSector("FINISHED_PRODUCT"), "FINISHED_PRODUCT");
    assert.equal(parseCollectorSector("finished-product"), "FINISHED_PRODUCT");
  });

  it("27. QR fixo /collector/sector/produto-acabado", () => {
    assert.equal(buildSectorCollectorPath("FINISHED_PRODUCT"), "/collector/sector/produto-acabado");
  });

  it("28. almoxarifado por presença de FINISHED_PRODUCT", async () => {
    const db = fakeDb();
    const ctx = await resolveCollectorProductSectorOperationalContext(db.client, "FINISHED_PRODUCT");
    assert.deepEqual(ctx.warehouses.map((w) => w.code), ["ALM-B"]);
    assert.equal(ctx.operationalState, "READY");
    assert.equal(ctx.diagnostics.itemsEligible, 2);
    assert.equal(ctx.diagnostics.itemsWithBalance, 1);
    assert.equal(ctx.diagnostics.itemsWithoutBalance, 1);
  });

  it("29–30. lista somente FINISHED_PRODUCT com productId", async () => {
    const db = fakeDb();
    const { sessionId } = await populateInto(db, "FINISHED_PRODUCT", WH_B);
    const items = db.state.lines
      .filter((l) => l.sessionId === sessionId)
      .map((l) => db.state.items.find((item) => item.id === l.itemId)!);
    assert.deepEqual([...new Set(items.map((i) => i.itemType))], ["FINISHED_PRODUCT"]);
    assert.ok(items.every((i) => typeof i.productId === "string" && i.productId.length > 0));
  });

  it("31. materialId nunca é identidade: PA com material e sem productId fica fora", async () => {
    const db = fakeDb();
    const { sessionId } = await populateInto(db, "FINISHED_PRODUCT", WH_B);
    assert.equal(
      db.state.lines.some((l) => l.sessionId === sessionId && l.itemId === "pa-material"),
      false
    );
    const eligibility = read("src/lib/inventory/collector/collectorSectorEligibility.ts");
    const block = eligibility.slice(eligibility.indexOf("FINISHED_PRODUCT_STOCK_CONTROLLED_ITEM_WHERE"));
    assert.match(block, /productId: \{ not: null \}/);
    assert.doesNotMatch(block, /materialId/);
  });

  it("32. sem saldo mas com almoxarifado padrão entra zerado", async () => {
    const db = fakeDb();
    const { sessionId, diagnostics } = await populateInto(db, "FINISHED_PRODUCT", WH_B);
    assert.deepEqual(lineKeys(db, sessionId), ["pa-1@-=50", "pa-2@-=0"]);
    assert.equal(diagnostics.itemsWithoutBalance, 1);
    assert.equal(db.state.balances.some((b) => b.itemId === "pa-2"), false, "zero sem criar saldo");
  });

  it("prepare/populate de FINISHED_PRODUCT recusam outro setor", async () => {
    await assert.rejects(
      () =>
        prepareFinishedProductSectorForCounting(NO_DB, {
          warehouseId: WH_B,
          deviceId: DEVICE,
          sector: "COMPONENT",
        }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
    await assert.rejects(
      () =>
        populateFinishedProductCountLines(NO_DB, {
          sessionId: "s",
          warehouseId: WH_B,
          sector: "RAW_MATERIAL",
        }),
      isCode(COLLECTOR_INVALID_SECTOR)
    );
  });
});

// ===========================================================================
// 24) Sessão (33–38)
// ===========================================================================

const S_MP = "5a5a5a5a-0001-4000-8000-000000000001";
const S_CP = "5a5a5a5a-0002-4000-8000-000000000002";
const S_PA = "5a5a5a5a-0003-4000-8000-000000000003";
const S_CF = "5a5a5a5a-0004-4000-8000-000000000004";
const S_OLD = "5a5a5a5a-0005-4000-8000-000000000005";

const at = (iso: string) => new Date(`2026-09-${iso}T10:00:00Z`);

function sessionDb(
  sessions: { id: string; code: string; warehouseId: string; startedAt?: Date }[],
  lines: { sessionId: string; itemId: string; warehouseId: string; systemQuantity: number; countedQuantity?: number | null }[]
) {
  return fakeDb({ sessions, lines });
}

async function createProduct(
  db: ReturnType<typeof fakeDb>,
  sector: "COMPONENT" | "FINISHED_PRODUCT",
  warehouseId: string
) {
  return createAndStartCollectorProductSectorSession(db.client, {
    sector,
    warehouseId,
    deviceId: DEVICE,
    operationId: "op-1",
  });
}

async function createRaw(db: ReturnType<typeof fakeDb>, warehouseId = WH_A) {
  return createAndStartCollectorSectorSession(db.client, {
    sector: "RAW_MATERIAL",
    warehouseId,
    deviceId: DEVICE,
  });
}

describe("sessão COUNTING por setor", () => {
  it("criação: CP-AAAAMMDD-NNN, COUNTING, DEVICE sem usuário, lock por almoxarifado e auditoria", async () => {
    const db = fakeDb();
    const result = await createProduct(db, "COMPONENT", WH_A);
    assert.match(result.session.code, /^CP-\d{8}-001$/);
    assert.equal(result.session.status, "COUNTING");
    const row = db.state.sessions.find((s) => s.id === result.session.id)!;
    assert.equal(row.responsibleUserId, null);
    assert.equal(row.notes, "Collector sector COMPONENT; operationId=op-1");
    assert.deepEqual(lineKeys(db, result.session.id), COMPONENT_LINES_WH_A);
    assert.ok(db.state.rawQueries.some((q) => q.includes("pg_advisory_xact_lock")));

    const created = db.state.auditLogs.find((l) => l.action === "COLLECTOR_COUNT_SESSION_CREATED");
    assert.equal(created?.entityId, result.session.id);
    assert.equal(created?.afterJson.sector, "COMPONENT");
    assert.equal(created?.afterJson.warehouseId, WH_A);
    assert.equal(created?.afterJson.deviceId, DEVICE);
    assert.equal(created?.afterJson.reused, false);
    const started = db.state.auditLogs.find((l) => l.action === "COLLECTOR_COUNT_SESSION_STARTED");
    assert.equal(started?.afterJson.lines, 5);

    const pa = await createProduct(db, "FINISHED_PRODUCT", WH_B);
    assert.match(pa.session.code, /^PA-\d{8}-001$/);
  });

  it("33. reutiliza sessão compatível de COMPONENT sem repopular", async () => {
    const db = sessionDb(
      [{ id: S_CP, code: "CP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_CP, itemId: "cp-1", warehouseId: WH_A, systemQuantity: 100, countedQuantity: 40 }]
    );
    const result = await createProduct(db, "COMPONENT", WH_A);
    assert.equal(result.reused, true);
    assert.equal(result.session.id, S_CP);
    assert.equal(db.state.sessions.length, 1);
    assert.deepEqual(lineKeys(db, S_CP), ["cp-1@-=100"], "linha existente preservada");
    assert.equal(Number(db.state.lines[0]!.countedQuantity), 40, "contagem em andamento intacta");
    const reused = db.state.auditLogs.find((l) => l.action === "COLLECTOR_COUNT_SESSION_REUSED");
    assert.equal(reused?.afterJson.sector, "COMPONENT");
    assert.equal(reused?.afterJson.lines, 1);
    assert.equal(reused?.afterJson.reused, true);
  });

  it("33b. sessão vazia com prefixo do próprio setor é reutilizada e populada", async () => {
    const db = sessionDb([{ id: S_CP, code: "CP-20260901-002", warehouseId: WH_A }], []);
    const result = await createProduct(db, "COMPONENT", WH_A);
    assert.equal(result.reused, true);
    assert.deepEqual(lineKeys(db, S_CP), COMPONENT_LINES_WH_A);
    assert.equal(result.diagnostics.linesCreated, 5);
  });

  it("34. reutiliza sessão compatível de FINISHED_PRODUCT", async () => {
    const db = sessionDb(
      [{ id: S_PA, code: "PA-20260901-001", warehouseId: WH_B }],
      [{ sessionId: S_PA, itemId: "pa-1", warehouseId: WH_B, systemQuantity: 50 }]
    );
    const result = await createProduct(db, "FINISHED_PRODUCT", WH_B);
    assert.equal(result.reused, true);
    assert.equal(result.session.id, S_PA);
    assert.equal(db.state.sessions.length, 1);
  });

  it("35. bloqueia sessão incompatível com erro explícito (linhas, prefixo e sessão vazia)", async () => {
    // MP em andamento no mesmo almoxarifado.
    const mp = sessionDb(
      [{ id: S_MP, code: "MP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_MP, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 }]
    );
    await assert.rejects(
      () => createProduct(mp, "COMPONENT", WH_A),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE &&
        e.message.includes("MP-20260901-001") &&
        e.message.includes("Componentes")
    );

    // Conferência manual (CF-) com tipos misturados: nenhum setor adota.
    const mixed = sessionDb(
      [{ id: S_CF, code: "CF-20260901-001", warehouseId: WH_A }],
      [
        { sessionId: S_CF, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 },
        { sessionId: S_CF, itemId: "cp-1", warehouseId: WH_A, systemQuantity: 100 },
      ]
    );
    await assert.rejects(() => createProduct(mixed, "COMPONENT", WH_A), isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE));
    await assert.rejects(() => createRaw(mixed), isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE));

    // Vazia sem prefixo de setor: não há como provar a origem → falha fechado.
    const empty = sessionDb([{ id: S_CF, code: "CF-20260901-002", warehouseId: WH_A }], []);
    await assert.rejects(() => createProduct(empty, "COMPONENT", WH_A), isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE));
    await assert.rejects(() => createRaw(empty), isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE));

    // Prefixo de outro setor contradiz as linhas: recusa mesmo com itemType certo.
    const wrongPrefix = sessionDb(
      [{ id: S_CP, code: "CP-20260901-009", warehouseId: WH_B }],
      [{ sessionId: S_CP, itemId: "pa-1", warehouseId: WH_B, systemQuantity: 50 }]
    );
    await assert.rejects(
      () => createProduct(wrongPrefix, "FINISHED_PRODUCT", WH_B),
      isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE)
    );
  });

  it("35b. regra de compatibilidade: linhas decidem; prefixo é sinal auxiliar", () => {
    const cases: Array<[Parameters<typeof evaluateCollectorSessionCompatibility>[0], boolean, string]> = [
      [{ sector: "COMPONENT", sessionCode: "CP-20260901-001", lineCount: 3, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ sector: "COMPONENT", sessionCode: "CF-20260901-001", lineCount: 3, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ sector: "COMPONENT", sessionCode: "CP-20260901-001", lineCount: 3, foreignLineCount: 1 }, false, "LINES_OF_OTHER_ITEM_TYPE"],
      [{ sector: "COMPONENT", sessionCode: "PA-20260901-001", lineCount: 3, foreignLineCount: 0 }, false, "PREFIX_OF_OTHER_SECTOR"],
      [{ sector: "COMPONENT", sessionCode: "CP-20260901-001", lineCount: 0, foreignLineCount: 0 }, true, "EMPTY_SESSION_OWN_PREFIX"],
      [{ sector: "COMPONENT", sessionCode: "MP-20260901-001", lineCount: 0, foreignLineCount: 0 }, false, "EMPTY_SESSION_UNPROVEN"],
      [{ sector: "COMPONENT", sessionCode: "CF-20260901-001", lineCount: 0, foreignLineCount: 0 }, false, "EMPTY_SESSION_UNPROVEN"],
      [{ sector: "RAW_MATERIAL", sessionCode: "CF-20260901-001", lineCount: 2, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ sector: "RAW_MATERIAL", sessionCode: "MP-20260901-001", lineCount: 2, foreignLineCount: 2 }, false, "LINES_OF_OTHER_ITEM_TYPE"],
    ];
    for (const [input, compatible, reason] of cases) {
      assert.deepEqual(
        evaluateCollectorSessionCompatibility(input),
        { compatible, reason },
        `${input.sector} × ${input.sessionCode} (${input.lineCount}/${input.foreignLineCount})`
      );
    }
    assert.equal(collectorSectorFromSessionCode("MP-20260901-001"), "RAW_MATERIAL");
    assert.equal(collectorSectorFromSessionCode("CP-20260901-001"), "COMPONENT");
    assert.equal(collectorSectorFromSessionCode("PA-20260901-001"), "FINISHED_PRODUCT");
    assert.equal(collectorSectorFromSessionCode("CF-20260901-001"), null);
    assert.equal(collectorSectorFromSessionCode("CP-sem-data"), null);
  });

  it("36. não mistura tipos: sessão alheia fica intacta e nenhuma linha de componente é criada", async () => {
    const db = sessionDb(
      [{ id: S_MP, code: "MP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_MP, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 }]
    );
    await assert.rejects(() => createProduct(db, "COMPONENT", WH_A));
    assert.deepEqual(lineKeys(db, S_MP), ["mp-1@-=20"]);
    assert.equal(db.state.lines.some((l) => l.itemId.startsWith("cp-")), false);
    // Contexto/ativa também recusam: a sessão alheia nunca aparece como "ativa".
    await assert.rejects(
      () => findCollectorSectorActiveSession(db.client, { sector: "COMPONENT", warehouseId: WH_A, scope: "all" }),
      isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE)
    );
  });

  it("37. não cria sessão concorrente: conflito vira erro, nunca uma segunda COUNTING", async () => {
    const db = sessionDb(
      [{ id: S_MP, code: "MP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_MP, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 }]
    );
    await assert.rejects(() => createProduct(db, "COMPONENT", WH_A));
    assert.equal(db.state.sessions.length, 1);
    assert.equal(db.state.writes.includes("inventoryCountSession.create"), false);
    assert.ok(db.state.rawQueries.some((q) => q.includes("pg_advisory_xact_lock")), "serializado por almoxarifado");

    // Setores de produto avaliam TODAS as COUNTING: a compatível mais recente
    // não mascara a incompatível mais antiga.
    const both = sessionDb(
      [
        { id: S_CP, code: "CP-20260902-001", warehouseId: WH_A, startedAt: at("02") },
        { id: S_OLD, code: "MP-20260901-001", warehouseId: WH_A, startedAt: at("01") },
      ],
      [
        { sessionId: S_CP, itemId: "cp-1", warehouseId: WH_A, systemQuantity: 100 },
        { sessionId: S_OLD, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 },
      ]
    );
    await assert.rejects(() => createProduct(both, "COMPONENT", WH_A), isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE));
    assert.equal(both.state.sessions.length, 2);

    // Zero linhas: erro e rollback — nunca sobra sessão vazia criada pelo Collector.
    const empty = fakeDb();
    await assert.rejects(
      () => createProduct(empty, "COMPONENT", WH_EMPTY),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === "COLLECTOR_NO_LINES" &&
        e.message === "Nenhum componente com saldo ou almoxarifado padrão neste almoxarifado."
    );
    assert.equal(empty.state.sessions.length, 0);
    const noItems = fakeDb({ items: baseSeed().items.filter((i) => i.itemType !== "FINISHED_PRODUCT") });
    await assert.rejects(
      () => createProduct(noItems, "FINISHED_PRODUCT", WH_B),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === "COLLECTOR_NO_ELIGIBLE_ITEMS" &&
        e.message === "Nenhum produto acabado elegível para inventário neste setor."
    );
    await assert.rejects(() => createProduct(fakeDb(), "COMPONENT", WH_OFF), isCode("WAREHOUSE_NOT_ELIGIBLE"));
  });

  it("38. RAW_MATERIAL mantém o comportamento atual (e nunca adota linhas de outro tipo)", async () => {
    // Continua a sessão MP em andamento, como hoje.
    const mp = sessionDb(
      [{ id: S_MP, code: "MP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_MP, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 }]
    );
    const reused = await createRaw(mp);
    assert.equal(reused.reused, true);
    assert.equal(reused.session.id, S_MP);

    // Conferência manual só com MP continua sendo adotada, como hoje.
    const manual = sessionDb(
      [{ id: S_CF, code: "CF-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_CF, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 }]
    );
    assert.equal((await createRaw(manual)).session.id, S_CF);

    // Sem sessão: cria MP- pelo fluxo de MP (prepare/populate próprios).
    const fresh = fakeDb();
    const created = await createRaw(fresh);
    assert.equal(created.reused, false);
    assert.match(created.session.code, /^MP-\d{8}-001$/);
    assert.deepEqual(lineKeys(fresh, created.session.id), ["mp-1@-=20"]);
    assert.ok(fresh.state.materialReads > 0, "MP segue lendo o cadastro de Material");

    // MP olha só a COUNTING mais recente (fluxo atual)...
    const latestOnly = sessionDb(
      [
        { id: S_MP, code: "MP-20260902-001", warehouseId: WH_A, startedAt: at("02") },
        { id: S_OLD, code: "CP-20260901-001", warehouseId: WH_A, startedAt: at("01") },
      ],
      [
        { sessionId: S_MP, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 },
        { sessionId: S_OLD, itemId: "cp-1", warehouseId: WH_A, systemQuantity: 100 },
      ]
    );
    const active = await findCollectorSectorActiveSession(latestOnly.client, {
      sector: "RAW_MATERIAL",
      warehouseId: WH_A,
      scope: "latest",
    });
    assert.equal(active?.id, S_MP);

    // ...mas nunca reaproveita sessão cujas linhas sejam de outro itemType.
    const cp = sessionDb(
      [{ id: S_CP, code: "CP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_CP, itemId: "cp-1", warehouseId: WH_A, systemQuantity: 100 }]
    );
    await assert.rejects(() => createRaw(cp), isCode(COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE));
    assert.equal(cp.state.sessions.length, 1);
  });
});

// ===========================================================================
// Despacho na borda (rotas reais do Collector) e UX do tablet
// ===========================================================================

function callRoute(
  db: ReturnType<typeof fakeDb>,
  method: "get" | "post",
  path: string,
  opts: { query?: Record<string, string>; body?: Record<string, unknown> } = {}
) {
  return callCollectorRoute(db.client, method, path, opts);
}

const CONTEXT = "/api/inventory/collector/context";
const SESSIONS = "/api/inventory/collector/count-sessions";
const ACTIVE = "/api/inventory/collector/count-sessions/active";

describe("despacho na borda — rotas do Collector", () => {
  it("contexto de Componentes e Produto acabado usa o resolvedor de produto", async () => {
    const db = fakeDb();
    const cp = await callRoute(db, "get", CONTEXT, { query: { sector: "componentes" } });
    assert.equal(cp.status, 200);
    assert.deepEqual(cp.body.sector, { code: "COMPONENT", label: "Componentes" });
    assert.deepEqual(cp.body.warehouses.map((w: { code: string }) => w.code), ["ALM-A"]);
    assert.equal(cp.body.operationalState, "READY");
    assert.equal(cp.body.diagnostics.itemsEligible, 5);
    assert.equal(cp.body.activeSession, null);

    const pa = await callRoute(db, "get", CONTEXT, { query: { sector: "produto-acabado" } });
    assert.deepEqual(pa.body.sector, { code: "FINISHED_PRODUCT", label: "Produto acabado" });
    assert.deepEqual(pa.body.warehouses.map((w: { code: string }) => w.code), ["ALM-B"]);
  });

  it("sessão incompatível no contexto → 409 COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE (produto e MP)", async () => {
    const withMp = sessionDb(
      [{ id: S_MP, code: "MP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_MP, itemId: "mp-1", warehouseId: WH_A, systemQuantity: 20 }]
    );
    const cp = await callRoute(withMp, "get", CONTEXT, { query: { sector: "componentes" } });
    assert.equal(cp.status, 409);
    assert.equal(cp.body.code, COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE);

    const mpOk = await callRoute(withMp, "get", CONTEXT, { query: { sector: "raw-material" } });
    assert.equal(mpOk.status, 200, "MP continua vendo a própria sessão");
    assert.equal(mpOk.body.activeSession.sessionId, S_MP);

    const withCp = sessionDb(
      [{ id: S_CP, code: "CP-20260901-001", warehouseId: WH_A }],
      [{ sessionId: S_CP, itemId: "cp-1", warehouseId: WH_A, systemQuantity: 100 }]
    );
    const mp = await callRoute(withCp, "get", CONTEXT, { query: { sector: "raw-material" } });
    assert.equal(mp.status, 409, "MP não mostra sessão de componentes como ativa");
    assert.equal(mp.body.code, COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE);
  });

  it("POST count-sessions despacha por setor: cria CP-, depois reutiliza; ativa exige presença", async () => {
    const db = fakeDb();
    const first = await callRoute(db, "post", SESSIONS, { body: { sector: "componentes", operationId: "op-a" } });
    assert.equal(first.status, 201);
    assert.match(first.body.session.code, /^CP-\d{8}-001$/);
    assert.equal(first.body.session.warehouseId, WH_A);
    const second = await callRoute(db, "post", SESSIONS, { body: { sector: "componentes", operationId: "op-b" } });
    assert.equal(second.status, 200);
    assert.equal(second.body.reused, true);
    assert.equal(second.body.session.id, first.body.session.id);

    const active = await callRoute(db, "get", ACTIVE, { query: { sector: "componentes", warehouseId: WH_A } });
    assert.equal(active.body.activeSession.sessionId, first.body.session.id);
    const noPresence = await callRoute(db, "get", ACTIVE, { query: { sector: "componentes", warehouseId: WH_B } });
    assert.equal(noPresence.status, 400);
    assert.equal(noPresence.body.code, "WAREHOUSE_NOT_ELIGIBLE");
  });

  it("retirada continua exclusiva de Matéria-prima", async () => {
    const db = fakeDb();
    const list = await callRoute(db, "get", "/api/inventory/collector/withdraw/items", {
      query: { sector: "componentes", warehouseId: WH_A },
    });
    assert.equal(list.status, 400);
    assert.equal(list.body.code, COLLECTOR_INVALID_SECTOR);
    const post = await callRoute(db, "post", "/api/inventory/collector/withdraw", {
      body: {
        sector: "produto-acabado",
        itemId: "12121212-1212-4212-8212-121212121212",
        warehouseId: WH_B,
        quantity: 1,
        person: "Operador",
        operationId: "op-w",
      },
    });
    assert.equal(post.status, 400);
    assert.equal(post.body.code, COLLECTOR_INVALID_SECTOR);
    assert.equal(db.state.movements.length, 0);
  });

  it("rotas: despacho explícito e 409 mapeado", () => {
    const src = codeOnly(read(ROUTES));
    assert.match(src, /isCollectorProductSector\(sector\)\s*\?\s*await resolveCollectorProductSectorOperationalContext/);
    assert.match(src, /createAndStartCollectorProductSectorSession\(prisma, \{ \.\.\.sessionInput, sector \}\)/);
    assert.match(src, /createAndStartCollectorSectorSession\(prisma, \{ \.\.\.sessionInput, sector \}\)/);
    assert.match(src, /error\.code === COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE/);
  });
});

describe("UX do tablet por setor", () => {
  it('nenhuma mensagem de Componentes/Produto acabado fala em "matéria-prima"', () => {
    for (const sectorCode of ["COMPONENT", "FINISHED_PRODUCT"]) {
      for (const operationalState of [
        "CONFIGURATION_REQUIRED",
        "NO_ELIGIBLE_ITEMS",
        "NEEDS_WAREHOUSE_SELECTION",
        "READY",
      ]) {
        for (const itemsEligible of [0, 3, undefined]) {
          const msg = productSectorOperationalMessage({ sectorCode, operationalState, itemsEligible }) ?? "";
          assert.doesNotMatch(msg, /mat[ée]ria/i, `${sectorCode}/${operationalState}`);
        }
      }
    }
    assert.match(
      productSectorOperationalMessage({
        sectorCode: "COMPONENT",
        operationalState: "CONFIGURATION_REQUIRED",
        itemsEligible: 0,
      }) ?? "",
      /^Não há componentes elegíveis/
    );
    assert.match(
      productSectorOperationalMessage({
        sectorCode: "FINISHED_PRODUCT",
        operationalState: "CONFIGURATION_REQUIRED",
        itemsEligible: 2,
      }) ?? "",
      /^Nenhum almoxarifado com produtos acabados/
    );
    assert.equal(isProductCollectorSectorCode("RAW_MATERIAL"), false);
    assert.doesNotMatch(codeOnly(read(PRODUCT_MODULE)), /mat[ée]ria/i, "mensagens do servidor por setor");
  });

  it("tela: retirada só em MP; mensagens de MP intactas; 409 vira erro com a mensagem do servidor", () => {
    const page = read("src/components/inventory/collector/CollectorSectorPage.tsx");
    assert.match(
      page,
      /const withdrawalEnabled =\s*\(boot\.context\.sector\?\.code \?\? sectorCodeFromSlug\(sectorParam\)\) === "RAW_MATERIAL"/
    );
    assert.match(page, /\{withdrawalEnabled \? \(\s*<button/);
    assert.match(page, /Não há matérias-primas elegíveis para inventário\. Verifique o cadastro de Suprimentos\./);
    const opFn = page.slice(page.indexOf("function operationalMessage"), page.indexOf("type Screen"));
    assert.ok(
      opFn.indexOf("isProductCollectorSectorCode") < opFn.indexOf("matérias-primas"),
      "setores de produto retornam antes das mensagens de MP"
    );
    const boot = mapCollectorBootError({
      status: 409,
      code: COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE,
      message: "Já existe uma conferência em contagem neste almoxarifado (MP-20260901-001)...",
    });
    assert.equal(boot.phase, "error");
    assert.match(boot.message, /MP-20260901-001/);
  });
});
