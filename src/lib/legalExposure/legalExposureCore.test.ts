import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBatchToMemory } from "./legalExposureApply.js";
import { correlateObservation } from "./legalExposureCorrelation.js";
import { freshnessFromAge, resolveSourceHealth } from "./legalExposureHealth.js";
import {
  movementFingerprint,
  normalizeExposureCnpj,
  normalizeProcessNumber,
  sanitizePayload,
  stableHash,
} from "./legalExposureNormalization.js";
import { createEmptyExposureMemory } from "./legalExposureStore.js";
import { mapDomicilioCommunicationList } from "./sources/domicilio/domicilioMapper.js";
import { mapDatajudSearch } from "./sources/datajud/datajudMapper.js";
import { mapDjenPublications } from "./sources/djen/djenMapper.js";
import { matchDjenHit } from "./sources/djen/djenMatchEngine.js";
import type { NormalizedSourceBatch } from "./legalExposureContracts.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";

const CNPJ = "11222333000181";
const PROCESS = "0001234-56.2024.5.09.0001";
const PROCESS_DIGITS = "00012345620245090001";

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function entityMemory() {
  const memory = createEmptyExposureMemory();
  memory.entities.push({
    id: "ent-1",
    cnpj: CNPJ,
    legalName: "Industria Exemplo LTDA",
    tradeName: null,
    active: true,
    state: "PR",
    city: "Curitiba",
    monitorDomicilio: true,
    monitorDatajud: true,
    monitorDjen: true,
    monitorCertificates: true,
    domicilioTenantId: "tenant-fixture",
    lastSuccessfulSyncAt: null,
    createdAt: "2026-09-29T18:00:00.000Z",
    updatedAt: "2026-09-29T18:00:00.000Z",
  });
  memory.aliases.push({
    id: "alias-1",
    entityId: "ent-1",
    type: "ABBREVIATION",
    value: "EXEMPLO",
    normalizedValue: "EXEMPLO",
    active: true,
    createdAt: "2026-09-29T18:00:00.000Z",
  });
  return memory;
}

function batch(partial: Partial<NormalizedSourceBatch> & Pick<NormalizedSourceBatch, "source">): NormalizedSourceBatch {
  return {
    outcome: "SUCCESS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: true,
    cases: [],
    communications: [],
    candidates: [],
    ...partial,
  };
}

describe("exposure normalization", () => {
  it("normaliza CNPJ válido e rejeita inválido", () => {
    assert.equal(normalizeExposureCnpj("11.222.333/0001-81"), CNPJ);
    assert.equal(normalizeExposureCnpj("00.000.000/0000-00"), null);
  });

  it("normaliza número CNJ para 20 dígitos", () => {
    assert.equal(normalizeProcessNumber(PROCESS), PROCESS_DIGITS);
    assert.equal(normalizeProcessNumber("123"), null);
  });

  it("hash estável ignora ordem de chaves e remove segredo", () => {
    assert.equal(stableHash({ b: 1, a: { d: 2, c: 3 } }), stableHash({ a: { c: 3, d: 2 }, b: 1 }));
    const clean = sanitizePayload({
      authorization: "Bearer segredo",
      client_secret: "x",
      cpf: "123.456.789-09",
      parteDocumento: "123.456.789-09",
      assunto: "citação fictícia",
    }) as Record<string, unknown>;
    assert.equal(clean.authorization, undefined);
    assert.equal(clean.client_secret, undefined);
    assert.equal(clean.cpf, undefined);
    assert.equal(clean.parteDocumento, "[redacted]");
    assert.equal(clean.assunto, "citação fictícia");
  });

  it("fingerprint de movimento é determinístico", () => {
    const input = {
      processNumberNormalized: PROCESS_DIGITS,
      sourceCode: "92",
      name: "Juntada",
      occurredAt: "2026-09-01T10:00:00.000Z",
      courtUnit: "1ª Vara",
      complements: { b: 1, a: 2 },
    };
    assert.equal(movementFingerprint(input), movementFingerprint({ ...input, complements: { a: 2, b: 1 } }));
  });
});

describe("exposure correlation", () => {
  const base = {
    explicitCnpj: null as string | null,
    entityCnpj: CNPJ,
    officialIdentifier: null as string | null,
    candidateName: null as string | null,
    entityLegalName: "Industria Exemplo LTDA",
    aliases: ["EXEMPLO"],
    existingCases: [{ id: "case-1", processNumberNormalized: PROCESS_DIGITS }],
    knownOfficialIds: [] as { officialIdentifier: string; caseId: string }[],
  };

  it("número CNJ confirma e reutiliza o processo", () => {
    const decision = correlateObservation({ ...base, processNumberNormalized: PROCESS_DIGITS });
    assert.equal(decision.confidence, "CONFIRMED");
    assert.equal(decision.method, "PROCESS_NUMBER");
    assert.equal(decision.matchedCaseId, "case-1");
  });

  it("CNPJ explícito confirma", () => {
    const decision = correlateObservation({
      ...base,
      processNumberNormalized: null,
      explicitCnpj: CNPJ,
      existingCases: [],
    });
    assert.equal(decision.confidence, "CONFIRMED");
    assert.equal(decision.method, "CNPJ");
  });

  it("nome exato e alias exato ficam como revisão, não confirmação", () => {
    const exact = correlateObservation({
      ...base,
      processNumberNormalized: null,
      candidateName: "Indústria Exemplo LTDA",
      existingCases: [],
    });
    assert.equal(exact.confidence, "LIKELY");
    assert.equal(exact.method, "EXACT_NAME");
    const alias = correlateObservation({
      ...base,
      processNumberNormalized: null,
      candidateName: "Exemplo",
      existingCases: [],
    });
    assert.equal(alias.confidence, "LIKELY");
    assert.equal(alias.method, "EXACT_ALIAS");
  });

  it("fuzzy não confirma", () => {
    const decision = correlateObservation({
      ...base,
      processNumberNormalized: null,
      entityLegalName: "Industria Exemplo Metalurgica Nacional LTDA",
      candidateName: "Industria Exemplo Metalurgica Nacional",
      existingCases: [],
    });
    assert.notEqual(decision.confidence, "CONFIRMED");
    assert.equal(decision.confidence, "UNCONFIRMED");
    assert.equal(decision.method, "FUZZY");
  });

  it("número do processo vence nome diferente", () => {
    const decision = matchDjenHit({
      processNumber: PROCESS,
      explicitCnpj: null,
      candidateName: "Outra Empresa SA",
      officialIdentifier: null,
      entityCnpj: CNPJ,
      entityLegalName: "Industria Exemplo LTDA",
      aliases: [],
      existingCases: base.existingCases,
      knownOfficialIds: [],
    });
    assert.equal(decision.confidence, "CONFIRMED");
    assert.equal(decision.method, "PROCESS_NUMBER");
  });
});

describe("exposure apply", () => {
  it("três fontes do mesmo número geram um processo e uma só novidade", () => {
    const memory = entityMemory();
    const createId = ids();
    const observation = {
      processNumber: PROCESS,
      tribunal: "TRT9",
      jurisdiction: null,
      degree: null,
      courtUnit: null,
      classCode: null,
      className: null,
      filedAt: null,
      currentStatus: "ATIVO",
      entityPole: "PASSIVE" as const,
      sourceIdentifier: "src-1",
      sourceUpdatedAt: null,
      explicitCnpj: CNPJ,
      candidateName: null,
      officialIdentifier: PROCESS_DIGITS,
      parties: [],
      movements: [
        {
          sourceCode: "92",
          name: "Juntada",
          occurredAt: "2026-09-01T10:00:00.000Z",
          courtUnit: null,
          complements: { a: 1 },
        },
      ],
      rawMetadata: { authorization: "Bearer x", assunto: "fixture" },
    };
    for (const source of ["DOMICILIO", "DJEN", "DATAJUD"] as const) {
      applyBatchToMemory(memory, {
        entityId: "ent-1",
        now: "2026-09-29T19:00:00.000Z",
        createId,
        batch: batch({
          source,
          cases: [{ ...observation, sourceIdentifier: source }],
        }),
      });
    }
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.events.filter((row) => row.eventType === "NEW_CASE").length, 1);
    assert.equal(memory.events.filter((row) => row.eventType === "SOURCE_CONFIRMATION").length, 2);
    assert.equal(memory.movements.length, 1);
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T19:05:00.000Z",
      createId,
      batch: batch({ source: "DATAJUD", cases: [{ ...observation, sourceIdentifier: "DATAJUD" }] }),
    });
    assert.equal(memory.movements.length, 1);
    assert.equal(memory.cases.length, 1);
    const evidence = memory.evidences[0];
    assert.equal((evidence?.rawMetadata as { authorization?: string }).authorization, undefined);
  });

  it("comunicação repetida não duplica e só emite transição uma vez", () => {
    const memory = entityMemory();
    const createId = ids();
    const communication = {
      sourceCommunicationId: "comm-1",
      tenantId: "tenant-fixture",
      processNumber: PROCESS,
      communicationType: "CITACAO",
      subject: "Citação fictícia",
      sourceStatus: "N",
      availableAt: "2026-09-29T19:00:00.000Z",
      scienceDeadlineAt: null,
      sourceScienceAt: null,
      tribunal: "TRT9",
      courtUnit: "1ª Vara",
      rawMetadata: { id: "comm-1" },
    };
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T19:00:00.000Z",
      createId,
      batch: batch({ source: "DOMICILIO", communications: [communication] }),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T19:05:00.000Z",
      createId,
      batch: batch({ source: "DOMICILIO", communications: [communication] }),
    });
    assert.equal(memory.communications.length, 1);
    assert.equal(memory.communications[0]?.lastSeenAt, "2026-09-29T19:05:00.000Z");
    assert.equal(memory.communications[0]?.officialContentOpenedAt, null);
    assert.equal(memory.events.filter((row) => row.eventType === "NEW_CITATION").length, 1);
    assert.equal(memory.alerts.filter((row) => row.title === "Citação pendente").length, 1);
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T20:00:00.000Z",
      createId,
      batch: batch({
        source: "DOMICILIO",
        communications: [{ ...communication, sourceStatus: "CIENTE" }],
      }),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T21:00:00.000Z",
      createId,
      batch: batch({
        source: "DOMICILIO",
        communications: [{ ...communication, sourceStatus: "CIENTE" }],
      }),
    });
    assert.equal(memory.events.filter((row) => row.eventType === "COMMUNICATION_ACKNOWLEDGED").length, 1);
    assert.equal(memory.communications[0]?.officialContentOpenedAt, null);
  });

  it("NO_RESULTS não apaga processo já visto", () => {
    const memory = entityMemory();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T19:00:00.000Z",
      createId,
      batch: batch({
        source: "DOMICILIO",
        cases: [
          {
            processNumber: PROCESS,
            tribunal: "TRT9",
            jurisdiction: null,
            degree: null,
            courtUnit: null,
            classCode: null,
            className: null,
            filedAt: null,
            currentStatus: null,
            entityPole: "UNKNOWN",
            sourceIdentifier: "dom-1",
            sourceUpdatedAt: null,
            explicitCnpj: null,
            candidateName: null,
            officialIdentifier: null,
            parties: [],
            movements: [],
            rawMetadata: {},
          },
        ],
      }),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T20:00:00.000Z",
      createId,
      batch: batch({ source: "DOMICILIO", outcome: "NO_RESULTS" }),
    });
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.cases[0]?.firstSeenAt, "2026-09-29T19:00:00.000Z");
    assert.notEqual(memory.connections[0]?.status, "SOURCE_ERROR");
  });

  it("candidato DJEN likely não vira processo confirmado", () => {
    const memory = entityMemory();
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-29T19:00:00.000Z",
      createId: ids(),
      batch: batch({
        source: "DJEN",
        candidates: [
          {
            candidateName: "Industria Exemplo LTDA",
            processNumber: null,
            explicitCnpj: null,
            officialIdentifier: null,
            tribunal: "TRT9",
            rawMetadata: { texto: "fixture" },
          },
        ],
      }),
    });
    assert.equal(memory.cases.length, 0);
    assert.equal(memory.alerts.some((row) => row.requiresAction && row.title.includes("revisão")), true);
  });

  it("G1 e G2 do mesmo CNJ geram um processo e duas evidências DataJud idempotentes", () => {
    const memory = entityMemory();
    const createId = ids();
    const datajudProcess = "00002860620215090021";
    const g1Id = "TRT9_G1_00002860620215090021";
    const g2Id = "TRT9_G2_00002860620215090021";
    const observation = {
      processNumber: datajudProcess,
      tribunal: "TRT9",
      jurisdiction: null,
      degree: "G1" as const,
      courtUnit: "02ª VARA DO TRABALHO DE MARINGÁ",
      classCode: "985",
      className: "Ação Trabalhista - Rito Ordinário",
      filedAt: "2021-03-30T11:40:43.000Z",
      currentStatus: null,
      entityPole: "UNKNOWN" as const,
      sourceUpdatedAt: null,
      explicitCnpj: null,
      candidateName: null,
      parties: [],
      movements: [],
    };
    const datajudBatch = batch({
      source: "DATAJUD",
      cases: [
        {
          ...observation,
          degree: "G1",
          sourceIdentifier: g1Id,
          officialIdentifier: g1Id,
          rawMetadata: { id: g1Id, grau: "G1" },
        },
        {
          ...observation,
          degree: "G2",
          courtUnit: "GAB. DES. MARLENE TERESINHA FUVERKI SUGUIMATSU",
          classCode: "1004",
          className: "Agravo de Petição",
          sourceIdentifier: g2Id,
          officialIdentifier: g2Id,
          rawMetadata: { id: g2Id, grau: "G2" },
        },
      ],
    });
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: datajudBatch,
    });
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.evidences.length, 2);
    assert.equal(new Set(memory.evidences.map((row) => row.sourceIdentifier)).size, 2);
    assert.deepEqual(
      new Set(memory.evidences.map((row) => row.sourceIdentifier)),
      new Set([g1Id, g2Id])
    );
    assert.equal(
      memory.evidences.every((row) => row.caseId === memory.cases[0]?.id),
      true
    );
    const g1 = memory.evidences.find((row) => row.sourceIdentifier === g1Id);
    const g2 = memory.evidences.find((row) => row.sourceIdentifier === g2Id);
    assert.equal((g1?.rawMetadata as { id?: string } | undefined)?.id, g1Id);
    assert.equal((g2?.rawMetadata as { id?: string } | undefined)?.id, g2Id);

    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-30T12:05:00.000Z",
      createId,
      batch: datajudBatch,
    });
    assert.equal(memory.cases.length, 1);
    assert.equal(memory.evidences.length, 2);
    assert.equal(new Set(memory.evidences.map((row) => row.sourceIdentifier)).size, 2);
    assert.deepEqual(
      new Set(memory.evidences.map((row) => row.sourceIdentifier)),
      new Set([g1Id, g2Id])
    );
  });

  it("DataJud enriquece processo já criado pelo DJEN", () => {
    const memory = entityMemory();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch({
        source: "DJEN",
        cases: [
          {
            processNumber: PROCESS,
            tribunal: "TRT9",
            jurisdiction: null,
            degree: null,
            courtUnit: "Vara parcial",
            classCode: null,
            className: "Intimação",
            filedAt: null,
            currentStatus: null,
            entityPole: "UNKNOWN",
            sourceIdentifier: PROCESS_DIGITS,
            sourceUpdatedAt: "2026-09-30T12:00:00.000Z",
            explicitCnpj: CNPJ,
            candidateName: null,
            officialIdentifier: PROCESS_DIGITS,
            parties: [],
            movements: [],
            rawMetadata: { tipoComunicacao: "Intimação" },
          },
        ],
      }),
    });
    assert.equal(memory.cases[0]?.className, null);
    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-30T13:00:00.000Z",
      createId,
      batch: batch({
        source: "DATAJUD",
        cases: [
          {
            processNumber: PROCESS,
            tribunal: "TRT9",
            jurisdiction: "Justiça do Trabalho",
            degree: "G1",
            courtUnit: "09ª VARA DO TRABALHO DE CURITIBA",
            classCode: "985",
            className: "Ação Trabalhista - Rito Ordinário",
            filedAt: "2026-09-23T00:00:00.000Z",
            currentStatus: null,
            entityPole: "UNKNOWN",
            sourceIdentifier: "TRT9_G1_fixture",
            sourceUpdatedAt: "2026-09-30T13:00:00.000Z",
            explicitCnpj: CNPJ,
            candidateName: null,
            officialIdentifier: "TRT9_G1_fixture",
            parties: [],
            movements: [],
            rawMetadata: { id: "TRT9_G1_fixture" },
          },
        ],
      }),
    });
    const legalCase = memory.cases[0];
    assert.equal(memory.cases.length, 1);
    assert.equal(legalCase?.courtUnit, "09ª VARA DO TRABALHO DE CURITIBA");
    assert.equal(legalCase?.classCode, "985");
    assert.equal(legalCase?.className, "Ação Trabalhista - Rito Ordinário");
    assert.equal(legalCase?.filedAt, "2026-09-23T00:00:00.000Z");
    assert.equal(legalCase?.jurisdiction, "Justiça do Trabalho");
    assert.equal(legalCase?.degree, "G1");
    assert.equal(legalCase?.entityPole, "UNKNOWN");
    assert.equal(legalCase?.primarySource, "DJEN");

    applyBatchToMemory(memory, {
      entityId: "ent-1",
      now: "2026-09-30T14:00:00.000Z",
      createId,
      batch: batch({
        source: "DJEN",
        cases: [
          {
            processNumber: PROCESS,
            tribunal: "TRT9",
            jurisdiction: null,
            degree: null,
            courtUnit: "Vara parcial",
            classCode: null,
            className: null,
            filedAt: null,
            currentStatus: null,
            entityPole: "UNKNOWN",
            sourceIdentifier: PROCESS_DIGITS,
            sourceUpdatedAt: "2026-09-30T14:00:00.000Z",
            explicitCnpj: CNPJ,
            candidateName: null,
            officialIdentifier: PROCESS_DIGITS,
            parties: [],
            movements: [],
            rawMetadata: { tipoComunicacao: "Intimação" },
          },
        ],
      }),
    });
    assert.equal(memory.cases[0]?.className, "Ação Trabalhista - Rito Ordinário");
    assert.equal(memory.cases[0]?.filedAt, "2026-09-23T00:00:00.000Z");
    assert.equal(memory.cases[0]?.courtUnit, "09ª VARA DO TRABALHO DE CURITIBA");
    assert.equal(memory.cases[0]?.jurisdiction, "Justiça do Trabalho");
  });
});

describe("exposure freshness", () => {
  it("Domicílio: 30 min saudável, acima disso degradado, acima de 1h desatualizado", () => {
    assert.equal(freshnessFromAge("DOMICILIO", 30 * 60 * 1000), "HEALTHY");
    assert.equal(freshnessFromAge("DOMICILIO", 30 * 60 * 1000 + 1), "DEGRADED");
    assert.equal(freshnessFromAge("DOMICILIO", 60 * 60 * 1000), "DEGRADED");
    assert.equal(freshnessFromAge("DOMICILIO", 60 * 60 * 1000 + 1), "STALE");
  });

  it("não configurado não é saudável e NO_RESULTS não é erro de fonte", () => {
    const status = resolveSourceHealth({
      source: "DOMICILIO",
      configured: false,
      enabled: false,
      now: new Date("2026-09-29T20:00:00.000Z"),
      lastAttemptAt: null,
      lastSuccessfulAt: null,
      lastErrorAt: null,
      lastErrorCode: null,
    });
    assert.equal(status, "NOT_CONFIGURED");
    assert.notEqual(status, "HEALTHY");
  });
});

describe("exposure mappers", () => {
  it("mapeia fixture de Domicílio sem tratar lista vazia como erro", () => {
    const empty = mapDomicilioCommunicationList({ content: [] });
    assert.equal(empty.outcome, "NO_RESULTS");
    const mapped = mapDomicilioCommunicationList({
      content: [
        {
          id: "comm-1",
          numeroProcesso: PROCESS,
          tipoComunicacao: "CITACAO",
          assunto: "Citação fictícia",
          statusCiente: "N",
          dataDisponibilizacao: "2026-09-29T19:00:00.000Z",
          tribunal: "TRT9",
        },
      ],
    });
    assert.equal(mapped.outcome, "SUCCESS");
    assert.equal(mapped.communications[0]?.sourceCommunicationId, "comm-1");
    assert.equal(mapped.communications.length, 1);
  });

  it("DataJud sem hits é inválido e hits vazio é sem resultado", () => {
    assert.equal(mapDatajudSearch({}).outcome, "INVALID_RESPONSE");
    assert.equal(mapDatajudSearch({ hits: { hits: [] } }).outcome, "NO_RESULTS");
    const mapped = mapDatajudSearch({
      hits: {
        hits: [
          {
            _source: {
              numeroProcesso: PROCESS,
              tribunal: "TRT9",
              movimentos: [{ codigo: 92, nome: "Juntada", dataHora: "2026-09-01T10:00:00.000Z" }],
            },
          },
        ],
      },
    });
    assert.equal(mapped.cases.length, 1);
    assert.equal(mapped.cases[0]?.movements.length, 1);
    assert.equal(mapped.cases[0]?.parties.length, 0);
  });

  it("DJEN sem número vira candidato", () => {
    const mapped = mapDjenPublications({
      items: [{ nomeParte: "Industria Exemplo LTDA", siglaTribunal: "TRT9" }],
    });
    assert.equal(mapped.cases.length, 0);
    assert.equal(mapped.candidates.length, 1);
  });

  it("tipoComunicacao DJEN não vira classe processual", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          numeroProcesso: PROCESS,
          siglaTribunal: "TRT9",
          nomeOrgao: "09ª VARA DO TRABALHO DE CURITIBA",
          tipoComunicacao: "Intimação",
          nomeParte: "Industria Exemplo LTDA",
        },
      ],
    });
    assert.equal(mapped.cases.length, 1);
    assert.equal(mapped.cases[0]?.className, null);
    assert.equal(mapped.cases[0]?.classCode, null);
    assert.equal(mapped.cases[0]?.filedAt, null);
    assert.equal(mapped.cases[0]?.courtUnit, "09ª VARA DO TRABALHO DE CURITIBA");
    assert.equal((mapped.cases[0]?.rawMetadata as { tipoComunicacao?: string }).tipoComunicacao, "Intimação");
    assert.equal(mapped.communications.length, 1);
    assert.equal(mapped.communications[0]?.communicationType, "Intimação");
  });

  it("DJEN não persiste texto integral e mapeia destinatários oficiais", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          id: "pub-1",
          numeroProcesso: PROCESS,
          siglaTribunal: "TRT9",
          tipoComunicacao: "Intimação",
          dataDisponibilizacao: "2026-09-30T12:00:00.000Z",
          texto: "conteudo pessoal desnecessario",
          destinatarios: [
            {
              nome: "Lazarios Comercio de Plasticos LTDA",
              polo: "P",
              cnpj: FINANCE_INTERNAL_GROUP_COMPANIES[0]!.cnpj,
            },
          ],
        },
      ],
    });
    assert.equal(mapped.cases[0]?.className, null);
    assert.equal(JSON.stringify(mapped.cases[0]?.rawMetadata ?? {}).includes("conteudo pessoal"), false);
    assert.equal(mapped.cases[0]?.parties[0]?.pole, "PASSIVE");
    assert.equal(mapped.cases[0]?.parties[0]?.personType, "COMPANY");
    assert.equal(mapped.communications[0]?.availableAt, "2026-09-30T12:00:00.000Z");
  });
});
