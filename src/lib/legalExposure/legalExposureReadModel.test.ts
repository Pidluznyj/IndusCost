import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBatchToMemory } from "./legalExposureApply.js";
import { CASE_POLE_UNKNOWN_COPY, CASE_VERIFIED_OFFICIAL_COPY } from "./legalExposureContracts.js";
import { casePoleLabel } from "./legalExposureCaseListUi.js";
import { listCases } from "./legalExposureReadModel.js";
import { normalizeProcessNumber } from "./legalExposureNormalization.js";
import { createEmptyExposureMemory } from "./legalExposureStore.js";
import { mapDjenPublications } from "./sources/djen/djenMapper.js";
import type { NormalizedSourceBatch } from "./legalExposureContracts.js";

const CNPJ_A = "11222333000181";
const CNPJ_B = "99888777000166";
const PROCESS_A = "0001234-56.2024.5.09.0001";
const PROCESS_B = "0009876-54.2024.5.09.0002";
const PROCESS_A_DIGITS = normalizeProcessNumber(PROCESS_A)!;
const PROCESS_B_DIGITS = normalizeProcessNumber(PROCESS_B)!;

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

function entity(id: string, cnpj: string, legalName: string) {
  return {
    id,
    cnpj,
    legalName,
    tradeName: null,
    active: true,
    state: "PR",
    city: "Curitiba",
    monitorDomicilio: true,
    monitorDatajud: true,
    monitorDjen: true,
    monitorCertificates: true,
    domicilioTenantId: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-09-29T18:00:00.000Z",
    updatedAt: "2026-09-29T18:00:00.000Z",
  } as const;
}

function twoEntities() {
  const memory = createEmptyExposureMemory();
  memory.entities.push(entity("ent-a", CNPJ_A, "Industria Exemplo LTDA"));
  memory.entities.push(entity("ent-b", CNPJ_B, "Comercio Outra LTDA"));
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

function djenCase(input: {
  processNumber: string;
  cnpj: string;
  tipoComunicacao?: string;
  courtUnit?: string;
}) {
  return {
    processNumber: input.processNumber,
    tribunal: "TRT9",
    jurisdiction: null,
    degree: null,
    courtUnit: input.courtUnit ?? "09ª VARA DO TRABALHO DE CURITIBA",
    classCode: null,
    className: null,
    filedAt: null,
    currentStatus: null,
    entityPole: "UNKNOWN" as const,
    sourceIdentifier: normalizeProcessNumber(input.processNumber)!,
    sourceUpdatedAt: "2026-09-30T12:00:00.000Z",
    explicitCnpj: input.cnpj,
    candidateName: null,
    officialIdentifier: normalizeProcessNumber(input.processNumber)!,
    parties: [],
    movements: [],
    rawMetadata: {
      tipoComunicacao: input.tipoComunicacao ?? "Intimação",
      dataDisponibilizacao: "2026-09-30T12:00:00.000Z",
      nomeOrgao: input.courtUnit ?? "09ª VARA DO TRABALHO DE CURITIBA",
    },
  };
}

describe("exposure case list read model", () => {
  it("resolve empresa pelo entityId, sem texto da publicação", () => {
    const memory = twoEntities();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId: ids(),
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A })] }),
    });
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.entity.legalName, "Industria Exemplo LTDA");
    assert.equal(item?.entity.cnpj, CNPJ_A);
    assert.match(item?.entity.displayCnpj ?? "", /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    assert.equal(item?.entityId, "ent-a");
  });

  it("evidenceSources une DJEN e DataJud sem duplicata", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A })] }),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T13:00:00.000Z",
      createId,
      batch: batch({
        source: "DATAJUD",
        cases: [
          {
            ...djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A }),
            className: "Ação Trabalhista - Rito Ordinário",
            classCode: "985",
            filedAt: "2026-09-23T00:00:00.000Z",
            jurisdiction: "Justiça do Trabalho",
            degree: "G1",
            sourceIdentifier: "TRT9_G1_a",
            officialIdentifier: "TRT9_G1_a",
            rawMetadata: { id: "TRT9_G1_a" },
          },
        ],
      }),
    });
    const item = listCases(memory, {}).items[0];
    assert.deepEqual(item?.evidenceSources, ["DATAJUD", "DJEN"]);
    assert.equal(item?.verificationStatus, "CONFIRMED_OFFICIAL");
    assert.equal(item?.enrichmentStatus, "DATAJUD_ENRICHED");
    assert.equal(item?.className, "Ação Trabalhista - Rito Ordinário");
  });

  it("DJEN confirmado sem DataJud continua oficial e aguardando enriquecimento", () => {
    const memory = twoEntities();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId: ids(),
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A })] }),
    });
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.verificationStatus, "CONFIRMED_OFFICIAL");
    assert.equal(item?.enrichmentStatus, "DJEN_ONLY");
    assert.equal(item?.className, null);
    assert.equal(JSON.stringify(item).includes("inválido"), false);
    assert.equal(item?.latestPublication?.type, "Intimação");
  });

  it("tipoComunicacao DJEN aparece só como publicação", () => {
    const mapped = mapDjenPublications({
      items: [
        {
          numeroProcesso: PROCESS_A,
          siglaTribunal: "TRT9",
          nomeOrgao: "09ª VARA DO TRABALHO DE CURITIBA",
          tipoComunicacao: "Intimação",
          cnpj: CNPJ_A,
        },
      ],
    });
    const memory = twoEntities();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId: ids(),
      batch: mapped,
    });
    assert.equal(memory.cases[0]?.className, null);
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.className, null);
    assert.equal(item?.latestPublication?.type, "Intimação");
    assert.equal(JSON.stringify(item).includes("rawMetadata"), false);
  });

  it("última movimentação usa occurredAt e cai para firstSeenAt", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch({
        source: "DATAJUD",
        cases: [
          {
            ...djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A }),
            className: "Ação Trabalhista - Rito Ordinário",
            sourceIdentifier: "mov-src",
            officialIdentifier: "mov-src",
            movements: [
              {
                sourceCode: "1",
                name: "Antiga",
                occurredAt: "2026-09-01T10:00:00.000Z",
                courtUnit: null,
                complements: null,
              },
              {
                sourceCode: "2",
                name: "Recente",
                occurredAt: "2026-09-30T10:00:00.000Z",
                courtUnit: "09ª VARA",
                complements: null,
              },
              {
                sourceCode: "3",
                name: "Sem data",
                occurredAt: null,
                courtUnit: null,
                complements: null,
              },
            ],
          },
        ],
      }),
    });
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.latestMovement?.name, "Recente");
    assert.equal(item?.latestMovement?.occurredAt, "2026-09-30T10:00:00.000Z");
  });

  it("polo UNKNOWN permanece UNKNOWN no backend", () => {
    const memory = twoEntities();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId: ids(),
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A })] }),
    });
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.entityPole, "UNKNOWN");
    assert.equal(casePoleLabel(item?.entityPole), CASE_POLE_UNKNOWN_COPY);
    assert.notEqual(casePoleLabel("UNKNOWN"), "polo UNKNOWN");
  });

  it("paginação devolve total e página corretos acima de 20", () => {
    const memory = twoEntities();
    const createId = ids();
    for (let index = 1; index <= 21; index += 1) {
      const digits = `0001234562024509${String(index).padStart(4, "0")}`;
      applyBatchToMemory(memory, {
        entityId: "ent-a",
        now: `2026-09-30T12:${String(index).padStart(2, "0")}:00.000Z`,
        createId,
        batch: batch({
          source: "DJEN",
          cases: [djenCase({ processNumber: digits, cnpj: CNPJ_A })],
        }),
      });
    }
    const page1 = listCases(memory, { page: 1, pageSize: 20 });
    const page2 = listCases(memory, { page: 2, pageSize: 20 });
    assert.equal(page1.total, 21);
    assert.equal(page1.page, 1);
    assert.equal(page1.items.length, 20);
    assert.equal(page2.total, 21);
    assert.equal(page2.page, 2);
    assert.equal(page2.items.length, 1);
  });

  it("filtro entityId isola empresas", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A })] }),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-b",
      now: "2026-09-30T12:01:00.000Z",
      createId,
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_B, cnpj: CNPJ_B })] }),
    });
    const onlyA = listCases(memory, { entityId: "ent-a" });
    const onlyB = listCases(memory, { entityId: "ent-b" });
    assert.equal(onlyA.total, 1);
    assert.equal(onlyA.items[0]?.entityId, "ent-a");
    assert.equal(onlyA.items[0]?.entity.legalName, "Industria Exemplo LTDA");
    assert.equal(onlyB.items[0]?.entityId, "ent-b");
    assert.equal(onlyB.items[0]?.entity.legalName, "Comercio Outra LTDA");
    assert.notEqual(PROCESS_A_DIGITS, PROCESS_B_DIGITS);
  });

  it("filtro source considera evidência DataJud mesmo com primarySource DJEN", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch({ source: "DJEN", cases: [djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A })] }),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T13:00:00.000Z",
      createId,
      batch: batch({
        source: "DATAJUD",
        cases: [
          {
            ...djenCase({ processNumber: PROCESS_A, cnpj: CNPJ_A }),
            className: "Ação Trabalhista - Rito Ordinário",
            sourceIdentifier: "TRT9_G1_a",
            officialIdentifier: "TRT9_G1_a",
            rawMetadata: { id: "TRT9_G1_a" },
          },
        ],
      }),
    });
    const byDatajud = listCases(memory, { source: "DATAJUD" });
    const byDjen = listCases(memory, { source: "DJEN" });
    assert.equal(byDatajud.total, 1);
    assert.equal(byDatajud.items[0]?.primarySource, "DJEN");
    assert.equal(byDjen.total, 1);
    assert.equal(CASE_VERIFIED_OFFICIAL_COPY.includes("ativo"), false);
  });
});
