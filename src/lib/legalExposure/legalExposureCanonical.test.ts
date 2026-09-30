import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyBatchToMemory, mergeExistingCaseMetadata } from "./legalExposureApply.js";
import { pickCanonicalCase, resolveCanonicalCaseGroup } from "./legalExposureCanonical.js";
import { classifyCaseStage } from "./legalExposureCaseStage.js";
import type { NormalizedCaseObservation, NormalizedSourceBatch } from "./legalExposureContracts.js";
import { buildExposureDashboard, listCases } from "./legalExposureReadModel.js";
import {
  buildExposureGroupReport,
  buildExposureProcessDossier,
  buildExecutiveNarrative,
} from "./legalExposureExecutive.js";
import { dossierPdfLines } from "./legalExposurePdf.js";
import { normalizeProcessNumber } from "./legalExposureNormalization.js";
import { maskCpf } from "./legalExposurePrivacy.js";
import { createEmptyExposureMemory, type ExposureCaseRecord } from "./legalExposureStore.js";

const CNPJ_A = "11222333000181";
const CNPJ_B = "99888777000166";
const PROCESS = "0001234-56.2024.5.09.0001";
const PROCESS_DIGITS = normalizeProcessNumber(PROCESS)!;

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

function observation(partial: Partial<NormalizedCaseObservation> = {}): NormalizedCaseObservation {
  return {
    processNumber: PROCESS,
    tribunal: "TRT9",
    jurisdiction: "G1",
    degree: "G1",
    courtUnit: "09ª VARA",
    classCode: "985",
    className: "Ação Trabalhista",
    filedAt: "2026-09-23T00:00:00.000Z",
    currentStatus: null,
    entityPole: "PASSIVE",
    sourceIdentifier: PROCESS_DIGITS,
    sourceUpdatedAt: "2026-09-30T12:00:00.000Z",
    explicitCnpj: CNPJ_A,
    candidateName: null,
    officialIdentifier: PROCESS_DIGITS,
    parties: [],
    movements: [],
    rawMetadata: {},
    ...partial,
  };
}

function batch(source: NormalizedSourceBatch["source"], cases: NormalizedCaseObservation[]): NormalizedSourceBatch {
  return {
    source,
    outcome: "SUCCESS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: true,
    cases,
    communications: [],
    candidates: [],
  };
}

function twoEntities() {
  const memory = createEmptyExposureMemory();
  memory.entities.push(entity("ent-a", CNPJ_A, "Lazarios Exemplo LTDA"));
  memory.entities.push(entity("ent-b", CNPJ_B, "Koppetel Exemplo LTDA"));
  return memory;
}

function physicalCase(id: string, entityId: string, createdAt: string): ExposureCaseRecord {
  return {
    id,
    entityId,
    processNumber: PROCESS,
    processNumberNormalized: PROCESS_DIGITS,
    tribunal: "TRT9",
    jurisdiction: "G1",
    degree: "G1",
    courtUnit: "09ª VARA",
    classCode: "985",
    className: "Ação Trabalhista",
    filedAt: "2026-09-23T00:00:00.000Z",
    currentStatus: null,
    entityPole: "PASSIVE",
    systemName: null,
    area: null,
    claimValue: "168127.48",
    claimCurrency: "BRL",
    archivedAt: null,
    secrecy: null,
    priority: null,
    firstSeenAt: createdAt,
    lastSeenAt: createdAt,
    primarySource: "DJEN",
    sourceUpdatedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("canonical CNJ grouping", () => {
  it("duas rows físicas do mesmo CNJ viram um processo com duas empresas", () => {
    const memory = twoEntities();
    memory.cases.push(physicalCase("case-a", "ent-a", "2026-09-01T10:00:00.000Z"));
    memory.cases.push(physicalCase("case-b", "ent-b", "2026-09-02T10:00:00.000Z"));
    const page = listCases(memory, {});
    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.groupEntities.length, 2);
    assert.equal(page.items[0]?.processNumber.replace(/\D/g, ""), PROCESS_DIGITS);
    const canonical = pickCanonicalCase(memory.cases);
    assert.equal(canonical?.id, "case-a");
    const dash = buildExposureDashboard(memory);
    assert.equal(dash.cards.monitoredCases, 1);
    assert.equal(dash.entities.find((row) => row.id === "ent-a")?.monitoredCases, 1);
    assert.equal(dash.entities.find((row) => row.id === "ent-b")?.monitoredCases, 1);
  });

  it("nova ingestão da segunda empresa não cria outro LegalCase", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch("DJEN", [observation({ explicitCnpj: CNPJ_A, className: null })]),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-b",
      now: "2026-09-30T13:00:00.000Z",
      createId,
      batch: batch("DJEN", [observation({ explicitCnpj: CNPJ_B, entityPole: "PASSIVE", className: null })]),
    });
    assert.equal(memory.cases.length, 1);
    const group = resolveCanonicalCaseGroup(memory, PROCESS_DIGITS);
    assert.equal(group.entityLinks.length, 2);
  });

  it("polo UNKNOWN não aparece como ré", () => {
    const memory = twoEntities();
    memory.entities.push(entity("ent-c", "11111111000191", "SM Exemplo LTDA"));
    memory.cases.push(physicalCase("case-a", "ent-a", "2026-09-01T10:00:00.000Z"));
    memory.entityLinks.push({
      id: "link-c",
      caseId: "case-a",
      entityId: "ent-c",
      pole: "UNKNOWN",
      confidence: "CONFIRMED",
      firstSource: "DJEN",
      lastSource: "DJEN",
      firstSeenAt: "2026-09-01T10:00:00.000Z",
      lastSeenAt: "2026-09-01T10:00:00.000Z",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    });
    const item = listCases(memory, {}).items[0];
    const unknown = item?.groupEntities.find((row) => row.id === "ent-c");
    assert.equal(unknown?.pole, "UNKNOWN");
    assert.equal(item?.groupEntities.filter((row) => row.pole === "PASSIVE").length >= 1, true);
  });

  it("claimant ACTIVE entra em claimants", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch("DATAJUD", [
        observation({
          explicitCnpj: CNPJ_A,
          parties: [{ name: "Maria Exemplo", document: "12345678909", partyType: "RECLAMANTE", pole: "ACTIVE" }],
        }),
      ]),
    });
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.claimants[0]?.name, "Maria Exemplo");
    assert.equal(item?.claimants[0]?.partyType, "RECLAMANTE");
  });

  it("deduplica party pelo documento entre fontes", () => {
    const memory = twoEntities();
    const createId = ids();
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T12:00:00.000Z",
      createId,
      batch: batch("DATAJUD", [
        observation({
          explicitCnpj: CNPJ_A,
          parties: [{ name: "Maria Exemplo", document: "12345678909", partyType: "RECLAMANTE", pole: "ACTIVE" }],
        }),
      ]),
    });
    applyBatchToMemory(memory, {
      entityId: "ent-a",
      now: "2026-09-30T13:00:00.000Z",
      createId,
      batch: batch("ESCAVADOR", [
        observation({
          explicitCnpj: CNPJ_A,
          className: "Reclamação Trabalhista",
          parties: [{ name: "Maria Exemplo", document: "12345678909", partyType: "RECLAMANTE", pole: "ACTIVE" }],
        }),
      ]),
    });
    const item = listCases(memory, {}).items[0];
    assert.equal(item?.claimants.length, 1);
    assert.deepEqual(item?.claimants[0]?.sources, ["DATAJUD", "ESCAVADOR"]);
    assert.equal(item?.className, "Ação Trabalhista");
  });

  it("null posterior não apaga dado oficial", () => {
    const legalCase = physicalCase("case-a", "ent-a", "2026-09-01T10:00:00.000Z");
    mergeExistingCaseMetadata(legalCase, observation({ className: null, tribunal: null }), "ESCAVADOR");
    assert.equal(legalCase.className, "Ação Trabalhista");
    assert.equal(legalCase.tribunal, "TRT9");
  });

  it("fase conservadora e narrativa só com fatos", () => {
    const stage = classifyCaseStage({
      currentStatus: null,
      className: "Ação Trabalhista",
      archivedAt: null,
      movements: [{ name: "Conclusos para decisão", sourceCode: "123" }],
    });
    assert.equal(stage.stage, "DECISION");
    const memory = twoEntities();
    memory.cases.push(physicalCase("case-a", "ent-a", "2026-09-01T10:00:00.000Z"));
    const dossier = buildExposureProcessDossier(memory, "case-a");
    assert.ok(dossier);
    const narrative = buildExecutiveNarrative(dossier);
    assert.match(narrative, /polo passivo/);
    assert.equal(narrative.includes("chance de condenação"), false);
    const lines = dossierPdfLines(dossier);
    assert.ok(lines.some((line) => line.includes(dossier.processNumber)));
    assert.ok(lines.some((line) => line.includes("Lazarios")));
    const report = buildExposureGroupReport(memory);
    assert.equal(report.totals.uniqueProcesses, 1);
  });
});

describe("privacy and cards", () => {
  it("mascara CPF", () => {
    assert.equal(maskCpf("12345678909"), "***.***.***-09");
  });

  it("card e dossiê não expõem CPF completo", () => {
    const memory = twoEntities();
    memory.cases.push(physicalCase("case-a", "ent-a", "2026-09-01T10:00:00.000Z"));
    memory.parties.push({
      id: "p1",
      caseId: "case-a",
      name: "Maria Exemplo",
      normalizedName: "MARIA EXEMPLO",
      document: "12345678909",
      documentNormalized: "12345678909",
      partyType: "RECLAMANTE",
      personType: "PERSON",
      pole: "ACTIVE",
      source: "DATAJUD",
      firstSeenAt: "2026-09-01T10:00:00.000Z",
      lastSeenAt: "2026-09-01T10:00:00.000Z",
    });
    const page = listCases(memory, {});
    const serialized = JSON.stringify(page.items);
    assert.equal(serialized.includes("12345678909"), false);
    assert.ok(page.items[0]?.claimants[0]?.documentMasked?.includes("***"));
    const dossier = buildExposureProcessDossier(memory, "case-a")!;
    assert.equal(JSON.stringify(dossier).includes("12345678909"), false);
    assert.ok(dossier.claimants[0]?.documentMasked);
    assert.ok(dossier.narrative != null);
  });
});
