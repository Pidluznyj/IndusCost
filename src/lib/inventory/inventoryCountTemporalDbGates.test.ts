/**
 * OP-10 — gates que EXIGEM PostgreSQL real.
 *
 * Concorrência (FOR UPDATE) e rollback transacional não podem ser declarados
 * aprovados com mock: o mock não tem lock nem atomicidade. Este harness roda
 * apenas quando um banco DESCARTÁVEL é apontado explicitamente:
 *
 *   INVENTORY_TEMPORAL_DB_URL=postgresql://.../induscost_inventory_temporal_gate_<ts>
 *
 * Nunca cai no DATABASE_URL do ambiente por conta própria — os testes escrevem
 * dados. Além disso o nome do banco precisa conter "inventory_temporal_gate":
 * apontar para qualquer outro banco ABORTA em vez de rodar.
 *
 * A prova de espera NÃO é sleep: vem do próprio PostgreSQL —
 * pg_stat_activity.wait_event_type = 'Lock' e pg_blocking_pids(), que
 * identifica qual backend detém exatamente o lock que o outro aguarda.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { recordInventoryCountInTx } from "./inventoryCountApplicationService.server.js";
import { buildInventoryBalanceKey } from "./inventoryTypes.js";

export const DB_GATE_PENDING =
  "DB_GATE_PENDING — defina INVENTORY_TEMPORAL_DB_URL (PostgreSQL descartável) para executar";

/** Token obrigatório no nome do banco — trava contra apontar para banco oficial. */
export const TEMPORAL_DB_NAME_TOKEN = "inventory_temporal_gate";

/** PostgreSQL oficial da infraestrutura onde este gate é executado. */
export const EXPECTED_POSTGRES_MAJOR = 17;

/** Major do PostgreSQL a partir de `server_version` (ex.: "17.2" → 17). */
export function parsePostgresMajor(serverVersion: string | undefined | null): number {
  return Number.parseInt(String(serverVersion ?? "").split(".")[0], 10);
}

/** URL do banco de teste. Opt-in explícito, sem fallback para DATABASE_URL. */
export function resolveTemporalDbUrl(): string | null {
  const url = process.env.INVENTORY_TEMPORAL_DB_URL?.trim();
  return url ? url : null;
}

/** Extrai só o nome do banco — nunca devolve credencial. */
export function temporalDbName(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

/**
 * Guarda de segurança: o alvo tem de ser inequivocamente descartável.
 * Lança (aborta o gate) em vez de degradar para skip.
 */
export function assertDisposableTemporalDb(url: string): string {
  const name = temporalDbName(url);
  if (!name) {
    throw new Error("INVENTORY_TEMPORAL_DB_URL sem nome de banco — ABORTADO.");
  }
  if (!name.includes(TEMPORAL_DB_NAME_TOKEN)) {
    throw new Error(
      `ABORTADO: banco "${name}" não contém "${TEMPORAL_DB_NAME_TOKEN}". ` +
        "Os DB gates escrevem dados e só rodam em banco descartável."
    );
  }
  return name;
}

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

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

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

type TxLike = {
  $queryRaw: PrismaClient["$queryRaw"];
  $executeRawUnsafe: PrismaClient["$executeRawUnsafe"];
};

/** pid do backend PostgreSQL que atende a transação corrente. */
async function backendPid(tx: TxLike): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
  return Number(rows[0].pid);
}

export type LockWaitEvidence = {
  blockedPid: number;
  waitEventType: string;
  waitEvent: string;
  blockingPids: number[];
  observedAfterMs: number;
};

/**
 * Evidência de espera vinda do servidor: o backend `blockedPid` está em
 * wait_event_type='Lock' e pg_blocking_pids() aponta quem o bloqueia.
 * Retorna null se a espera nunca foi observada (→ gate FAIL).
 */
async function observeLockWait(
  observer: PrismaClient,
  blockedPid: number,
  timeoutMs = 15000
): Promise<LockWaitEvidence | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = await observer.$queryRaw<
      Array<{ wait_event_type: string; wait_event: string; blocking_pids: number[] }>
    >`
      SELECT coalesce(a.wait_event_type, '')::text AS wait_event_type,
             coalesce(a.wait_event, '')::text      AS wait_event,
             coalesce(pg_blocking_pids(a.pid), '{}')::int[] AS blocking_pids
      FROM pg_stat_activity a
      WHERE a.pid = ${blockedPid}
    `;
    const row = rows[0];
    if (row && row.wait_event_type === "Lock" && row.blocking_pids.length > 0) {
      return {
        blockedPid,
        waitEventType: row.wait_event_type,
        waitEvent: row.wait_event,
        blockingPids: row.blocking_pids.map(Number),
        observedAfterMs: Date.now() - started,
      };
    }
    await sleep(20);
  }
  return null;
}

/**
 * PASSO 14 — o row lock foi liberado? Tenta travar a mesma linha com
 * lock_timeout curto: sucesso imediato = lock livre.
 */
async function lockIsFree(observer: PrismaClient, balanceId: string): Promise<boolean> {
  try {
    await observer.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1000ms'");
      await tx.$queryRaw`SELECT 1 FROM "InventoryBalance" WHERE id = ${balanceId}::uuid FOR UPDATE`;
    });
    return true;
  } catch {
    return false;
  }
}

function log(label: string, payload: unknown): void {
  console.log(`[OP-10 DB GATE] ${label}: ${JSON.stringify(payload)}`);
}

// ---------------------------------------------------------------------------
// Guarda de segurança — roda SEMPRE, mesmo sem banco
// ---------------------------------------------------------------------------

describe("OP-10 DB gate — guarda do banco descartável", () => {
  it("aceita apenas banco cujo nome contém inventory_temporal_gate", () => {
    assert.equal(
      assertDisposableTemporalDb(
        "postgresql://u:p@localhost:5432/induscost_inventory_temporal_gate_1755000000"
      ),
      "induscost_inventory_temporal_gate_1755000000"
    );
    for (const unsafe of [
      "postgresql://u:p@localhost:5432/teste_bi",
      "postgresql://u:p@localhost:5432/induscost",
      "postgresql://u:p@localhost:5432/induscost_homolog",
      "postgresql://u:p@localhost:5432/",
    ]) {
      assert.throws(() => assertDisposableTemporalDb(unsafe), /ABORTADO/);
    }
  });

  it("temporalDbName não expõe credencial", () => {
    const name = temporalDbName(
      "postgresql://user:s3cr3t@host:5432/x_inventory_temporal_gate_1?schema=public"
    );
    assert.equal(name, "x_inventory_temporal_gate_1");
    assert.doesNotMatch(name, /s3cr3t/);
  });

  it("parsePostgresMajor extrai o major e não quebra com valor ausente", () => {
    assert.equal(parsePostgresMajor("17.2"), EXPECTED_POSTGRES_MAJOR);
    assert.equal(parsePostgresMajor("17.6 (Debian 17.6-1.pgdg120+1)"), 17);
    assert.equal(parsePostgresMajor("16.4"), 16);
    // O bug original: coluna inexistente virava undefined e estourava no split.
    assert.equal(Number.isNaN(parsePostgresMajor(undefined)), true);
    assert.equal(Number.isNaN(parsePostgresMajor(null)), true);
  });

  it("sem INVENTORY_TEMPORAL_DB_URL não há fallback para DATABASE_URL", () => {
    const original = process.env.INVENTORY_TEMPORAL_DB_URL;
    delete process.env.INVENTORY_TEMPORAL_DB_URL;
    try {
      assert.equal(resolveTemporalDbUrl(), null);
    } finally {
      if (original !== undefined) process.env.INVENTORY_TEMPORAL_DB_URL = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Migration / schema real
// ---------------------------------------------------------------------------

describe("OP-10 DB gate — migration e schema em PostgreSQL real", { skip: gate }, () => {
  let prisma: PrismaClient;

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    prisma = client();
    await prisma.$connect();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("PostgreSQL alvo e banco descartável identificados", async () => {
    const rows = await prisma.$queryRaw<Array<{ v: string; db: string }>>`
      SELECT version()::text AS v, current_database()::text AS db
    `;
    // `SHOW server_version` devolve a coluna chamada `server_version`; o generic
    // do $queryRaw não renomeia nada em runtime. Alias explícito é determinístico.
    const serverVersion = await prisma.$queryRaw<Array<{ n: string }>>`
      SELECT current_setting('server_version')::text AS n
    `;
    const major = parsePostgresMajor(serverVersion[0]?.n);
    log("postgres", {
      database: rows[0].db,
      server_version: serverVersion[0]?.n,
      server_major: major,
      version: rows[0].v.split(" ").slice(0, 2).join(" "),
    });
    assert.match(rows[0].db, new RegExp(TEMPORAL_DB_NAME_TOKEN));
    assert.equal(
      major,
      EXPECTED_POSTGRES_MAJOR,
      `DB gate roda no PostgreSQL ${EXPECTED_POSTGRES_MAJOR} oficial da infraestrutura; encontrado major ${major}`
    );
  });

  it("InventoryCountLine.version e currentObservationId existem com o tipo certo", async () => {
    const cols = await prisma.$queryRaw<
      Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>
    >`
      SELECT column_name::text, data_type::text, is_nullable::text, column_default::text
      FROM information_schema.columns
      WHERE table_name = 'InventoryCountLine'
        AND column_name IN ('version', 'currentObservationId', 'systemQuantity')
      ORDER BY column_name
    `;
    log("InventoryCountLine columns", cols);
    const byName = new Map(cols.map((c) => [c.column_name, c]));

    const version = byName.get("version");
    assert.ok(version, "coluna version ausente");
    assert.equal(version.data_type, "integer");
    assert.equal(version.is_nullable, "NO");
    assert.match(String(version.column_default), /0/);

    const current = byName.get("currentObservationId");
    assert.ok(current, "coluna currentObservationId ausente");
    assert.equal(current.data_type, "uuid");
    assert.equal(current.is_nullable, "YES");
  });

  it("InventoryCountObservation existe com precisão Decimal(20,6)", async () => {
    const cols = await prisma.$queryRaw<
      Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        numeric_precision: number | null;
        numeric_scale: number | null;
      }>
    >`
      SELECT column_name::text, data_type::text, is_nullable::text,
             numeric_precision::int, numeric_scale::int
      FROM information_schema.columns
      WHERE table_name = 'InventoryCountObservation'
      ORDER BY column_name
    `;
    log("InventoryCountObservation columns", cols);
    const byName = new Map(cols.map((c) => [c.column_name, c]));

    for (const expected of [
      "id",
      "lineId",
      "operationId",
      "expectedQuantity",
      "countedQuantity",
      "adjustmentDelta",
      "justification",
      "actorType",
      "userId",
      "deviceId",
      "observedAt",
      "createdAt",
    ]) {
      assert.ok(byName.has(expected), `coluna ${expected} ausente`);
    }

    for (const decimalCol of ["expectedQuantity", "countedQuantity", "adjustmentDelta"]) {
      const col = byName.get(decimalCol)!;
      assert.equal(col.data_type, "numeric");
      assert.equal(Number(col.numeric_precision), 20);
      assert.equal(Number(col.numeric_scale), 6);
      assert.equal(col.is_nullable, "NO");
    }
  });

  it("índices e constraints da Observation estão no lugar", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname::text, indexdef::text
      FROM pg_indexes
      WHERE tablename IN ('InventoryCountObservation', 'InventoryCountLine')
      ORDER BY indexname
    `;
    log("indexes", indexes.map((i) => i.indexname));
    const defs = indexes.map((i) => i.indexdef).join("\n");
    // operationId UNIQUE (fundação de idempotência — FASE 2B).
    assert.match(defs, /UNIQUE INDEX.*InventoryCountObservation.*operationId/s);
    // (lineId, observedAt) para o histórico append-only.
    assert.match(defs, /InventoryCountObservation.*lineId.*observedAt/s);
    // currentObservationId UNIQUE na linha.
    assert.match(defs, /UNIQUE INDEX.*InventoryCountLine.*currentObservationId/s);

    const fks = await prisma.$queryRaw<
      Array<{ conname: string; confdeltype: string; table_name: string }>
    >`
      SELECT c.conname::text,
             c.confdeltype::text,
             t.relname::text AS table_name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE c.contype = 'f'
        AND t.relname IN ('InventoryCountObservation', 'InventoryCountLine')
        AND (c.conname LIKE '%currentObservation%' OR c.conname LIKE '%Observation_lineId%')
      ORDER BY c.conname
    `;
    log("foreign keys", fks);
    const byName = new Map(fks.map((f) => [f.conname, f]));
    // Observation.lineId → CASCADE ('c'); Line.currentObservationId → SET NULL ('n').
    const lineFk = [...byName.values()].find((f) => f.conname.includes("Observation_lineId"));
    assert.ok(lineFk, "FK Observation.lineId ausente");
    assert.equal(lineFk.confdeltype, "c");
    const currentFk = [...byName.values()].find((f) => f.conname.includes("currentObservation"));
    assert.ok(currentFk, "FK Line.currentObservationId ausente");
    assert.equal(currentFk.confdeltype, "n");
  });

  it("registro da migration OP-10 (quando o banco tem histórico Prisma)", async () => {
    const hasLedger = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n
      FROM information_schema.tables
      WHERE table_name = '_prisma_migrations'
    `;
    if (Number(hasLedger[0].n) === 0) {
      log("migration ledger", { present: false, note: "schema criado por db push" });
      return;
    }
    const rows = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`
      SELECT migration_name::text, finished_at
      FROM _prisma_migrations
      WHERE migration_name LIKE '%inventory_count_temporal_consistency%'
    `;
    log("migration ledger", rows);
    assert.equal(rows.length, 1, "migration OP-10 não registrada");
    assert.notEqual(rows[0].finished_at, null, "migration OP-10 não concluída");
  });
});

// ---------------------------------------------------------------------------
// Concorrência real
// ---------------------------------------------------------------------------

type Fixture = {
  itemId: string;
  warehouseId: string;
  sessionId: string;
  lineId: string;
  balanceId: string;
  balanceKey: string;
};

describe("OP-10 DB gate — concorrência real FOR UPDATE", { skip: gate }, () => {
  let movementClient: PrismaClient;
  let countClient: PrismaClient;
  let observer: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    movementClient = client();
    countClient = client();
    observer = client();
    await Promise.all([
      movementClient.$connect(),
      countClient.$connect(),
      observer.$connect(),
    ]);
  });

  after(async () => {
    await cleanup(observer, created);
    await Promise.all([
      movementClient.$disconnect(),
      countClient.$disconnect(),
      observer.$disconnect(),
    ]);
  });

  async function seed(physicalQuantity: number, systemQuantity: number): Promise<Fixture> {
    const fixture = await seedFixture(observer, physicalQuantity, systemQuantity);
    created.push(fixture);
    return fixture;
  }

  it("CASO A — movimento trava primeiro: a contagem espera e lê o saldo pós-commit", async () => {
    const f = await seed(100, 100);
    const movementLocked = deferred();
    const countPid = deferred<number>();

    const movement = movementClient.$transaction(
      async (tx) => {
        const pid = await backendPid(tx);
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text FROM "InventoryBalance" WHERE id = ${f.balanceId}::uuid FOR UPDATE
        `;
        movementLocked.resolve();
        // Espera a prova, dada pelo servidor, de que a contagem está bloqueada.
        const blocked = await countPid.promise;
        const evidence = await observeLockWait(observer, blocked);
        assert.ok(evidence, "CASO A FAIL CRÍTICO: espera da contagem não observada em pg_locks");
        assert.equal(evidence.waitEventType, "Lock");
        assert.ok(
          evidence.blockingPids.includes(pid),
          "CASO A FAIL CRÍTICO: quem bloqueia a contagem não é o backend do movimento"
        );
        log("caso A — evidência de espera", {
          lockedBalanceId: rows[0].id,
          movementPid: pid,
          ...evidence,
        });

        await tx.inventoryBalance.update({
          where: { id: f.balanceId },
          data: { physicalQuantity: 80, availableQuantity: 80 },
        });
        return { pid, lockedBalanceId: rows[0].id };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    await movementLocked.promise;
    const count = countClient.$transaction(
      async (tx) => {
        countPid.resolve(await backendPid(tx));
        return recordInventoryCountInTx(
          tx,
          {
            sessionId: f.sessionId,
            lineId: f.lineId,
            countedQuantity: 80,
            justification: "Contagem sob concorrência",
          },
          { userId: "op10-user" }
        );
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const movementResult = await movement;
    const { observation, line } = await count;

    log("caso A — resultado", {
      expectedQuantity: String(observation.expectedQuantity),
      countedQuantity: String(observation.countedQuantity),
      adjustmentDelta: String(observation.adjustmentDelta),
      lineVersion: line.version,
    });

    // A contagem esperou o COMMIT do movimento: esperado = 80, não 100.
    assert.equal(Number(observation.expectedQuantity), 80);
    assert.equal(Number(observation.countedQuantity), 80);
    assert.equal(Number(observation.adjustmentDelta), 0);
    // systemQuantity (foto do START) permanece 100.
    assert.equal(Number(line.systemQuantity), 100);

    // Mesma linha de saldo disputada pelos dois lados.
    assert.equal(movementResult.lockedBalanceId, f.balanceId);

    // PASSO 14 — lock liberado após COMMIT.
    assert.equal(await lockIsFree(observer, f.balanceId), true, "lock não liberado após COMMIT");
  });

  it("CASO B — contagem trava primeiro: movimento espera e vê a Observation já commitada", async () => {
    const f = await seed(100, 100);
    const countLocked = deferred();
    const movementPid = deferred<number>();

    const count = countClient.$transaction(
      async (tx) => {
        const pid = await backendPid(tx);
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
        countLocked.resolve();
        // Prova de que o movimento está bloqueado por ESTE backend.
        const blocked = await movementPid.promise;
        const evidence = await observeLockWait(observer, blocked);
        assert.ok(evidence, "CASO B FAIL CRÍTICO: espera do movimento não observada em pg_locks");
        assert.equal(evidence.waitEventType, "Lock");
        assert.ok(
          evidence.blockingPids.includes(pid),
          "CASO B FAIL CRÍTICO: movimento não está bloqueado pelo backend da contagem"
        );
        log("caso B — evidência de espera", { countPid: pid, ...evidence });
        return { ...result, pid, evidence };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    await countLocked.promise;
    const movement = movementClient.$transaction(
      async (tx) => {
        movementPid.resolve(await backendPid(tx));
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text FROM "InventoryBalance" WHERE id = ${f.balanceId}::uuid FOR UPDATE
        `;
        // Prova determinística de ordem de serialização (sem depender de timing
        // do event loop): se o movimento só conseguiu o lock depois do COMMIT da
        // contagem, a Observation dela JÁ está visível para esta transação.
        const seen = await tx.$queryRaw<Array<{ n: number; current_id: string | null }>>`
          SELECT (SELECT count(*)::int FROM "InventoryCountObservation" WHERE "lineId" = ${f.lineId}::uuid) AS n,
                 (SELECT "currentObservationId"::text FROM "InventoryCountLine" WHERE id = ${f.lineId}::uuid) AS current_id
        `;
        await tx.inventoryBalance.update({
          where: { id: f.balanceId },
          data: { physicalQuantity: 80, availableQuantity: 80 },
        });
        return { lockedBalanceId: rows[0].id, observationsVisible: Number(seen[0].n), currentObservationId: seen[0].current_id };
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const countResult = await count;
    const movementResult = await movement;

    log("caso B — resultado", {
      expectedQuantity: String(countResult.observation.expectedQuantity),
      adjustmentDelta: String(countResult.observation.adjustmentDelta),
      movementSawObservations: movementResult.observationsVisible,
    });

    // FAIL CRÍTICO se o movimento tivesse pegado o lock antes do commit da contagem.
    assert.equal(
      movementResult.observationsVisible,
      1,
      "CASO B FAIL CRÍTICO: movimento adquiriu o lock antes do COMMIT da contagem"
    );
    assert.equal(movementResult.currentObservationId, countResult.observation.id);

    // O −20 posterior não reescreve a Observation.
    assert.equal(Number(countResult.observation.expectedQuantity), 100);
    assert.equal(Number(countResult.observation.adjustmentDelta), -5);
    assert.equal(movementResult.lockedBalanceId, f.balanceId);

    const balance = await observer.inventoryBalance.findUnique({ where: { id: f.balanceId } });
    assert.equal(Number(balance?.physicalQuantity), 80);

    // Observation permanece intacta depois do movimento.
    const persisted = await observer.inventoryCountObservation.findUnique({
      where: { id: countResult.observation.id },
    });
    assert.equal(Number(persisted?.expectedQuantity), 100);
    assert.equal(Number(persisted?.adjustmentDelta), -5);

    assert.equal(await lockIsFree(observer, f.balanceId), true, "lock não liberado após COMMIT");
  });

  it("os dois lados travam o MESMO InventoryBalance derivado do balanceKey canônico", async () => {
    const f = await seed(50, 50);
    // balanceKey é a chave canônica item/almoxarifado/endereço usada pelo ledger.
    const line = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    const expectedKey = buildInventoryBalanceKey(line.warehouseId, line.locationId);
    const balance = await observer.inventoryBalance.findUniqueOrThrow({
      where: { itemId_balanceKey: { itemId: line.itemId, balanceKey: expectedKey } },
    });
    log("mesma linha de lock", {
      balanceKeyMatchesCanonicalHelper: expectedKey === f.balanceKey,
      balanceId: balance.id,
      sameAsFixture: balance.id === f.balanceId,
    });
    assert.equal(expectedKey, f.balanceKey);
    assert.equal(balance.id, f.balanceId);
  });
});

// ---------------------------------------------------------------------------
// Rollback real
// ---------------------------------------------------------------------------

describe("OP-10 DB gate — rollback transacional real", { skip: gate }, () => {
  let prisma: PrismaClient;
  let observer: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    prisma = client();
    observer = client();
    await Promise.all([prisma.$connect(), observer.$connect()]);
  });

  after(async () => {
    await cleanup(observer, created);
    await Promise.all([prisma.$disconnect(), observer.$disconnect()]);
  });

  it("falha após criar a Observation e antes do commit não deixa rastro", async () => {
    const f = await seedFixture(observer, 100, 100);
    created.push(f);

    const before = await observer.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    assert.equal(before.countedQuantity, null);
    assert.equal(before.currentObservationId, null);
    assert.equal(before.version, 0);

    await assert.rejects(
      () =>
        prisma.$transaction(
          async (tx) => {
            const result = await recordInventoryCountInTx(
              tx,
              {
                sessionId: f.sessionId,
                lineId: f.lineId,
                countedQuantity: 95,
                justification: "Vai falhar",
              },
              { userId: "op10-user" }
            );
            // Dentro da transação a escrita existe...
            const inside = await tx.$queryRaw<Array<{ n: number }>>`
              SELECT count(*)::int AS n FROM "InventoryCountObservation" WHERE "lineId" = ${f.lineId}::uuid
            `;
            log("rollback — dentro da transação", {
              observationsInsideTx: Number(inside[0].n),
              observationId: result.observation.id,
              lineVersionInsideTx: result.line.version,
            });
            assert.equal(Number(inside[0].n), 1);
            throw new Error("OP10_FORCED_ROLLBACK");
          },
          { timeout: 30000 }
        ),
      /OP10_FORCED_ROLLBACK/
    );

    // ...e depois do ROLLBACK, visto por OUTRA conexão, não existe.
    const observations = await observer.inventoryCountObservation.findMany({
      where: { lineId: f.lineId },
    });
    const afterLine = await observer.inventoryCountLine.findUniqueOrThrow({
      where: { id: f.lineId },
    });
    log("rollback — após ROLLBACK (outra conexão)", {
      observations: observations.length,
      countedQuantity: afterLine.countedQuantity,
      currentObservationId: afterLine.currentObservationId,
      version: afterLine.version,
      systemQuantity: String(afterLine.systemQuantity),
    });

    assert.equal(observations.length, 0, "Observation não pode sobreviver ao rollback");
    assert.equal(afterLine.countedQuantity, null);
    assert.equal(afterLine.currentObservationId, null);
    assert.equal(afterLine.version, 0);
    assert.equal(Number(afterLine.systemQuantity), 100);

    // PASSO 14 — lock liberado após ROLLBACK.
    assert.equal(await lockIsFree(observer, f.balanceId), true, "lock não liberado após ROLLBACK");
  });

  it("nenhuma sessão PostgreSQL fica presa em lock após os gates", async () => {
    const stuck = await observer.$queryRaw<Array<{ pid: number; wait_event: string }>>`
      SELECT a.pid::int, coalesce(a.wait_event, '')::text AS wait_event
      FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.wait_event_type = 'Lock'
    `;
    log("sessões presas em Lock", stuck);
    assert.equal(stuck.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedFixture(
  prisma: PrismaClient,
  physicalQuantity: number,
  systemQuantity: number
): Promise<Fixture> {
  const stamp = `OP10-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
  const balanceKey = buildInventoryBalanceKey(warehouse.id, null);
  const balance = await prisma.inventoryBalance.create({
    data: {
      itemId: item.id,
      warehouseId: warehouse.id,
      balanceKey,
      physicalQuantity,
      reservedQuantity: 0,
      blockedQuantity: 0,
      quarantineQuantity: 0,
      availableQuantity: physicalQuantity,
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
      systemQuantity,
    },
  });
  return {
    itemId: item.id,
    warehouseId: warehouse.id,
    sessionId: session.id,
    lineId: line.id,
    balanceId: balance.id,
    balanceKey,
  };
}

/** Cleanup confiável — permite 3 execuções consecutivas em banco não vazio. */
async function cleanup(prisma: PrismaClient, fixtures: Fixture[]): Promise<void> {
  for (const f of [...fixtures].reverse()) {
    await prisma.inventoryCountLine.updateMany({
      where: { id: f.lineId },
      data: { currentObservationId: null },
    });
    await prisma.inventoryCountObservation.deleteMany({ where: { lineId: f.lineId } });
    await prisma.inventoryCountLine.deleteMany({ where: { sessionId: f.sessionId } });
    await prisma.inventoryCountSession.deleteMany({ where: { id: f.sessionId } });
    await prisma.inventoryBalance.deleteMany({ where: { id: f.balanceId } });
    await prisma.inventoryItem.deleteMany({ where: { id: f.itemId } });
    await prisma.inventoryWarehouse.deleteMany({ where: { id: f.warehouseId } });
  }
}
