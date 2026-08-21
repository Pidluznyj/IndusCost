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
import {
  COUNT_LINE_VERSION_CONFLICT,
  COUNT_OPERATION_IDEMPOTENCY_CONFLICT,
  recordInventoryCount as recordInventoryCountService,
} from "./inventoryCountApplicationService.server.js";
import {
  buildCountRequestHash,
  canonicalCountQuantity,
} from "./inventoryCountRequestHash.js";
import {
  COUNT_ADJUSTMENT_BASIS,
  computeObservationDelta,
  hasEffectiveCountDivergence,
  requiresCountJustification,
  resolveCountAdjustmentBasis,
} from "./inventoryCountObservation.js";
import {
  INVENTORY_COUNT_LEGACY_BASIS_EVENT,
  buildLegacyCountBasisEvent,
} from "./inventoryCountTelemetry.js";
import {
  approveInventoryCountSession,
  finalizeInventoryCountSession,
  generateInventoryCountAdjustments,
} from "./inventoryCountService.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * Wrapper de teste. O CAS é obrigatório no serviço; estes cenários exercitam
 * semântica temporal, não concorrência, então usam a versão vigente da linha.
 * Os testes de CAS passam expectedVersion explicitamente.
 */
async function recordInventoryCount(
  prisma: never,
  input: {
    sessionId: string;
    lineId: string;
    countedQuantity: number;
    justification?: string | null;
    expectedVersion?: number;
    operationId?: string | null;
  },
  actor: { userId: string; permissions?: readonly string[] }
) {
  const db = prisma as unknown as {
    inventoryCountLine: {
      findFirst: (args: unknown) => Promise<{ version?: number } | null>;
    };
  };
  const current = await db.inventoryCountLine.findFirst({
    where: { id: input.lineId, sessionId: input.sessionId },
  });
  return recordInventoryCountService(
    prisma,
    { ...input, expectedVersion: input.expectedVersion ?? current?.version ?? 0 },
    actor
  );
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
  it("PATCH normal: grava e devolve a linha com a versão nova", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });

    const { line } = await recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 12, justification: "Sobra física" },
          { userId: "user-1" }
        );
    assert.equal(Number(line?.countedQuantity), 12);
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
        recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 8, justification: null },
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
        recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 8, justification: "x" },
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
        recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 8, justification: "x" },
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
        recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 8, justification: "x" },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "ADJUSTMENT_EXISTS"
    );
  });

  it("rota humana entra pelo serviço de aplicação canônico", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /recordInventoryCount/);
    assert.match(routes, /count-sessions\/:id\/lines\/:lineId/);
    // FASE 2B: a rota repassa o CAS e fixa o ator server-side.
    assert.match(routes, /expectedVersion: input\.expectedVersion/);
    assert.match(routes, /actorType: "USER"/);
    assert.match(routes, /deviceId: null/);
    // O ator jamais pode vir do corpo da requisição.
    assert.doesNotMatch(routes, /actorType: input\./);
    assert.doesNotMatch(routes, /req\.body\.actorType/);

    const service = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    const legacy = read("src/lib/inventory/inventoryCountService.server.ts");
    // Uma única implementação: o serviço de sessão não grava contagem.
    assert.doesNotMatch(legacy, /inventoryCountObservation\.create/);
    assert.match(service, /inventoryCountObservation\.create/);
    // recordCount nunca escreve saldo.
    assert.doesNotMatch(service, /inventoryBalance\.update/);
    assert.doesNotMatch(service, /persistInventoryBalanceSnapshot/);
    // Transação única.
    assert.match(service, /prisma\.\$transaction/);
  });
});

describe("OP-10 DEVICE auto-justification", () => {
  const deviceActor = { userId: null as string | null };

  it("DEVICE com divergência e justification null aceita e grava constante canônica", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const result = await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 90,
        justification: null,
        expectedVersion: 0,
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    assert.equal(result.replayed, false);
    assert.equal(Number(result.snapshot.countedQuantity), 90);
    assert.equal(result.snapshot.justification, "Contagem física Collector");
    assert.equal(Number(result.snapshot.adjustmentDelta), -10);
    assert.equal(state.lines[0].justification, "Contagem física Collector");
    assert.equal(state.observations[0].justification, "Contagem física Collector");
  });

  it("HUMAN com divergência e justification null continua JUSTIFICATION_REQUIRED", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await assert.rejects(
      () =>
        recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 90, justification: null },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );
  });

  it("HUMAN com justificativa válida continua PASS", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const { line } = await recordInventoryCount(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 90,
        justification: "Falta física confirmada",
      },
      { userId: "user-1" }
    );
    assert.equal(Number(line?.countedQuantity), 90);
    assert.equal(state.lines[0].justification, "Falta física confirmada");
  });

  it("DEVICE sem divergência efetiva não grava justificativa artificial", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const result = await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 100,
        justification: null,
        expectedVersion: 0,
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    assert.equal(Number(result.snapshot.adjustmentDelta), 0);
    assert.equal(result.snapshot.justification, null);
    assert.equal(state.lines[0].justification ?? null, null);
  });

  it("DEVICE counted 0 é válido, autojustifica e preserva delta -100", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const result = await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 0,
        justification: null,
        expectedVersion: 0,
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    assert.equal(Number(result.snapshot.countedQuantity), 0);
    assert.equal(Number(result.snapshot.adjustmentDelta), -100);
    assert.equal(result.snapshot.justification, "Contagem física Collector");
    assert.equal(Number(state.lines[0].countedQuantity), 0);
  });

  it("DEVICE ignora justification forjada pelo client", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 90,
        justification: "texto forjado no iPad",
        expectedVersion: 0,
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    assert.equal(state.lines[0].justification, "Contagem física Collector");
  });

  it("DEVICE retry mesmo operationId após autojustification é idempotente", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const input = {
      sessionId: "sess-1",
      lineId: "line-1",
      countedQuantity: 90,
      justification: null as string | null,
      expectedVersion: 0,
      operationId: "op-device-retry",
      actorType: "DEVICE" as const,
      deviceId: "dev-1",
    };
    const first = await recordInventoryCountService(prisma as never, input, deviceActor);
    const second = await recordInventoryCountService(prisma as never, input, deviceActor);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.snapshot, first.snapshot);
    assert.equal(state.observations.length, 1);
    assert.equal(state.lines[0].version, 1);
    assert.equal(auditCountRecorded(state).length, 1);
  });

  it("DEVICE CAS stale version continua 409", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 90,
        expectedVersion: 0,
        operationId: "op-cas-1",
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    const beforeObs = state.observations.length;
    await assert.rejects(
      () =>
        recordInventoryCountService(
          prisma as never,
          {
            sessionId: "sess-1",
            lineId: "line-1",
            countedQuantity: 88,
            expectedVersion: 0,
            operationId: "op-cas-2",
            actorType: "DEVICE",
            deviceId: "dev-1",
          },
          deviceActor
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COUNT_LINE_VERSION_CONFLICT
    );
    assert.equal(state.observations.length, beforeObs);
    assert.equal(state.lines[0].version, 1);
  });

  it("START 100, movimento -20, DEVICE count 80: delta efetivo 0 sem autojustification", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const result = await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 80,
        justification: null,
        expectedVersion: 0,
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    assert.equal(Number(result.snapshot.expectedQuantity), 80);
    assert.equal(Number(result.snapshot.adjustmentDelta), 0);
    assert.equal(result.snapshot.justification, null);
    state.sessions[0].status = "APPROVED";
    const adj = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: null,
      deviceId: "dev-1",
      actorType: "DEVICE",
    });
    assert.equal(adj.movementsCreated, 0);
  });

  it("DEVICE finalize + apply: reason canônica e movimento sem ADJUSTMENT_REASON_REQUIRED", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 90,
        justification: null,
        expectedVersion: 0,
        actorType: "DEVICE",
        deviceId: "dev-1",
      },
      deviceActor
    );
    await finalizeInventoryCountSession(prisma as never, "sess-1", {
      userId: null,
      deviceId: "dev-1",
      actorType: "DEVICE",
    });
    if (state.sessions[0].status === "WAITING_APPROVAL") {
      await approveInventoryCountSession(prisma as never, "sess-1", {
        userId: null,
        deviceId: "dev-1",
        actorType: "DEVICE",
      });
    }
    const adj = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: null,
      deviceId: "dev-1",
      actorType: "DEVICE",
    });
    assert.equal(adj.movementsCreated, 1);
    assert.equal(state.movements[0].reason, "Contagem física Collector");
    assert.equal(state.movements[0].movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(state.movements[0].quantity), 10);
  });
});

// ---------------------------------------------------------------------------
// FASE 2A.3 — alinhamento semântico do workflow humano
// ---------------------------------------------------------------------------

describe("OP-10 divergência efetiva — regra canônica", () => {
  it("requiresCountJustification só olha o delta efetivo", () => {
    assert.equal(requiresCountJustification(-2, null), true);
    assert.equal(requiresCountJustification(-2, "   "), true);
    assert.equal(requiresCountJustification(-2, "Falta"), false);
    // Delta efetivo zero nunca exige justificativa.
    assert.equal(requiresCountJustification(0, null), false);
  });

  it("hasEffectiveCountDivergence ignora a diferença contra o START", () => {
    // START 100, saldo 80, contado 80 → differenceQuantity −20, delta 0.
    assert.equal(
      hasEffectiveCountDivergence({
        systemQuantity: new Prisma.Decimal(100),
        countedQuantity: new Prisma.Decimal(80),
        differenceQuantity: new Prisma.Decimal(-20),
        currentObservation: { adjustmentDelta: new Prisma.Decimal(0) },
      }),
      false
    );
    assert.equal(
      hasEffectiveCountDivergence({
        systemQuantity: new Prisma.Decimal(100),
        countedQuantity: new Prisma.Decimal(78),
        differenceQuantity: new Prisma.Decimal(-22),
        currentObservation: { adjustmentDelta: new Prisma.Decimal(-2) },
      }),
      true
    );
    // Linha legada: regra antiga intacta.
    assert.equal(
      hasEffectiveCountDivergence({
        systemQuantity: new Prisma.Decimal(100),
        countedQuantity: new Prisma.Decimal(80),
        differenceQuantity: new Prisma.Decimal(-20),
        currentObservation: null,
      }),
      true
    );
  });
});

describe("OP-10 2A.3 — workflow humano segue a divergência efetiva", () => {
  it("A/B/H — START 100, saldo 80, contagem 80 SEM justificativa: passa, não vira divergência", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    // A — sem justification, não pode lançar JUSTIFICATION_REQUIRED.
    const { observation } = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 80 },
      { userId: "user-1" }
    );
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.countedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), 0);
    assert.equal(state.lines[0].justification ?? null, null);

    // H — informação histórica/visual preservada.
    assert.equal(Number(state.lines[0].systemQuantity), 100);
    assert.equal(Number(state.lines[0].differenceQuantity), -20);
    assert.equal(Number(state.lines[0].differencePercent), -20);

    // B — finalize não trata como divergência e não pede aprovação.
    const session = await finalizeInventoryCountSession(prisma as never, "sess-1", {
      userId: "user-1",
    });
    assert.equal(session.status, "APPROVED");
    assert.equal(state.sessions[0].approvedByUserId, "user-1");
    assert.ok(state.sessions[0].approvedAt);

    // generate-adjustments não cria movimento.
    const result = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(result.movementsCreated, 0);
    assert.equal(state.movements.length, 0);
  });

  it("C/D/G — START 100, saldo 80, contagem 78: exige justificativa, roda rollback, depois aprova pelo fluxo", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    // C/G — sem justificativa: erro e NENHUMA Observation persistida.
    await assert.rejects(
      () =>
        recordInventoryCount(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 78 },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );
    assert.equal(state.observations.length, 0);
    assert.equal(state.lines[0].countedQuantity ?? null, null);
    assert.equal(state.lines[0].currentObservationId ?? null, null);
    assert.equal(state.lines[0].version, 0);

    // Agora COM justificativa.
    const { observation } = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 78, justification: "Falta real" },
      { userId: "user-1" }
    );
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), -2);

    // D — divergência física efetiva vai para o fluxo de aprovação existente.
    const session = await finalizeInventoryCountSession(prisma as never, "sess-1", {
      userId: "user-1",
    });
    assert.equal(session.status, "WAITING_APPROVAL");
    assert.equal(state.sessions[0].approvedByUserId ?? null, null);
  });

  it("PASSO 9 — movimento posterior não muda a decisão de aprovação", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 95, justification: "Falta" },
      { userId: "user-1" }
    );
    // −20 legítimo depois da contagem.
    state.balances[0].physicalQuantity = new Prisma.Decimal(80);

    const session = await finalizeInventoryCountSession(prisma as never, "sess-1", {
      userId: "user-1",
    });
    assert.equal(session.status, "WAITING_APPROVAL");
    // A divergência continua sendo −5, não −25.
    assert.equal(Number(state.observations[0].adjustmentDelta), -5);
    assert.equal(state.lines[0].justification, "Falta");
  });

  it("E — recontagem vigente com delta 0 anula a divergência da contagem anterior", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    // Obs1: divergência real de −5.
    await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 95, justification: "Falta" },
      { userId: "user-1" }
    );
    // Movimento legítimo de −5: saldo real vira 95.
    state.balances[0].physicalQuantity = new Prisma.Decimal(95);
    // Obs2: recontagem bate com o saldo — delta 0, sem justificativa.
    const second = await recordInventoryCount(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 95 },
      { userId: "user-1" }
    );
    assert.equal(Number(second.observation.adjustmentDelta), 0);

    // Obs1 preservada para auditoria.
    assert.equal(state.observations.length, 2);
    assert.equal(Number(state.observations[0].adjustmentDelta), -5);
    assert.equal(state.lines[0].currentObservationId, second.observation.id);

    // Só a vigente decide: sessão aprovada direto.
    const session = await finalizeInventoryCountSession(prisma as never, "sess-1", {
      userId: "user-1",
    });
    assert.equal(session.status, "APPROVED");

    const result = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(result.movementsCreated, 0);
  });

  it("F — linha legada (sem Observation) mantém o comportamento antigo no finalize", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [
        {
          ...countLine("line-1", "sess-1", 100),
          countedQuantity: new Prisma.Decimal(80),
          differenceQuantity: new Prisma.Decimal(-20),
          differencePercent: new Prisma.Decimal(-20),
          justification: "Justificativa da época",
        },
      ],
    });

    // Mesmo cenário do caso A, mas SEM Observation: continua divergente.
    const session = await finalizeInventoryCountSession(prisma as never, "sess-1", {
      userId: "user-1",
    });
    assert.equal(session.status, "WAITING_APPROVAL");
    assert.equal(state.observations.length, 0);
    assert.equal(state.lines[0].currentObservationId ?? null, null);
  });

  it("F — linha legada divergente sem justificativa continua bloqueando o finalize", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 80)],
      lines: [
        {
          ...countLine("line-1", "sess-1", 100),
          countedQuantity: new Prisma.Decimal(80),
          differenceQuantity: new Prisma.Decimal(-20),
          justification: null,
        },
      ],
    });
    await assert.rejects(
      () => finalizeInventoryCountSession(prisma as never, "sess-1", { userId: "user-1" }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );
  });

  it("finalize sem linha contada continua exigindo COUNTED_REQUIRED", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await assert.rejects(
      () => finalizeInventoryCountSession(prisma as never, "sess-1", { userId: "user-1" }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "COUNTED_REQUIRED"
    );
  });

  it("uma única implementação da regra — finalize não recalcula por systemQuantity", () => {
    const service = read("src/lib/inventory/inventoryCountService.server.ts");
    assert.match(service, /hasEffectiveCountDivergence/);
    assert.match(service, /requiresCountJustification/);
    // A autoridade não pode voltar a ser a diferença contra o START.
    assert.doesNotMatch(service, /computeCountDifference/);
    assert.doesNotMatch(service, /line\.differenceQuantity/);

    const app = read("src/lib/inventory/inventoryCountApplicationService.server.ts");
    assert.match(app, /requiresCountJustification/);
    // A checagem tem de vir depois do lock do saldo — comparação entre os
    // pontos de USO no corpo (lastIndexOf), não entre os imports do topo.
    assert.ok(
      app.lastIndexOf("getOrCreateInventoryBalanceForUpdate") <
        app.lastIndexOf("requiresCountJustification"),
      "justificativa não pode ser decidida antes do FOR UPDATE"
    );
  });
});

// ---------------------------------------------------------------------------
// FASE 2B — CAS, idempotência, ator e auditoria
// ---------------------------------------------------------------------------

const OP_ACTOR = { userId: "user-1" } as const;

function auditCountRecorded(state: { auditLogs: Array<Record<string, unknown>> }) {
  return state.auditLogs.filter((a) => a.action === "COUNT_RECORDED");
}

describe("2B — hash canônico do request", () => {
  it("18/19/20 — Decimal(20,6): 1, 1.0 e 1.000000 são o MESMO request", () => {
    assert.equal(canonicalCountQuantity(1), "1.000000");
    assert.equal(canonicalCountQuantity(1.0), "1.000000");
    assert.equal(canonicalCountQuantity(1.000000), "1.000000");
    assert.equal(canonicalCountQuantity(0.000001), "0.000001");

    const base = {
      lineId: "line-1",
      justification: "Falta",
      expectedVersion: 3,
      actorType: "USER" as const,
      userId: "user-1",
      deviceId: null,
    };
    const a = buildCountRequestHash({ ...base, countedQuantity: 1 });
    const b = buildCountRequestHash({ ...base, countedQuantity: 1.0 });
    const c = buildCountRequestHash({ ...base, countedQuantity: 1.000000 });
    assert.equal(a, b);
    assert.equal(b, c);
    // 1e-6 é significativo na precisão do Inventory.
    assert.notEqual(a, buildCountRequestHash({ ...base, countedQuantity: 1.000001 }));
  });

  it("qualquer campo que muda a operação muda o hash", () => {
    const base = {
      lineId: "line-1",
      countedQuantity: 10,
      justification: "Falta",
      expectedVersion: 3,
      actorType: "USER" as const,
      userId: "user-1",
      deviceId: null,
    };
    const h = buildCountRequestHash(base);
    assert.notEqual(h, buildCountRequestHash({ ...base, lineId: "line-2" }));
    assert.notEqual(h, buildCountRequestHash({ ...base, countedQuantity: 11 }));
    assert.notEqual(h, buildCountRequestHash({ ...base, justification: "Outra" }));
    assert.notEqual(h, buildCountRequestHash({ ...base, expectedVersion: 4 }));
    assert.notEqual(h, buildCountRequestHash({ ...base, actorType: "DEVICE" }));
    assert.notEqual(h, buildCountRequestHash({ ...base, userId: "user-2" }));
    assert.notEqual(h, buildCountRequestHash({ ...base, deviceId: "dev-1" }));
    // Normalização: trim não é campo novo.
    assert.equal(h, buildCountRequestHash({ ...base, justification: "  Falta  " }));
  });

  it("delimitador dentro do texto não confunde payloads distintos", () => {
    const base = {
      lineId: "line-1",
      countedQuantity: 10,
      expectedVersion: 0,
      actorType: "USER" as const,
      userId: "user-1",
      deviceId: null,
    };
    // Concatenação com "|" faria estes dois colidirem.
    assert.notEqual(
      buildCountRequestHash({ ...base, justification: "a|b" }),
      buildCountRequestHash({ ...base, justification: "a" })
    );
  });
});

describe("2B — CAS (concorrência otimista)", () => {
  it("1/3 — expectedVersion correto grava e incrementa exatamente 1", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    const result = await recordInventoryCountService(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 10, expectedVersion: 0 },
      OP_ACTOR
    );
    assert.equal(result.replayed, false);
    assert.equal(result.snapshot.previousVersion, 0);
    assert.equal(result.snapshot.version, 1);
    assert.equal(state.lines[0].version, 1);
  });

  it("2 — expectedVersion antigo perde o CAS com COUNT_LINE_VERSION_CONFLICT", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    await recordInventoryCountService(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 10, expectedVersion: 0 },
      OP_ACTOR
    );
    await assert.rejects(
      () =>
        recordInventoryCountService(
          prisma as never,
          { sessionId: "sess-1", lineId: "line-1", countedQuantity: 9, justification: "x", expectedVersion: 0 },
          OP_ACTOR
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COUNT_LINE_VERSION_CONFLICT
    );
    assert.equal(state.lines[0].version, 1);
  });

  it("4/5 — CAS perdido não deixa Observation nem auditoria", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    await recordInventoryCountService(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 10, expectedVersion: 0 },
      OP_ACTOR
    );
    const observationsBefore = state.observations.length;
    const auditsBefore = auditCountRecorded(state).length;

    await assert.rejects(
      () =>
        recordInventoryCountService(
          prisma as never,
          {
            sessionId: "sess-1",
            lineId: "line-1",
            countedQuantity: 9,
            justification: "x",
            expectedVersion: 0,
            operationId: "op-perdedor",
          },
          OP_ACTOR
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COUNT_LINE_VERSION_CONFLICT
    );

    assert.equal(state.observations.length, observationsBefore);
    assert.equal(auditCountRecorded(state).length, auditsBefore);
    // 13 — a chave do perdedor não fica envenenada: sumiu com o rollback.
    assert.equal(state.operations.some((o) => o.operationId === "op-perdedor"), false);
  });

  /**
   * O mock tem UMA conexão: não modela duas transações isoladas, e tentar
   * simular isso aqui produziria rigor falso. O que ele prova de verdade é o
   * determinismo do CAS — duas intenções partindo da MESMA versão só podem
   * resultar em um vencedor. A simultaneidade real (duas conexões PostgreSQL
   * disparadas juntas) é o gate DB-1.
   */
  it("6 — duas intenções na mesma versão: exatamente 1 sucesso e 1 conflito", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    const attempt = (counted: number, operationId: string) =>
      recordInventoryCountService(
        prisma as never,
        {
          sessionId: "sess-1",
          lineId: "line-1",
          countedQuantity: counted,
          justification: "concorrente",
          expectedVersion: 0,
          operationId,
        },
        OP_ACTOR
      );

    const settled: Array<{ ok: boolean; code?: string }> = [];
    for (const [counted, opId] of [
      [9, "op-a"],
      [8, "op-b"],
    ] as const) {
      try {
        await attempt(counted, opId);
        settled.push({ ok: true });
      } catch (e: unknown) {
        settled.push({
          ok: false,
          code: e instanceof InventoryValidationError ? e.code : "OUTRO",
        });
      }
    }

    assert.equal(settled.filter((r) => r.ok).length, 1);
    assert.equal(
      settled.filter((r) => !r.ok && r.code === COUNT_LINE_VERSION_CONFLICT).length,
      1
    );
    assert.equal(state.lines[0].version, 1);
    assert.equal(state.observations.length, 1);
    // O perdedor não deixou rastro.
    assert.equal(state.operations.length, 1);
  });

  it("6b — a simultaneidade real é coberta pelo DB gate, não pelo mock", () => {
    const gate = read("src/lib/inventory/inventoryCountConcurrencyIdempotencyDbGate.test.ts");
    assert.match(gate, /DB-1/);
    assert.match(gate, /DB-4/);
    // Duas conexões independentes é o que caracteriza a prova.
    assert.match(gate, /clientA/);
    assert.match(gate, /clientB/);
  });
});

describe("2B — idempotência", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    sessionId: "sess-1",
    lineId: "line-1",
    countedQuantity: 9,
    justification: "Falta",
    expectedVersion: 0,
    operationId: "op-retry",
    ...over,
  });

  it("7/8/9/10 — retry com mesmo payload faz replay sem novo efeito", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });

    const first = await recordInventoryCountService(prisma as never, input(), OP_ACTOR);
    assert.equal(first.replayed, false);

    const second = await recordInventoryCountService(prisma as never, input(), OP_ACTOR);
    assert.equal(second.replayed, true);
    // 7 — mesmo resultado lógico.
    assert.deepEqual(second.snapshot, first.snapshot);
    // 8 — nenhuma Observation nova.
    assert.equal(state.observations.length, 1);
    // 9 — version não incrementa de novo.
    assert.equal(state.lines[0].version, 1);
    // 10 — auditoria não duplica.
    assert.equal(auditCountRecorded(state).length, 1);
  });

  it("2 (ajuste do plano) — replay devolve o resultado ORIGINAL, não o estado atual", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });

    // op X grava 80 / version 1
    const original = await recordInventoryCountService(
      prisma as never,
      input({ countedQuantity: 80, justification: "Primeira", operationId: "op-X" }),
      OP_ACTOR
    );
    assert.equal(original.snapshot.countedQuantity, 80);
    assert.equal(original.snapshot.version, 1);

    // recontagem posterior grava 79 / version 2
    await recordInventoryCountService(
      prisma as never,
      input({ countedQuantity: 79, justification: "Recontagem", expectedVersion: 1, operationId: "op-Y" }),
      OP_ACTOR
    );
    assert.equal(state.lines[0].version, 2);
    assert.equal(Number(state.lines[0].countedQuantity), 79);

    // retry atrasado de X: precisa responder 80/version 1, não 79/version 2.
    const replay = await recordInventoryCountService(
      prisma as never,
      input({ countedQuantity: 80, justification: "Primeira", operationId: "op-X" }),
      OP_ACTOR
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.snapshot.countedQuantity, 80);
    assert.equal(replay.snapshot.version, 1);
    assert.deepEqual(replay.snapshot, original.snapshot);
    // E o estado atual continua sendo o da recontagem.
    assert.equal(Number(state.lines[0].countedQuantity), 79);
    assert.equal(state.lines[0].version, 2);
  });

  it("11 — mesmo operationId com payload diferente é conflito", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    await recordInventoryCountService(prisma as never, input(), OP_ACTOR);

    await assert.rejects(
      () =>
        recordInventoryCountService(
          prisma as never,
          input({ countedQuantity: 7, expectedVersion: 1 }),
          OP_ACTOR
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === COUNT_OPERATION_IDEMPOTENCY_CONFLICT
    );
    // Nenhuma alteração adicional.
    assert.equal(state.observations.length, 1);
    assert.equal(state.lines[0].version, 1);
    assert.equal(auditCountRecorded(state).length, 1);
  });

  it("11b — mesma chave e payload, ator diferente, também é conflito", async () => {
    const { prisma } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    await recordInventoryCountService(prisma as never, input(), OP_ACTOR);
    await assert.rejects(
      () => recordInventoryCountService(prisma as never, input(), { userId: "outro-user" }),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === COUNT_OPERATION_IDEMPOTENCY_CONFLICT
    );
  });

  /**
   * Mesma limitação do teste 6: aqui provamos que a MESMA chave nunca produz
   * dois efeitos, qualquer que seja a ordem. A corrida real entre duas conexões
   * (que o PostgreSQL resolve bloqueando no índice único) é o gate DB-4.
   */
  it("12 — a mesma chave nunca executa duas vezes", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    const results = [
      await recordInventoryCountService(prisma as never, input(), OP_ACTOR),
      await recordInventoryCountService(prisma as never, input(), OP_ACTOR),
      await recordInventoryCountService(prisma as never, input(), OP_ACTOR),
    ];
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    assert.equal(results.filter((r) => r.replayed).length, 2);
    for (const r of results) assert.deepEqual(r.snapshot, results[0].snapshot);
    assert.equal(state.observations.length, 1);
    assert.equal(state.lines[0].version, 1);
    assert.equal(auditCountRecorded(state).length, 1);
    assert.equal(state.operations.length, 1);
  });

  it("13 — falha antes do commit não envenena o operationId", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    // Divergência sem justificativa → aborta tudo.
    await assert.rejects(
      () =>
        recordInventoryCountService(
          prisma as never,
          input({ justification: null, countedQuantity: 8 }),
          OP_ACTOR
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );
    assert.equal(state.operations.length, 0);
    assert.equal(state.observations.length, 0);

    // O mesmo operationId funciona normalmente depois.
    const retry = await recordInventoryCountService(
      prisma as never,
      input({ justification: "Agora com justificativa", countedQuantity: 8 }),
      OP_ACTOR
    );
    assert.equal(retry.replayed, false);
    assert.equal(state.lines[0].version, 1);
    assert.equal(state.observations.length, 1);
  });
});

describe("2B — ator e auditoria", () => {
  it("14/16/17 — rota humana grava USER, userId autenticado e deviceId null", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      lines: [countLine("line-1", "sess-1", 10)],
    });
    await recordInventoryCountService(
      prisma as never,
      { sessionId: "sess-1", lineId: "line-1", countedQuantity: 10, expectedVersion: 0, operationId: "op-1" },
      { userId: "user-42" }
    );
    assert.equal(state.observations[0].actorType, "USER");
    assert.equal(state.observations[0].userId, "user-42");
    assert.equal(state.observations[0].deviceId, null);
    assert.equal(state.operations[0].actorType, "USER");
    assert.equal(state.operations[0].userId, "user-42");
    assert.equal(state.operations[0].deviceId, null);
  });

  it("15 — o browser não consegue forjar ator: a rota não lê actorType do corpo", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    const validation = read("src/lib/inventory/inventoryCountValidation.ts");
    // O parser do corpo humano sequer conhece actorType/deviceId/userId.
    assert.doesNotMatch(validation, /actorType/);
    assert.doesNotMatch(validation, /deviceId/);
    // E a rota fixa o ator server-side.
    assert.match(routes, /actorType: "USER"/);
    assert.match(routes, /deviceId: null/);
    assert.doesNotMatch(routes, /actorType: input\./);
    assert.doesNotMatch(routes, /actorType: req\./);
  });

  it("auditoria responde às 12 perguntas obrigatórias", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 95,
        justification: "Falta apurada",
        expectedVersion: 0,
        operationId: "op-audit",
      },
      { userId: "user-42" }
    );

    const observation = state.observations[0];
    const operation = state.operations[0];
    const audit = auditCountRecorded(state)[0];
    const after = audit.afterJson as Record<string, unknown>;
    const before = audit.beforeJson as Record<string, unknown>;

    // quem contou / ator / device
    assert.equal(observation.userId, "user-42");
    assert.equal(observation.actorType, "USER");
    assert.equal(observation.deviceId, null);
    // quando
    assert.ok(observation.observedAt);
    // linha e sessão
    assert.equal(observation.lineId, "line-1");
    assert.equal(after.sessionId, "sess-1");
    // versão anterior e nova
    assert.equal(before.version, 0);
    assert.equal(after.version, 1);
    assert.equal(operation.expectedVersion, 0);
    assert.equal(operation.resultVersion, 1);
    // quantidades e delta
    assert.equal(Number(observation.expectedQuantity), 100);
    assert.equal(Number(observation.countedQuantity), 95);
    assert.equal(Number(observation.adjustmentDelta), -5);
    // justificativa e operationId
    assert.equal(observation.justification, "Falta apurada");
    assert.equal(observation.operationId, "op-audit");
    assert.equal(after.operationId, "op-audit");
    // a auditoria aponta para a Observation em vez de duplicar quantidades
    assert.equal(after.observationId, observation.id);
    assert.equal(Object.prototype.hasOwnProperty.call(after, "countedQuantity"), false);
  });
});

describe("2B — recontagem e contrato HTTP", () => {
  it("21/22/23 — recontagem exige a versão seguinte e preserva a Observation antiga", async () => {
    const { prisma, state } = createTemporalMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 100)],
      lines: [countLine("line-1", "sess-1", 100)],
    });
    const first = await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 95,
        justification: "Primeira",
        expectedVersion: 0,
        operationId: "op-1",
      },
      OP_ACTOR
    );

    // 22 — reutilizar a versão anterior é conflito.
    await assert.rejects(
      () =>
        recordInventoryCountService(
          prisma as never,
          {
            sessionId: "sess-1",
            lineId: "line-1",
            countedQuantity: 94,
            justification: "Segunda",
            expectedVersion: 0,
            operationId: "op-2",
          },
          OP_ACTOR
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COUNT_LINE_VERSION_CONFLICT
    );

    // 21 — nova intenção: nova chave + versão vigente.
    const second = await recordInventoryCountService(
      prisma as never,
      {
        sessionId: "sess-1",
        lineId: "line-1",
        countedQuantity: 94,
        justification: "Segunda",
        expectedVersion: 1,
        operationId: "op-2",
      },
      OP_ACTOR
    );
    assert.equal(second.snapshot.version, 2);
    // 23 — append-only preservado.
    assert.equal(state.observations.length, 2);
    assert.equal(state.observations[0].id, first.snapshot.observationId);
    assert.equal(state.lines[0].currentObservationId, second.snapshot.observationId);
  });

  it("24/25/26 — mapeamento HTTP dos conflitos e do replay", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    // 409 para os dois conflitos canônicos.
    assert.match(routes, /COUNT_LINE_VERSION_CONFLICT/);
    assert.match(routes, /COUNT_OPERATION_IDEMPOTENCY_CONFLICT/);
    const statusBlock = routes.slice(
      routes.indexOf("function handleInventoryValidation"),
      routes.indexOf("function decimalOrNull")
    );
    assert.match(statusBlock, /COUNT_LINE_VERSION_CONFLICT[\s\S]*\? 409/);
    // 26 — replay responde 200 normal.
    assert.match(routes, /result\.replayed/);
    assert.doesNotMatch(routes, /replayed[\s\S]{0,80}status\(409\)/);

    // A UI não pode fazer retry automático nem sobrescrever sozinha.
    const sheet = read("src/components/inventory/InventoryCountDetailSheet.tsx");
    assert.match(sheet, /COUNT_LINE_VERSION_CONFLICT/);
    assert.match(sheet, /expectedVersion/);
    assert.match(sheet, /operationId/);
    assert.doesNotMatch(sheet, /setTimeout\([\s\S]{0,120}saveLine/);
  });
});

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------


/** Aplica data do Prisma numa linha do mock, entendendo { increment }. */
function applyMockUpdate<T extends Record<string, unknown>>(
  row: T,
  data: Record<string, unknown>
): T {
  const next: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in (value as object)) {
      const inc = Number((value as { increment: number }).increment);
      next[key] = Number(next[key] ?? 0) + inc;
      continue;
    }
    next[key] = value;
  }
  return next as T;
}

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
    operations: [] as Array<Record<string, unknown>>,
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
      findFirst: async ({ where }: { where: { id: string; sessionId?: string } }) =>
        state.lines.find(
          (l) => l.id === where.id && (where.sessionId === undefined || l.sessionId === where.sessionId)
        ) ?? null,
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
        state.lines[idx] = applyMockUpdate(state.lines[idx], data);
        return state.lines[idx];
      },
      // CAS: filtra por version e devolve count, igual ao UPDATE condicional.
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; version?: number };
        data: Record<string, unknown>;
      }) => {
        const matches = state.lines.filter(
          (l) => l.id === where.id && (where.version === undefined || (l.version ?? 0) === where.version)
        );
        for (const match of matches) {
          const idx = state.lines.findIndex((l) => l.id === match.id);
          state.lines[idx] = applyMockUpdate(state.lines[idx], data);
        }
        return { count: matches.length };
      },
    },
    // FASE 2B: aquisição por INSERT ... ON CONFLICT DO NOTHING.
    inventoryCountOperation: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Array<Record<string, unknown>>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const row of data) {
          const exists = state.operations.some((o) => o.operationId === row.operationId);
          if (exists && skipDuplicates) continue;
          state.operations.push({ id: `op-${state.operations.length + 1}`, ...row });
          count += 1;
        }
        return { count };
      },
      findUnique: async ({ where }: { where: { operationId: string } }) =>
        state.operations.find((o) => o.operationId === where.operationId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { operationId: string };
        data: Record<string, unknown>;
      }) => {
        const idx = state.operations.findIndex((o) => o.operationId === where.operationId);
        state.operations[idx] = { ...state.operations[idx], ...data };
        return state.operations[idx];
      },
    },
  };

  // Transação com rollback de verdade: sem isso o mock declararia
  // atomicidade que não tem, e os testes de CAS/idempotência ficariam falsos.
  const snapshotState = () => ({
    balances: state.balances.map((r) => ({ ...r })),
    lines: state.lines.map((r) => ({ ...r })),
    observations: state.observations.map((r) => ({ ...r })),
    operations: state.operations.map((r) => ({ ...r })),
    sessions: state.sessions.map((r) => ({ ...r })),
    movements: state.movements.map((r) => ({ ...r })),
    auditLogs: state.auditLogs.map((r) => ({ ...r })),
  });
  const restoreState = (snap: ReturnType<typeof snapshotState>) => {
    state.balances.splice(0, state.balances.length, ...snap.balances);
    state.lines.splice(0, state.lines.length, ...snap.lines);
    state.observations.splice(0, state.observations.length, ...snap.observations);
    state.operations.splice(0, state.operations.length, ...snap.operations);
    state.sessions.splice(0, state.sessions.length, ...snap.sessions);
    state.movements.splice(0, state.movements.length, ...snap.movements);
    state.auditLogs.splice(0, state.auditLogs.length, ...snap.auditLogs);
  };

  const prisma = {
    $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => {
      const snap = snapshotState();
      try {
        return await fn(tx);
      } catch (e) {
        restoreState(snap);
        throw e;
      }
    },
    ...tx,
  };

  return { prisma, state, tx };
}
