/**
 * Regularização de almoxarifado padrão — classificação pura, apply com CAS e
 * auditoria, idempotência e reversão. Banco substituído por um dublê em memória.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_WAREHOUSE_REGULARIZATION_AUDIT_ACTION,
  DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM,
  DEFAULT_WAREHOUSE_REGULARIZATION_REVERT_AUDIT_ACTION,
  assertRegularizationApplyRequest,
  executeDefaultWarehouseRegularization,
  formatRegularizationPlanReport,
  planDefaultWarehouseRegularization,
  revertDefaultWarehouseRegularization,
  type RegularizationApplyTx,
  type RegularizationItemSnapshot,
  type RegularizationSectorSnapshot,
  type RegularizationWarehouseSnapshot,
} from "./inventoryItemDefaultWarehouseRegularization.js";

const WH_ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WH_EPI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WH_OFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WH_OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR = { id: "11111111-1111-4111-8111-111111111111", name: "Paulo", isActive: true };

const SECTORS: RegularizationSectorSnapshot[] = [
  {
    sectorId: "5ec70000-0000-4000-8000-000000000001",
    sectorCode: "ADMINISTRATIVO",
    sectorName: "Administrativo",
    itemType: "ADMINISTRATIVE_SUPPLY",
    warehouseId: WH_ADM,
    warehouseCode: "ADMINISTRATIVO",
    warehouseName: "Estoque administrativo",
  },
  {
    sectorId: "5ec70000-0000-4000-8000-000000000002",
    sectorCode: "EPI",
    sectorName: "EPI",
    itemType: "PPE",
    warehouseId: WH_EPI,
    warehouseCode: "EPI",
    warehouseName: "EPI",
  },
  {
    sectorId: "5ec70000-0000-4000-8000-000000000003",
    sectorCode: "MANUT",
    sectorName: "Manutenção",
    itemType: "MAINTENANCE",
    warehouseId: WH_OFF,
    warehouseCode: "MANUT-OFF",
    warehouseName: "Manutenção (desativado)",
  },
];

const WAREHOUSES = new Map<string, RegularizationWarehouseSnapshot>([
  [WH_ADM, { id: WH_ADM, code: "ADMINISTRATIVO", status: "ACTIVE", allowsMovements: true }],
  [WH_EPI, { id: WH_EPI, code: "EPI", status: "ACTIVE", allowsMovements: true }],
  [WH_OFF, { id: WH_OFF, code: "MANUT-OFF", status: "INACTIVE", allowsMovements: true }],
  [WH_OTHER, { id: WH_OTHER, code: "OUTRO", status: "ACTIVE", allowsMovements: true }],
]);

let seq = 0;
function item(over: Partial<RegularizationItemSnapshot> & { code: string }): RegularizationItemSnapshot {
  seq += 1;
  return {
    id: `${seq.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    description: over.code,
    itemType: "ADMINISTRATIVE_SUPPLY",
    status: "ACTIVE",
    controlsStock: true,
    materialId: null,
    productId: null,
    defaultWarehouseId: null,
    defaultLocationId: null,
    createdAt: "2026-10-13T12:00:00.000Z",
    balanceWarehouseIds: [],
    activeReservationWarehouseIds: [],
    activeBlockWarehouseIds: [],
    ...over,
  };
}

/** Os 15 códigos do caso real (ADM-PAP-100, ADM-MOB-013..017, ADM-FIX-096..099, ADM-INF-037..041). */
const REAL_CODES = [
  "ADM-PAP-100",
  ...[13, 14, 15, 16, 17].map((n) => `ADM-MOB-0${n}`),
  ...[96, 97, 98, 99].map((n) => `ADM-FIX-0${n}`),
  ...[37, 38, 39, 40, 41].map((n) => `ADM-INF-0${n}`),
];

function realItems(): RegularizationItemSnapshot[] {
  return REAL_CODES.map((code) => item({ code }));
}

/** Banco em memória: CAS de verdade sobre o snapshot + trilha de auditoria. */
function memoryTx(items: RegularizationItemSnapshot[]) {
  const audits: Array<Parameters<RegularizationApplyTx["writeAudit"]>[0]> = [];
  const tx = {
    setDefaultWarehouseIfUnset: async (itemId: string, warehouseId: string) => {
      const row = items.find((i) => i.id === itemId);
      if (!row || row.defaultWarehouseId || row.status !== "ACTIVE" || !row.controlsStock) return false;
      row.defaultWarehouseId = warehouseId;
      return true;
    },
    clearDefaultWarehouseIfEquals: async (itemId: string, warehouseId: string) => {
      const row = items.find((i) => i.id === itemId);
      if (!row || row.defaultWarehouseId !== warehouseId) return false;
      row.defaultWarehouseId = null;
      return true;
    },
    writeAudit: async (a: Parameters<RegularizationApplyTx["writeAudit"]>[0]) => {
      audits.push(a);
    },
  };
  return { tx, audits };
}

function plan(items: RegularizationItemSnapshot[], filters?: { itemTypes?: ("ADMINISTRATIVE_SUPPLY" | "PPE")[]; codes?: string[] }) {
  return planDefaultWarehouseRegularization({
    items,
    activeStandardSectors: SECTORS,
    warehousesById: WAREHOUSES,
    filters,
    now: new Date("2026-10-20T12:00:00Z"),
  });
}

describe("regularização · classificação (dry-run)", () => {
  it("6. os 15 itens do caso real: elegíveis para ADMINISTRATIVO, saldo zero, sem criar nada", () => {
    const p = plan(realItems());
    assert.equal(p.eligibleCount, 15);
    for (const line of p.lines) {
      assert.equal(line.classification, "ELIGIBLE", line.code);
      assert.equal(line.targetWarehouseId, WH_ADM);
      assert.equal(line.sectorCode, "ADMINISTRATIVO");
      assert.equal(line.hasBalanceInTarget, false);
    }
    assert.deepEqual(p.byItemType, { ADMINISTRATIVE_SUPPLY: { ELIGIBLE: 15 } });
    const report = formatRegularizationPlanReport(p);
    assert.match(report, /SERIAM alterados \(ELIGIBLE\): 15/);
    assert.match(report, /ADM-INF-037/);
    assert.match(report, /Nenhum saldo, movimento, sessão ou linha de conferência/);
  });

  it("critérios verificáveis: inativo, sem controle de estoque ou já com padrão nunca entram", () => {
    const p = plan([
      item({ code: "A", status: "INACTIVE" }),
      item({ code: "B", controlsStock: false }),
      item({ code: "C", defaultWarehouseId: WH_ADM }),
    ]);
    assert.equal(p.eligibleCount, 0);
    assert.ok(p.lines.every((l) => l.classification === "NOT_IN_SCOPE"));
  });

  it("14-16/18. MP (ou qualquer item com materialId), componente e produto acabado ficam de fora", () => {
    const p = plan([
      item({ code: "MP", itemType: "RAW_MATERIAL" }),
      item({ code: "ADM-LINKED", materialId: "22222222-2222-4222-8222-222222222222" }),
      item({ code: "CP", itemType: "COMPONENT", productId: "33333333-3333-4333-8333-333333333333" }),
      item({ code: "PA", itemType: "FINISHED_PRODUCT" }),
    ]);
    assert.equal(p.eligibleCount, 0);
    assert.deepEqual(
      p.lines.map((l) => l.classification),
      ["OFFICIAL_LINK", "OFFICIAL_LINK", "PRESENCE_TYPE", "PRESENCE_TYPE"]
    );
  });

  it("17. EPI vai para o setor de EPI; tipo sem setor fica como NO_SECTOR (cadastro em preparação)", () => {
    const p = plan([
      item({ code: "EPI-1", itemType: "PPE" }),
      item({ code: "FER-1", itemType: "TOOLING" }),
      item({ code: "EMB-1", itemType: "PACKAGING" }),
    ]);
    const [epi, tooling, packaging] = p.lines;
    assert.equal(epi.classification, "ELIGIBLE");
    assert.equal(epi.targetWarehouseId, WH_EPI);
    assert.equal(tooling.classification, "NO_SECTOR");
    assert.equal(packaging.classification, "NO_SECTOR");
    assert.deepEqual(p.byItemType, {
      PPE: { ELIGIBLE: 1 },
      TOOLING: { NO_SECTOR: 1 },
      PACKAGING: { NO_SECTOR: 1 },
    });
  });

  it("conflitos: saldo/reserva/bloqueio em outro almoxarifado e alvo inválido não são tocados", () => {
    const p = plan([
      item({ code: "SALDO-OUTRO", balanceWarehouseIds: [WH_OTHER] }),
      item({ code: "RESERVA-OUTRO", activeReservationWarehouseIds: [WH_OTHER] }),
      item({ code: "BLOQUEIO-OUTRO", activeBlockWarehouseIds: [WH_OTHER] }),
      item({ code: "SALDO-ALVO", balanceWarehouseIds: [WH_ADM] }),
      item({ code: "MANUT-1", itemType: "MAINTENANCE" }),
    ]);
    assert.deepEqual(
      p.lines.map((l) => [l.code, l.classification]),
      [
        ["SALDO-OUTRO", "CONFLICT_LINKED_ELSEWHERE"],
        ["RESERVA-OUTRO", "CONFLICT_LINKED_ELSEWHERE"],
        ["BLOQUEIO-OUTRO", "CONFLICT_LINKED_ELSEWHERE"],
        ["SALDO-ALVO", "ELIGIBLE"],
        ["MANUT-1", "TARGET_WAREHOUSE_INVALID"],
      ]
    );
    assert.equal(p.lines[3].hasBalanceInTarget, true);
  });

  it("dois setores ativos para o mesmo tipo: escolha manual, nada automático", () => {
    const p = planDefaultWarehouseRegularization({
      items: [item({ code: "X" })],
      activeStandardSectors: [SECTORS[0], { ...SECTORS[0], sectorId: "5ec70000-0000-4000-8000-000000000009", sectorCode: "ADM-2", warehouseId: WH_OTHER, warehouseCode: "OUTRO" }],
      warehousesById: WAREHOUSES,
    });
    assert.equal(p.lines[0].classification, "AMBIGUOUS_SECTOR");
  });

  it("filtros por tipo e por código limitam o apply sem esconder o diagnóstico", () => {
    const items = [...realItems(), item({ code: "EPI-1", itemType: "PPE" })];
    const byType = plan(items, { itemTypes: ["ADMINISTRATIVE_SUPPLY"] });
    assert.equal(byType.eligibleCount, 15);
    assert.equal(byType.lines.find((l) => l.code === "EPI-1")?.classification, "NOT_SELECTED");
    const byCode = plan(items, { codes: ["adm-inf-037", "ADM-INF-038"] });
    assert.equal(byCode.eligibleCount, 2);
    assert.deepEqual(byCode.filters.codes, ["ADM-INF-037", "ADM-INF-038"]);
    assert.equal(Object.keys(byCode.byItemType).length, 2, "diagnóstico continua cobrindo todos os tipos");
  });
});

describe("regularização · apply / idempotência / reversão", () => {
  it("20. apply grava só os elegíveis, com auditoria before/after por item", async () => {
    const items = [...realItems(), item({ code: "CP", itemType: "COMPONENT" })];
    const { tx, audits } = memoryTx(items);
    const result = await executeDefaultWarehouseRegularization({ plan: plan(items), actor: ACTOR, tx });
    assert.equal(result.applied, 15);
    assert.equal(result.skippedAlreadySet, 0);
    assert.equal(result.notEligible, 1);
    assert.ok(items.filter((i) => i.itemType === "ADMINISTRATIVE_SUPPLY").every((i) => i.defaultWarehouseId === WH_ADM));
    assert.equal(items.find((i) => i.code === "CP")?.defaultWarehouseId, null);
    assert.equal(audits.length, 15);
    assert.equal(audits[0].action, DEFAULT_WAREHOUSE_REGULARIZATION_AUDIT_ACTION);
    assert.deepEqual(audits[0].beforeJson, { code: "ADM-PAP-100", defaultWarehouseId: null });
    assert.deepEqual(audits[0].afterJson, { code: "ADM-PAP-100", defaultWarehouseId: WH_ADM });
    assert.equal(audits[0].userId, ACTOR.id);
    assert.match(audits[0].reason, /conferência do setor/);
  });

  it("13. repetir não duplica nem sobrescreve: segunda rodada não encontra nada elegível", async () => {
    const items = realItems();
    const { tx, audits } = memoryTx(items);
    await executeDefaultWarehouseRegularization({ plan: plan(items), actor: ACTOR, tx });
    // Nova prévia sobre o estado já regularizado: tudo fora de escopo.
    const second = plan(items);
    assert.equal(second.eligibleCount, 0);
    const result = await executeDefaultWarehouseRegularization({ plan: second, actor: ACTOR, tx });
    assert.equal(result.applied, 0);
    assert.equal(audits.length, 15);
  });

  it("CAS: item alterado entre a prévia e o apply é pulado (sem sobrescrever) e sem auditoria", async () => {
    const items = realItems();
    const stale = plan(items);
    items[0].defaultWarehouseId = WH_OTHER; // alguém ajustou à mão depois da prévia
    const { tx, audits } = memoryTx(items);
    const result = await executeDefaultWarehouseRegularization({ plan: stale, actor: ACTOR, tx });
    assert.equal(result.applied, 14);
    assert.equal(result.skippedAlreadySet, 1);
    assert.equal(items[0].defaultWarehouseId, WH_OTHER);
    assert.equal(audits.length, 14);
    assert.equal(result.lines[0].finalAction, "SKIPPED_ALREADY_SET");
  });

  it("apply exige confirmação e responsável ativo", async () => {
    assert.throws(() => assertRegularizationApplyRequest({ confirm: "x", actorUserId: ACTOR.id }), /confirm=/);
    assert.throws(
      () => assertRegularizationApplyRequest({ confirm: DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM, actorUserId: "abc" }),
      /actorUserId/
    );
    assertRegularizationApplyRequest({ confirm: DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM, actorUserId: ACTOR.id });
    const items = realItems();
    const { tx } = memoryTx(items);
    await assert.rejects(
      executeDefaultWarehouseRegularization({ plan: plan(items), actor: { ...ACTOR, isActive: false }, tx }),
      /inativo/
    );
    assert.ok(items.every((i) => i.defaultWarehouseId === null));
  });

  it("reversão: desfaz só o que ainda está como foi gravado, com auditoria", async () => {
    const items = realItems();
    const { tx, audits } = memoryTx(items);
    const applied = await executeDefaultWarehouseRegularization({ plan: plan(items), actor: ACTOR, tx });
    items[1].defaultWarehouseId = WH_OTHER; // mudou depois do apply: não é revertido
    const reverted = await revertDefaultWarehouseRegularization({ applyResult: applied, actor: ACTOR, tx });
    assert.equal(reverted.reverted, 14);
    assert.equal(reverted.skippedChanged, 1);
    assert.equal(items[0].defaultWarehouseId, null);
    assert.equal(items[1].defaultWarehouseId, WH_OTHER);
    assert.equal(audits.filter((a) => a.action === DEFAULT_WAREHOUSE_REGULARIZATION_REVERT_AUDIT_ACTION).length, 14);
  });

  it("o CLI só escreve InventoryItem.defaultWarehouseId e InventoryAuditLog", () => {
    const src = readFileSync(join(process.cwd(), "scripts/regularizeInventoryItemDefaultWarehouse.ts"), "utf8");
    assert.doesNotMatch(src, /inventoryBalance\.(create|update|upsert|delete)/);
    assert.doesNotMatch(src, /inventoryMovement\.|inventoryCountSession\.(create|update)|inventoryCountLine\./);
    assert.doesNotMatch(src, /material\.|product\./);
    assert.match(src, /defaultWarehouseId: null, status: "ACTIVE", controlsStock: true/, "CAS no updateMany");
    assert.match(src, /\$transaction/);
    assert.match(src, /--revert/);
  });
});
