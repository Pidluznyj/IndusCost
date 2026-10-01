import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { applyBatchToMemory } from "./legalExposureApply.js";
import { PARTY_ROLE_CONFLICT_COPY, SOURCE_ATTEMPT_IDENTIFIER, type NormalizedCaseObservation, type NormalizedSourceBatch } from "./legalExposureContracts.js";
import {
  buildCaseDataCoverage,
  buildOppositionCaption,
  confirmedClaimants,
} from "./legalExposureCoverage.js";
import { sourceFactsFromRecords } from "./legalExposureCoverageDiagnosis.js";
import { buildCoverageAuditReport } from "./legalExposureCoverageAudit.js";
import { buildExposureProcessSummary } from "./legalExposureExecutive.js";
import { isJusbrasilEnabled } from "./legalExposureFeatureFlags.js";
import { normalizeProcessNumber } from "./legalExposureNormalization.js";
import { createEmptyExposureMemory } from "./legalExposureStore.js";
import { inferTribunalAlias, tribunalPublicLookup, TRIBUNAL_PUBLIC_MANUAL_ACCESS } from "./legalTribunalPublicRegistry.js";
import { mapEscavadorProcess } from "./sources/escavador/escavadorMapper.js";
import { runWebDiscoveryLocator } from "./sources/webDiscovery/webDiscoveryRunner.server.js";

const GROUP = FINANCE_INTERNAL_GROUP_COMPANIES[1]!;
const PROCESS = "0001234-56.2024.5.09.0001";
const PROCESS_DIGITS = normalizeProcessNumber(PROCESS)!;

function ids() {
  let n = 0;
  return () => `id-${++n}`;
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
    explicitCnpj: GROUP.cnpj,
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

function seedEntity() {
  const memory = createEmptyExposureMemory();
  memory.entities.push({
    id: "ent-a",
    cnpj: GROUP.cnpj,
    legalName: GROUP.name,
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
  });
  return memory;
}

function apply(memory: ReturnType<typeof seedEntity>, source: NormalizedSourceBatch["source"], extra: Partial<NormalizedCaseObservation>) {
  applyBatchToMemory(memory, {
    entityId: "ent-a",
    batch: batch(source, [observation(extra)]),
    now: "2026-09-30T12:00:00.000Z",
    createId: ids(),
  });
}

describe("cobertura e invariantes de polo", () => {
  it("empresa descoberta não vira reclamante automaticamente", () => {
    const memory = seedEntity();
    apply(memory, "DJEN", {
      entityPole: "UNKNOWN",
      className: null,
      parties: [
        {
          name: GROUP.name,
          document: GROUP.cnpj,
          partyType: "DESTINATARIO",
          personType: "COMPANY",
          pole: "ACTIVE",
        },
      ],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(confirmedClaimants(item.claimants).length, 0);
    assert.equal(item.claimants.some((row) => row.isGroupEntity && row.pole === "ACTIVE"), false);
    assert.equal(item.coverage?.opposition.caption.includes("contra"), false);
    assert.notEqual(item.coverage?.opposition.claimantLabel, GROUP.name);
  });

  it("ACTIVE + PASSIVE da mesma empresa não renderiza X contra X", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", {
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" }],
    });
    apply(memory, "ESCAVADOR", {
      className: null,
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMANTE", personType: "COMPANY", pole: "ACTIVE" }],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    const opposition = buildOppositionCaption(item);
    assert.equal(opposition.conflict, true);
    assert.equal(opposition.caption, PARTY_ROLE_CONFLICT_COPY);
    assert.equal(item.attentionFlags.includes("PARTY_ROLE_CONFLICT"), true);
    assert.notEqual(opposition.caption, `${GROUP.name} × ${GROUP.name}`);
  });

  it("party ACTIVE real vira claimant", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", {
      parties: [
        { name: "Maria Reclamante", document: "12345678909", partyType: "RECLAMANTE", personType: "PERSON", pole: "ACTIVE" },
        { name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" },
      ],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.claimants[0]?.name, "Maria Reclamante");
    assert.equal(item.groupEntities[0]?.pole, "PASSIVE");
    assert.equal(item.coverage?.fields.claimant, "FOUND");
  });

  it("party PASSIVE vira defendant e duas empresas do grupo PASSIVE aparecem", () => {
    const memory = seedEntity();
    const other = FINANCE_INTERNAL_GROUP_COMPANIES[0]!;
    memory.entities.push({
      id: "ent-b",
      cnpj: other.cnpj,
      legalName: other.name,
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
    });
    apply(memory, "DATAJUD", {
      parties: [
        { name: "João Autor", document: "98765432100", partyType: "RECLAMANTE", personType: "PERSON", pole: "ACTIVE" },
        { name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" },
        { name: other.name, document: other.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" },
      ],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.claimants[0]?.name, "João Autor");
    assert.equal(item.groupEntities.filter((row) => row.pole === "PASSIVE").length, 2);
  });

  it("provider complementar não sobrescreve classe oficial", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", { className: "Ação Trabalhista" });
    apply(memory, "ESCAVADOR", { className: "Classe comercial divergente", claimValue: "10.00" });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.className, "Ação Trabalhista");
    assert.ok(item.claimValue);
  });

  it("snippet web sozinho não confirma party", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", { parties: [] });
    apply(memory, "WEB_DISCOVERY", {
      className: "Inventada",
      parties: [{ name: "Nome do snippet", document: null, partyType: "RECLAMANTE", personType: "PERSON", pole: "ACTIVE" }],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.claimants.length, 0);
    assert.notEqual(item.className, "Inventada");
  });

  it("DataJud + tribunal + Escavador deduplicam a mesma party", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", {
      parties: [{ name: "Maria Reclamante", document: "12345678909", partyType: "AUTOR", personType: "PERSON", pole: "ACTIVE" }],
    });
    apply(memory, "TRIBUNAL_PUBLIC", {
      className: null,
      parties: [{ name: "Maria Reclamante", document: "123.456.789-09", partyType: "RECLAMANTE", personType: "PERSON", pole: "ACTIVE" }],
    });
    apply(memory, "ESCAVADOR", {
      className: null,
      parties: [{ name: "MARIA RECLAMANTE", document: "12345678909", partyType: "ATIVO", personType: "PERSON", pole: "ACTIVE" }],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.claimants.length, 1);
    assert.ok(item.claimants[0]?.sources.includes("DATAJUD"));
    assert.ok(item.claimants[0]?.sources.includes("ESCAVADOR"));
  });

  it("coverage identifica missing e conflict", () => {
    const memory = seedEntity();
    apply(memory, "DJEN", {
      className: null,
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "DESTINATARIO", personType: "COMPANY", pole: "ACTIVE" }],
    });
    const missing = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(missing.coverage?.fields.claimant, "MISSING");
    assert.ok((missing.coverage?.missingReasons[0] ?? "").includes("Autor/reclamante"));
    assert.ok((missing.coverage?.fieldDiagnoses.claimant.cause ?? "") !== "");
    assert.notEqual(missing.coverage?.fieldDiagnoses.claimant.line, "não identificado");

    apply(memory, "DATAJUD", {
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" }],
    });
    apply(memory, "ESCAVADOR", {
      className: null,
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMANTE", personType: "COMPANY", pole: "ACTIVE" }],
    });
    const conflict = buildCaseDataCoverage({ item: buildExposureProcessSummary(memory, PROCESS_DIGITS)! });
    assert.equal(conflict.fields.claimant, "CONFLICT");
  });
});

describe("fontes de cobertura", () => {
  it("Jusbrasil permanece desligado por default", () => {
    assert.equal(isJusbrasilEnabled({ LEGAL_EXPOSURE_ENABLED: "1" }), false);
  });

  it("TRT9 e TJPR exigem acesso manual e registram URL oficial", () => {
    assert.equal(inferTribunalAlias(PROCESS), "TRT9");
    const trt9 = tribunalPublicLookup({ processNumber: PROCESS, tribunal: "TRT9", system: "PJe" });
    assert.equal(trt9.errorCode, TRIBUNAL_PUBLIC_MANUAL_ACCESS);
    assert.equal(trt9.automated, false);
    assert.ok(trt9.publicUrl?.includes("pje.trt9.jus.br"));
    const tjpr = tribunalPublicLookup({ processNumber: "0001111-22.2024.8.16.0001", tribunal: "TJPR", system: "PJe" });
    assert.equal(tjpr.errorCode, TRIBUNAL_PUBLIC_MANUAL_ACCESS);
    assert.ok(tjpr.publicUrl?.includes("tjpr.jus.br"));
  });

  it("Escavador lê envolvidos em fontes[] e titulo_polo_ativo", () => {
    const mapped = mapEscavadorProcess(
      {
        numero_cnj: PROCESS,
        titulo_polo_ativo: "Maria Fonte Titulo",
        fontes: [
          {
            envolvidos: [{ nome: "Maria das Fontes", polo: "Ativo", cpf: "12345678909" }],
            capa: { classe: "Reclamação Trabalhista", valor_causa: { valor: 168127.48, moeda: "BRL" } },
          },
        ],
      },
      { items: [{ conteudo: "Distribuído", data: "2026-09-23" }] }
    );
    assert.equal(mapped.cases[0]?.parties[0]?.name, "Maria das Fontes");
    assert.equal(mapped.cases[0]?.parties[0]?.pole, "ACTIVE");
    assert.equal(mapped.cases[0]?.className, "Reclamação Trabalhista");
    assert.equal(mapped.cases[0]?.claimValue, "168127.48");
    assert.equal(mapped.cases[0]?.movements[0]?.name, "Distribuído");
  });

  it("web discovery não confirma polo e não usa Google", async () => {
    const batch = await runWebDiscoveryLocator({ processNumber: PROCESS, env: { LEGAL_EXPOSURE_ENABLED: "1" } });
    assert.equal(batch.source, "WEB_DISCOVERY");
    assert.equal(batch.cases.length, 0);
    assert.ok((batch.errorMessageSanitized ?? "").includes("Google"));
  });
});

describe("causas de lacuna de cobertura", () => {
  function coverageWithFacts(
    facts: ReturnType<typeof sourceFactsFromRecords>,
    extra: Partial<NormalizedCaseObservation> = {}
  ) {
    const memory = seedEntity();
    apply(memory, "DATAJUD", extra);
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    return buildCaseDataCoverage({ item, sourceFacts: facts });
  }

  it("fonte oficial encontrada confirma reclamante", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", {
      parties: [
        { name: "Maria Reclamante", document: "12345678909", partyType: "RECLAMANTE", personType: "PERSON", pole: "ACTIVE" },
        { name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" },
      ],
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.coverage?.fields.claimant, "FOUND");
    assert.equal(item.coverage?.fieldDiagnoses.claimant.cause, "FOUND");
    assert.match(item.coverage?.fieldDiagnoses.claimant.line ?? "", /Confirmado/);
    assert.ok(item.coverage?.sourceMatrix.some((row) => row.source === "DATAJUD" && row.outcome === "SUCCESS"));
  });

  it("provider sem credencial", () => {
    const facts = sourceFactsFromRecords({
      className: null,
      claimValueFormatted: null,
      currentStatus: null,
      evidences: [
        {
          source: "ESCAVADOR",
          lastSeenAt: "2026-09-30T12:00:00.000Z",
          sourceIdentifier: SOURCE_ATTEMPT_IDENTIFIER,
          rawMetadata: {
            kind: SOURCE_ATTEMPT_IDENTIFIER,
            outcome: "CONFIGURATION_ERROR",
            errorCode: "NOT_CONFIGURED",
            message: "Escavador desligado.",
          },
        },
      ],
    });
    const coverage = coverageWithFacts(facts);
    assert.equal(coverage.sourceMatrix.find((row) => row.source === "ESCAVADOR")?.outcome, "NOT_CONFIGURED");
    assert.equal(coverage.fieldDiagnoses.attorneys.cause, "NOT_CONFIGURED");
  });

  it("CAPTCHA/manual no portal público", () => {
    const facts = sourceFactsFromRecords({
      className: "Ação Trabalhista",
      claimValueFormatted: null,
      currentStatus: null,
      movements: Array.from({ length: 14 }, () => ({ source: "DATAJUD" as const })),
      evidences: [
        { source: "DATAJUD", lastSeenAt: "2026-09-30T12:00:00.000Z" },
        {
          source: "TRIBUNAL_PUBLIC",
          lastSeenAt: "2026-09-30T12:00:00.000Z",
          sourceIdentifier: SOURCE_ATTEMPT_IDENTIFIER,
          rawMetadata: {
            kind: SOURCE_ATTEMPT_IDENTIFIER,
            outcome: "CONFIGURATION_ERROR",
            errorCode: TRIBUNAL_PUBLIC_MANUAL_ACCESS,
            message: "CAPTCHA",
            capabilities: ["PARTIES", "ATTORNEYS"],
          },
        },
      ],
    });
    const coverage = coverageWithFacts(facts);
    assert.equal(coverage.fieldDiagnoses.claimant.cause, "CAPTCHA");
    assert.match(coverage.fieldDiagnoses.claimant.line, /CAPTCHA/);
    assert.equal(coverage.sourceMatrix.find((row) => row.source === "TRIBUNAL_PUBLIC")?.outcome, "CAPTCHA");
    assert.ok((coverage.publicCompare?.additionalOnPortal ?? []).includes("PARTIES"));
  });

  it("rate limit", () => {
    const facts = sourceFactsFromRecords({
      className: null,
      claimValueFormatted: null,
      currentStatus: null,
      evidences: [
        {
          source: "DATAJUD",
          lastSeenAt: "2026-09-30T12:00:00.000Z",
          sourceIdentifier: SOURCE_ATTEMPT_IDENTIFIER,
          rawMetadata: {
            kind: SOURCE_ATTEMPT_IDENTIFIER,
            outcome: "RATE_LIMITED",
            errorCode: "RATE_LIMITED",
            message: "limite",
          },
        },
      ],
    });
    const coverage = coverageWithFacts(facts);
    assert.equal(coverage.fieldDiagnoses.claimant.cause, "RATE_LIMIT");
  });

  it("source error técnico", () => {
    const facts = sourceFactsFromRecords({
      className: null,
      claimValueFormatted: null,
      currentStatus: null,
      evidences: [
        {
          source: "DATAJUD",
          lastSeenAt: "2026-09-30T12:00:00.000Z",
          sourceIdentifier: SOURCE_ATTEMPT_IDENTIFIER,
          rawMetadata: {
            kind: SOURCE_ATTEMPT_IDENTIFIER,
            outcome: "SOURCE_ERROR",
            errorCode: "SOURCE_ERROR",
            message: "timeout do tribunal",
          },
        },
      ],
    });
    const coverage = coverageWithFacts(facts);
    assert.equal(coverage.fieldDiagnoses.claimant.cause, "TECHNICAL_ERROR");
  });

  it("processo sigiloso", () => {
    const facts = sourceFactsFromRecords({
      className: "Ação Trabalhista",
      claimValueFormatted: null,
      currentStatus: null,
      evidences: [{ source: "DATAJUD", lastSeenAt: "2026-09-30T12:00:00.000Z" }],
    });
    const coverage = coverageWithFacts(facts, { secrecy: true, parties: [] });
    assert.equal(coverage.fieldDiagnoses.claimant.cause, "SEALED_PROCESS");
  });

  it("endpoint oficial sem partes", () => {
    const facts = sourceFactsFromRecords({
      className: "Ação Trabalhista",
      claimValueFormatted: null,
      currentStatus: null,
      movements: [{ source: "DATAJUD" }],
      evidences: [{ source: "DATAJUD", lastSeenAt: "2026-09-30T12:00:00.000Z" }],
    });
    const coverage = coverageWithFacts(facts, { parties: [] });
    assert.equal(coverage.fieldDiagnoses.claimant.cause, "ENDPOINT_WITHOUT_PARTIES");
    assert.equal(coverage.sourceMatrix.find((row) => row.source === "DATAJUD")?.claimant, "missing");
    assert.equal(coverage.sourceMatrix.find((row) => row.source === "DATAJUD")?.class, "found");
  });

  it("campo realmente ausente e conflito", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", {
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" }],
      currentStatus: "Em andamento",
    });
    const item = buildExposureProcessSummary(memory, PROCESS_DIGITS)!;
    assert.equal(item.coverage?.fields.hearings, "MISSING");
    assert.ok(["FIELD_ABSENT", "NOT_CONFIGURED", "CAPTCHA"].includes(item.coverage?.fieldDiagnoses.hearings.cause ?? ""));
    apply(memory, "ESCAVADOR", {
      className: null,
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMANTE", personType: "COMPANY", pole: "ACTIVE" }],
    });
    const conflict = buildCaseDataCoverage({ item: buildExposureProcessSummary(memory, PROCESS_DIGITS)! });
    assert.equal(conflict.fieldDiagnoses.claimant.cause, "CONFLICT");
  });
});

describe("auditoria de cobertura", () => {
  it("ordena incompletos e calcula percentuais sem inventar reclamante", () => {
    const memory = seedEntity();
    apply(memory, "DATAJUD", {
      parties: [{ name: GROUP.name, document: GROUP.cnpj, partyType: "RECLAMADA", personType: "COMPANY", pole: "PASSIVE" }],
    });
    const items = [buildExposureProcessSummary(memory, PROCESS_DIGITS)!];
    const report = buildCoverageAuditReport({ items, configuration: [] });
    assert.equal(report.readOnly, true);
    assert.equal(report.coverage.claimantIdentified, "0.0%");
    assert.equal(report.topIncomplete[0]?.cnj.includes("0001234"), true);
    assert.ok(report.processes[0]?.sourceMatrix.some((row) => row.source === "DATAJUD"));
    assert.equal(report.controlSample.trt9.length, 1);
  });
});
