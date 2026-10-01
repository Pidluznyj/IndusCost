import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import {
  createMemoryExposureRepository,
  createPrismaExposureRepository,
  type LegalExposureRepository,
} from "./legalExposureRepository.server.js";
import { createLegalExposureService } from "./legalExposureService.server.js";
import type { ExposureAuditRecord, LegalExposureMemory } from "./legalExposureStore.js";
import { createEmptyExposureMemory } from "./legalExposureStore.js";

const T1 = "2026-09-30T01:25:47.816Z";
const T2 = "2026-09-30T01:26:01.185Z";
const USER = "00000000-0000-4000-8000-000000000001";
const CASE_ID = "11111111-1111-4111-8111-111111111111";
const GROUP = FINANCE_INTERNAL_GROUP_COMPANIES[0];

function sequentialIds() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function instrumentRepository(inner: ReturnType<typeof createMemoryExposureRepository>) {
  const calls = {
    persist: 0,
    appendAudit: 0,
    appended: [] as ExposureAuditRecord[],
  };
  const repository: LegalExposureRepository & {
    snapshot(): LegalExposureMemory;
    calls: typeof calls;
  } = {
    snapshot: () => inner.snapshot(),
    load: () => inner.load(),
    persist: async (next) => {
      calls.persist += 1;
      await inner.persist(next);
    },
    appendAudit: async (record) => {
      calls.appendAudit += 1;
      calls.appended.push(record);
      await inner.appendAudit(record);
    },
    listCaseReadStates: (userId) => inner.listCaseReadStates(userId),
    upsertCaseReadState: (input) => inner.upsertCaseReadState(input),
    calls,
  };
  return repository;
}

function seededService(clock: { now: string }) {
  const inner = createMemoryExposureRepository();
  const repository = instrumentRepository(inner);
  const service = createLegalExposureService({
    repository,
    createId: sequentialIds(),
    now: () => new Date(clock.now),
  });
  return { service, repository, clock };
}

async function createOfficialEntity(
  service: ReturnType<typeof createLegalExposureService>
) {
  assert.ok(GROUP);
  return service.createEntity(
    { cnpj: GROUP.cnpj, legalName: GROUP.name },
    USER
  );
}

function seedCase(memory: LegalExposureMemory, entityId: string) {
  memory.cases.push({
    id: CASE_ID,
    entityId,
    processNumber: "0001234-56.2024.5.09.0001",
    processNumberNormalized: "00012345620245090001",
    tribunal: "TRT9",
    jurisdiction: null,
    degree: null,
    courtUnit: null,
    classCode: null,
    className: null,
    filedAt: null,
    currentStatus: null,
    entityPole: "UNKNOWN",
    systemName: null,
    area: null,
    claimValue: null,
    claimCurrency: null,
    archivedAt: null,
    secrecy: null,
    priority: null,
    firstSeenAt: T1,
    lastSeenAt: T1,
    primarySource: "DATAJUD",
    sourceUpdatedAt: null,
    createdAt: T1,
    updatedAt: T1,
  });
}

function recordingPrisma() {
  const upserts: Array<{
    model: string;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }> = [];
  const creates: Array<{ model: string; data: Record<string, unknown> }> = [];
  const createdIds = new Set<string>();

  const stub = (model: string) => ({
    findMany: async () => [],
    upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      upserts.push({ model, create: args.create, update: args.update });
    },
    create: async (args: { data: Record<string, unknown> }) => {
      const id = String(args.data.id ?? "");
      if (createdIds.has(`${model}:${id}`)) {
        throw new Error(`Unique constraint failed on ${model}.id`);
      }
      createdIds.add(`${model}:${id}`);
      creates.push({ model, data: args.data });
    },
  });

  const client = {
    legalExposureEntity: stub("legalExposureEntity"),
    legalExposureEntityAlias: stub("legalExposureEntityAlias"),
    legalSourceConnection: stub("legalSourceConnection"),
    legalExposureJurisdiction: stub("legalExposureJurisdiction"),
    legalCase: stub("legalCase"),
    legalCaseEntityLink: stub("legalCaseEntityLink"),
    legalCaseSubject: stub("legalCaseSubject"),
    legalCaseHearing: stub("legalCaseHearing"),
    legalCaseAttorney: stub("legalCaseAttorney"),
    legalCaseSourceEvidence: stub("legalCaseSourceEvidence"),
    legalCaseParty: stub("legalCaseParty"),
    legalCaseMovement: stub("legalCaseMovement"),
    legalCommunication: stub("legalCommunication"),
    legalExposureEvent: stub("legalExposureEvent"),
    legalExposureAlert: stub("legalExposureAlert"),
    legalCertificate: stub("legalCertificate"),
    legalExposureAuditLog: stub("legalExposureAuditLog"),
    $transaction: async (callback: (tx: typeof client) => Promise<unknown>) => callback(client),
  };

  return { client: client as unknown as PrismaClient, upserts, creates };
}

describe("exposure read audits are append-only", () => {
  it("listCommunications registra VIEW_COMMUNICATION_METADATA sem persist global", async () => {
    const { service, repository, clock } = seededService({ now: T1 });
    await createOfficialEntity(service);
    const entity = repository.snapshot().entities[0];
    assert.ok(entity);
    assert.equal(entity.updatedAt, T1);
    repository.calls.persist = 0;
    repository.calls.appendAudit = 0;
    repository.calls.appended = [];

    clock.now = T2;
    await service.listCommunications({}, USER);

    assert.equal(repository.calls.persist, 0);
    assert.equal(repository.calls.appendAudit, 1);
    assert.equal(repository.calls.appended[0]?.action, "VIEW_COMMUNICATION_METADATA");
    assert.equal(repository.snapshot().entities[0]?.updatedAt, T1);
    assert.equal(repository.snapshot().entities[0]?.createdAt, T1);
    assert.deepEqual(
      repository.snapshot().entities.map((row) => ({
        id: row.id,
        legalName: row.legalName,
        updatedAt: row.updatedAt,
      })),
      [{ id: entity.id, legalName: entity.legalName, updatedAt: T1 }]
    );
    const viewAudits = repository.snapshot().audits.filter((row) => row.action === "VIEW_COMMUNICATION_METADATA");
    assert.equal(viewAudits.length, 1);
    assert.equal(viewAudits[0]?.occurredAt, T2);
  });

  it("getCase registra VIEW_CASE com entityId/caseId e não chama persist", async () => {
    const { service, repository, clock } = seededService({ now: T1 });
    const created = await createOfficialEntity(service);
    seedCase(repository.snapshot(), created.id);
    repository.calls.persist = 0;
    repository.calls.appendAudit = 0;
    repository.calls.appended = [];
    clock.now = T2;

    const viewed = await service.getCase(CASE_ID, USER);
    assert.equal(viewed.id, CASE_ID);
    assert.equal(viewed.entityId, created.id);
    assert.equal(repository.calls.persist, 0);
    assert.equal(repository.calls.appendAudit, 1);
    assert.equal(repository.calls.appended[0]?.action, "VIEW_CASE");
    assert.equal(repository.calls.appended[0]?.entityId, created.id);
    assert.equal(repository.calls.appended[0]?.caseId, CASE_ID);
    assert.equal(repository.snapshot().entities[0]?.updatedAt, T1);
  });

  it("timeline registra VIEW_CASE com metadata.timeline e não chama persist", async () => {
    const { service, repository, clock } = seededService({ now: T1 });
    const created = await createOfficialEntity(service);
    seedCase(repository.snapshot(), created.id);
    repository.calls.persist = 0;
    repository.calls.appendAudit = 0;
    repository.calls.appended = [];
    clock.now = T2;

    await service.timeline(CASE_ID, {}, USER);
    assert.equal(repository.calls.persist, 0);
    assert.equal(repository.calls.appendAudit, 1);
    assert.equal(repository.calls.appended[0]?.action, "VIEW_CASE");
    assert.equal(repository.calls.appended[0]?.entityId, created.id);
    assert.equal(repository.calls.appended[0]?.caseId, CASE_ID);
    assert.deepEqual(repository.calls.appended[0]?.metadata, { timeline: true });
    assert.equal(repository.snapshot().entities[0]?.updatedAt, T1);
  });
});

describe("exposure updatedAt stays semantic", () => {
  it("leitura auditada não avança updatedAt da empresa criada em T1", async () => {
    const { service, repository, clock } = seededService({ now: T1 });
    await createOfficialEntity(service);
    assert.equal(repository.snapshot().entities[0]?.createdAt, T1);
    assert.equal(repository.snapshot().entities[0]?.updatedAt, T1);

    clock.now = T2;
    await service.listCommunications({}, USER);

    const entity = repository.snapshot().entities[0];
    assert.ok(entity);
    assert.equal(entity.updatedAt, T1);
    const audit = repository.snapshot().audits.find((row) => row.action === "VIEW_COMMUNICATION_METADATA");
    assert.equal(audit?.occurredAt, T2);
    assert.equal(audit?.createdAt, T2);
  });

  it("mutação de certificado não altera updatedAt da entidade inalterada", async () => {
    const { service, repository, clock } = seededService({ now: T1 });
    const created = await createOfficialEntity(service);
    repository.calls.persist = 0;
    clock.now = T2;

    await service.registerCertificate(
      { entityId: created.id, type: "CNDT", notes: "manual" },
      USER
    );

    assert.equal(repository.calls.persist, 1);
    assert.equal(repository.snapshot().entities[0]?.updatedAt, T1);
    assert.equal(repository.snapshot().certificates[0]?.updatedAt, T2);
  });

  it("Prisma persist envia updatedAt canônico da entidade inalterada", async () => {
    const recorded = recordingPrisma();
    const repository = createPrismaExposureRepository(recorded.client);
    const memory = createEmptyExposureMemory();
    memory.entities.push({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cnpj: GROUP!.cnpj,
      legalName: GROUP!.name,
      tradeName: null,
      active: true,
      state: null,
      city: null,
      monitorDomicilio: true,
      monitorDatajud: true,
      monitorDjen: true,
      monitorCertificates: true,
      domicilioTenantId: null,
      lastSuccessfulSyncAt: null,
      createdAt: T1,
      updatedAt: T1,
    });
    memory.certificates.push({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "CNDT",
      tribunal: null,
      issuedAt: null,
      validUntil: null,
      result: "UNKNOWN",
      verificationCode: null,
      fileStorageKey: null,
      originalFileName: null,
      notes: "manual",
      registeredByUserId: USER,
      createdAt: T2,
      updatedAt: T2,
    });

    await repository.persist(memory);

    const entityUpsert = recorded.upserts.find((row) => row.model === "legalExposureEntity");
    assert.ok(entityUpsert);
    assert.equal((entityUpsert.update.updatedAt as Date).toISOString(), T1);
    assert.equal((entityUpsert.create.updatedAt as Date).toISOString(), T1);
    const certificateUpsert = recorded.upserts.find((row) => row.model === "legalCertificate");
    assert.ok(certificateUpsert);
    assert.equal((certificateUpsert.update.updatedAt as Date).toISOString(), T2);
  });

  it("Prisma appendAudit insere só o log e falha em colisão de id", async () => {
    const recorded = recordingPrisma();
    const repository = createPrismaExposureRepository(recorded.client);
    const record: ExposureAuditRecord = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userId: USER,
      action: "VIEW_COMMUNICATION_METADATA",
      entityId: null,
      caseId: null,
      communicationId: null,
      occurredAt: T2,
      metadata: {},
      createdAt: T2,
    };

    await repository.appendAudit(record);
    assert.equal(recorded.creates.length, 1);
    assert.equal(recorded.creates[0]?.model, "legalExposureAuditLog");
    assert.equal(recorded.upserts.length, 0);
    await assert.rejects(() => repository.appendAudit(record), /Unique constraint/);
  });
});
