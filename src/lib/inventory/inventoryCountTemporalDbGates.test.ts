/**
 * OP-10 — gates que EXIGEM PostgreSQL real.
 *
 * Concorrência (FOR UPDATE) e rollback transacional não podem ser declarados
 * aprovados com mock: o mock não tem lock nem atomicidade. Este harness roda
 * apenas quando um banco de TESTE é apontado explicitamente:
 *
 *   INVENTORY_TEMPORAL_DB_URL=postgresql://.../induscost_test
 *
 * Nunca cai no DATABASE_URL do ambiente por conta própria — o banco recebe
 * INSERT/UPDATE e precisa ser descartável. Sem a variável, os testes ficam
 * DB_GATE_PENDING (skip explícito, jamais PASS falso).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { recordInventoryCountInTx } from "./inventoryCountApplicationService.server.js";

export const DB_GATE_PENDING =
  "DB_GATE_PENDING — defina INVENTORY_TEMPORAL_DB_URL (PostgreSQL descartável) para executar";

/** URL do banco de teste. Opt-in explícito, sem fallback para DATABASE_URL. */
export function resolveTemporalDbUrl(): string | null {
  const url = process.env.INVENTORY_TEMPORAL_DB_URL?.trim();
  return url ? url : null;
}

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

/** Espera ativa com deadline — usada só para orquestrar as duas transações. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Fixture = {
  itemId: string;
  warehouseId: string;
  sessionId: string;
  lineId: string;
  balanceId: string;
};

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

describe("OP-10 DB gate — concorrência real FOR UPDATE", { skip: gate }, () => {
  let a: PrismaClient;
  let b: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    a = client();
    b = client();
    await a.$connect();
    await b.$connect();
  });

  after(async () => {
    for (const f of created.reverse()) {
      await a.inventoryCountObservation.deleteMany({ where: { lineId: f.lineId } });
      await a.inventoryCountLine.deleteMany({ where: { sessionId: f.sessionId } });
      await a.inventoryCountSession.deleteMany({ where: { id: f.sessionId } });
      await a.inventoryBalance.deleteMany({ where: { id: f.balanceId } });
      await a.inventoryItem.deleteMany({ where: { id: f.itemId } });
      await a.inventoryWarehouse.deleteMany({ where: { id: f.warehouseId } });
    }
    await a.$disconnect();
    await b.$disconnect();
  });

  async function seed(physicalQuantity: number, systemQuantity: number): Promise<Fixture> {
    const stamp = `OP10-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const warehouse = await a.inventoryWarehouse.create({
      data: { code: stamp, name: stamp, status: "ACTIVE" },
    });
    const item = await a.inventoryItem.create({
      data: {
        code: stamp,
        description: stamp,
        itemType: "RAW_MATERIAL",
        unit: "UN",
        status: "ACTIVE",
      },
    });
    const balance = await a.inventoryBalance.create({
      data: {
        itemId: item.id,
        warehouseId: warehouse.id,
        balanceKey: warehouse.id,
        physicalQuantity,
        reservedQuantity: 0,
        blockedQuantity: 0,
        quarantineQuantity: 0,
        availableQuantity: physicalQuantity,
      },
    });
    const session = await a.inventoryCountSession.create({
      data: { code: stamp, warehouseId: warehouse.id, status: "COUNTING" },
    });
    const line = await a.inventoryCountLine.create({
      data: {
        sessionId: session.id,
        itemId: item.id,
        warehouseId: warehouse.id,
        systemQuantity,
      },
    });
    const fixture: Fixture = {
      itemId: item.id,
      warehouseId: warehouse.id,
      sessionId: session.id,
      lineId: line.id,
      balanceId: balance.id,
    };
    created.push(fixture);
    return fixture;
  }

  it("CASO A — movimento trava primeiro: a contagem espera e lê o saldo pós-movimento", async () => {
    // START fotografou 100; o saldo materializado ainda é 100.
    const f = await seed(100, 100);
    const locked = deferred();
    const countStarted = deferred();

    const movement = a.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "InventoryBalance" WHERE id = ${f.balanceId}::uuid FOR UPDATE`;
        locked.resolve();
        // Mantém o lock enquanto a contagem tenta adquiri-lo.
        await countStarted.promise;
        await sleep(300);
        await tx.inventoryBalance.update({
          where: { id: f.balanceId },
          data: { physicalQuantity: 80, availableQuantity: 80 },
        });
      },
      { timeout: 20000 }
    );

    await locked.promise;
    const count = b.$transaction(
      async (tx) =>
        recordInventoryCountInTx(
          tx,
          {
            sessionId: f.sessionId,
            lineId: f.lineId,
            countedQuantity: 80,
            justification: "Contagem sob concorrência",
          },
          { userId: "op10-user" }
        ),
      { timeout: 20000 }
    );
    countStarted.resolve();

    await movement;
    const { observation } = await count;

    // A contagem esperou o commit do movimento: esperado = 80, não 100.
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.countedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), 0);
  });

  it("CASO B — contagem trava primeiro: Observation mantém o saldo pré-movimento", async () => {
    const f = await seed(100, 100);
    const counted = deferred();
    const movementDone = deferred();

    const count = b.$transaction(
      async (tx) => {
        const result = await recordInventoryCountInTx(
          tx,
          {
            sessionId: f.sessionId,
            lineId: f.lineId,
            countedQuantity: 95,
            justification: "Contagem antes do movimento",
          },
          { userId: "op10-user" }
        );
        counted.resolve();
        // Segura o lock; o movimento abaixo precisa esperar.
        await sleep(300);
        return result;
      },
      { timeout: 20000 }
    );

    await counted.promise;
    let movementAcquiredLockBeforeCountCommit = false;
    let countCommitted = false;

    const movement = a.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "InventoryBalance" WHERE id = ${f.balanceId}::uuid FOR UPDATE`;
        if (!countCommitted) movementAcquiredLockBeforeCountCommit = true;
        await tx.inventoryBalance.update({
          where: { id: f.balanceId },
          data: { physicalQuantity: 80, availableQuantity: 80 },
        });
        movementDone.resolve();
      },
      { timeout: 20000 }
    );

    const { observation } = await count;
    countCommitted = true;
    await movement;
    await movementDone.promise;

    assert.equal(
      movementAcquiredLockBeforeCountCommit,
      false,
      "o movimento não pode travar o saldo antes do commit da contagem"
    );
    // O −20 posterior não reescreve a Observation.
    assert.equal(Number(observation.expectedQuantity), 100);
    assert.equal(Number(observation.adjustmentDelta), -5);

    const balance = await a.inventoryBalance.findUnique({ where: { id: f.balanceId } });
    assert.equal(Number(balance?.physicalQuantity), 80);
  });
});

describe("OP-10 DB gate — rollback transacional real", { skip: gate }, () => {
  let prisma: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    prisma = client();
    await prisma.$connect();
  });

  after(async () => {
    for (const f of created.reverse()) {
      await prisma.inventoryCountObservation.deleteMany({ where: { lineId: f.lineId } });
      await prisma.inventoryCountLine.deleteMany({ where: { sessionId: f.sessionId } });
      await prisma.inventoryCountSession.deleteMany({ where: { id: f.sessionId } });
      await prisma.inventoryBalance.deleteMany({ where: { id: f.balanceId } });
      await prisma.inventoryItem.deleteMany({ where: { id: f.itemId } });
      await prisma.inventoryWarehouse.deleteMany({ where: { id: f.warehouseId } });
    }
    await prisma.$disconnect();
  });

  it("falha depois de criar a Observation e antes do commit não deixa rastro", async () => {
    const stamp = `OP10R-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
        balanceKey: warehouse.id,
        physicalQuantity: 100,
        reservedQuantity: 0,
        blockedQuantity: 0,
        quarantineQuantity: 0,
        availableQuantity: 100,
      },
    });
    const session = await prisma.inventoryCountSession.create({
      data: { code: stamp, warehouseId: warehouse.id, status: "COUNTING" },
    });
    const line = await prisma.inventoryCountLine.create({
      data: {
        sessionId: session.id,
        itemId: item.id,
        warehouseId: warehouse.id,
        systemQuantity: 100,
      },
    });
    created.push({
      itemId: item.id,
      warehouseId: warehouse.id,
      sessionId: session.id,
      lineId: line.id,
      balanceId: balance.id,
    });

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await recordInventoryCountInTx(
            tx,
            {
              sessionId: session.id,
              lineId: line.id,
              countedQuantity: 95,
              justification: "Vai falhar",
            },
            { userId: "op10-user" }
          );
          throw new Error("OP10_FORCED_ROLLBACK");
        }),
      /OP10_FORCED_ROLLBACK/
    );

    const observations = await prisma.inventoryCountObservation.findMany({
      where: { lineId: line.id },
    });
    assert.equal(observations.length, 0, "Observation não pode sobreviver ao rollback");

    const after = await prisma.inventoryCountLine.findUnique({ where: { id: line.id } });
    assert.equal(after?.countedQuantity, null);
    assert.equal(after?.currentObservationId, null);
    assert.equal(after?.version, 0);
    assert.equal(Number(after?.systemQuantity), 100);
  });
});
