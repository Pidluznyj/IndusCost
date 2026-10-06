/**
 * Collector — motor genérico de setores configuráveis (strategy = STANDARD).
 *
 * O setor vem de InventoryStockSector; nada aqui é específico de um setor. A
 * configuração real de referência é ADMINISTRATIVO (ADMINISTRATIVE_SUPPLY,
 * prefixo ADM), e um segundo setor (EMBALAGENS / PACKAGING / EM) prova que o
 * motor não tem nada fixo no código.
 *
 * Sessão, contagem, finalização, ajustes e retirada passam pelas rotas reais do
 * tablet e pelos motores canônicos reais (recordInventoryCount → finalize →
 * generateInventoryCountAdjustments → createInventoryMovementInTx). O Prisma em
 * memória (collectorCountFakeDb.ts) só guarda e devolve linhas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  callCollectorRoute,
  createCollectorCountFakeDb,
  type FakeBalanceSeed,
  type FakeItemSeed,
  type FakeLineSeed,
  type FakeSessionSeed,
  type FakeStockSectorSeed,
  type FakeWarehouseSeed,
} from "./collectorCountFakeDb.js";
import {
  COLLECTOR_COUNTING_DENIED,
  COLLECTOR_SECTOR_INACTIVE,
  COLLECTOR_SECTOR_MISCONFIGURED,
  COLLECTOR_SECTOR_STRATEGY_UNSUPPORTED,
  COLLECTOR_SECTOR_WAREHOUSE_INACTIVE,
  COLLECTOR_WITHDRAWAL_DENIED,
  resolveCollectorSectorRef,
  resolveStandardCollectorSector,
  type CollectorStandardSectorRef,
} from "./collectorSectorResolve.server.js";
import {
  COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE,
  collectorSectorFromSessionCode,
  collectorSessionCodePrefix,
  evaluateCollectorSessionCompatibility,
  evaluateCollectorSessionIdentityCompatibility,
} from "./collectorSessionCompatibility.server.js";
import {
  createAndStartCollectorStandardSectorSession,
  populateStandardSectorCountLines,
} from "./collectorStandardSector.server.js";
import {
  COLLECTOR_INSUFFICIENT_STOCK_MESSAGE,
  COLLECTOR_ITEM_NOT_ELIGIBLE,
  listCollectorStandardWithdrawItems,
} from "./collectorWithdrawal.server.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const uuid = (n: number, block = "1111") =>
  `${n.toString(16).padStart(8, "0")}-${block}-4111-8111-111111111111`;

const WH_ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WH_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WH_OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECTOR_ADM = "5ec70000-0000-4000-8000-000000000001";
const SECTOR_EMB = "5ec70000-0000-4000-8000-000000000002";
const COST_CENTER = "cc000000-0000-4000-8000-000000000001";
const COST_CENTER_OFF = "cc000000-0000-4000-8000-000000000002";
const DEVICE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ADM_1 = uuid(1); // padrão no ADMINISTRATIVO, sem saldo
const ADM_2 = uuid(2); // saldo 10 no ADMINISTRATIVO
const ADM_HIST = uuid(3); // padrão em outro almoxarifado, saldo histórico no ADMINISTRATIVO
const ADM_OTHER_WH = uuid(4); // tudo em outro almoxarifado
const PPE_1 = uuid(5); // outro itemType
const ADM_INACTIVE = uuid(6);
const ADM_NO_STOCK = uuid(7); // controlsStock = false
const EMB_1 = uuid(8); // PACKAGING, saldo 20 no outro almoxarifado

const WAREHOUSES: FakeWarehouseSeed[] = [
  { id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo" },
  { id: WH_OTHER, code: "ALM-B" },
  { id: WH_OFF, code: "ALM-OFF", status: "INACTIVE" },
];

/** Exatamente a configuração do primeiro caso real. */
const ADMINISTRATIVO: FakeStockSectorSeed = {
  id: SECTOR_ADM,
  code: "ADMINISTRATIVO",
  name: "Administrativo",
  slug: "administrativo",
  strategy: "STANDARD",
  itemType: "ADMINISTRATIVE_SUPPLY",
  warehouseId: WH_ADM,
  sessionCodePrefix: "ADM",
  allowsCounting: true,
  allowsWithdrawal: true,
};

const EMBALAGENS: FakeStockSectorSeed = {
  id: SECTOR_EMB,
  code: "EMBALAGENS",
  name: "Embalagens",
  slug: "embalagens",
  itemType: "PACKAGING",
  warehouseId: WH_OTHER,
  sessionCodePrefix: "EM",
  allowsCounting: true,
  allowsWithdrawal: true,
};

const ITEMS: FakeItemSeed[] = [
  { id: ADM_1, code: "ADM-001", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_ADM },
  { id: ADM_2, code: "ADM-002", itemType: "ADMINISTRATIVE_SUPPLY" },
  { id: ADM_HIST, code: "ADM-003", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_OTHER },
  { id: ADM_OTHER_WH, code: "ADM-004", itemType: "ADMINISTRATIVE_SUPPLY", defaultWarehouseId: WH_OTHER },
  { id: PPE_1, code: "EPI-001", itemType: "PPE", defaultWarehouseId: WH_ADM },
  {
    id: ADM_INACTIVE,
    code: "ADM-005",
    itemType: "ADMINISTRATIVE_SUPPLY",
    status: "INACTIVE",
    defaultWarehouseId: WH_ADM,
  },
  {
    id: ADM_NO_STOCK,
    code: "ADM-006",
    itemType: "ADMINISTRATIVE_SUPPLY",
    controlsStock: false,
    defaultWarehouseId: WH_ADM,
  },
  { id: EMB_1, code: "EMB-001", itemType: "PACKAGING" },
];

const BALANCES: FakeBalanceSeed[] = [
  { itemId: ADM_2, warehouseId: WH_ADM, physicalQuantity: 10 },
  { itemId: ADM_HIST, warehouseId: WH_ADM, physicalQuantity: 3 },
  { itemId: ADM_OTHER_WH, warehouseId: WH_OTHER, physicalQuantity: 8 },
  { itemId: PPE_1, warehouseId: WH_ADM, physicalQuantity: 9 },
  { itemId: ADM_INACTIVE, warehouseId: WH_ADM, physicalQuantity: 9 },
  { itemId: ADM_NO_STOCK, warehouseId: WH_ADM, physicalQuantity: 9 },
  { itemId: EMB_1, warehouseId: WH_OTHER, physicalQuantity: 20 },
];

function fakeDb(
  overrides: {
    sectors?: FakeStockSectorSeed[];
    items?: FakeItemSeed[];
    balances?: FakeBalanceSeed[];
    sessions?: FakeSessionSeed[];
    lines?: FakeLineSeed[];
  } = {}
) {
  return createCollectorCountFakeDb({
    warehouses: WAREHOUSES,
    items: overrides.items ?? ITEMS,
    balances: overrides.balances ?? BALANCES,
    sectors: overrides.sectors ?? [ADMINISTRATIVO, EMBALAGENS],
    sessions: overrides.sessions,
    lines: overrides.lines,
    costCenters: [{ id: COST_CENTER }, { id: COST_CENTER_OFF, isActive: false }],
  });
}

type Db = ReturnType<typeof fakeDb>;

const codeOf = (code: string) => (e: unknown) =>
  e instanceof InventoryValidationError && e.code === code;

async function admRef(db: Db): Promise<CollectorStandardSectorRef> {
  return resolveStandardCollectorSector(db.client, "administrativo");
}

const linesOf = (db: Db, sessionId: string) =>
  db.state.lines.filter((line) => line.sessionId === sessionId);

const SESSIONS_ROUTE = "/api/inventory/collector/count-sessions";
const WITHDRAW_ROUTE = "/api/inventory/collector/withdraw";

function openSession(db: Db, sector = "administrativo", extra: Record<string, unknown> = {}) {
  return callCollectorRoute(db.client, "post", SESSIONS_ROUTE, {
    body: { sector, operationId: `open-${sector}`, ...extra },
  });
}

function withdraw(db: Db, body: Record<string, unknown>) {
  return callCollectorRoute(db.client, "post", WITHDRAW_ROUTE, {
    body: {
      sector: "administrativo",
      operationId: "w-1",
      itemId: ADM_2,
      quantity: 4,
      person: "Maria",
      costCenterId: COST_CENTER,
      ...body,
    },
  });
}

// ===========================================================================
// 1) Resolução do setor
// ===========================================================================

describe("STANDARD · resolve", () => {
  it("1. resolve o setor ACTIVE STANDARD pelo slug, com tudo que o motor precisa", async () => {
    const db = fakeDb();
    const ref = await resolveStandardCollectorSector(db.client, "administrativo");
    assert.deepEqual(ref, {
      kind: "STANDARD",
      strategy: "STANDARD",
      sectorId: SECTOR_ADM,
      code: "ADMINISTRATIVO",
      name: "Administrativo",
      label: "Administrativo",
      slug: "administrativo",
      itemType: "ADMINISTRATIVE_SUPPLY",
      sessionCodePrefix: "ADM",
      warehouseId: WH_ADM,
      warehouse: { id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo", status: "ACTIVE" },
      allowsCounting: true,
      allowsWithdrawal: true,
      capabilities: { allowsCounting: true, allowsWithdrawal: true },
    });
    assert.deepEqual(db.state.queries, ["inventoryStockSector.findUnique"], "uma consulta só");
  });

  it("2. setor inexistente falha fechado", async () => {
    const db = fakeDb();
    await assert.rejects(
      () => resolveStandardCollectorSector(db.client, "nao-existe"),
      codeOf("COLLECTOR_INVALID_SECTOR")
    );
    await assert.rejects(
      () => resolveCollectorSectorRef(db.client, ""),
      codeOf("COLLECTOR_INVALID_SECTOR")
    );
  });

  it("3. setor inativo falha fechado", async () => {
    const db = fakeDb({ sectors: [{ ...ADMINISTRATIVO, status: "INACTIVE" }] });
    await assert.rejects(() => admRef(db), codeOf(COLLECTOR_SECTOR_INACTIVE));
  });

  it("4. almoxarifado inativo ou inexistente falha fechado", async () => {
    const off = fakeDb({ sectors: [{ ...ADMINISTRATIVO, warehouseId: WH_OFF }] });
    await assert.rejects(() => admRef(off), codeOf(COLLECTOR_SECTOR_WAREHOUSE_INACTIVE));
    const missing = fakeDb({ sectors: [{ ...ADMINISTRATIVO, warehouseId: uuid(999, "9999") }] });
    await assert.rejects(() => admRef(missing), codeOf(COLLECTOR_SECTOR_WAREHOUSE_INACTIVE));
  });

  it("5. strategy que não é STANDARD não é suportada", async () => {
    for (const strategy of ["RAW_MATERIAL", "PRODUCT", "QUALQUER"]) {
      const db = fakeDb({ sectors: [{ ...ADMINISTRATIVO, strategy }] });
      await assert.rejects(
        () => admRef(db),
        codeOf(COLLECTOR_SECTOR_STRATEGY_UNSUPPORTED),
        `strategy ${strategy}`
      );
    }
  });

  it("6. STANDARD sem itemType falha fechado", async () => {
    const db = fakeDb({ sectors: [{ ...ADMINISTRATIVO, itemType: null }] });
    await assert.rejects(() => admRef(db), codeOf(COLLECTOR_SECTOR_MISCONFIGURED));
  });

  it("7. prefixo de sessão inválido ou reservado ao legado falha fechado", async () => {
    for (const sessionCodePrefix of ["MP", "CP", "PA", "A", "ABCDE", "A1"]) {
      const db = fakeDb({ sectors: [{ ...ADMINISTRATIVO, sessionCodePrefix }] });
      await assert.rejects(
        () => admRef(db),
        codeOf(COLLECTOR_SECTOR_MISCONFIGURED),
        `prefixo ${sessionCodePrefix}`
      );
    }
  });

  it("8. legado resolve sem tocar no banco, mesmo com a tabela de setores vazia", async () => {
    const db = fakeDb({ sectors: [] });
    for (const [raw, code] of [
      ["raw-material", "RAW_MATERIAL"],
      ["RAW_MATERIAL", "RAW_MATERIAL"],
      ["componentes", "COMPONENT"],
      ["produto-acabado", "FINISHED_PRODUCT"],
    ] as const) {
      const ref = await resolveCollectorSectorRef(db.client, raw);
      assert.equal(ref.kind, "LEGACY");
      assert.equal(ref.code, code);
    }
    assert.deepEqual(db.state.queries, [], "legado não consulta InventoryStockSector");
  });

  it("9. slug legado nunca vira STANDARD, nem que exista linha homônima", async () => {
    const db = fakeDb({
      sectors: [{ ...ADMINISTRATIVO, slug: "raw-material", code: "RAW_MATERIAL" }],
    });
    const ref = await resolveCollectorSectorRef(db.client, "raw-material");
    assert.equal(ref.kind, "LEGACY");
    await assert.rejects(
      () => resolveStandardCollectorSector(db.client, "raw-material"),
      codeOf("COLLECTOR_INVALID_SECTOR")
    );
    assert.deepEqual(db.state.queries, []);
  });

  it("10. capacidades do legado espelham o comportamento atual", async () => {
    const db = fakeDb();
    const mp = await resolveCollectorSectorRef(db.client, "raw-material");
    const cp = await resolveCollectorSectorRef(db.client, "componentes");
    const pa = await resolveCollectorSectorRef(db.client, "produto-acabado");
    assert.deepEqual(mp.capabilities, { allowsCounting: true, allowsWithdrawal: true });
    assert.deepEqual(cp.capabilities, { allowsCounting: true, allowsWithdrawal: false });
    assert.deepEqual(pa.capabilities, { allowsCounting: true, allowsWithdrawal: false });
  });
});

// ===========================================================================
// 2) População
// ===========================================================================

describe("STANDARD · população", () => {
  const S_EMPTY = uuid(100, "2222");
  const emptySession: FakeSessionSeed = {
    id: S_EMPTY,
    code: "ADM-20260901-001",
    warehouseId: WH_ADM,
  };

  async function populate(db: Db) {
    const sector = await admRef(db);
    db.state.queries.length = 0;
    return populateStandardSectorCountLines(db.client, { sessionId: S_EMPTY, sector });
  }

  it("11. zero itens elegíveis: nenhuma linha, nenhum createMany", async () => {
    const db = fakeDb({ items: [], balances: [], sessions: [emptySession] });
    const diagnostics = await populate(db);
    assert.equal(diagnostics.linesCreated, 0);
    assert.equal(diagnostics.skippedExistingLines, false);
    assert.equal(linesOf(db, S_EMPTY).length, 0);
    assert.deepEqual(db.state.writes, []);
  });

  it("12. um item sem saldo: uma linha com saldo sistêmico 0", async () => {
    const db = fakeDb({
      items: [ITEMS[0]!],
      balances: [],
      sessions: [emptySession],
    });
    const diagnostics = await populate(db);
    assert.equal(diagnostics.linesCreated, 1);
    assert.equal(diagnostics.itemsWithoutBalance, 1);
    const [line] = linesOf(db, S_EMPTY);
    assert.equal(line!.itemId, ADM_1);
    assert.equal(line!.warehouseId, WH_ADM);
    assert.equal(line!.locationId, null);
    assert.equal(Number(line!.systemQuantity), 0);
  });

  it("13. com saldo: saldo sistêmico = físico; saldo histórico entra mesmo com outro padrão", async () => {
    const db = fakeDb({ sessions: [emptySession] });
    const diagnostics = await populate(db);
    const byItem = new Map(linesOf(db, S_EMPTY).map((l) => [l.itemId, Number(l.systemQuantity)]));
    assert.deepEqual(
      [...byItem].sort(),
      [
        [ADM_1, 0],
        [ADM_2, 10],
        [ADM_HIST, 3],
      ].sort()
    );
    assert.equal(diagnostics.itemsWithBalance, 2);
    assert.equal(diagnostics.itemsWithoutBalance, 1);
    assert.equal(diagnostics.itemsEligibleInWarehouse, 3);
  });

  it("14. ficam de fora: outro almoxarifado, outro tipo, inativo e sem controle de estoque", async () => {
    const db = fakeDb({ sessions: [emptySession] });
    await populate(db);
    const itemIds = new Set(linesOf(db, S_EMPTY).map((l) => l.itemId));
    for (const [label, id] of [
      ["outro almoxarifado", ADM_OTHER_WH],
      ["outro itemType", PPE_1],
      ["inativo", ADM_INACTIVE],
      ["controlsStock=false", ADM_NO_STOCK],
      ["item de outro setor", EMB_1],
    ] as const) {
      assert.equal(itemIds.has(id), false, `${label} não pode virar linha`);
    }
  });

  it("15. não exige materialId nem productId", async () => {
    const db = fakeDb({ sessions: [emptySession] });
    await populate(db);
    for (const line of linesOf(db, S_EMPTY)) {
      const item = db.state.items.find((i) => i.id === line.itemId)!;
      assert.equal(item.materialId, null);
      assert.equal(item.productId, null);
    }
  });

  it("16. idempotente: sessão que já tem linhas não é duplicada", async () => {
    const db = fakeDb({ sessions: [emptySession] });
    const first = await populate(db);
    const second = await populate(db);
    assert.equal(first.linesCreated, 3);
    assert.equal(second.linesCreated, 0);
    assert.equal(second.skippedExistingLines, true);
    assert.equal(second.existingLines, 3);
    assert.equal(linesOf(db, S_EMPTY).length, 3);
  });

  it("17. só escreve InventoryCountLine: não cria item, saldo nem movimento", async () => {
    const db = fakeDb({ sessions: [emptySession] });
    const balancesBefore = JSON.stringify(db.state.balances);
    await populate(db);
    assert.deepEqual(db.state.writes, ["inventoryCountLine.createMany"]);
    assert.equal(JSON.stringify(db.state.balances), balancesBefore);
    assert.equal(db.state.movements.length, 0);
    assert.equal(db.state.materialReads, 0);
  });

  it("18. almoxarifado que não é o do setor é recusado", async () => {
    const db = fakeDb({ sessions: [emptySession] });
    const sector = await admRef(db);
    await assert.rejects(
      () =>
        populateStandardSectorCountLines(db.client, {
          sessionId: S_EMPTY,
          sector,
          warehouseId: WH_OTHER,
        }),
      codeOf("WAREHOUSE_NOT_ELIGIBLE")
    );
    assert.equal(linesOf(db, S_EMPTY).length, 0);
  });

  function bulkSeed(total: number) {
    const items: FakeItemSeed[] = [];
    const balances: FakeBalanceSeed[] = [];
    for (let i = 0; i < total; i += 1) {
      const id = uuid(i + 1, "5555");
      // Metade com saldo (sem almoxarifado padrão), metade só com padrão.
      if (i % 2 === 0) {
        items.push({ id, code: `B-${i}`, itemType: "ADMINISTRATIVE_SUPPLY" });
        balances.push({ itemId: id, warehouseId: WH_ADM, physicalQuantity: i + 1 });
      } else {
        items.push({
          id,
          code: `B-${i}`,
          itemType: "ADMINISTRATIVE_SUPPLY",
          defaultWarehouseId: WH_ADM,
        });
      }
    }
    return { items, balances };
  }

  it("19. 500 itens: 500 linhas, sem N+1 — mesmas consultas de 1 item", async () => {
    const one = fakeDb({ ...bulkSeed(1), sessions: [emptySession] });
    await populate(one);
    const many = fakeDb({ ...bulkSeed(500), sessions: [emptySession] });
    const diagnostics = await populate(many);

    assert.equal(diagnostics.linesCreated, 500);
    assert.equal(diagnostics.itemsWithBalance, 250);
    assert.equal(diagnostics.itemsWithoutBalance, 250);
    assert.equal(linesOf(many, S_EMPTY).length, 500);
    assert.equal(new Set(linesOf(many, S_EMPTY).map((l) => l.itemId)).size, 500);

    const expected = [
      "inventoryCountLine.count",
      "inventoryBalance.findMany",
      "inventoryItem.findMany",
      "inventoryCountLine.createMany",
    ];
    assert.deepEqual([...many.state.queries].sort(), [...expected].sort());
    assert.deepEqual(
      [...many.state.queries].sort(),
      [...one.state.queries].sort(),
      "número de consultas não cresce com o número de itens"
    );
  });

  it("20. volume acima do bloco de inserção continua em lote (createMany por bloco)", async () => {
    const db = fakeDb({ ...bulkSeed(1001), sessions: [emptySession] });
    const diagnostics = await populate(db);
    assert.equal(diagnostics.linesCreated, 1001);
    assert.equal(linesOf(db, S_EMPTY).length, 1001);
    assert.equal(
      db.state.queries.filter((q) => q === "inventoryCountLine.createMany").length,
      2
    );
    assert.equal(db.state.queries.length, 5);
  });
});

// ===========================================================================
// 3) Sessão
// ===========================================================================

describe("STANDARD · sessão", () => {
  it("21. cria: código <prefixo>-AAAAMMDD-NNN do setor, no almoxarifado do setor", async () => {
    const db = fakeDb();
    const opened = await openSession(db);
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.match(opened.body.session.code, /^ADM-\d{8}-001$/);
    assert.equal(opened.body.session.status, "COUNTING");
    assert.equal(opened.body.session.warehouseId, WH_ADM);
    assert.equal(opened.body.reused, false);
    assert.equal(opened.body.diagnostics.linesCreated, 3);
    assert.deepEqual(opened.body.sector, {
      code: "ADMINISTRATIVO",
      label: "Administrativo",
      slug: "administrativo",
      strategy: "STANDARD",
      itemType: "ADMINISTRATIVE_SUPPLY",
      allowsCounting: true,
      allowsWithdrawal: true,
    });
    assert.equal(collectorSectorFromSessionCode(opened.body.session.code), null);
    assert.equal(collectorSessionCodePrefix(opened.body.session.code), "ADM");
    const session = db.state.sessions[0]!;
    assert.equal(session.responsibleUserId, null, "dispositivo não é usuário humano");
    assert.ok(
      db.state.rawQueries.some((q) => q.includes("pg_advisory_xact_lock")),
      "abertura serializada pelo lock do almoxarifado"
    );
  });

  it("22. continua: segundo toque reaproveita a mesma sessão e não duplica linhas", async () => {
    const db = fakeDb();
    const first = await openSession(db);
    const second = await openSession(db);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.reused, true);
    assert.equal(second.body.session.id, first.body.session.id);
    assert.equal(db.state.sessions.length, 1);
    assert.equal(linesOf(db, first.body.session.id).length, 3);
  });

  it("23. prefixo vem do setor: outro setor, outro prefixo, sem nada fixo no código", async () => {
    const db = fakeDb();
    const opened = await openSession(db, "embalagens");
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.match(opened.body.session.code, /^EM-\d{8}-001$/);
    assert.equal(opened.body.session.warehouseId, WH_OTHER);
    assert.deepEqual(
      linesOf(db, opened.body.session.id).map((l) => l.itemId),
      [EMB_1]
    );
  });

  it("24. compatibilidade por identidade: itemType + prefixo", () => {
    const base = { expectedItemType: "ADMINISTRATIVE_SUPPLY" as const, expectedSessionCodePrefix: "ADM" };
    const cases: [Parameters<typeof evaluateCollectorSessionIdentityCompatibility>[0], boolean, string][] = [
      [{ ...base, sessionCode: "ADM-20260901-001", lineCount: 3, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ ...base, sessionCode: "ADM-20260901-001", lineCount: 0, foreignLineCount: 0 }, true, "EMPTY_SESSION_OWN_PREFIX"],
      [{ ...base, sessionCode: "ADM-20260901-001", lineCount: 3, foreignLineCount: 1 }, false, "LINES_OF_OTHER_ITEM_TYPE"],
      [{ ...base, sessionCode: "MP-20260901-001", lineCount: 3, foreignLineCount: 0 }, false, "PREFIX_OF_OTHER_SECTOR"],
      [{ ...base, sessionCode: "EM-20260901-001", lineCount: 3, foreignLineCount: 0, knownSectorPrefixes: ["EM"] }, false, "PREFIX_OF_OTHER_SECTOR"],
      // Prefixo desconhecido (conferência manual) não contradiz as linhas.
      [{ ...base, sessionCode: "CF-20260901-001", lineCount: 3, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ ...base, sessionCode: "CF-20260901-001", lineCount: 0, foreignLineCount: 0 }, false, "EMPTY_SESSION_UNPROVEN"],
      [{ ...base, sessionCode: "MP-20260901-001", lineCount: 0, foreignLineCount: 0 }, false, "EMPTY_SESSION_UNPROVEN"],
    ];
    for (const [input, compatible, reason] of cases) {
      assert.deepEqual(
        evaluateCollectorSessionIdentityCompatibility(input),
        { compatible, reason },
        JSON.stringify(input)
      );
    }
  });

  it("25. regra legada preservada com prefixos de 3 letras em circulação", () => {
    const cases: [Parameters<typeof evaluateCollectorSessionCompatibility>[0], boolean, string][] = [
      [{ sector: "RAW_MATERIAL", sessionCode: "MP-20260901-001", lineCount: 2, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ sector: "RAW_MATERIAL", sessionCode: "CF-20260901-001", lineCount: 2, foreignLineCount: 0 }, true, "LINES_MATCH_SECTOR"],
      [{ sector: "RAW_MATERIAL", sessionCode: "CP-20260901-001", lineCount: 2, foreignLineCount: 0 }, false, "PREFIX_OF_OTHER_SECTOR"],
      [{ sector: "COMPONENT", sessionCode: "CP-20260901-001", lineCount: 0, foreignLineCount: 0 }, true, "EMPTY_SESSION_OWN_PREFIX"],
      [{ sector: "COMPONENT", sessionCode: "ADM-20260901-001", lineCount: 0, foreignLineCount: 0 }, false, "EMPTY_SESSION_UNPROVEN"],
      [{ sector: "RAW_MATERIAL", sessionCode: "ADM-20260901-001", lineCount: 2, foreignLineCount: 2 }, false, "LINES_OF_OTHER_ITEM_TYPE"],
    ];
    for (const [input, compatible, reason] of cases) {
      assert.deepEqual(
        evaluateCollectorSessionCompatibility(input),
        { compatible, reason },
        JSON.stringify(input)
      );
    }
  });

  it("26. sessão COUNTING incompatível no almoxarifado: 409, sem abrir concorrente", async () => {
    const S_MP = uuid(200, "2222");
    const MP_ITEM = uuid(201, "2222");
    const db = fakeDb({
      items: [...ITEMS, { id: MP_ITEM, code: "MP-001", itemType: "RAW_MATERIAL", materialId: "mat-1" }],
      sessions: [{ id: S_MP, code: "MP-20260901-001", warehouseId: WH_ADM }],
      lines: [{ sessionId: S_MP, itemId: MP_ITEM, warehouseId: WH_ADM, systemQuantity: 5 }],
    });
    const opened = await openSession(db);
    assert.equal(opened.status, 409, JSON.stringify(opened.body));
    assert.equal(opened.body.code, COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE);
    assert.match(opened.body.error, /Administrativo/);
    assert.equal(db.state.sessions.length, 1, "nenhuma segunda COUNTING");
    assert.equal(db.state.lines.length, 1);
  });

  it("27. sessão vazia de outro setor configurado também é incompatível", async () => {
    const S_EM = uuid(210, "2222");
    const db = fakeDb({
      sessions: [{ id: S_EM, code: "EM-20260901-001", warehouseId: WH_ADM }],
    });
    const opened = await openSession(db);
    assert.equal(opened.status, 409, JSON.stringify(opened.body));
    assert.equal(opened.body.code, COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE);
    assert.equal(db.state.sessions.length, 1);
  });

  it("28. sessão vazia do próprio prefixo é continuada e populada", async () => {
    const S_ADM = uuid(220, "2222");
    const db = fakeDb({
      sessions: [{ id: S_ADM, code: "ADM-20260901-007", warehouseId: WH_ADM }],
    });
    const opened = await openSession(db);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.reused, true);
    assert.equal(opened.body.session.id, S_ADM);
    assert.equal(linesOf(db, S_ADM).length, 3);
  });

  it("29. sem item elegível: erro e rollback — não sobra sessão vazia", async () => {
    const db = fakeDb({ items: [], balances: [] });
    const opened = await openSession(db);
    assert.equal(opened.status, 400, JSON.stringify(opened.body));
    assert.equal(opened.body.code, "COLLECTOR_NO_ELIGIBLE_ITEMS");
    assert.equal(db.state.sessions.length, 0);
  });

  it("30. o cliente não escolhe almoxarifado nem strategy", async () => {
    const db = fakeDb();
    const wrong = await openSession(db, "administrativo", { warehouseId: WH_OTHER });
    assert.equal(wrong.status, 400, JSON.stringify(wrong.body));
    assert.equal(wrong.body.code, "WAREHOUSE_NOT_ELIGIBLE");
    assert.equal(db.state.sessions.length, 0);

    const forced = await openSession(db, "administrativo", {
      warehouseId: WH_ADM,
      strategy: "RAW_MATERIAL",
      itemType: "RAW_MATERIAL",
    });
    assert.equal(forced.status, 201, JSON.stringify(forced.body));
    assert.equal(forced.body.sector.strategy, "STANDARD");
    assert.equal(forced.body.sector.itemType, "ADMINISTRATIVE_SUPPLY");
    assert.equal(db.state.materialReads, 0, "nunca cai no cold-start de matéria-prima");
  });

  it("31. contexto e sessão ativa: almoxarifado fixo e capacidades do servidor", async () => {
    const db = fakeDb();
    const before = await callCollectorRoute(db.client, "get", "/api/inventory/collector/context", {
      query: { sector: "administrativo" },
    });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(before.body.sector.code, "ADMINISTRATIVO");
    assert.equal(before.body.sector.allowsCounting, true);
    assert.equal(before.body.sector.allowsWithdrawal, true);
    assert.deepEqual(before.body.warehouses, [
      { id: WH_ADM, code: "ADMINISTRATIVO", name: "Administrativo" },
    ]);
    assert.equal(before.body.operationalState, "READY");
    assert.equal(before.body.activeSession, null);
    assert.equal(before.body.diagnostics.itemsEligibleInWarehouse, 3);

    const opened = await openSession(db);
    const active = await callCollectorRoute(db.client, "get", `${SESSIONS_ROUTE}/active`, {
      query: { sector: "administrativo" },
    });
    assert.equal(active.status, 200, JSON.stringify(active.body));
    assert.equal(active.body.activeSession.sessionId, opened.body.session.id);
    assert.equal(active.body.activeSession.totalLines, 3);

    const otherWarehouse = await callCollectorRoute(db.client, "get", `${SESSIONS_ROUTE}/active`, {
      query: { sector: "administrativo", warehouseId: WH_OTHER },
    });
    assert.equal(otherWarehouse.status, 400);
    assert.equal(otherWarehouse.body.code, "WAREHOUSE_NOT_ELIGIBLE");
  });

  it("32. setor inexistente / inativo nas rotas: recusa sem cair no legado", async () => {
    const db = fakeDb({ sectors: [{ ...ADMINISTRATIVO, status: "INACTIVE" }] });
    const inactive = await openSession(db);
    assert.equal(inactive.status, 400);
    assert.equal(inactive.body.code, COLLECTOR_SECTOR_INACTIVE);
    const unknown = await openSession(db, "nao-existe");
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, "COLLECTOR_INVALID_SECTOR");
    assert.equal(db.state.sessions.length, 0);
  });

  it("33. abrir sessão não cresce em consultas com o número de itens", async () => {
    const seed = (total: number) => {
      const items: FakeItemSeed[] = [];
      for (let i = 0; i < total; i += 1) {
        items.push({
          id: uuid(i + 1, "6666"),
          code: `S-${i}`,
          itemType: "ADMINISTRATIVE_SUPPLY",
          defaultWarehouseId: WH_ADM,
        });
      }
      return { items, balances: [] as FakeBalanceSeed[] };
    };
    const one = fakeDb(seed(1));
    const many = fakeDb(seed(500));
    assert.equal((await openSession(one)).status, 201);
    const opened = await openSession(many);
    assert.equal(opened.status, 201);
    assert.equal(opened.body.diagnostics.linesCreated, 500);
    assert.deepEqual(many.state.queries, one.state.queries);
  });
});

// ===========================================================================
// 4) Contagem — motores canônicos, nenhum motor paralelo
// ===========================================================================

type BlindItem = { lineId: string; itemId: string; version: number };

async function countFinalizeApply(db: Db, sector: string, counts: Record<string, number>) {
  const opened = await openSession(db, sector);
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const sessionId: string = opened.body.session.id;

  const listed = await callCollectorRoute(db.client, "get", `${SESSIONS_ROUTE}/:id/items`, {
    params: { id: sessionId },
  });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const items = listed.body.items as BlindItem[];
  for (const item of items) {
    assert.equal("systemQuantity" in item, false, "lista cega não revela saldo");
  }

  for (const item of items) {
    if (!(item.itemId in counts)) continue;
    const counted = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count", {
      body: {
        sessionId,
        lineId: item.lineId,
        countedQuantity: counts[item.itemId],
        expectedVersion: item.version,
        operationId: `count-${item.itemId}`,
      },
    });
    assert.equal(counted.status, 200, JSON.stringify(counted.body));
  }

  const finalized = await callCollectorRoute(db.client, "post", `${SESSIONS_ROUTE}/:id/finalize`, {
    params: { id: sessionId },
    body: { allowUncounted: false },
  });
  const applied =
    finalized.status === 200
      ? await callCollectorRoute(db.client, "post", `${SESSIONS_ROUTE}/:id/apply-adjustments`, {
          params: { id: sessionId },
          body: { confirm: true, operationId: `apply-${sector}` },
        })
      : null;
  return { sessionId, items, finalized, applied };
}

describe("STANDARD · contagem", () => {
  it("34. registrar contagem grava pelo motor canônico (ator DEVICE)", async () => {
    const db = fakeDb();
    const opened = await openSession(db);
    const sessionId: string = opened.body.session.id;
    const line = linesOf(db, sessionId).find((l) => l.itemId === ADM_2)!;
    const counted = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count", {
      body: {
        sessionId,
        lineId: line.id,
        countedQuantity: 12,
        expectedVersion: 0,
        operationId: "count-adm-2",
      },
    });
    assert.equal(counted.status, 200, JSON.stringify(counted.body));
    assert.equal(Number(line.countedQuantity), 12);
    assert.equal(line.version, 1);
    assert.equal(db.state.observations.length, 1);
    assert.equal(db.state.movements.length, 0, "contar não movimenta estoque");
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 10, "contar não altera saldo");
  });

  it("35. finalizar e aplicar: implantação por contagem (0 → contado) no setor administrativo", async () => {
    const db = fakeDb();
    const run = await countFinalizeApply(db, "administrativo", {
      [ADM_1]: 4, // sem saldo → +4
      [ADM_2]: 10, // confere
      [ADM_HIST]: 5, // 3 → 5
    });
    assert.equal(run.finalized.status, 200, JSON.stringify(run.finalized.body));
    assert.equal(run.applied!.status, 200, JSON.stringify(run.applied!.body));
    assert.equal(run.applied!.body.movementsCreated, 2);

    assert.equal(db.balanceOf(ADM_1, WH_ADM), 4);
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 10);
    assert.equal(db.balanceOf(ADM_HIST, WH_ADM), 5);
    assert.deepEqual(
      db.state.movements.map((m) => [m.itemId, m.movementType, Number(m.quantity)]).sort(),
      [
        [ADM_1, "POSITIVE_ADJUSTMENT", 4],
        [ADM_HIST, "POSITIVE_ADJUSTMENT", 2],
      ].sort()
    );
    assert.equal(db.state.sessions[0]!.status, "ADJUSTED");
    // Saldo só foi escrito pelo motor de movimentos, nunca pelo Collector.
    for (const stack of db.state.balanceWriteStacks) {
      assert.match(stack, /inventoryService\.server|inventoryRepository\.server/);
      assert.doesNotMatch(stack, /collectorStandardSector\.server/);
    }
  });

  it("36. ajuste negativo passa pelo mesmo motor (setor sem exigência de centro de custo)", async () => {
    const db = fakeDb();
    const run = await countFinalizeApply(db, "embalagens", { [EMB_1]: 15 });
    assert.equal(run.applied!.status, 200, JSON.stringify(run.applied!.body));
    assert.equal(db.balanceOf(EMB_1, WH_OTHER), 15);
    assert.deepEqual(
      db.state.movements.map((m) => [m.movementType, Number(m.quantity)]),
      [["NEGATIVE_ADJUSTMENT", 5]]
    );
  });

  it("37. reaplicar ajustes é idempotente", async () => {
    const db = fakeDb();
    const run = await countFinalizeApply(db, "embalagens", { [EMB_1]: 15 });
    const again = await callCollectorRoute(db.client, "post", `${SESSIONS_ROUTE}/:id/apply-adjustments`, {
      params: { id: run.sessionId },
      body: { confirm: true, operationId: "apply-again" },
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.alreadyApplied, true);
    assert.equal(db.state.movements.length, 1);
    assert.equal(db.balanceOf(EMB_1, WH_OTHER), 15);
  });

  it("38. regra canônica de centro de custo NÃO é contornada: ajuste negativo de ADMINISTRATIVE_SUPPLY", async () => {
    // Limite conhecido do motor de movimentos (não do Collector): saída de
    // ADMINISTRATIVE_SUPPLY — inclusive NEGATIVE_ADJUSTMENT — exige centro de
    // custo, e a conferência não informa um. O motor recusa e nada é gravado.
    const db = fakeDb();
    const run = await countFinalizeApply(db, "administrativo", {
      [ADM_1]: 0,
      [ADM_2]: 7, // 10 → 7
      [ADM_HIST]: 3,
    });
    assert.equal(run.finalized.status, 200, JSON.stringify(run.finalized.body));
    assert.equal(run.applied!.status, 400, JSON.stringify(run.applied!.body));
    assert.equal(run.applied!.body.code, "COST_CENTER_REQUIRED");
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 10, "saldo intacto");
    assert.equal(db.state.movements.length, 0);
  });
});

// ===========================================================================
// 5) Retirada
// ===========================================================================

describe("STANDARD · retirada", () => {
  it("39. sucesso: debita pelo motor, tipo fixo no servidor, almoxarifado do setor", async () => {
    const db = fakeDb();
    const result = await withdraw(db, {});
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body, {
      ok: true,
      idempotent: false,
      item: { code: "ADM-002", description: "ADM-002", unit: "UN" },
      quantity: 4,
      withdrawnBy: "Maria",
    });
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 6);
    const [movement] = db.state.movements;
    assert.equal(movement!.movementType, "REQUISITION_EXIT");
    assert.equal(movement!.sourceWarehouseId, WH_ADM);
    assert.equal(movement!.costCenterId, COST_CENTER);
    assert.equal(movement!.createdByUserId, null);
    assert.match(String(movement!.notes), /Setor Administrativo/);
    const [row] = db.state.withdrawals;
    assert.equal(row!.sector, "ADMINISTRATIVO");
    assert.equal(row!.deviceId, DEVICE_ID);
    assert.equal(row!.warehouseId, WH_ADM);
    assert.equal(row!.movementId, movement!.id);
  });

  it("40. movementType e almoxarifado do corpo não mandam em nada", async () => {
    const db = fakeDb();
    const result = await withdraw(db, { movementType: "MANUAL_ENTRY", warehouseId: WH_ADM });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.state.movements[0]!.movementType, "REQUISITION_EXIT");
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 6, "saiu, não entrou");
  });

  it("41. saldo insuficiente: bloqueado pelo motor, sem número na mensagem, nada gravado", async () => {
    const db = fakeDb();
    const result = await withdraw(db, { quantity: 11 });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, "COLLECTOR_INSUFFICIENT_STOCK");
    assert.equal(result.body.error, COLLECTOR_INSUFFICIENT_STOCK_MESSAGE);
    assert.doesNotMatch(result.body.error, /\d/);
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 10);
    assert.equal(db.state.movements.length, 0);
    assert.equal(db.state.withdrawals.length, 0);
  });

  it("42. item do setor sem saldo: insuficiente, e nenhum saldo é criado", async () => {
    const db = fakeDb();
    const result = await withdraw(db, { itemId: ADM_1, quantity: 1 });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, "COLLECTOR_INSUFFICIENT_STOCK");
    assert.equal(db.balanceOf(ADM_1, WH_ADM), null);
    assert.equal(db.state.movements.length, 0);
  });

  it("43. almoxarifado errado: o do corpo é recusado; item de outro almoxarifado não é elegível", async () => {
    const db = fakeDb();
    const wrongBody = await withdraw(db, { warehouseId: WH_OTHER });
    assert.equal(wrongBody.status, 400, JSON.stringify(wrongBody.body));
    assert.equal(wrongBody.body.code, "WAREHOUSE_NOT_ELIGIBLE");

    const foreignItem = await withdraw(db, { itemId: ADM_OTHER_WH, quantity: 1 });
    assert.equal(foreignItem.status, 404, JSON.stringify(foreignItem.body));
    assert.equal(foreignItem.body.code, COLLECTOR_ITEM_NOT_ELIGIBLE);
    assert.equal(db.balanceOf(ADM_OTHER_WH, WH_OTHER), 8);
    assert.equal(db.state.movements.length, 0);
  });

  it("44. itemType errado, item inativo e item sem controle de estoque são recusados", async () => {
    const db = fakeDb();
    for (const [label, itemId] of [
      ["outro itemType", PPE_1],
      ["inativo", ADM_INACTIVE],
      ["controlsStock=false", ADM_NO_STOCK],
      ["item de outro setor", EMB_1],
      ["inexistente", uuid(999, "9999")],
    ] as const) {
      const result = await withdraw(db, { itemId, quantity: 1, operationId: `w-${label}` });
      assert.equal(result.status, 404, `${label}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.code, COLLECTOR_ITEM_NOT_ELIGIBLE, label);
    }
    assert.equal(db.state.movements.length, 0);
    assert.equal(db.state.withdrawals.length, 0);
  });

  it("45. allowsWithdrawal=false: o servidor bloqueia lista e retirada", async () => {
    const db = fakeDb({ sectors: [{ ...ADMINISTRATIVO, allowsWithdrawal: false }] });
    const result = await withdraw(db, {});
    assert.equal(result.status, 403, JSON.stringify(result.body));
    assert.equal(result.body.code, COLLECTOR_WITHDRAWAL_DENIED);
    const list = await callCollectorRoute(db.client, "get", `${WITHDRAW_ROUTE}/items`, {
      query: { sector: "administrativo" },
    });
    assert.equal(list.status, 403, JSON.stringify(list.body));
    assert.equal(list.body.code, COLLECTOR_WITHDRAWAL_DENIED);
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 10);
    assert.equal(db.state.movements.length, 0);
  });

  it("46. idempotência: mesmo operationId debita uma vez só", async () => {
    const db = fakeDb();
    const first = await withdraw(db, {});
    const second = await withdraw(db, {});
    assert.equal(first.body.idempotent, false);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.idempotent, true);
    assert.equal(second.body.quantity, 4);
    assert.equal(db.state.withdrawals.length, 1);
    assert.equal(db.state.movements.length, 1);
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 6);

    const other = await withdraw(db, { operationId: "w-2", quantity: 1 });
    assert.equal(other.body.idempotent, false);
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 5);
  });

  it("47. centro de custo: exigência do motor intacta; inexistente/inativo recusado", async () => {
    const db = fakeDb();
    const missing = await withdraw(db, { costCenterId: undefined });
    assert.equal(missing.status, 400, JSON.stringify(missing.body));
    assert.equal(missing.body.code, "COST_CENTER_REQUIRED");

    for (const costCenterId of [COST_CENTER_OFF, uuid(998, "9999")]) {
      const invalid = await withdraw(db, { costCenterId });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      assert.equal(invalid.body.code, "COST_CENTER_NOT_FOUND");
    }
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 10);
    assert.equal(db.state.movements.length, 0);
    assert.equal(db.state.withdrawals.length, 0);
  });

  it("48. setor cujo itemType não exige centro de custo retira sem ele", async () => {
    const db = fakeDb();
    const result = await withdraw(db, {
      sector: "embalagens",
      itemId: EMB_1,
      quantity: 5,
      costCenterId: undefined,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.balanceOf(EMB_1, WH_OTHER), 15);
    assert.equal(db.state.withdrawals[0]!.sector, "EMBALAGENS");
  });

  it("49. lista: itens do setor no almoxarifado do setor, sem quantidade, em 2 consultas", async () => {
    const db = fakeDb();
    const sector = await admRef(db);
    db.state.queries.length = 0;
    const items = await listCollectorStandardWithdrawItems(db.client, { sector });
    assert.deepEqual(
      items.map((i) => i.itemId),
      [ADM_1, ADM_2, ADM_HIST]
    );
    for (const item of items) {
      assert.deepEqual(Object.keys(item).sort(), [
        "code",
        "description",
        "itemId",
        "locationCode",
        "locationId",
        "locationName",
        "unit",
      ]);
    }
    assert.deepEqual([...db.state.queries].sort(), [
      "inventoryBalance.findMany",
      "inventoryItem.findMany",
    ]);

    const viaRoute = await callCollectorRoute(db.client, "get", `${WITHDRAW_ROUTE}/items`, {
      query: { sector: "administrativo", q: "adm-002" },
    });
    assert.equal(viaRoute.status, 200, JSON.stringify(viaRoute.body));
    assert.deepEqual(
      viaRoute.body.items.map((i: { itemId: string }) => i.itemId),
      [ADM_2]
    );
  });
});

// ===========================================================================
// 6) allowsCounting = false
// ===========================================================================

describe("STANDARD · allowsCounting=false", () => {
  const S_ADM = uuid(300, "2222");
  function countingOffDb() {
    return fakeDb({
      sectors: [{ ...ADMINISTRATIVO, allowsCounting: false }],
      // Sessão aberta antes de a contagem ser desligada no setor.
      sessions: [{ id: S_ADM, code: "ADM-20260901-001", warehouseId: WH_ADM }],
      lines: [{ sessionId: S_ADM, itemId: ADM_2, warehouseId: WH_ADM, systemQuantity: 10 }],
    });
  }

  it("50. não abre nem consulta sessão", async () => {
    const db = countingOffDb();
    const opened = await openSession(db);
    assert.equal(opened.status, 403, JSON.stringify(opened.body));
    assert.equal(opened.body.code, COLLECTOR_COUNTING_DENIED);
    const active = await callCollectorRoute(db.client, "get", `${SESSIONS_ROUTE}/active`, {
      query: { sector: "administrativo" },
    });
    assert.equal(active.status, 403);
    assert.equal(active.body.code, COLLECTOR_COUNTING_DENIED);
    assert.equal(db.state.sessions.length, 1);
    await assert.rejects(
      async () =>
        createAndStartCollectorStandardSectorSession(db.client, {
          sector: await admRef(db),
          deviceId: DEVICE_ID,
        }),
      codeOf(COLLECTOR_COUNTING_DENIED)
    );
  });

  it("51. contar, finalizar e aplicar são bloqueados no servidor", async () => {
    const db = countingOffDb();
    const line = db.state.lines[0]!;
    const counted = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count", {
      body: {
        sessionId: S_ADM,
        lineId: line.id,
        countedQuantity: 9,
        expectedVersion: 0,
        operationId: "count-off",
      },
    });
    assert.equal(counted.status, 403, JSON.stringify(counted.body));
    assert.equal(counted.body.code, COLLECTOR_COUNTING_DENIED);
    assert.equal(line.countedQuantity, null);

    const finalized = await callCollectorRoute(db.client, "post", `${SESSIONS_ROUTE}/:id/finalize`, {
      params: { id: S_ADM },
      body: {},
    });
    assert.equal(finalized.status, 403);
    assert.equal(finalized.body.code, COLLECTOR_COUNTING_DENIED);

    const applied = await callCollectorRoute(db.client, "post", `${SESSIONS_ROUTE}/:id/apply-adjustments`, {
      params: { id: S_ADM },
      body: { confirm: true, operationId: "apply-off" },
    });
    assert.equal(applied.status, 403);
    assert.equal(applied.body.code, COLLECTOR_COUNTING_DENIED);
    assert.equal(db.state.sessions[0]!.status, "COUNTING");
    assert.equal(db.state.movements.length, 0);
  });

  it("52. contexto segue respondendo, com a capacidade desligada e sem sessão", async () => {
    const db = countingOffDb();
    const context = await callCollectorRoute(db.client, "get", "/api/inventory/collector/context", {
      query: { sector: "administrativo" },
    });
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.equal(context.body.sector.allowsCounting, false);
    assert.equal(context.body.sector.allowsWithdrawal, true);
    assert.equal(context.body.activeSession, null);
  });

  it("53. retirada continua valendo quando só a contagem está desligada", async () => {
    const db = countingOffDb();
    const result = await withdraw(db, {});
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(db.balanceOf(ADM_2, WH_ADM), 6);
  });
});

// ===========================================================================
// 7) Legado intacto e fronteiras do código
// ===========================================================================

describe("STANDARD · legado intacto e fronteiras", () => {
  const ENGINE = "src/lib/inventory/collector/collectorStandardSector.server.ts";
  const RESOLVE = "src/lib/inventory/collector/collectorSectorResolve.server.ts";
  const ROUTES = "src/lib/inventory/collector/collectorRoutes.server.ts";
  const WITHDRAWAL = "src/lib/inventory/collector/collectorWithdrawal.server.ts";

  it("54. rotas do legado não consultam InventoryStockSector", async () => {
    const CP = uuid(400, "2222");
    const db = fakeDb({
      sectors: [],
      items: [{ id: CP, code: "CP-001", itemType: "COMPONENT", productId: "prod-1" }],
      balances: [{ itemId: CP, warehouseId: WH_OTHER, physicalQuantity: 5 }],
    });
    const context = await callCollectorRoute(db.client, "get", "/api/inventory/collector/context", {
      query: { sector: "componentes" },
    });
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.deepEqual(context.body.sector, { code: "COMPONENT", label: "Componentes" });
    const opened = await openSession(db, "componentes");
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.match(opened.body.session.code, /^CP-\d{8}-001$/);
    const line = db.state.lines[0]!;
    const counted = await callCollectorRoute(db.client, "post", "/api/inventory/collector/count", {
      body: {
        sessionId: opened.body.session.id,
        lineId: line.id,
        countedQuantity: 5,
        expectedVersion: 0,
        operationId: "count-cp",
      },
    });
    assert.equal(counted.status, 200, JSON.stringify(counted.body));
    assert.equal(
      db.state.queries.filter((q) => q.startsWith("inventoryStockSector.")).length,
      0
    );
  });

  it("55. retirada do legado segue só de Matéria-prima", async () => {
    const db = fakeDb();
    const result = await withdraw(db, { sector: "componentes", warehouseId: WH_ADM });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, "COLLECTOR_INVALID_SECTOR");
    assert.equal(db.state.movements.length, 0);
  });

  it("56. o motor genérico não tem setor, slug ou itemType fixo", () => {
    for (const file of [ENGINE, RESOLVE]) {
      const code = codeOnly(read(file));
      for (const hardcoded of [/ADMINISTRATIV/i, /"ADM"/, /PACKAGING/, /"PPE"/]) {
        assert.doesNotMatch(code, hardcoded, `${file} não pode conter ${hardcoded}`);
      }
    }
  });

  it("57. o motor genérico não escreve saldo, movimento nem item", () => {
    const code = codeOnly(read(ENGINE));
    assert.doesNotMatch(code, /inventoryBalance\.(create|update|upsert|delete)/);
    assert.doesNotMatch(code, /inventoryMovement\./);
    assert.doesNotMatch(code, /inventoryItem\.(create|update|upsert)/);
    assert.doesNotMatch(code, /materialId|productId/);
    assert.match(code, /inventoryCountLine\.createMany/);
  });

  it("58. as rotas não aceitam strategy nem tipo de movimento do cliente", () => {
    const routes = codeOnly(read(ROUTES));
    assert.doesNotMatch(routes, /body\.strategy|query\.strategy/);
    assert.doesNotMatch(routes, /body\.movementType/);
    assert.doesNotMatch(routes, /body\.itemType|query\.itemType/);
    assert.match(routes, /resolveCollectorSectorRef/);
    const withdrawal = codeOnly(read(WITHDRAWAL));
    assert.match(withdrawal, /COLLECTOR_WITHDRAWAL_MOVEMENT_TYPE = "REQUISITION_EXIT"/);
    assert.equal(
      withdrawal.match(/createInventoryMovementInTx\(/g)?.length,
      1,
      "um único ponto de movimentação para legado e STANDARD"
    );
  });
});
