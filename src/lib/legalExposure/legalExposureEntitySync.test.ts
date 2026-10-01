import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import type { NormalizedCaseObservation, NormalizedSourceBatch } from "./legalExposureContracts.js";
import { createMemoryExposureRepository } from "./legalExposureRepository.server.js";
import { createLegalExposureService, type ExposureRunners } from "./legalExposureService.server.js";
import { createEmptyExposureMemory, type LegalExposureMemory } from "./legalExposureStore.js";
import { DJEN_EMPTY_QUERY_MESSAGE } from "./sources/djen/djenContracts.js";
import { searchDjen } from "./sources/djen/djenClient.server.js";
import { runDjenSync } from "./sources/djen/djenSyncRunner.server.js";

const USER = "00000000-0000-4000-8000-000000000099";
const PROCESS = "00002860620215090021";
const G1 = "TRT9_G1_00002860620215090021";
const G2 = "TRT9_G2_00002860620215090021";
const PROCESS_B = "00011111111111111111";
const PROCESS_C = "00022222222222222222";

function sequentialIds() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function emptyBatch(source: NormalizedSourceBatch["source"], extra?: Partial<NormalizedSourceBatch>): NormalizedSourceBatch {
  return {
    source,
    outcome: "NO_RESULTS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
    ...extra,
  };
}

function observation(partial: Partial<NormalizedCaseObservation> & Pick<NormalizedCaseObservation, "processNumber" | "sourceIdentifier">): NormalizedCaseObservation {
  return {
    tribunal: "TRT9",
    jurisdiction: null,
    degree: null,
    courtUnit: null,
    classCode: null,
    className: null,
    filedAt: null,
    currentStatus: null,
    entityPole: "UNKNOWN",
    sourceUpdatedAt: null,
    explicitCnpj: null,
    candidateName: null,
    officialIdentifier: partial.sourceIdentifier,
    parties: [],
    movements: [],
    rawMetadata: { id: partial.sourceIdentifier },
    ...partial,
  };
}

function seedGroupEntities(memory: LegalExposureMemory) {
  const timestamp = "2026-09-30T12:00:00.000Z";
  FINANCE_INTERNAL_GROUP_COMPANIES.forEach((company, index) => {
    memory.entities.push({
      id: `entity-${index}`,
      cnpj: company.cnpj,
      legalName: company.name,
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
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

describe("exposure entity-scoped sync", () => {
  it("aplica resultado DJEN somente na empresa consultada", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const companyA = FINANCE_INTERNAL_GROUP_COMPANIES[0];
    assert.ok(companyA);
    const djenCalls: Array<{ nomeParte?: string; numeroProcesso?: string }> = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          djenCalls.push(input ?? {});
          return emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
          });
        },
      },
    });

    await service.sync({ mode: "apply", source: "DJEN", entityId: "entity-0" }, USER);
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 1);
    assert.equal(snapshot.cases[0]?.entityId, "entity-0");
    assert.equal(snapshot.evidences.length, 1);
    assert.equal(snapshot.evidences[0]?.caseId, snapshot.cases[0]?.id);
    assert.equal(snapshot.cases.filter((row) => row.entityId === "entity-1").length, 0);
    assert.equal(snapshot.cases.filter((row) => row.entityId === "entity-2").length, 0);
    assert.equal(djenCalls.length, 2);
    assert.equal(djenCalls[0]?.nomeParte, companyA.name);
    assert.equal(djenCalls[1]?.numeroProcesso, PROCESS);
  });

  it("sync global não compartilha batch entre empresas", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const names = FINANCE_INTERNAL_GROUP_COMPANIES.map((row) => row.name);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          const processNumber = input?.numeroProcesso
            ? String(input.numeroProcesso).replace(/\D/g, "")
            : input?.nomeParte === names[0]
              ? PROCESS
              : input?.nomeParte === names[1]
                ? PROCESS_B
                : PROCESS_C;
          return emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber, sourceIdentifier: processNumber, tribunal: "TRT9" })],
          });
        },
      },
    });

    await service.sync({ mode: "apply", source: "DJEN" }, USER);
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 3);
    assert.equal(snapshot.cases.find((row) => row.entityId === "entity-0")?.processNumberNormalized, PROCESS);
    assert.equal(snapshot.cases.find((row) => row.entityId === "entity-1")?.processNumberNormalized, PROCESS_B);
    assert.equal(snapshot.cases.find((row) => row.entityId === "entity-2")?.processNumberNormalized, PROCESS_C);
  });

  it("DJEN discovery usa a razão social da entidade", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const companyA = FINANCE_INTERNAL_GROUP_COMPANIES[0];
    assert.ok(companyA);
    const djenCalls: Array<{ nomeParte?: string; numeroProcesso?: string }> = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          djenCalls.push(input ?? {});
          return emptyBatch("DJEN", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "preview", source: "DJEN", entityId: "entity-0" }, USER);
    assert.equal(djenCalls.length, 1);
    assert.equal(djenCalls[0]?.nomeParte, companyA.name);
    assert.equal(djenCalls[0]?.numeroProcesso, undefined);
  });

  it("pipeline DJEN → DataJud usa o tribunal normalizado e a mesma entidade", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const datajudCalls: Array<{ processNumber?: string; tribunalAlias?: string }> = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () =>
          emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
          }),
        datajud: async (input) => {
          datajudCalls.push(input ?? {});
          return emptyBatch("DATAJUD", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [
              observation({
                processNumber: PROCESS,
                sourceIdentifier: G1,
                officialIdentifier: G1,
                degree: "G1",
                rawMetadata: { id: G1 },
              }),
              observation({
                processNumber: PROCESS,
                sourceIdentifier: G2,
                officialIdentifier: G2,
                degree: "G2",
                rawMetadata: { id: G2 },
              }),
            ],
          });
        },
      },
    });

    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.equal(datajudCalls.length, 1);
    assert.equal(datajudCalls[0]?.processNumber, PROCESS);
    assert.equal(datajudCalls[0]?.tribunalAlias, "trt9");
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 1);
    assert.equal(snapshot.cases[0]?.entityId, "entity-0");
    const datajudEvidence = snapshot.evidences.filter((row) => row.source === "DATAJUD");
    assert.equal(datajudEvidence.length, 2);
    assert.deepEqual(new Set(datajudEvidence.map((row) => row.sourceIdentifier)), new Set([G1, G2]));
    assert.equal(snapshot.cases.filter((row) => row.entityId !== "entity-0").length, 0);
  });

  it("deduplica o mesmo número/tribunal antes do DataJud", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const datajudCalls: Array<{ processNumber?: string; tribunalAlias?: string }> = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async () =>
          emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [
              observation({ processNumber: PROCESS, sourceIdentifier: `${PROCESS}-a`, tribunal: "TRT9" }),
              observation({ processNumber: PROCESS, sourceIdentifier: `${PROCESS}-b`, tribunal: "TRT9" }),
            ],
          }),
        datajud: async (input) => {
          datajudCalls.push(input ?? {});
          return emptyBatch("DATAJUD", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.equal(datajudCalls.length, 1);
    assert.equal(datajudCalls[0]?.processNumber, PROCESS);
    assert.equal(datajudCalls[0]?.tribunalAlias, "trt9");
  });

  it("preview consulta runners e não altera casos, evidências, movimentos ou alertas", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    let djenCalls = 0;
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD", { outcome: "SUCCESS", externalCall: true }),
        djen: async () => {
          djenCalls += 1;
          return emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
          });
        },
      },
    });
    await service.sync({ mode: "preview", source: "ALL", entityId: "entity-0" }, USER);
    assert.equal(djenCalls, 2);
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 0);
    assert.equal(snapshot.evidences.length, 0);
    assert.equal(snapshot.movements.length, 0);
    assert.equal(snapshot.alerts.length, 0);
  });

  it("apply do pipeline DJEN → DataJud é idempotente", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const runners: ExposureRunners = {
      domicilio: async () => emptyBatch("DOMICILIO"),
      djen: async () =>
        emptyBatch("DJEN", {
          outcome: "SUCCESS",
          externalCall: true,
          cases: [observation({ processNumber: PROCESS, sourceIdentifier: PROCESS, tribunal: "TRT9" })],
        }),
      datajud: async () =>
        emptyBatch("DATAJUD", {
          outcome: "SUCCESS",
          externalCall: true,
          cases: [
            observation({ processNumber: PROCESS, sourceIdentifier: G1, officialIdentifier: G1, rawMetadata: { id: G1 } }),
            observation({ processNumber: PROCESS, sourceIdentifier: G2, officialIdentifier: G2, rawMetadata: { id: G2 } }),
          ],
        }),
    };
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners,
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    const first = {
      cases: inner.snapshot().cases.length,
      evidences: inner.snapshot().evidences.length,
      movements: inner.snapshot().movements.length,
    };
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    const snapshot = inner.snapshot();
    assert.equal(snapshot.cases.length, 1);
    assert.equal(snapshot.cases.length, first.cases);
    assert.equal(snapshot.evidences.length, first.evidences);
    assert.equal(snapshot.movements.length, first.movements);
    assert.equal(new Set(snapshot.evidences.map((row) => `${row.source}:${row.sourceIdentifier}`)).size, snapshot.evidences.length);
  });

  it("manual run usa lock e recusa segunda execução da mesma fonte", async () => {
    const memory = createEmptyExposureMemory();
    seedGroupEntities(memory);
    let release!: (batch: NormalizedSourceBatch) => void;
    const hang = new Promise<NormalizedSourceBatch>((resolve) => {
      release = resolve;
    });
    const service = createLegalExposureService({
      repository: createMemoryExposureRepository(memory),
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async () => hang,
      },
    });
    const first = service.sync({ mode: "apply", source: "DJEN", entityId: "entity-0" }, USER);
    await Promise.resolve();
    await assert.rejects(
      () => service.sync({ mode: "apply", source: "DJEN", entityId: "entity-0" }, USER),
      (error: unknown) => error instanceof Error && error.message.includes("Execução já em andamento")
    );
    release(emptyBatch("DJEN"));
    await first;
  });
});

describe("djen empty query is fail-closed", () => {
  it("sem nome e sem número não chama a rede", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    const env = {
      LEGAL_EXPOSURE_ENABLED: "1",
      DJEN_ENABLED: "1",
      DJEN_BASE_URL: "https://fixture.invalid",
    };
    const runner = await runDjenSync({ env, fetchImpl });
    const client = await searchDjen({ env, fetchImpl, query: {} });
    assert.equal(calls, 0);
    assert.equal(runner.externalCall, false);
    assert.equal(client.externalCall, false);
    assert.equal(runner.errorMessageSanitized, DJEN_EMPTY_QUERY_MESSAGE);
    assert.equal(client.errorMessageSanitized, DJEN_EMPTY_QUERY_MESSAGE);
  });
});
