/**
 * FASE 2B — CAS e idempotência em PostgreSQL REAL.
 *
 * Mock não modela duas transações isoladas: a corrida entre dois clientes e o
 * bloqueio no índice único só existem no banco. Este harness dispara conexões
 * independentes de verdade.
 *
 * Só roda com banco DESCARTÁVEL apontado por INVENTORY_TEMPORAL_DB_URL, com o
 * mesmo guard de nome dos gates da 2A. Sem fallback para DATABASE_URL.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  COUNT_LINE_VERSION_CONFLICT,
  COUNT_OPERATION_IDEMPOTENCY_CONFLICT,
  recordInventoryCount,
  recordInventoryCountInTx,
} from "./inventoryCountApplicationService.server.js";
import { createInventoryMovement } from "./inventoryService.server.js";
import { buildInventoryBalanceKey, InventoryValidationError } from "./inventoryTypes.js";
import {
  DB_GATE_PENDING,
  assertDisposableTemporalDb,
  resolveTemporalDbUrl,
} from "./inventoryCountDbGateSupport.js";

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

const OPERATOR = {
  userId: "op10-2b-user",
  permissions: ["inventory.manage", "inventory.count.manage", "inventory.count.approve"],
} as const;

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

function log(label: string, payload: unknown): void {
  console.log(`[OP-10 2B GATE] ${label}: ${JSON.stringify(payload)}`);
}

function errorCode(e: unknown): string {
  return e instanceof InventoryValidationError ? e.code : `OUTRO:${String(e)}`;
}

type Fixture = {
  itemId: string;
  warehouseId: string;
  balanceId: string;
  sessionId: string;
  lineId: string;
};

describe("FASE 2B — CAS e idempotência em PostgreSQL real", { skip: gate }, () => {
  /** Duas conexões independentes — é isso que caracteriza a prova. */
  let clientA: PrismaClient;
  let clientB: PrismaClient;
  let observer: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    clientA = client();
    clientB = client();
    observer = client();
    await Promise.all([clientA.$connect(), clientB.$connect(), observer.$connect()]);
  });

  after(async () => {
    for (const f of [...created].reverse()) {
      await observer.inventoryCountLine.updateMany({
        where: { sessionId: f.sessionId },
        data: { currentObservationId: null, generatedMovementId: null },
      });
      await observer.inventoryCountOperation.deleteMany({ where: { sessionId: f.sessionId } });
      await observer.inventoryCountObservation.deleteMany({ where: { lineId: f.lineId } });
      await observer.inventoryCountLine.deleteMany({ where: { sessionId: f.sessionId } });
      await observer.inventoryCountSession.deleteMany({ where: { id: f.sessionId } });
      await observer.inventoryMovement.deleteMany({ where: { itemId: f.itemId } });
      await observer.inventoryBalance.deleteMany({ where: { itemId: f.itemId } });
      await observer.inventoryItem.deleteMany({ where: { id: f.itemId } });
      await observer.inventoryWarehouse.deleteMany({ where: { id: f.warehouseId } });
      await observer.inventoryAuditLog.deleteMany({ where: { entityId: f.lineId } });
      await observer.inventoryAuditLog.deleteMany({ where: { entityId: f.sessionId } });
    }
    await Promise.all([clientA.$disconnect(), clientB.$disconnect(), observer.$disconnect()]);
  });

  async function seed(physicalQuantity: number): Promise<Fixture> {
    const stamp = `OP10B-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const warehouse = await observer.inventoryWarehouse.create({
      data: { code: stamp, name: stamp, status: "ACTIVE" },
    });
    const item = await observer.inventoryItem.create({
      data: {
        code: stamp,
        description: stamp,
        itemType: "RAW_MATERIAL",
        unit: "UN",
        status: "ACTIVE",
      },
    });
    const balance = await observer.inventoryBalance.create({
      data: {
        itemId: item.id,
        warehouseId: warehouse.id,
        balanceKey: buildInventoryBalanceKey(warehouse.id, null),
        physicalQuantity,
        reservedQuantity: 0,
        blockedQuantity: 0,
        quarantineQuantity: 0,
        availableQuantity: physicalQuantity,
      },
    });
    const session = await observer.inventoryCountSession.create({
      data: { code: stamp, warehouseId: warehouse.id, status: "COUNTING" },
    });
    const line = await observer.inventoryCountLine.create({
      data: {
        sessionId: session.id,
        itemId: item.id,
        warehouseId: warehouse.id,
        systemQuantity: physicalQuantity,
      },
    });
    const fixture: Fixture = {
      itemId: item.id,
      warehouseId: warehouse.id,
      balanceId: balance.id,
      sessionId: session.id,
      lineId: line.id,
    };
    created.push(fixture);
    return fixture;
  }

  async function countState(f: Fixture) {
    const [line, observations, operations, audits] = await Promise.all([
      observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } }),
      observer.inventoryCountObservation.count({ where: { lineId: f.lineId } }),
      observer.inventoryCountOperation.count({ where: { lineId: f.lineId } }),
      observer.inventoryAuditLog.count({
        where: { entityId: f.lineId, action: "COUNT_RECORDED" },
      }),
    ]);
    return { version: line.version, line, observations, operations, audits };
  }

  // -------------------------------------------------------------------------
  // DB-1 — CAS simultâneo
  // -------------------------------------------------------------------------

  it("DB-1 — dois clientes com expectedVersion 0 ao mesmo tempo: 1 sucesso, 1 conflito", async () => {
    const f = await seed(100);

    const attempt = (c: PrismaClient, counted: number, operationId: string) =>
      recordInventoryCount(
        c,
        {
          sessionId: f.sessionId,
          lineId: f.lineId,
          countedQuantity: counted,
          justification: "Contagem concorrente",
          expectedVersion: 0,
          operationId,
        },
        OPERATOR
      );

    const settled = await Promise.allSettled([
      attempt(clientA, 95, `${f.lineId}-A`),
      attempt(clientB, 90, `${f.lineId}-B`),
    ]);

    const ok = settled.filter((r) => r.status === "fulfilled");
    const conflicts = settled.filter(
      (r) => r.status === "rejected" && errorCode(r.reason) === COUNT_LINE_VERSION_CONFLICT
    );
    const state = await countState(f);

    log("DB-1", {
      sucessos: ok.length,
      conflitos: conflicts.length,
      outros: settled.length - ok.length - conflicts.length,
      version: state.version,
      observations: state.observations,
      audits: state.audits,
    });

    assert.equal(ok.length, 1, "exatamente uma transação pode vencer o CAS");
    assert.equal(conflicts.length, 1, "a perdedora precisa ser COUNT_LINE_VERSION_CONFLICT");
    assert.equal(state.version, 1, "version final = 1");
    assert.equal(state.observations, 1, "somente uma Observation");
    assert.equal(state.audits, 1, "somente um evento de auditoria");
    // A operação da perdedora sumiu com o rollback.
    assert.equal(state.operations, 1);
  });

  // -------------------------------------------------------------------------
  // DB-2 — retry idempotente
  // -------------------------------------------------------------------------

  it("DB-2 — mesmo operationId e mesmo payload: replay sem novo efeito", async () => {
    const f = await seed(100);
    const payload = {
      sessionId: f.sessionId,
      lineId: f.lineId,
      countedQuantity: 95,
      justification: "Falta",
      expectedVersion: 0,
      operationId: `${f.lineId}-retry`,
    };

    const first = await recordInventoryCount(clientA, payload, OPERATOR);
    const second = await recordInventoryCount(clientA, payload, OPERATOR);
    const state = await countState(f);

    log("DB-2", {
      firstReplayed: first.replayed,
      secondReplayed: second.replayed,
      version: state.version,
      observations: state.observations,
      audits: state.audits,
    });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.snapshot, first.snapshot, "mesmo resultado lógico");
    assert.equal(state.observations, 1);
    assert.equal(state.version, 1, "incremento total de version = 1");
    assert.equal(state.audits, 1);
  });

  // -------------------------------------------------------------------------
  // DB-3 — conflito de idempotência
  // -------------------------------------------------------------------------

  it("DB-3 — mesmo operationId com payload diferente: conflito canônico, nada muda", async () => {
    const f = await seed(100);
    const operationId = `${f.lineId}-conflito`;

    await recordInventoryCount(
      clientA,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 95,
        justification: "Falta",
        expectedVersion: 0,
        operationId,
      },
      OPERATOR
    );
    const before = await countState(f);

    await assert.rejects(
      () =>
        recordInventoryCount(
          clientA,
          {
            sessionId: f.sessionId,
            lineId: f.lineId,
            countedQuantity: 90,
            justification: "Outro conteúdo",
            expectedVersion: 1,
            operationId,
          },
          OPERATOR
        ),
      (e: unknown) => errorCode(e) === COUNT_OPERATION_IDEMPOTENCY_CONFLICT
    );

    const afterState = await countState(f);
    log("DB-3", {
      version: afterState.version,
      observations: afterState.observations,
      audits: afterState.audits,
    });

    assert.equal(afterState.version, before.version);
    assert.equal(afterState.observations, before.observations);
    assert.equal(afterState.audits, before.audits);
    assert.equal(afterState.operations, before.operations);
  });

  // -------------------------------------------------------------------------
  // DB-4 — corrida com a MESMA chave
  // -------------------------------------------------------------------------

  it("DB-4 — mesma chave em duas conexões simultâneas: uma execução física, um replay", async () => {
    const f = await seed(100);
    const payload = {
      sessionId: f.sessionId,
      lineId: f.lineId,
      countedQuantity: 95,
      justification: "Falta",
      expectedVersion: 0,
      operationId: `${f.lineId}-corrida`,
    };

    const settled = await Promise.allSettled([
      recordInventoryCount(clientA, payload, OPERATOR),
      recordInventoryCount(clientB, payload, OPERATOR),
    ]);
    const fulfilled = settled.filter((r) => r.status === "fulfilled") as Array<
      PromiseFulfilledResult<Awaited<ReturnType<typeof recordInventoryCount>>>
    >;
    const state = await countState(f);

    log("DB-4", {
      fulfilled: fulfilled.length,
      executados: fulfilled.filter((r) => !r.value.replayed).length,
      replays: fulfilled.filter((r) => r.value.replayed).length,
      version: state.version,
      observations: state.observations,
      audits: state.audits,
      rejeitados: settled
        .filter((r) => r.status === "rejected")
        .map((r) => errorCode((r as PromiseRejectedResult).reason)),
    });

    assert.equal(fulfilled.length, 2, "ambas as requisições devem ter sucesso");
    assert.equal(fulfilled.filter((r) => !r.value.replayed).length, 1, "uma execução física");
    assert.equal(fulfilled.filter((r) => r.value.replayed).length, 1, "um replay");
    assert.deepEqual(fulfilled[0].value.snapshot, fulfilled[1].value.snapshot);
    assert.equal(state.observations, 1, "somente uma Observation");
    assert.equal(state.version, 1, "somente um incremento de version");
    assert.equal(state.audits, 1);
  });

  // -------------------------------------------------------------------------
  // DB-5 — rollback
  // -------------------------------------------------------------------------

  it("DB-5 — falha antes do commit não deixa rastro e não envenena o operationId", async () => {
    const f = await seed(100);
    const operationId = `${f.lineId}-rollback`;

    await assert.rejects(
      () =>
        clientA.$transaction(async (tx) => {
          await recordInventoryCountInTx(
            tx,
            {
              sessionId: f.sessionId,
              lineId: f.lineId,
              countedQuantity: 95,
              justification: "Vai falhar",
              expectedVersion: 0,
              operationId,
            },
            OPERATOR
          );
          throw new Error("OP10_2B_FORCED_ROLLBACK");
        }),
      /OP10_2B_FORCED_ROLLBACK/
    );

    // Conexão independente: o que sobreviveu ao rollback?
    const afterFail = await countState(f);
    const operationRow = await observer.inventoryCountOperation.findUnique({
      where: { operationId },
    });
    log("DB-5 — após rollback", {
      observations: afterFail.observations,
      operations: afterFail.operations,
      audits: afterFail.audits,
      version: afterFail.version,
      operacaoConcluida: operationRow !== null,
    });

    assert.equal(afterFail.observations, 0, "nenhuma Observation residual");
    assert.equal(afterFail.version, 0, "nenhuma mudança de version");
    assert.equal(afterFail.audits, 0, "nenhuma auditoria residual");
    assert.equal(operationRow, null, "nenhuma operação marcada como concluída");

    // Retry posterior com a MESMA chave funciona normalmente.
    const retry = await recordInventoryCount(
      clientA,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 95,
        justification: "Agora vai",
        expectedVersion: 0,
        operationId,
      },
      OPERATOR
    );
    const afterRetry = await countState(f);
    log("DB-5 — retry", {
      replayed: retry.replayed,
      version: afterRetry.version,
      observations: afterRetry.observations,
    });

    assert.equal(retry.replayed, false, "retry executa de fato");
    assert.equal(afterRetry.version, 1);
    assert.equal(afterRetry.observations, 1);
    assert.equal(afterRetry.audits, 1);
  });

  // -------------------------------------------------------------------------
  // DB-6 — CAS/idempotência não quebram a semântica temporal da 2A
  // -------------------------------------------------------------------------

  it("DB-6 — movimento antes: expectedQuantity segue o saldo sob lock, com CAS ativo", async () => {
    const f = await seed(100);
    await createInventoryMovement(
      observer,
      {
        itemId: f.itemId,
        movementType: "MANUAL_EXIT",
        quantity: 20,
        unit: "UN",
        reason: "Saída legítima antes da contagem",
        sourceWarehouseId: f.warehouseId,
        originType: "MANUAL",
      },
      OPERATOR
    );

    const { snapshot } = await recordInventoryCount(
      clientA,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 80,
        expectedVersion: 0,
        operationId: `${f.lineId}-antes`,
      },
      OPERATOR
    );
    log("DB-6 — movimento antes", {
      expectedQuantity: snapshot.expectedQuantity,
      adjustmentDelta: snapshot.adjustmentDelta,
      differenceQuantity: snapshot.differenceQuantity,
      version: snapshot.version,
    });

    assert.equal(snapshot.expectedQuantity, 80);
    assert.equal(snapshot.adjustmentDelta, 0);
    // differenceQuantity continua medindo contra a foto do START.
    assert.equal(snapshot.differenceQuantity, -20);
    assert.equal(snapshot.version, 1);
  });

  it("DB-6 — movimento depois: o delta da Observation vigente não é recalculado", async () => {
    const f = await seed(100);

    const { snapshot } = await recordInventoryCount(
      clientA,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: 95,
        justification: "Falta",
        expectedVersion: 0,
        operationId: `${f.lineId}-depois`,
      },
      OPERATOR
    );
    assert.equal(snapshot.adjustmentDelta, -5);

    await createInventoryMovement(
      observer,
      {
        itemId: f.itemId,
        movementType: "MANUAL_EXIT",
        quantity: 20,
        unit: "UN",
        reason: "Saída legítima depois da contagem",
        sourceWarehouseId: f.warehouseId,
        originType: "MANUAL",
      },
      OPERATOR
    );

    const observation = await observer.inventoryCountObservation.findUniqueOrThrow({
      where: { id: snapshot.observationId },
    });
    const balance = await observer.inventoryBalance.findUniqueOrThrow({
      where: { id: f.balanceId },
    });
    log("DB-6 — movimento depois", {
      adjustmentDelta: String(observation.adjustmentDelta),
      expectedQuantity: String(observation.expectedQuantity),
      saldoAtual: String(balance.physicalQuantity),
    });

    assert.equal(Number(observation.adjustmentDelta), -5);
    assert.equal(Number(observation.expectedQuantity), 100);
    assert.equal(Number(balance.physicalQuantity), 80);
  });

  it("DB-6 — contagem concorrente com movimento continua serializando no saldo", async () => {
    const f = await seed(100);

    // Movimento e contagem partem juntos: o FOR UPDATE da 2A precisa continuar
    // ordenando os dois, agora com CAS e operação no meio do caminho.
    const [movementResult, countResult] = await Promise.allSettled([
      createInventoryMovement(
        clientB,
        {
          itemId: f.itemId,
          movementType: "MANUAL_EXIT",
          quantity: 20,
          unit: "UN",
          reason: "Saída concorrente",
          sourceWarehouseId: f.warehouseId,
          originType: "MANUAL",
        },
        OPERATOR
      ),
      recordInventoryCount(
        clientA,
        {
          sessionId: f.sessionId,
          lineId: f.lineId,
          countedQuantity: 80,
          justification: "Contagem concorrente",
          expectedVersion: 0,
          operationId: `${f.lineId}-serial`,
        },
        OPERATOR
      ),
    ]);

    assert.equal(movementResult.status, "fulfilled");
    assert.equal(countResult.status, "fulfilled");

    const observation = await observer.inventoryCountObservation.findFirstOrThrow({
      where: { lineId: f.lineId },
    });
    const balance = await observer.inventoryBalance.findUniqueOrThrow({
      where: { id: f.balanceId },
    });
    const expected = Number(observation.expectedQuantity);
    log("DB-6 — concorrência", {
      expectedQuantity: expected,
      adjustmentDelta: String(observation.adjustmentDelta),
      saldoFinal: String(balance.physicalQuantity),
    });

    // Qualquer que seja a ordem vencedora, expectedQuantity é um dos dois
    // estados COERENTES do saldo — nunca um valor intermediário.
    assert.ok(
      expected === 100 || expected === 80,
      `expectedQuantity precisa refletir um estado consistente do saldo, veio ${expected}`
    );
    assert.equal(Number(balance.physicalQuantity), 80);
    // E o delta é sempre coerente com o que foi observado.
    assert.equal(Number(observation.adjustmentDelta), 80 - expected);
  });
});
