/**
 * OP-10 / FASE 2A.3 — semântica do workflow humano em PostgreSQL REAL.
 *
 * A Fase 2A.3 provou em mock que justificativa, divergência e roteamento de
 * aprovação passaram a seguir a divergência FÍSICA efetiva (adjustmentDelta da
 * Observation) em vez da diferença contra a fotografia do START. Mock não tem
 * transação nem lock: este harness repete os mesmos cenários contra o banco
 * real, chamando os serviços de verdade.
 *
 * Regra do arquivo: nada de recalcular o esperado com cópia da implementação —
 * os cenários chamam recordInventoryCount / finalizeInventoryCountSession /
 * generateInventoryCountAdjustments e conferem os valores finais persistidos.
 *
 * Só roda com banco DESCARTÁVEL apontado por INVENTORY_TEMPORAL_DB_URL, com o
 * mesmo guard de nome usado pelo gate temporal. Sem fallback para DATABASE_URL.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { recordInventoryCount } from "./inventoryCountApplicationService.server.js";
import {
  createInventoryCountSession,
  finalizeInventoryCountSession,
  generateInventoryCountAdjustments,
  startInventoryCountSession,
} from "./inventoryCountService.server.js";
import { createInventoryMovement } from "./inventoryService.server.js";
import { buildInventoryBalanceKey, InventoryValidationError } from "./inventoryTypes.js";
import {
  DB_GATE_PENDING,
  assertDisposableTemporalDb,
  resolveTemporalDbUrl,
} from "./inventoryCountDbGateSupport.js";

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

/** Contexto humano completo: conta, movimenta, finaliza, aprova e ajusta. */
const OPERATOR = {
  userId: "op10-semantics-user",
  permissions: ["inventory.manage", "inventory.count.manage", "inventory.count.approve"],
} as const;

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

function log(label: string, payload: unknown): void {
  console.log(`[OP-10 SEMANTIC GATE] ${label}: ${JSON.stringify(payload)}`);
}

type Fixture = {
  stamp: string;
  itemId: string;
  warehouseId: string;
  balanceId: string;
  sessionId: string;
  lineId: string;
};

describe("OP-10 2A.3 — semântica do workflow em PostgreSQL real", { skip: gate }, () => {
  let prisma: PrismaClient;
  /** Conexão independente — usada para observar o resultado de rollbacks. */
  let observer: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    prisma = client();
    observer = client();
    await Promise.all([prisma.$connect(), observer.$connect()]);
  });

  after(async () => {
    for (const f of [...created].reverse()) {
      await observer.inventoryCountLine.updateMany({
        where: { sessionId: f.sessionId },
        data: { currentObservationId: null, generatedMovementId: null },
      });
      await observer.inventoryCountObservation.deleteMany({ where: { lineId: f.lineId } });
      await observer.inventoryCountLine.deleteMany({ where: { sessionId: f.sessionId } });
      await observer.inventoryCountSession.deleteMany({ where: { id: f.sessionId } });
      await observer.inventoryMovement.deleteMany({ where: { itemId: f.itemId } });
      await observer.inventoryBalance.deleteMany({ where: { itemId: f.itemId } });
      await observer.inventoryItem.deleteMany({ where: { id: f.itemId } });
      await observer.inventoryWarehouse.deleteMany({ where: { id: f.warehouseId } });
      await observer.inventoryAuditLog.deleteMany({ where: { entityId: f.sessionId } });
    }
    await Promise.all([prisma.$disconnect(), observer.$disconnect()]);
  });

  /**
   * Sessão real: saldo materializado, sessão criada e START executado pelos
   * serviços canônicos — systemQuantity nasce da fotografia do START.
   */
  async function seedStartedSession(initialBalance: number): Promise<Fixture> {
    const stamp = `OP10S-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const warehouse = await prisma.inventoryWarehouse.create({
      data: { code: stamp, name: stamp, status: "ACTIVE" },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        code: stamp,
        description: stamp,
        itemType: "RAW_MATERIAL",
        unit: "UN",
        status: "ACTIVE",
      },
    });
    const balance = await prisma.inventoryBalance.create({
      data: {
        itemId: item.id,
        warehouseId: warehouse.id,
        balanceKey: buildInventoryBalanceKey(warehouse.id, null),
        physicalQuantity: initialBalance,
        reservedQuantity: 0,
        blockedQuantity: 0,
        quarantineQuantity: 0,
        availableQuantity: initialBalance,
      },
    });

    const session = await createInventoryCountSession(
      prisma,
      { warehouseId: warehouse.id },
      OPERATOR
    );
    await startInventoryCountSession(prisma, session.id, OPERATOR);
    const line = await prisma.inventoryCountLine.findFirstOrThrow({
      where: { sessionId: session.id },
    });

    const fixture: Fixture = {
      stamp,
      itemId: item.id,
      warehouseId: warehouse.id,
      balanceId: balance.id,
      sessionId: session.id,
      lineId: line.id,
    };
    created.push(fixture);
    return fixture;
  }

  /** Movimentação legítima pelo ledger real — nunca UPDATE manual de saldo. */
  async function legitimateExit(f: Fixture, quantity: number): Promise<void> {
    await createInventoryMovement(
      prisma,
      {
        itemId: f.itemId,
        movementType: "MANUAL_EXIT",
        quantity,
        unit: "UN",
        reason: "Saída legítima durante a conferência",
        sourceWarehouseId: f.warehouseId,
        originType: "MANUAL",
      },
      OPERATOR
    );
  }

  async function physicalQuantity(f: Fixture): Promise<number> {
    const balance = await observer.inventoryBalance.findUniqueOrThrow({
      where: { id: f.balanceId },
    });
    return Number(balance.physicalQuantity);
  }

  async function countAdjustmentMovements(f: Fixture): Promise<number> {
    return observer.inventoryMovement.count({
      where: { itemId: f.itemId, originType: "COUNT_SESSION" },
    });
  }

  // -------------------------------------------------------------------------
  // CENÁRIO A — movimento legítimo antes, delta zero
  // -------------------------------------------------------------------------

  it("CENÁRIO A — START 100, saída 20, contagem 80 sem justificativa: aprova e não ajusta", async () => {
    const f = await seedStartedSession(100);
    const started = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    assert.equal(Number(started.systemQuantity), 100);

    await legitimateExit(f, 20);
    assert.equal(await physicalQuantity(f), 80);

    // Sem justification — não pode exigir por diferença contra o START.
    const { observation } = await recordInventoryCount(
      prisma,
      { sessionId: f.sessionId, lineId: f.lineId, countedQuantity: 80 },
      OPERATOR
    );

    const line = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    log("cenário A — observation e linha", {
      expectedQuantity: String(observation.expectedQuantity),
      countedQuantity: String(observation.countedQuantity),
      adjustmentDelta: String(observation.adjustmentDelta),
      systemQuantity: String(line.systemQuantity),
      differenceQuantity: String(line.differenceQuantity),
      currentObservationId: line.currentObservationId,
      justification: line.justification,
    });

    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.countedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), 0);
    assert.equal(Number(line.systemQuantity), 100);
    assert.notEqual(line.currentObservationId, null);
    assert.equal(line.justification, null);

    // PASSO 13 — as duas leituras coexistem e divergem de propósito.
    assert.equal(Number(line.differenceQuantity), -20);
    assert.equal(Number(observation.adjustmentDelta), 0);

    const session = await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    log("cenário A — finalize", {
      status: session.status,
      approvedByUserId: session.approvedByUserId,
      approvedAt: session.approvedAt?.toISOString() ?? null,
    });
    assert.equal(session.status, "APPROVED");
    assert.equal(session.approvedByUserId, OPERATOR.userId);
    assert.notEqual(session.approvedAt, null);

    const result = await generateInventoryCountAdjustments(prisma, f.sessionId, OPERATOR);
    log("cenário A — adjustments", {
      movementsCreated: result.movementsCreated,
      balance: await physicalQuantity(f),
    });
    assert.equal(result.movementsCreated, 0);
    assert.equal(await countAdjustmentMovements(f), 0);
    assert.equal(await physicalQuantity(f), 80);
  });

  // -------------------------------------------------------------------------
  // CENÁRIO B — divergência real sem justificativa (rollback real)
  // -------------------------------------------------------------------------

  it("CENÁRIO B — contagem 78 sem justificativa: JUSTIFICATION_REQUIRED e rollback real", async () => {
    const f = await seedStartedSession(100);
    await legitimateExit(f, 20);
    assert.equal(await physicalQuantity(f), 80);

    const before = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    assert.equal(before.countedQuantity, null);
    assert.equal(before.currentObservationId, null);
    assert.equal(before.version, 0);

    await assert.rejects(
      () =>
        recordInventoryCount(
          prisma,
          { sessionId: f.sessionId, lineId: f.lineId, countedQuantity: 78 },
          OPERATOR
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );

    // Leitura por conexão INDEPENDENTE: prova de rollback transacional real.
    const observations = await observer.inventoryCountObservation.findMany({
      where: { lineId: f.lineId },
    });
    const line = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    log("cenário B — após rollback (outra conexão)", {
      observations: observations.length,
      countedQuantity: line.countedQuantity,
      currentObservationId: line.currentObservationId,
      version: line.version,
      systemQuantity: String(line.systemQuantity),
      balance: await physicalQuantity(f),
    });

    assert.equal(observations.length, 0);
    assert.equal(line.countedQuantity, null);
    assert.equal(line.currentObservationId, null);
    assert.equal(line.version, 0);
    assert.equal(Number(line.systemQuantity), 100);
    // O saldo do ledger não foi tocado pela contagem que falhou.
    assert.equal(await physicalQuantity(f), 80);
  });

  // -------------------------------------------------------------------------
  // CENÁRIO C — mesma divergência COM justificativa
  // -------------------------------------------------------------------------

  it("CENÁRIO C — contagem 78 com justificativa: delta −2 e vai para aprovação", async () => {
    const f = await seedStartedSession(100);
    await legitimateExit(f, 20);

    const { observation } = await recordInventoryCount(
      prisma,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 78,
        justification: "Falta física confirmada",
      },
      OPERATOR
    );
    log("cenário C — observation", {
      expectedQuantity: String(observation.expectedQuantity),
      countedQuantity: String(observation.countedQuantity),
      adjustmentDelta: String(observation.adjustmentDelta),
    });
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.countedQuantity), 78);
    assert.equal(Number(observation.adjustmentDelta), -2);

    const session = await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    log("cenário C — finalize", {
      status: session.status,
      approvedByUserId: session.approvedByUserId,
      approvedAt: session.approvedAt?.toISOString() ?? null,
    });
    assert.equal(session.status, "WAITING_APPROVAL");
    assert.equal(session.approvedByUserId, null);
    assert.equal(session.approvedAt, null);

    // Fluxo atual: ajuste só depois da aprovação — nada gerado aqui.
    assert.equal(await countAdjustmentMovements(f), 0);
  });

  // -------------------------------------------------------------------------
  // CENÁRIO D — movimento posterior à contagem
  // -------------------------------------------------------------------------

  it("CENÁRIO D — movimento depois da contagem não altera a divergência efetiva", async () => {
    const f = await seedStartedSession(100);

    const { observation } = await recordInventoryCount(
      prisma,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 95,
        justification: "Falta apurada na contagem",
      },
      OPERATOR
    );
    assert.equal(Number(observation.expectedQuantity), 100);
    assert.equal(Number(observation.adjustmentDelta), -5);

    // −20 legítimo DEPOIS da contagem.
    await legitimateExit(f, 20);
    assert.equal(await physicalQuantity(f), 80);

    const session = await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    const persisted = await observer.inventoryCountObservation.findUniqueOrThrow({
      where: { id: observation.id },
    });
    log("cenário D — finalize", {
      status: session.status,
      adjustmentDelta: String(persisted.adjustmentDelta),
      balance: await physicalQuantity(f),
    });

    assert.equal(session.status, "WAITING_APPROVAL");
    // Continua −5: nem recalculado contra o saldo atual (−25), nem contra o START.
    assert.equal(Number(persisted.adjustmentDelta), -5);
    assert.equal(Number(persisted.expectedQuantity), 100);
  });

  // -------------------------------------------------------------------------
  // CENÁRIO E — recontagem
  // -------------------------------------------------------------------------

  it("CENÁRIO E — recontagem vigente com delta 0 aprova a sessão e não ajusta", async () => {
    const f = await seedStartedSession(100);

    const first = await recordInventoryCount(
      prisma,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 95,
        justification: "Primeira contagem",
      },
      OPERATOR
    );
    assert.equal(Number(first.observation.adjustmentDelta), -5);

    // Movimento legítimo de −5: saldo real vira 95.
    await legitimateExit(f, 5);
    assert.equal(await physicalQuantity(f), 95);

    // Recontagem bate com o saldo — delta 0, sem justificativa.
    const second = await recordInventoryCount(
      prisma,
      { sessionId: f.sessionId, lineId: f.lineId, countedQuantity: 95 },
      OPERATOR
    );

    const observations = await observer.inventoryCountObservation.findMany({
      where: { lineId: f.lineId },
      orderBy: { observedAt: "asc" },
    });
    const line = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    log("cenário E — recontagem", {
      observations: observations.map((o) => ({
        expected: String(o.expectedQuantity),
        counted: String(o.countedQuantity),
        delta: String(o.adjustmentDelta),
      })),
      currentObservationId: line.currentObservationId,
      version: line.version,
    });

    assert.equal(Number(second.observation.expectedQuantity), 95);
    assert.equal(Number(second.observation.adjustmentDelta), 0);
    // Append-only: Obs1 continua persistida para auditoria.
    assert.equal(observations.length, 2);
    assert.equal(Number(observations[0].adjustmentDelta), -5);
    assert.equal(line.currentObservationId, second.observation.id);
    assert.equal(line.version, 2);

    const session = await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    log("cenário E — finalize", { status: session.status });
    assert.equal(session.status, "APPROVED");

    const result = await generateInventoryCountAdjustments(prisma, f.sessionId, OPERATOR);
    assert.equal(result.movementsCreated, 0);
    assert.equal(await countAdjustmentMovements(f), 0);
    assert.equal(await physicalQuantity(f), 95);
  });

  // -------------------------------------------------------------------------
  // CENÁRIO F — linha legada (anterior ao OP-10)
  // -------------------------------------------------------------------------

  it("CENÁRIO F — linha sem Observation mantém integralmente o comportamento antigo", async () => {
    const f = await seedStartedSession(100);
    await legitimateExit(f, 20);

    // Linha histórica: contada pela semântica antiga, sem Observation.
    await prisma.inventoryCountLine.update({
      where: { id: f.lineId },
      data: {
        countedQuantity: 80,
        differenceQuantity: -20,
        differencePercent: -20,
        justification: null,
        currentObservationId: null,
      },
    });

    // Sem justificativa, a regra antiga continua bloqueando o finalize.
    await assert.rejects(
      () => finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );

    await prisma.inventoryCountLine.update({
      where: { id: f.lineId },
      data: { justification: "Justificativa da época" },
    });

    const session = await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    const observations = await observer.inventoryCountObservation.findMany({
      where: { lineId: f.lineId },
    });
    const line = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    log("cenário F — legado", {
      status: session.status,
      observations: observations.length,
      currentObservationId: line.currentObservationId,
    });

    // Mesmo cenário numérico do CENÁRIO A, mas sem Observation: divergente.
    assert.equal(session.status, "WAITING_APPROVAL");
    // Nenhuma Observation sintética, nenhum backfill.
    assert.equal(observations.length, 0);
    assert.equal(line.currentObservationId, null);
  });
});
