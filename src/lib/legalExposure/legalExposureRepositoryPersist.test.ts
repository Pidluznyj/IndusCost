/**
 * Transação de `persist` do Exposure: limite próprio, atomicidade, idempotência e métricas.
 * Sem banco: um Prisma falso reproduz o que importa da transação interativa — as escritas
 * só valem se o callback terminar, e a transação é encerrada quando passa do limite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createPrismaExposureRepository,
  LEGAL_EXPOSURE_PERSIST_TRANSACTION_OPTIONS,
  type ExposurePersistMetrics,
} from "./legalExposureRepository.server.js";
import { createEmptyExposureMemory, type LegalExposureMemory } from "./legalExposureStore.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const T = "2026-10-13T12:00:00.000Z";
const PRISMA_DEFAULT_TIMEOUT_MS = 5_000;
const MODELS = [
  "legalExposureEntity",
  "legalExposureEntityAlias",
  "legalSourceConnection",
  "legalExposureJurisdiction",
  "legalCase",
  "legalCaseEntityLink",
  "legalCaseSubject",
  "legalCaseHearing",
  "legalCaseAttorney",
  "legalCaseSourceEvidence",
  "legalCaseParty",
  "legalCaseMovement",
  "legalCommunication",
  "legalExposureEvent",
  "legalExposureAlert",
  "legalCertificate",
  "legalExposureAuditLog",
] as const;

type Store = Map<string, Map<string, Record<string, unknown>>>;

/**
 * Prisma falso com relógio virtual: cada upsert custa `latencyMs`. Passado o limite da
 * transação, a próxima operação falha como no Prisma ("Transaction already closed", P2028)
 * e nada do que foi escrito é confirmado.
 */
function fakePrisma(input: { latencyMs?: number; failAt?: { model: string; nth: number }; ignoreTransactionOptions?: boolean } = {}) {
  const committed: Store = new Map(MODELS.map((model) => [model, new Map()]));
  const state = {
    clock: 0,
    transactions: [] as Array<{ options: unknown; operations: number; committed: boolean; lastModel: string | null }>,
  };

  const client = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>, options?: { timeout?: number; maxWait?: number }) => {
      const timeout = input.ignoreTransactionOptions ? PRISMA_DEFAULT_TIMEOUT_MS : options?.timeout ?? PRISMA_DEFAULT_TIMEOUT_MS;
      const staged: Store = new Map([...committed].map(([model, rows]) => [model, new Map(rows)]));
      const record = { options, operations: 0, committed: false, lastModel: null as string | null };
      state.transactions.push(record);
      const startedAt = state.clock;
      const perModel = new Map<string, number>();
      const tx = Object.fromEntries(
        MODELS.map((model) => [
          model,
          {
            upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
              state.clock += input.latencyMs ?? 0;
              record.lastModel = model;
              if (state.clock - startedAt > timeout) {
                throw Object.assign(new Error("Transaction API error: Transaction already closed"), { code: "P2028" });
              }
              const nth = (perModel.get(model) ?? 0) + 1;
              perModel.set(model, nth);
              if (input.failAt && input.failAt.model === model && input.failAt.nth === nth) {
                throw Object.assign(new Error(`Unique constraint failed on ${model}`), { code: "P2002" });
              }
              record.operations += 1;
              const rows = staged.get(model)!;
              const key = JSON.stringify(args.where);
              const existing = rows.get(key);
              rows.set(key, existing ? { ...existing, ...args.update } : { ...args.create });
            },
          },
        ])
      );
      const result = await callback(tx);
      // Só chega aqui se o callback terminou: é quando a transação confirma.
      for (const [model, rows] of staged) committed.set(model, rows);
      record.committed = true;
      return result;
    },
  };

  const count = () => Object.fromEntries([...committed].map(([model, rows]) => [model, rows.size]));
  return { client: client as unknown as PrismaClient, committed, state, count };
}

/** Volume confirmado na AWS: 3 entidades, 9 processos, 9 vínculos, 91 evidências, 70 comunicações, 640 eventos, 350 auditorias. */
function productionSizedMemory(): LegalExposureMemory {
  const memory = createEmptyExposureMemory();
  const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, "0")}`;
  const many = <T>(total: number, build: (n: number) => T): T[] => Array.from({ length: total }, (_, index) => build(index + 1));

  memory.entities = many(3, (n) => ({ id: id("ent", n), cnpj: String(n).padStart(14, "0"), legalName: `Empresa ${n}`, active: true, createdAt: T, updatedAt: T })) as never;
  memory.connections = many(9, (n) => ({
    id: id("conn", n),
    entityId: id("ent", ((n - 1) % 3) + 1),
    source: ["DJEN", "DATAJUD", "DOMICILIO"][(n - 1) % 3],
    environment: "production",
    enabled: true,
    status: "HEALTHY",
    lastAttemptAt: T,
    lastSuccessfulAt: T,
    lastFullSyncAt: (n - 1) % 3 === 2 ? T : null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessageSanitized: null,
    sourceUpdatedAt: null,
    createdAt: T,
    updatedAt: T,
  })) as never;
  memory.cases = many(9, (n) => ({
    id: id("case", n),
    entityId: id("ent", ((n - 1) % 3) + 1),
    processNumber: `000${n}000-00.2026.5.09.0001`,
    processNumberNormalized: `000${n}0000020265090001`,
    entityPole: "PASSIVE",
    primarySource: "DJEN",
    firstSeenAt: T,
    lastSeenAt: T,
    createdAt: T,
    updatedAt: T,
  })) as never;
  memory.entityLinks = many(9, (n) => ({
    // O repositório só grava vínculos com id em formato UUID.
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    caseId: id("case", n),
    entityId: id("ent", ((n - 1) % 3) + 1),
    pole: "PASSIVE",
    confidence: "CONFIRMED",
    firstSource: "DJEN",
    lastSource: "DATAJUD",
    firstSeenAt: T,
    lastSeenAt: T,
    createdAt: T,
    updatedAt: T,
  })) as never;
  memory.evidences = many(91, (n) => ({
    id: id("evid", n),
    caseId: id("case", ((n - 1) % 9) + 1),
    source: "DJEN",
    sourceIdentifier: id("src", n),
    confidence: "CONFIRMED",
    firstSeenAt: T,
    lastSeenAt: T,
    sourceUpdatedAt: null,
    rawMetadata: {},
    rawHash: null,
    createdAt: T,
    updatedAt: T,
  })) as never;
  memory.communications = many(70, (n) => ({
    id: id("comm", n),
    entityId: id("ent", ((n - 1) % 3) + 1),
    caseId: id("case", ((n - 1) % 9) + 1),
    source: "DJEN",
    sourceCommunicationId: id("pub", n),
    idempotencyKey: `DJEN:-:${id("pub", n)}`,
    processNumber: null,
    communicationType: "INTIMACAO",
    subject: "Conteúdo jurídico que não pode aparecer em métrica",
    sourceStatus: "N",
    normalizedStatus: "PENDING",
    availableAt: T,
    detectedAt: T,
    scienceDeadlineAt: null,
    sourceScienceAt: null,
    officialContentOpenedAt: null,
    officialContentOpenedByUserId: null,
    tribunal: "TRT9",
    courtUnit: null,
    rawMetadata: {},
    rawHash: null,
    firstSeenAt: T,
    lastSeenAt: T,
    createdAt: T,
    updatedAt: T,
  })) as never;
  memory.events = many(640, (n) => ({
    id: id("evt", n),
    eventKey: `NEW_MOVEMENT:${n}`,
    entityId: id("ent", ((n - 1) % 3) + 1),
    caseId: id("case", ((n - 1) % 9) + 1),
    communicationId: null,
    source: "DATAJUD",
    eventType: "NEW_MOVEMENT",
    severity: "LOW",
    detectedAt: T,
    payload: {},
    payloadHash: "h",
    createdAt: T,
  })) as never;
  memory.audits = many(350, (n) => ({
    id: id("aud", n),
    userId: null,
    action: "MANUAL_SYNC",
    entityId: null,
    caseId: null,
    communicationId: null,
    occurredAt: T,
    metadata: {},
    createdAt: T,
  })) as never;
  return memory;
}

const PRODUCTION_ROWS = 3 + 9 + 9 + 9 + 91 + 70 + 640 + 350;

describe("exposure persist — limite próprio da transação", () => {
  it("usa 30 s de timeout e 10 s de espera por conexão, só nesta transação", async () => {
    assert.deepEqual(LEGAL_EXPOSURE_PERSIST_TRANSACTION_OPTIONS, { timeout: 30_000, maxWait: 10_000 });
    const prisma = fakePrisma();
    await createPrismaExposureRepository(prisma.client, { onPersistMetrics: () => {} }).persist(productionSizedMemory());
    assert.equal(prisma.state.transactions.length, 1, "uma única transação: a gravação continua atômica");
    assert.deepEqual(prisma.state.transactions[0]!.options, { timeout: 30_000, maxWait: 10_000 });
  });

  it("o padrão global do Prisma não foi alterado", () => {
    const client = read("src/lib/prisma.ts");
    assert.equal(/transactionOptions|timeout|maxWait/.test(client), false);
    // No repositório, o limite aparece uma vez, na transação de persist.
    const repository = read("src/lib/legalExposure/legalExposureRepository.server.ts");
    assert.equal((repository.match(/\$transaction\(/g) ?? []).length, 1);
    assert.equal((repository.match(/LEGAL_EXPOSURE_PERSIST_TRANSACTION_OPTIONS\)\)/g) ?? []).length, 1);
  });

  it("com o volume da AWS, o limite padrão de 5 s estoura no bloco de auditoria e nada é gravado (o incidente)", async () => {
    // 5 ms por upsert: dentro da faixa de 4,2 a 6 ms deduzida da falha em produção.
    const prisma = fakePrisma({ latencyMs: 5, ignoreTransactionOptions: true });
    const metrics: ExposurePersistMetrics[] = [];
    const repository = createPrismaExposureRepository(prisma.client, { onPersistMetrics: (m) => metrics.push(m) });
    await assert.rejects(
      () => repository.persist(productionSizedMemory()),
      (error: Error & { code?: string }) => error.code === "P2028" && /Transaction already closed/.test(error.message)
    );
    const tx = prisma.state.transactions[0]!;
    assert.equal(tx.lastModel, "legalExposureAuditLog", "mesma operação reportada na falha de produção");
    assert.equal(tx.committed, false);
    assert.deepEqual([...new Set(Object.values(prisma.count()))], [0], "nada confirmado");
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]!.ok, false);
    assert.equal(metrics[0]!.errorCode, "P2028");
  });

  it("com o mesmo volume e a mesma latência, 30 s gravam tudo com folga", async () => {
    const prisma = fakePrisma({ latencyMs: 5 });
    const metrics: ExposurePersistMetrics[] = [];
    let clock = 0;
    const repository = createPrismaExposureRepository(prisma.client, {
      onPersistMetrics: (m) => metrics.push(m),
      now: () => clock + prisma.state.clock,
    });
    clock = 1_000;
    await repository.persist(productionSizedMemory());
    const tx = prisma.state.transactions[0]!;
    assert.equal(tx.committed, true);
    assert.equal(tx.operations, PRODUCTION_ROWS);
    assert.equal(metrics[0]!.ok, true);
    assert.equal(metrics[0]!.rows, PRODUCTION_ROWS);
    assert.equal(metrics[0]!.durationMs, PRODUCTION_ROWS * 5);
    assert.ok(metrics[0]!.durationMs > PRISMA_DEFAULT_TIMEOUT_MS, "passaria do limite antigo");
    assert.ok(metrics[0]!.durationMs < LEGAL_EXPOSURE_PERSIST_TRANSACTION_OPTIONS.timeout / 4, "folga de mais de 4x");
    assert.equal(metrics[0]!.nearTimeout, false);
  });

  it("30 s não é garantia: a gravação lenta ou maior continua falhando, com aviso antes", async () => {
    // 14 ms por upsert: passa de metade do limite e a métrica sinaliza.
    const warned = fakePrisma({ latencyMs: 14 });
    const metrics: ExposurePersistMetrics[] = [];
    await createPrismaExposureRepository(warned.client, {
      onPersistMetrics: (m) => metrics.push(m),
      now: () => warned.state.clock,
    }).persist(productionSizedMemory());
    assert.equal(metrics[0]!.ok, true);
    assert.equal(metrics[0]!.nearTimeout, true);

    // 26 ms por upsert: estoura os 30 s. O erro aparece; não há sucesso falso.
    const slow = fakePrisma({ latencyMs: 26 });
    await assert.rejects(
      () => createPrismaExposureRepository(slow.client, { onPersistMetrics: () => {} }).persist(productionSizedMemory()),
      /Transaction already closed/
    );
    assert.equal(slow.state.transactions[0]!.committed, false);
  });
});

describe("exposure persist — atomicidade, idempotência e checkpoints", () => {
  it("execução repetida não duplica nada e mantém os checkpoints", async () => {
    const prisma = fakePrisma({ latencyMs: 5 });
    const repository = createPrismaExposureRepository(prisma.client, { onPersistMetrics: () => {} });
    const memory = productionSizedMemory();
    await repository.persist(memory);
    const first = prisma.count();
    assert.deepEqual(
      {
        entities: first.legalExposureEntity,
        connections: first.legalSourceConnection,
        cases: first.legalCase,
        links: first.legalCaseEntityLink,
        evidences: first.legalCaseSourceEvidence,
        communications: first.legalCommunication,
        events: first.legalExposureEvent,
        audits: first.legalExposureAuditLog,
      },
      { entities: 3, connections: 9, cases: 9, links: 9, evidences: 91, communications: 70, events: 640, audits: 350 }
    );
    await repository.persist(memory);
    await repository.persist(memory);
    assert.deepEqual(prisma.count(), first);
    assert.equal(prisma.state.transactions.every((tx) => tx.committed && tx.operations === PRODUCTION_ROWS), true);

    const connections = [...prisma.committed.get("legalSourceConnection")!.values()];
    const checkpoints = connections.filter((row) => row.lastFullSyncAt instanceof Date);
    assert.equal(checkpoints.length, 3, "checkpoint do Domicílio de cada empresa");
    for (const row of checkpoints) assert.equal((row.lastFullSyncAt as Date).toISOString(), T);
    assert.equal(connections.filter((row) => row.lastFullSyncAt === null).length, 6);
  });

  it("falha no meio desfaz tudo: o estado anterior fica intacto e o erro é propagado", async () => {
    const memory = productionSizedMemory();
    const prisma = fakePrisma();
    const repository = createPrismaExposureRepository(prisma.client, { onPersistMetrics: () => {} });
    await repository.persist(memory);
    const before = prisma.count();
    const snapshot = JSON.stringify([...prisma.committed.get("legalSourceConnection")!.values()]);

    // Nova execução: mais dados e checkpoint avançado, mas uma escrita falha no meio dos eventos.
    const next = structuredClone(memory);
    next.audits.push({ ...next.audits[0]!, id: "aud-novo" });
    next.communications.push({ ...next.communications[0]!, id: "comm-novo", idempotencyKey: "DJEN:-:novo" });
    for (const connection of next.connections) connection.lastFullSyncAt = "2026-10-13T13:00:00.000Z";
    const failing = fakePrisma({ failAt: { model: "legalExposureEvent", nth: 300 } });
    for (const [model, rows] of prisma.committed) failing.committed.set(model, new Map(rows));
    const metrics: ExposurePersistMetrics[] = [];
    const failingRepository = createPrismaExposureRepository(failing.client, { onPersistMetrics: (m) => metrics.push(m) });

    await assert.rejects(
      () => failingRepository.persist(next),
      (error: Error & { code?: string }) => error.code === "P2002"
    );
    assert.equal(failing.state.transactions[0]!.committed, false);
    assert.deepEqual(failing.count(), before, "nenhuma linha nova: comunicação e auditoria não entraram");
    assert.equal(JSON.stringify([...failing.committed.get("legalSourceConnection")!.values()]), snapshot, "checkpoint não avançou");
    assert.deepEqual(metrics.map((m) => [m.ok, m.errorCode]), [[false, "P2002"]]);
  });

  it("o sincronizador não transforma a falha em sucesso: o processo termina com erro para o systemd", () => {
    const cli = read("scripts/legalExposureSync.ts");
    assert.equal(/\bcatch\b/.test(cli), false, "a linha de comando não engole exceção");
    assert.match(cli, /await service\.sync\(/);
    const service = read("src/lib/legalExposure/legalExposureService.server.ts");
    // O único catch do sync marca a execução como FAILED e relança.
    assert.match(service, /status: "FAILED",[\s\S]{0,260}throw error;/);
  });
});

describe("exposure persist — métricas agregadas", () => {
  it("informa duração e contagens, sem conteúdo jurídico, documento ou identificador", async () => {
    const prisma = fakePrisma({ latencyMs: 5 });
    const metrics: ExposurePersistMetrics[] = [];
    await createPrismaExposureRepository(prisma.client, {
      onPersistMetrics: (m) => metrics.push(m),
      now: () => prisma.state.clock,
    }).persist(productionSizedMemory());
    const metric = metrics[0]!;
    assert.deepEqual(Object.keys(metric).sort(), ["byCollection", "durationMs", "errorCode", "nearTimeout", "ok", "rows", "timeoutMs"]);
    assert.equal(metric.timeoutMs, 30_000);
    assert.equal(metric.byCollection.entities, 3);
    assert.equal(metric.byCollection.cases, 9);
    assert.equal(metric.byCollection.evidences, 91);
    assert.equal(metric.byCollection.communications, 70);
    assert.equal(metric.byCollection.events, 640);
    assert.equal(metric.byCollection.audits, 350);
    for (const value of Object.values(metric.byCollection)) assert.equal(typeof value, "number");
    const serialized = JSON.stringify(metric);
    for (const leak of ["Conteúdo jurídico", "Empresa 1", "2026.5.09", "comm-0001", "00000000000001"]) {
      assert.equal(serialized.includes(leak), false, leak);
    }
  });

  it("erro sem código do Prisma vira só o nome do erro, nunca a mensagem", async () => {
    const prisma = fakePrisma();
    const client = prisma.client as unknown as { $transaction: unknown };
    client.$transaction = async () => {
      throw new TypeError("falha com dado sensível 0001384-86.2026.5.09.0009");
    };
    const metrics: ExposurePersistMetrics[] = [];
    await assert.rejects(
      () => createPrismaExposureRepository(prisma.client, { onPersistMetrics: (m) => metrics.push(m) }).persist(createEmptyExposureMemory()),
      TypeError
    );
    assert.equal(metrics[0]!.errorCode, "TypeError");
    assert.equal(JSON.stringify(metrics[0]).includes("0001384"), false);
  });

  it("sem coletor configurado, a métrica vai para stderr em uma linha e stdout fica limpo", async () => {
    const prisma = fakePrisma();
    const lines: string[] = [];
    const originalErr = process.stderr.write.bind(process.stderr);
    const originalOut = process.stdout.write.bind(process.stdout);
    let stdoutWrites = 0;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
      stdoutWrites += 1;
      return originalOut(...args);
    }) as typeof process.stdout.write;
    try {
      await createPrismaExposureRepository(prisma.client).persist(createEmptyExposureMemory());
    } finally {
      process.stderr.write = originalErr;
      process.stdout.write = originalOut;
    }
    assert.equal(stdoutWrites, 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^\[legal-exposure\] persist \{"ok":true,.*\}\n$/);
  });
});
