/**
 * OP-10 — consistência temporal da conferência física.
 *
 * O ajuste não pode ser derivado da fotografia tirada no START da sessão:
 * movimentações legítimas entre o START e a contagem, e entre a contagem e o
 * ajuste, precisam sobreviver. A autoridade é o `adjustmentDelta` da
 * InventoryCountObservation, medido contra o saldo materializado sob lock.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { recordInventoryCount } from "./inventoryCountApplicationService.server.js";
import {
  COUNT_ADJUSTMENT_BASIS,
  computeObservationDelta,
  resolveCountAdjustmentBasis,
} from "./inventoryCountObservation.js";
import {
  INVENTORY_COUNT_LEGACY_BASIS_EVENT,
  buildLegacyCountBasisEvent,
} from "./inventoryCountTelemetry.js";
import {
  generateInventoryCountAdjustments,
  updateInventoryCountLine,
} from "./inventoryCountService.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// ---------------------------------------------------------------------------
// Motor puro
// ---------------------------------------------------------------------------

describe("OP-10 computeObservationDelta", () => {
  it("delta = contado − esperado (saldo sob lock)", () => {
    assert.equal(computeObservationDelta(80, 78), -2);
    assert.equal(computeObservationDelta(80, 80), 0);
    assert.equal(computeObservationDelta(80, 91), 11);
  });

  it("preserva a precisão Decimal(20,6) do Inventory", () => {
    assert.equal(computeObservationDelta(10.000001, 10.000002), 0.000001);
    assert.equal(computeObservationDelta(0.1 + 0.2, 0.3), 0);
  });
});

describe("OP-10 resolveCountAdjustmentBasis", () => {
  it("com Observation vigente a base é OBSERVATION", () => {
    const resolved = resolveCountAdjustmentBasis({
      systemQuantity: new Prisma.Decimal(100),
      countedQuantity: new Prisma.Decimal(78),
      differenceQuantity: new Prisma.Decimal(-22),
      currentObservation: { adjustmentDelta: new Prisma.Decimal(-2) },
    });
    assert.equal(resolved.basis, COUNT_ADJUSTMENT_BASIS.observation);
    // -2 (contra o saldo real) e não -22 (contra a foto do START).
    assert.equal(resolved.delta, -2);
  });

  it("sem Observation cai no legado (diferença contra a foto do START)", () => {
    const resolved = resolveCountAdjustmentBasis({
      systemQuantity: new Prisma.Decimal(100),
      countedQuantity: new Prisma.Decimal(97),
      differenceQuantity: new Prisma.Decimal(-3),
      currentObservation: null,
    });
    assert.equal(resolved.basis, COUNT_ADJUSTMENT_BASIS.legacy);
    assert.equal(resolved.delta, -3);
  });

  it("legado sem differenceQuantity recalcula pelo systemQuantity", () => {
    const resolved = resolveCountAdjustmentBasis({
      systemQuantity: new Prisma.Decimal(10),
      countedQuantity: new Prisma.Decimal(12),
    });
    assert.equal(resolved.basis, COUNT_ADJUSTMENT_BASIS.legacy);
    assert.equal(resolved.delta, 2);
  });

  it("linha não contada não produz ajuste", () => {
    const resolved = resolveCountAdjustmentBasis({
      systemQuantity: new Prisma.Decimal(10),
    });
    assert.equal(resolved.basis, COUNT_ADJUSTMENT_BASIS.notCounted);
    assert.equal(resolved.delta, 0);
  });

  it("delta zero da Observation não vira fallback legado", () => {
    const resolved = resolveCountAdjustmentBasis({
      systemQuantity: new Prisma.Decimal(100),
      countedQuantity: new Prisma.Decimal(80),
      differenceQuantity: new Prisma.Decimal(-20),
      currentObservation: { adjustmentDelta: new Prisma.Decimal(0) },
    });
    assert.equal(resolved.basis, COUNT_ADJUSTMENT_BASIS.observation);
    assert.equal(resolved.delta, 0);
  });
});

describe("OP-10 telemetria do fallback", () => {
  it("evento identificável sem dado sensível", () => {
    const event = buildLegacyCountBasisEvent({
      sessionId: "sess-1",
      sessionCode: "CF-LEGACY",
      lineId: "line-1",
      itemId: "item-1",
      warehouseId: "wh-1",
    });
    assert.equal(event.event, INVENTORY_COUNT_LEGACY_BASIS_EVENT);
    assert.equal(event.basis, "LEGACY_SYSTEM_QUANTITY");
    assert.equal(event.sessionCode, "CF-LEGACY");
    const keys = Object.keys(event).sort();
    assert.deepEqual(keys, [
      "basis",
      "event",
      "itemId",
      "lineId",
      "sessionCode",
      "sessionId",
      "warehouseId",
    ]);
  });
});

// ---------------------------------------------------------------------------
// recordCount — serviço de aplicação canônico
// ---------------------------------------------------------------------------

describe("OP-10 recordInventoryCount", () => {
  it("PASSO 11 — movimento ANTES da contagem: delta 0, nenhum ajuste", async () => {
    // START fotografou 100; um movimento de −20 já rebaixou o saldo para 80.
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    const { observation } = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 80, justification: "Contagem" },
      { userId: "user-1" }
    );

    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.countedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), 0);

    state.sessions[0].status = "APPROVED";
    const result = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    // O −20 legítimo NÃO é reaplicado como ajuste.
    assert.equal(result.movementsCreated, 0);
    assert.equal(state.movements.length, 0);
  });

  it("PASSO 12 — movimento DEPOIS da contagem: ajuste continua −5", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    const { observation } = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 95, justification: "Falta" },
      { userId: "user-1" }
    );
    assert.equal(Number(observation.expectedQuantity), 100);
    assert.equal(Number(observation.adjustmentDelta), -5);

    // Saída legítima de 20 depois da contagem.
    state.balances[0].physicalQuantity = new Prisma.Decimal(80);
    state.sessions[0].status = "APPROVED";

    await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(state.movements.length, 1);
    assert.equal(state.movements[0].movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(state.movements[0].quantity), 5);
  });

  it("PASSO 13 — entrada positiva depois da contagem não é removida", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 80)],
    });

    const { observation } = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 80 },
      { userId: "user-1" }
    );
    assert.equal(Number(observation.adjustmentDelta), 0);

    // +10 legítimo depois da contagem.
    state.balances[0].physicalQuantity = new Prisma.Decimal(90);
    state.sessions[0].status = "APPROVED";

    const result = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(result.movementsCreated, 0);
    assert.equal(Number(state.balances[0].physicalQuantity), 90);
  });

  it("PASSO 14 — vários movimentos depois: delta permanece −3", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 97, justification: "Falta" },
      { userId: "user-1" }
    );

    // −20, +50, −7 depois da contagem: 100 → 123.
    for (const qty of [80, 130, 123]) {
      state.balances[0].physicalQuantity = new Prisma.Decimal(qty);
    }
    state.sessions[0].status = "APPROVED";

    await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(state.movements.length, 1);
    assert.equal(Number(state.movements[0].quantity), 3);
    assert.equal(state.movements[0].movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(state.observations[0].adjustmentDelta), -3);
  });

  it("PASSO 15 — datas retroativas não influenciam expected/delta", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    // Movimento com movementDate retroativo e createdAt futuro no ledger.
    state.movements.push({
      id: "mov-retro",
      itemId: "item-1",
      movementType: "MANUAL_EXIT",
      quantity: new Prisma.Decimal(20),
      movementDate: new Date("2020-01-01T00:00:00.000Z"),
      createdAt: new Date("2099-01-01T00:00:00.000Z"),
      originType: "MANUAL",
    });
    state.balances[0].lastMovementAt = new Date("2099-12-31T00:00:00.000Z");

    const { observation } = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 80, justification: "Contagem" },
      { userId: "user-1" }
    );
    // Só o saldo materializado importa.
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), 0);

    // Garantia estrutural: o serviço não LÊ timestamps para decidir o delta —
    // só o saldo materializado sob lock.
    const src = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    assert.doesNotMatch(src, /\.movementDate/);
    assert.doesNotMatch(src, /\.lastMovementAt/);
    assert.doesNotMatch(src, /\.createdAt/);
    assert.doesNotMatch(src, /inventoryMovement\./);
    assert.match(src, /getOrCreateInventoryBalanceForUpdate/);
    assert.match(src, /balance\.physicalQuantity/);
  });

  it("PASSO 10 — recontagem cria nova Observation e só a vigente vale", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    const first = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 95, justification: "Falta" },
      { userId: "user-1" }
    );
    assert.equal(Number(first.observation.adjustmentDelta), -5);

    // −10 legítimo entre as duas contagens.
    state.balances[0].physicalQuantity = new Prisma.Decimal(90);

    const second = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 88, justification: "Recontagem" },
      { userId: "user-1" }
    );
    assert.equal(Number(second.observation.expectedQuantity), 90);
    assert.equal(Number(second.observation.adjustmentDelta), -2);

    // Append-only: Obs1 permanece intacta.
    assert.equal(state.observations.length, 2);
    assert.equal(Number(state.observations[0].adjustmentDelta), -5);
    assert.equal(state.lines[0].currentObservationId, second.observation.id);

    state.sessions[0].status = "APPROVED";
    await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    // Usa apenas −2; deltas históricos não são somados.
    assert.equal(state.movements.length, 1);
    assert.equal(Number(state.movements[0].quantity), 2);
  });

  it("PASSO 5 — systemQuantity continua sendo a foto do START", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 78, justification: "Falta" },
      { userId: "user-1" }
    );

    assert.equal(Number(state.lines[0].systemQuantity), 100);
    assert.equal(Number(state.lines[0].countedQuantity), 78);
    assert.equal(Number(state.observations[0].expectedQuantity), 80);
    assert.equal(Number(state.observations[0].adjustmentDelta), -2);
  });

  it("PASSO 6 — differenceQuantity segue medindo contra a foto do START", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 78, justification: "Falta" },
      { userId: "user-1" }
    );

    // Compatibilidade visual/histórica: 78 − 100.
    assert.equal(Number(state.lines[0].differenceQuantity), -22);
    assert.equal(Number(state.lines[0].differencePercent), -22);
    // Mas a autoridade do ajuste é a Observation.
    assert.equal(Number(state.observations[0].adjustmentDelta), -2);
  });

  it("PASSO 21 — Observation registra o usuário humano e actorType USER", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 10 },
      { userId: "user-42" }
    );

    assert.equal(state.observations[0].userId, "user-42");
    assert.equal(state.observations[0].actorType, "USER");
    assert.equal(state.observations[0].deviceId, null);
    assert.equal(state.observations[0].operationId, null);
  });

  it("PASSO 19 — version é incrementada sem exigir expectedVersion", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 10 },
      { userId: "user-1" }
    );
    assert.equal(state.lines[0].version, 1);

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 9, justification: "Recontagem" },
      { userId: "user-1" }
    );
    assert.equal(state.lines[0].version, 2);
  });

  it("Decimal — delta de 1e-6 sobrevive à contagem", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10.000001)],
      lines: [countLine("line-1", "sess-1", 10.000001)],
    });

    await recordInventoryCount(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 10.000002,
        justification: "Aferição",
      },
      { userId: "user-1" }
    );
    assert.equal(Number(state.observations[0].adjustmentDelta), 0.000001);
  });
});

// ---------------------------------------------------------------------------
// generate-adjustments — fallback legado
// ---------------------------------------------------------------------------

describe("OP-10 generate-adjustments", () => {
  it("PASSO 7 — sessão legada mantém a semântica anterior e emite telemetria", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [
        {
          ...countLine("line-1", "sess-1", 100),
          countedQuantity: new Prisma.Decimal(97),
          differenceQuantity: new Prisma.Decimal(-3),
          justification: "Falta antiga",
        },
      ],
    });
    state.sessions[0].status = "APPROVED";
    state.sessions[0].code = "CF-LEGACY";

    const logs = captureWarnings();
    try {
      await generateInventoryCountAdjustments(prisma as never, "sess-1", {
        userId: "user-1",
        permissions: ["inventory.manage"],
      });
    } finally {
      logs.restore();
    }

    assert.equal(state.movements.length, 1);
    assert.equal(Number(state.movements[0].quantity), 3);
    const legacyLog = logs.lines.find((l) => l.includes(INVENTORY_COUNT_LEGACY_BASIS_EVENT));
    assert.ok(legacyLog, "fallback legado precisa ser observável");
    assert.match(legacyLog, /CF-LEGACY/);
    assert.match(legacyLog, /LEGACY_SYSTEM_QUANTITY/);
  });

  it("PASSO 7 — linha com Observation não emite telemetria de fallback", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 97, justification: "Falta" },
      { userId: "user-1" }
    );
    state.sessions[0].status = "APPROVED";

    const logs = captureWarnings();
    try {
      await generateInventoryCountAdjustments(prisma as never, "sess-1", {
        userId: "user-1",
        permissions: ["inventory.manage"],
      });
    } finally {
      logs.restore();
    }

    assert.equal(
      logs.lines.filter((l) => l.includes(INVENTORY_COUNT_LEGACY_BASIS_EVENT)).length,
      0
    );
  });

  it("PASSO 9 — linha sem contagem e sem Observation não gera ajuste", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    state.sessions[0].status = "APPROVED";

    const result = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(result.movementsCreated, 0);
    assert.equal(state.movements.length, 0);
  });

  it("não reescreve histórico: nenhuma Observation sintética para linha legada", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [
        {
          ...countLine("line-1", "sess-1", 100),
          countedQuantity: new Prisma.Decimal(97),
          differenceQuantity: new Prisma.Decimal(-3),
          justification: "Falta antiga",
        },
      ],
    });
    state.sessions[0].status = "APPROVED";

    const logs = captureWarnings();
    try {
      await generateInventoryCountAdjustments(prisma as never, "sess-1", {
        userId: "user-1",
        permissions: ["inventory.manage"],
      });
    } finally {
      logs.restore();
    }

    assert.equal(state.observations.length, 0);
    assert.equal(state.lines[0].currentObservationId ?? null, null);
  });
});

// ---------------------------------------------------------------------------
// PASSO 26 — regressão do contrato HTTP humano
// ---------------------------------------------------------------------------

describe("OP-10 regressão do contrato humano", () => {
  it("PATCH normal: payload antigo (sem operationId/version/device) continua válido", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });

    const line = await updateInventoryCountLine(
      prisma as never,
      "sess-1",
      "line-1",
      { countedQuantity: 12, justification: "Sobra física" },
      { userId: "user-1" }
    );
    assert.equal(Number(line.countedQuantity), 12);
    assert.equal(Number(state.lines[0].differenceQuantity), 2);
    assert.ok(state.lines[0].currentObservationId);
  });

  it("validation error: divergência sem justificativa continua JUSTIFICATION_REQUIRED", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    await assert.rejects(
      () =>
        updateInventoryCountLine(
          prisma as never,
          "sess-1",
          "line-1",
          { countedQuantity: 8, justification: null },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );
  });

  it("session state error: fora de COUNTING continua SESSION_LOCKED", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    state.sessions[0].status = "WAITING_APPROVAL";
    await assert.rejects(
      () =>
        updateInventoryCountLine(
          prisma as never,
          "sess-1",
          "line-1",
          { countedQuantity: 8, justification: "x" },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "SESSION_LOCKED"
    );
  });

  it("linha de outra sessão continua LINE_NOT_FOUND", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-outra", 10)],
    });
    await assert.rejects(
      () =>
        updateInventoryCountLine(
          prisma as never,
          "sess-1",
          "line-1",
          { countedQuantity: 8, justification: "x" },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "LINE_NOT_FOUND"
    );
  });

  it("linha já ajustada continua ADJUSTMENT_EXISTS", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [{ ...countLine("line-1", "sess-1", 10), generatedMovementId: "mov-1" }],
    });
    await assert.rejects(
      () =>
        updateInventoryCountLine(
          prisma as never,
          "sess-1",
          "line-1",
          { countedQuantity: 8, justification: "x" },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "ADJUSTMENT_EXISTS"
    );
  });

  it("rota humana entra pelo serviço de aplicação canônico", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /recordInventoryCount/);
    assert.match(routes, /count-sessions\/:id\/lines\/:lineId/);
    // Contrato preservado: nada de campo novo obrigatório vindo do frontend.
    assert.doesNotMatch(routes, /expectedVersion/);

    const service = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    const legacy = read("src/lib/inventory/inventoryCountService.server.ts");
    // Uma única implementação: o serviço antigo delega.
    assert.match(legacy, /recordInventoryCount/);
    assert.doesNotMatch(legacy, /inventoryCountObservation\.create/);
    assert.match(service, /inventoryCountObservation\.create/);
    // recordCount nunca escreve saldo.
    assert.doesNotMatch(service, /inventoryBalance\.update/);
    assert.doesNotMatch(service, /persistInventoryBalanceSnapshot/);
    // Transação única.
    assert.match(service, /prisma\.\$transaction/);
  });
});

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function captureWarnings() {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.warn = original;
    },
  };
}

type MockBalance = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  balanceKey: string;
  physicalQuantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
  blockedQuantity: Prisma.Decimal;
  quarantineQuantity: Prisma.Decimal;
  availableQuantity: Prisma.Decimal;
  lastMovementAt?: Date | null;
  item: { status: string };
};

type MockLine = {
  id: string;
  sessionId: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  systemQuantity: Prisma.Decimal;
  countedQuantity?: Prisma.Decimal | null;
  differenceQuantity?: Prisma.Decimal | null;
  differencePercent?: Prisma.Decimal | null;
  justification?: string | null;
  generatedMovementId?: string | null;
  version?: number;
  currentObservationId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type MockObservation = Record<string, unknown> & { id: string; lineId: string };

type MockSession = Record<string, unknown> & { id: string; status: string; code: string };

function balanceRow(itemId: string, warehouseId: string, qty: number): MockBalance {
  return {
    id: `bal-${itemId}`,
    itemId,
    warehouseId,
    locationId: null,
    balanceKey: warehouseId,
    physicalQuantity: new Prisma.Decimal(qty),
    reservedQuantity: new Prisma.Decimal(0),
    blockedQuantity: new Prisma.Decimal(0),
    quarantineQuantity: new Prisma.Decimal(0),
    availableQuantity: new Prisma.Decimal(qty),
    lastMovementAt: null,
    item: { status: "ACTIVE" },
  };
}

function countLine(id: string, sessionId: string, systemQty: number): MockLine {
  return {
    id,
    sessionId,
    itemId: "item-1",
    warehouseId: "wh-1",
    locationId: null,
    systemQuantity: new Prisma.Decimal(systemQty),
    version: 0,
    currentObservationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createTemporalMockPrisma(options?: { balances?: MockBalance[]; lines?: MockLine[] }) {
  const state = {
    balances: [...(options?.balances ?? [])],
    lines: [...(options?.lines ?? [])],
    observations: [] as MockObservation[],
    sessions: [
      {
        id: "sess-1",
        code: "CF-TEMPORAL",
        warehouseId: "wh-1",
        status: "COUNTING",
        responsibleUserId: "user-1",
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MockSession,
    ],
    movements: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
  };

  const item = {
    id: "item-1",
    status: "ACTIVE" as const,
    itemType: "RAW_MATERIAL" as const,
    unit: "UN",
    controlsStock: true,
    allowsReservation: true,
    allowsBlock: true,
    controlsLocation: false,
    materialId: null as string | null,
    materialCodeSnapshot: null as string | null,
    materialDescriptionSnapshot: null as string | null,
    lastKnownCost: null as unknown,
    averageCost: null as unknown,
  };

  const tx = {
    inventoryItem: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ ...item, id: where.id }),
    },
    inventoryWarehouse: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "ACTIVE" as const,
        allowsMovements: true,
      }),
    },
    inventoryBalance: {
      findUnique: async ({
        where,
      }: {
        where: { itemId_balanceKey?: { itemId: string; balanceKey: string }; id?: string };
      }) => {
        if (where.id) return state.balances.find((b) => b.id === where.id) ?? null;
        if (where.itemId_balanceKey) {
          const key = where.itemId_balanceKey;
          return (
            state.balances.find(
              (b) => b.itemId === key.itemId && b.balanceKey === key.balanceKey
            ) ?? null
          );
        }
        return null;
      },
      findMany: async ({ where }: { where: { warehouseId?: string } }) =>
        state.balances.filter((b) => !where.warehouseId || b.warehouseId === where.warehouseId),
      create: async ({ data }: { data: MockBalance }) => {
        const row = { ...data, id: data.id ?? `bal-${state.balances.length + 1}` };
        state.balances.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<MockBalance> }) => {
        const idx = state.balances.findIndex((b) => b.id === where.id);
        state.balances[idx] = { ...state.balances[idx], ...data };
        return state.balances[idx];
      },
    },
    inventoryMovement: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.movements.find((m) => {
          if (where.originId && m.originId === where.originId) return true;
          if (where.idempotencyKey && m.idempotencyKey === where.idempotencyKey) return true;
          return false;
        }) ?? null,
      findMany: async () => [...state.movements],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mov-${state.movements.length + 1}`, ...data };
        state.movements.push(row);
        return row;
      },
    },
    inventoryReservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "res-1", ...data }),
      findUnique: async () => null,
      update: async () => ({}),
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
    inventoryCountSession: {
      count: async () => state.sessions.length,
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.sessions.find((s) => s.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.sessions.findIndex((s) => s.id === where.id);
        state.sessions[idx] = { ...state.sessions[idx], ...data } as MockSession;
        return state.sessions[idx];
      },
    },
    inventoryCountObservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: MockObservation = {
          ...data,
          id: `obs-${state.observations.length + 1}`,
          lineId: String(data.lineId),
          observedAt: new Date(),
          createdAt: new Date(),
        };
        state.observations.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { lineId?: string } }) =>
        state.observations.filter((o) => !where.lineId || o.lineId === where.lineId),
    },
    inventoryCountLine: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `line-${state.lines.length + 1}`, ...data } as MockLine;
        state.lines.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { id: string; sessionId: string } }) =>
        state.lines.find((l) => l.id === where.id && l.sessionId === where.sessionId) ?? null,
      findMany: async ({
        where,
        include,
      }: {
        where: { sessionId: string };
        include?: { item?: unknown; currentObservation?: boolean };
      }) =>
        state.lines
          .filter((l) => l.sessionId === where.sessionId)
          .map((l) => ({
            ...l,
            ...(include?.item ? { item: { unit: "UN" } } : {}),
            ...(include?.currentObservation
              ? {
                  currentObservation:
                    state.observations.find((o) => o.id === l.currentObservationId) ?? null,
                }
              : {}),
          })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.lines.findIndex((l) => l.id === where.id);
        state.lines[idx] = { ...state.lines[idx], ...data } as MockLine;
        return state.lines[idx];
      },
    },
  };

  const prisma = {
    $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
    ...tx,
  };

  return { prisma, state, tx };
}
