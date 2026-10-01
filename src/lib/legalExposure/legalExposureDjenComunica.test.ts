import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { applyBatchToMemory } from "./legalExposureApply.js";
import type { NormalizedCaseObservation, NormalizedSourceBatch } from "./legalExposureContracts.js";
import { CASE_POLE_UNCONFIRMED_COPY } from "./legalExposureContracts.js";
import { listCanonicalCases } from "./legalExposureExecutive.js";
import { listCases } from "./legalExposureReadModel.js";
import { collectDatajudTargetsFromBatch } from "./legalExposurePipeline.js";
import { createMemoryExposureRepository } from "./legalExposureRepository.server.js";
import { createLegalExposureService } from "./legalExposureService.server.js";
import { createEmptyExposureMemory, type LegalExposureMemory } from "./legalExposureStore.js";
import { searchDjen } from "./sources/djen/djenClient.server.js";
import { createDjenThrottle } from "./sources/djen/djenThrottle.js";
import { mapDjenPublications } from "./sources/djen/djenMapper.js";
import { djenHasNextPage } from "./sources/djen/djenContracts.js";

const USER = "00000000-0000-4000-8000-000000000099";
const PROCESS_X = "00013848620265090009";
const PROCESS_Y = "00011111111111111111";
const PROCESS_FMT = "0001384-86.2026.5.09.0009";

function sequentialIds() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function emptyBatch(
  source: NormalizedSourceBatch["source"],
  extra?: Partial<NormalizedSourceBatch>
): NormalizedSourceBatch {
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

function observation(
  partial: Partial<NormalizedCaseObservation> & Pick<NormalizedCaseObservation, "processNumber" | "sourceIdentifier">
): NormalizedCaseObservation {
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

function seedTwoEntities(memory: LegalExposureMemory) {
  const timestamp = "2026-09-30T12:00:00.000Z";
  [FINANCE_INTERNAL_GROUP_COMPANIES[0], FINANCE_INTERNAL_GROUP_COMPANIES[1]].forEach((company, index) => {
    memory.entities.push({
      id: `entity-${index}`,
      cnpj: company!.cnpj,
      legalName: company!.name,
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

describe("DJEN Comunica PJe completo", () => {
  it("teste 1: Lazarios e Koppetel encontram o mesmo CNJ → 1 processo e 2 groupEntities", async () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    const inner = createMemoryExposureRepository(memory);
    const names = memory.entities.map((row) => row.legalName);
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        datajud: async () => emptyBatch("DATAJUD"),
        djen: async (input) => {
          const processNumber = input?.numeroProcesso
            ? PROCESS_X
            : names.includes(input?.nomeParte ?? "")
              ? PROCESS_X
              : PROCESS_Y;
          return emptyBatch("DJEN", {
            outcome: "SUCCESS",
            externalCall: true,
            cases: [observation({ processNumber, sourceIdentifier: `${processNumber}:${input?.nomeParte ?? input?.numeroProcesso}` })],
            communications: [
              {
                sourceCommunicationId: `${processNumber}:${input?.nomeParte ?? input?.numeroProcesso}`,
                tenantId: null,
                processNumber,
                communicationType: "Intimação",
                subject: null,
                sourceStatus: "PUBLICADA",
                availableAt: "2026-09-30T12:00:00.000Z",
                scienceDeadlineAt: null,
                sourceScienceAt: null,
                tribunal: "TRT9",
                courtUnit: null,
                rawMetadata: {},
              },
            ],
          });
        },
      },
    });
    await service.sync({ mode: "apply", source: "DJEN" }, USER);
    const snapshot = inner.snapshot();
    const items = listCanonicalCases(snapshot, {});
    assert.equal(items.length, 1);
    assert.equal(items[0]?.groupEntities.length, 2);
    assert.equal(new Set(items.map((row) => row.processNumber.replace(/\D/g, ""))).size, items.length);
  });

  it("teste 2: 5 publicações do mesmo CNJ → 1 card e 5 communications", () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    const pubs = Array.from({ length: 5 }, (_, index) =>
      observation({
        processNumber: PROCESS_X,
        sourceIdentifier: `pub-${index}`,
        className: index === 0 ? "Reclamação Trabalhista" : null,
        classCode: index === 0 ? "985" : null,
      })
    );
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: emptyBatch("DJEN", {
        outcome: "SUCCESS",
        cases: pubs,
        communications: pubs.map((row, index) => ({
          sourceCommunicationId: `pub-${index}`,
          tenantId: null,
          processNumber: PROCESS_X,
          communicationType: "Intimação",
          subject: `pub ${index}`,
          sourceStatus: "PUBLICADA",
          availableAt: "2026-09-30T12:00:00.000Z",
          scienceDeadlineAt: null,
          sourceScienceAt: null,
          tribunal: "TRT9",
          courtUnit: "09ª Vara do Trabalho de Curitiba",
          officialText: `texto ${index}`,
          rawMetadata: {},
        })),
      }),
    });
    const items = listCanonicalCases(memory, {});
    assert.equal(items.length, 1);
    assert.equal(memory.communications.length, 5);
    assert.equal(items[0]?.communicationCount, 5);
  });

  it("teste 3: party ACTIVE estruturada vira claimant", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          id: "pub-1",
          numeroProcesso: PROCESS_FMT,
          siglaTribunal: "TRT9",
          nomeClasse: "Reclamação Trabalhista",
          codigoClasse: "985",
          tipoComunicacao: "Intimação",
          destinatarios: [{ nome: "Maria Exemplo", polo: "A", cpf: "12345678909" }],
        },
      ],
    });
    assert.equal(mapped.cases[0]?.className, "Reclamação Trabalhista");
    assert.equal(mapped.cases[0]?.classCode, "985");
    assert.notEqual(mapped.cases[0]?.className, "Intimação");
    assert.equal(mapped.cases[0]?.parties[0]?.pole, "ACTIVE");
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: mapped,
    });
    const item = listCanonicalCases(memory, {})[0];
    assert.equal(item?.claimants[0]?.name, "Maria Exemplo");
  });

  it("teste 4: party PASSIVE vira defendant do grupo", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          id: "pub-1",
          numeroProcesso: PROCESS_X,
          siglaTribunal: "TRT9",
          destinatarios: [
            { nome: FINANCE_INTERNAL_GROUP_COMPANIES[0]!.name, polo: "P", cnpj: FINANCE_INTERNAL_GROUP_COMPANIES[0]!.cnpj },
          ],
        },
      ],
    });
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: mapped,
    });
    const item = listCanonicalCases(memory, {})[0];
    assert.equal(item?.groupEntities[0]?.pole, "PASSIVE");
    assert.equal(item?.claimants.length, 0);
  });

  it("teste 5: entidade de discovery sem party não vira claimant", () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: emptyBatch("DJEN", {
        outcome: "SUCCESS",
        cases: [observation({ processNumber: PROCESS_X, sourceIdentifier: PROCESS_X, entityPole: "UNKNOWN" })],
      }),
    });
    const item = listCanonicalCases(memory, {})[0];
    assert.equal(item?.claimants.length, 0);
    assert.ok(item?.coverage?.opposition.caption.includes(CASE_POLE_UNCONFIRMED_COPY));
    assert.equal(item?.coverage?.opposition.caption.includes("contra"), false);
  });

  it("teste 6: party estruturada e texto concordam em uma party", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          id: "pub-1",
          numeroProcesso: PROCESS_X,
          siglaTribunal: "TRT9",
          texto: "RECLAMANTE: MARIA EXEMPLO",
          destinatarios: [{ nome: "Maria Exemplo", polo: "A", cpf: "12345678909" }],
        },
      ],
    });
    assert.equal(mapped.cases[0]?.parties.filter((row) => /MARIA/i.test(row.name)).length, 1);
    assert.equal(mapped.cases[0]?.parties[0]?.pole, "ACTIVE");
  });

  it("teste 7: estruturado e texto divergentes geram conflito", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          id: "pub-1",
          numeroProcesso: PROCESS_X,
          siglaTribunal: "TRT9",
          texto: "RECLAMADO: MARIA EXEMPLO",
          destinatarios: [{ nome: "Maria Exemplo", polo: "A", cpf: "12345678909" }],
        },
      ],
    });
    const party = mapped.cases[0]?.parties.find((row) => /MARIA/i.test(row.name));
    assert.equal(party?.partyType, "POLO_DIVERGENTE");
  });

  it("teste 8: advogado duplicado em 3 publicações → 1 attorney", () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    const attorney = {
      name: "João Silva",
      document: null,
      oabNumber: "12345",
      oabState: "PR",
      representedPartyName: null,
      representedPartyDocument: null,
    };
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: emptyBatch("DJEN", {
        outcome: "SUCCESS",
        cases: [0, 1, 2].map((index) =>
          observation({
            processNumber: PROCESS_X,
            sourceIdentifier: `pub-${index}`,
            attorneys: [attorney],
          })
        ),
      }),
    });
    assert.equal(memory.attorneys.length, 1);
  });

  it("teste 9: mesma audiência em duas publicações → 1 hearing", () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    const hearing = {
      type: "AUDIÊNCIA INICIAL",
      scheduledAt: "2026-11-10T12:30:00.000Z",
      status: null,
      courtUnit: "09ª Vara do Trabalho de Curitiba",
    };
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: emptyBatch("DJEN", {
        outcome: "SUCCESS",
        cases: [
          observation({ processNumber: PROCESS_X, sourceIdentifier: "pub-1", hearings: [hearing] }),
          observation({ processNumber: PROCESS_X, sourceIdentifier: "pub-2", hearings: [hearing] }),
        ],
      }),
    });
    assert.equal(memory.hearings.length, 1);
  });

  it("teste 10: 105 comunicações / 20 por página → 6 páginas", async () => {
    const calls: number[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const pagina = Number(new URL(String(input)).searchParams.get("pagina") ?? "1");
      calls.push(pagina);
      const remaining = Math.max(0, 105 - (pagina - 1) * 20);
      const count = Math.min(20, remaining);
      return new Response(
        JSON.stringify({
          count: 105,
          items: Array.from({ length: count }, (_, index) => ({
            id: `p${pagina}-${index}`,
            numeroProcesso: PROCESS_X,
            siglaTribunal: "TRT9",
            tipoComunicacao: "Intimação",
          })),
        }),
        { status: 200 }
      );
    };
    const batch = await searchDjen({
      env: { DJEN_BASE_URL: "https://fixture.invalid", DJEN_MAX_PAGES: "50" },
      fetchImpl,
      throttle: createDjenThrottle({ intervalMs: 500, sleep: async () => {} }),
      query: { nomeParte: "LAZARIOS COMERCIO DE PLASTICOS LTDA" },
    });
    assert.equal(calls.length, 6);
    assert.equal(djenHasNextPage({ pagina: 5, itensPorPagina: 20, itemCount: 20, totalCount: 105 }), true);
    assert.equal(djenHasNextPage({ pagina: 6, itensPorPagina: 20, itemCount: 5, totalCount: 105 }), false);
    assert.equal(batch.pagination?.pagesFetched, 6);
    assert.equal(batch.pagination?.itemsFetched, 105);
    assert.equal(batch.pagination?.truncated, false);
    assert.equal(new URL("https://fixture.invalid/api/v1/comunicacao?nomeParte=x").searchParams.has("siglaTribunal"), false);
  });

  it("teste 11: 5 publicações X + 2 Y → DataJud X e Y uma vez cada", async () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    memory.entities.splice(1);
    const inner = createMemoryExposureRepository(memory);
    const datajudCalls: string[] = [];
    const service = createLegalExposureService({
      repository: inner,
      createId: sequentialIds(),
      now: () => new Date("2026-09-30T13:00:00.000Z"),
      runners: {
        domicilio: async () => emptyBatch("DOMICILIO"),
        djen: async (input) => {
          if (input?.numeroProcesso) {
            const processNumber = input.numeroProcesso.replace(/\D/g, "");
            return emptyBatch("DJEN", {
              outcome: "SUCCESS",
              cases: [observation({ processNumber, sourceIdentifier: `cnj-${processNumber}` })],
            });
          }
          return emptyBatch("DJEN", {
            outcome: "SUCCESS",
            cases: [
              ...Array.from({ length: 5 }, (_, index) =>
                observation({ processNumber: PROCESS_X, sourceIdentifier: `x-${index}` })
              ),
              ...Array.from({ length: 2 }, (_, index) =>
                observation({ processNumber: PROCESS_Y, sourceIdentifier: `y-${index}` })
              ),
            ],
          });
        },
        datajud: async (input) => {
          datajudCalls.push(input?.processNumber ?? "");
          return emptyBatch("DATAJUD", { outcome: "NO_RESULTS", externalCall: true });
        },
      },
    });
    await service.sync({ mode: "apply", source: "ALL", entityId: "entity-0" }, USER);
    assert.deepEqual([...datajudCalls].sort(), [PROCESS_X, PROCESS_Y].sort());
    const fanout = collectDatajudTargetsFromBatch(
      emptyBatch("DJEN", {
        cases: [
          observation({ processNumber: PROCESS_X, sourceIdentifier: "a" }),
          observation({ processNumber: PROCESS_X, sourceIdentifier: "b" }),
          observation({ processNumber: PROCESS_Y, sourceIdentifier: "c" }),
        ],
      })
    );
    assert.equal(fanout.length, 2);
  });

  it("listCanonicalCases e page.total batem com CNJ único", () => {
    const memory = createEmptyExposureMemory();
    seedTwoEntities(memory);
    applyBatchToMemory(memory, {
      entityId: "entity-0",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: emptyBatch("DJEN", {
        outcome: "SUCCESS",
        cases: [observation({ processNumber: PROCESS_X, sourceIdentifier: "a" })],
      }),
    });
    applyBatchToMemory(memory, {
      entityId: "entity-1",
      now: "2026-09-30T13:00:00.000Z",
      createId: sequentialIds(),
      batch: emptyBatch("DJEN", {
        outcome: "SUCCESS",
        cases: [observation({ processNumber: PROCESS_X, sourceIdentifier: "b" })],
      }),
    });
    const items = listCanonicalCases(memory, {});
    const page = listCases(memory, { page: 1, pageSize: 20 });
    assert.equal(items.length, 1);
    assert.equal(page.total, 1);
    assert.equal(new Set(items.map((row) => row.processNumber.replace(/\D/g, ""))).size, items.length);
  });
});
