/**
 * FASE 2D — contagem via DEVICE em PostgreSQL REAL (DB-D1..DB-D6).
 *
 * Prova que o ator DEVICE atravessa o motor canônico com as MESMAS garantias
 * certificadas para USER: CAS entre conexões independentes, idempotência com
 * corrida real, rollback sem resíduo e serialização temporal no
 * InventoryBalance FOR UPDATE.
 *
 * Tailscale NÃO participa deste gate — a identidade do dispositivo entra como
 * contexto já resolvido (o gate Tailscale real da 2C existe separadamente).
 *
 * Opt-in explícito via INVENTORY_TEMPORAL_DB_URL (mesma convenção dos gates
 * 2A/2B: banco DESCARTÁVEL com "inventory_temporal_gate" no nome; sem fallback
 * para DATABASE_URL). Exige a migration da 2C aplicada.
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

/** Movimentações do cenário DB-D6 continuam humanas — DEVICE não movimenta. */
const HUMAN = {
  userId: "op10-2d-human",
  permissions: ["inventory.manage", "inventory.count.manage"],
} as const;

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

function log(label: string, payload: unknown): void {
  console.log(`[OP-10 2D GATE] ${label}: ${JSON.stringify(payload)}`);
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
  deviceA: string;
  deviceB: string;
};

describe("FASE 2D — contagem DEVICE em PostgreSQL real", { skip: gate }, () => {
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
      await observer.inventoryCollectorDevice.deleteMany({
        where: { id: { in: [f.deviceA, f.deviceB] } },
      });
      await observer.inventoryAuditLog.deleteMany({ where: { entityId: f.lineId } });
    }
    await Promise.all([clientA.$disconnect(), clientB.$disconnect(), observer.$disconnect()]);
  });

  async function seed(physicalQuantity: number): Promise<Fixture> {
    const stamp = `OP10D-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
    // Dois dispositivos REAIS do registry (tabela da migration 2C).
    const deviceA = await observer.inventoryCollectorDevice.create({
      data: { name: `${stamp}-A`, tailscaleStableNodeId: `${stamp}-nA` },
    });
    const deviceB = await observer.inventoryCollectorDevice.create({
      data: { name: `${stamp}-B`, tailscaleStableNodeId: `${stamp}-nB` },
    });

    const fixture: Fixture = {
      itemId: item.id,
      warehouseId: warehouse.id,
      balanceId: balance.id,
      sessionId: session.id,
      lineId: line.id,
      deviceA: deviceA.id,
      deviceB: deviceB.id,
    };
    created.push(fixture);
    return fixture;
  }

  /** Exatamente o que a rota Collector monta: identidade server-side DEVICE. */
  function deviceCount(
    c: PrismaClient,
    f: Fixture,
    deviceId: string,
    input: {
      countedQuantity: number;
      justification?: string | null;
      expectedVersion: number;
      operationId: string;
    }
  ) {
    return recordInventoryCount(
      c,
      {
        sessionId: f.sessionId,
        lineId: f.lineId,
        countedQuantity: input.countedQuantity,
        justification: input.justification ?? null,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
        actorType: "DEVICE",
        deviceId,
      },
      { userId: null }
    );
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
    return { version: line.version, observations, operations, audits };
  }

  it("DB-D1 — DEVICE registra Observation com actorType DEVICE, deviceId correto e userId null", async () => {
    const f = await seed(100);
    const { snapshot } = await deviceCount(clientA, f, f.deviceA, {
      countedQuantity: 95,
      justification: "Falta apurada pelo coletor",
      expectedVersion: 0,
      operationId: `${f.lineId}-d1`,
    });

    const observation = await observer.inventoryCountObservation.findUniqueOrThrow({
      where: { id: snapshot.observationId },
    });
    const operation = await observer.inventoryCountOperation.findFirstOrThrow({
      where: { lineId: f.lineId },
    });
    const audit = await observer.inventoryAuditLog.findFirstOrThrow({
      where: { entityId: f.lineId, action: "COUNT_RECORDED" },
    });

    log("DB-D1", {
      actorType: observation.actorType,
      deviceId: observation.deviceId,
      userId: observation.userId,
      expectedQuantity: String(observation.expectedQuantity),
      adjustmentDelta: String(observation.adjustmentDelta),
    });

    assert.equal(observation.actorType, "DEVICE");
    assert.equal(observation.deviceId, f.deviceA);
    assert.equal(observation.userId, null);
    assert.equal(operation.actorType, "DEVICE");
    assert.equal(operation.deviceId, f.deviceA);
    assert.equal(operation.userId, null);
    assert.equal(audit.userId, null);
    assert.equal((audit.afterJson as Record<string, unknown>).actorType, "DEVICE");
    assert.equal((audit.afterJson as Record<string, unknown>).deviceId, f.deviceA);
  });

  it("DB-D2 — CAS concorrente entre dois DEVICEs: 1 sucesso, 1 conflito", async () => {
    const f = await seed(100);
    const settled = await Promise.allSettled([
      deviceCount(clientA, f, f.deviceA, {
        countedQuantity: 95,
        justification: "A",
        expectedVersion: 0,
        operationId: `${f.lineId}-d2a`,
      }),
      deviceCount(clientB, f, f.deviceB, {
        countedQuantity: 90,
        justification: "B",
        expectedVersion: 0,
        operationId: `${f.lineId}-d2b`,
      }),
    ]);
    const ok = settled.filter((r) => r.status === "fulfilled");
    const conflicts = settled.filter(
      (r) => r.status === "rejected" && errorCode(r.reason) === COUNT_LINE_VERSION_CONFLICT
    );
    const state = await countState(f);
    log("DB-D2", { ok: ok.length, conflicts: conflicts.length, ...state });

    assert.equal(ok.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(state.version, 1);
    assert.equal(state.observations, 1);
    assert.equal(state.audits, 1);
    assert.equal(state.operations, 1);
  });

  it("DB-D3 — mesma operationId em duas conexões do MESMO device: uma execução, um replay", async () => {
    const f = await seed(100);
    const input = {
      countedQuantity: 95,
      justification: "Falta",
      expectedVersion: 0,
      operationId: `${f.lineId}-d3`,
    };
    const settled = await Promise.allSettled([
      deviceCount(clientA, f, f.deviceA, input),
      deviceCount(clientB, f, f.deviceA, input),
    ]);
    const fulfilled = settled.filter((r) => r.status === "fulfilled") as Array<
      PromiseFulfilledResult<Awaited<ReturnType<typeof deviceCount>>>
    >;
    const state = await countState(f);
    log("DB-D3", {
      fulfilled: fulfilled.length,
      executados: fulfilled.filter((r) => !r.value.replayed).length,
      replays: fulfilled.filter((r) => r.value.replayed).length,
      ...state,
    });

    assert.equal(fulfilled.length, 2);
    assert.equal(fulfilled.filter((r) => !r.value.replayed).length, 1);
    assert.equal(fulfilled.filter((r) => r.value.replayed).length, 1);
    assert.deepEqual(fulfilled[0].value.snapshot, fulfilled[1].value.snapshot);
    assert.equal(state.observations, 1);
    assert.equal(state.version, 1);
    assert.equal(state.audits, 1);
  });

  it("DB-D4 — mesma operationId em DOIS devices: conflito, nenhum segundo efeito", async () => {
    const f = await seed(100);
    const operationId = `${f.lineId}-d4`;
    await deviceCount(clientA, f, f.deviceA, {
      countedQuantity: 95,
      justification: "Primeiro device",
      expectedVersion: 0,
      operationId,
    });
    const before = await countState(f);

    await assert.rejects(
      () =>
        deviceCount(clientB, f, f.deviceB, {
          countedQuantity: 95,
          justification: "Primeiro device",
          expectedVersion: 0,
          operationId,
        }),
      (e: unknown) => errorCode(e) === COUNT_OPERATION_IDEMPOTENCY_CONFLICT
    );
    const afterState = await countState(f);
    log("DB-D4", { before, after: afterState });

    assert.deepEqual(afterState, before);
  });

  it("DB-D5 — rollback: zero Operation/Observation/Audit residual, version intacta, retry funciona", async () => {
    const f = await seed(100);
    const operationId = `${f.lineId}-d5`;

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
              actorType: "DEVICE",
              deviceId: f.deviceA,
            },
            { userId: null }
          );
          throw new Error("OP10_2D_FORCED_ROLLBACK");
        }),
      /OP10_2D_FORCED_ROLLBACK/
    );

    const afterFail = await countState(f);
    log("DB-D5 — após rollback", afterFail);
    assert.deepEqual(afterFail, { version: 0, observations: 0, operations: 0, audits: 0 });

    const retry = await deviceCount(clientA, f, f.deviceA, {
      countedQuantity: 95,
      justification: "Agora vai",
      expectedVersion: 0,
      operationId,
    });
    assert.equal(retry.replayed, false);
    const afterRetry = await countState(f);
    log("DB-D5 — retry", afterRetry);
    assert.deepEqual(afterRetry, { version: 1, observations: 1, operations: 1, audits: 1 });
  });

  it("DB-D6 — movimento + contagem DEVICE: mesma serialização temporal da 2A", async () => {
    const f = await seed(100);

    // Movimento legítimo ANTES da contagem.
    await createInventoryMovement(
      observer,
      {
        itemId: f.itemId,
        movementType: "MANUAL_EXIT",
        quantity: 20,
        unit: "UN",
        reason: "Saída antes da contagem DEVICE",
        sourceWarehouseId: f.warehouseId,
        originType: "MANUAL",
      },
      HUMAN
    );

    const { snapshot } = await deviceCount(clientA, f, f.deviceA, {
      countedQuantity: 80,
      expectedVersion: 0,
      operationId: `${f.lineId}-d6a`,
    });
    log("DB-D6 — antes", snapshot);
    assert.equal(snapshot.expectedQuantity, 80);
    assert.equal(snapshot.adjustmentDelta, 0);
    assert.equal(snapshot.differenceQuantity, -20);

    // Movimento DEPOIS da contagem não reescreve a Observation.
    await createInventoryMovement(
      observer,
      {
        itemId: f.itemId,
        movementType: "MANUAL_EXIT",
        quantity: 10,
        unit: "UN",
        reason: "Saída depois da contagem DEVICE",
        sourceWarehouseId: f.warehouseId,
        originType: "MANUAL",
      },
      HUMAN
    );
    const observation = await observer.inventoryCountObservation.findUniqueOrThrow({
      where: { id: snapshot.observationId },
    });
    const balance = await observer.inventoryBalance.findUniqueOrThrow({
      where: { id: f.balanceId },
    });
    log("DB-D6 — depois", {
      adjustmentDelta: String(observation.adjustmentDelta),
      expectedQuantity: String(observation.expectedQuantity),
      saldo: String(balance.physicalQuantity),
    });
    assert.equal(Number(observation.adjustmentDelta), 0);
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(balance.physicalQuantity), 70);
  });
});
