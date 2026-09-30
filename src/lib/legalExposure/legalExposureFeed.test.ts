/**
 * Feed do Exposure: cada linha de comunicação, evento, alerta e linha do
 * tempo diz de qual processo/empresa se trata e o que aconteceu — sem
 * código bruto nem eventos que só repetem a movimentação.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { caseTimeline, listAlerts, listCommunications, listEvents } from "./legalExposureReadModel.js";
import {
  COMMUNICATION_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  communicationTypeLabel,
  eventDetail,
  eventTypeLabel,
  movementComplementsText,
  SOURCE_STATUS_HINTS,
} from "./legalExposureFeedUi.js";
import { LEGAL_EXPOSURE_EVENT_TYPES, LEGAL_SOURCE_CONNECTION_STATUSES } from "./legalExposureContracts.js";
import { createEmptyExposureMemory, type LegalExposureMemory } from "./legalExposureStore.js";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const AT = "2026-09-30T18:02:03.188Z";

function memoryWithCase(): LegalExposureMemory {
  const memory = createEmptyExposureMemory();
  memory.entities.push({
    id: "ent-a",
    cnpj: "11222333000181",
    legalName: "Industria Exemplo LTDA",
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
    createdAt: AT,
    updatedAt: AT,
  });
  memory.cases.push({
    id: "case-1",
    entityId: "ent-a",
    processNumber: "0030701-80.2024.8.16.0001",
    processNumberNormalized: "00307018020248160001",
    tribunal: "TJPR",
    jurisdiction: null,
    degree: null,
    courtUnit: "10ª Vara Cível de Curitiba",
    classCode: null,
    className: "Procedimento Comum Cível",
    filedAt: null,
    currentStatus: null,
    entityPole: "PASSIVE",
    firstSeenAt: AT,
    lastSeenAt: AT,
    primarySource: "DJEN",
    sourceUpdatedAt: null,
    createdAt: AT,
    updatedAt: AT,
  });
  memory.movements.push({
    id: "mov-1",
    caseId: "case-1",
    source: "DATAJUD",
    sourceCode: "123",
    name: "Decurso de Prazo",
    occurredAt: "2026-05-05T12:00:00.000Z",
    courtUnit: "10ª Vara Cível de Curitiba",
    complements: [{ codigo: 2, descricao: "tipo_de_distribuicao_redistribuicao", valor: 2, nome: "sorteio" }],
    fingerprint: "f1",
    firstSeenAt: AT,
    rawMetadata: null,
    createdAt: AT,
  });
  memory.communications.push({
    id: "com-1",
    entityId: "ent-a",
    caseId: "case-1",
    source: "DJEN",
    sourceCommunicationId: "djen-1",
    idempotencyKey: "k1",
    processNumber: "00307018020248160001",
    communicationType: "Intimação",
    subject: null,
    sourceStatus: "P",
    normalizedStatus: "PENDING",
    availableAt: "2026-09-01T10:24:00.000Z",
    detectedAt: AT,
    scienceDeadlineAt: "2026-09-11T03:00:00.000Z",
    sourceScienceAt: null,
    officialContentOpenedAt: null,
    officialContentOpenedByUserId: null,
    tribunal: "TJPR",
    courtUnit: "10ª Vara Cível de Curitiba",
    rawMetadata: null,
    rawHash: null,
    firstSeenAt: AT,
    lastSeenAt: AT,
    createdAt: AT,
    updatedAt: AT,
  });
  const event = (id: string, eventType: LegalExposureMemory["events"][number]["eventType"], payload: unknown, communicationId: string | null = null) => ({
    id,
    eventKey: id,
    entityId: "ent-a",
    caseId: "case-1",
    communicationId,
    source: "DATAJUD" as const,
    eventType,
    severity: "INFO" as const,
    detectedAt: AT,
    payload,
    payloadHash: id,
    createdAt: AT,
  });
  memory.events.push(
    event("ev-mov", "NEW_MOVEMENT", { name: "Decurso de Prazo", sourceCode: "123" }),
    event("ev-status", "CASE_STATUS_CHANGED", { from: "Em andamento", to: "Arquivado" }),
    event("ev-int", "NEW_INTIMATION", { communicationType: "Intimação" }, "com-1"),
    event("ev-src", "SOURCE_CONFIRMATION", { source: "DATAJUD" })
  );
  memory.alerts.push({
    id: "al-1",
    entityId: "ent-a",
    eventId: "ev-int",
    severity: "HIGH",
    status: "OPEN",
    requiresAction: true,
    title: "Intimação nova",
    summary: "Há intimação pendente nas fontes consultadas.",
    createdAt: AT,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    resolvedAt: null,
    resolvedByUserId: null,
  });
  return memory;
}

describe("rótulos de leitura", () => {
  it("todo tipo de evento e toda situação de fonte têm texto em português", () => {
    for (const type of LEGAL_EXPOSURE_EVENT_TYPES) assert.ok(EVENT_TYPE_LABELS[type], type);
    for (const status of LEGAL_SOURCE_CONNECTION_STATUSES) assert.ok(SOURCE_STATUS_HINTS[status], status);
    assert.equal(eventTypeLabel("NEW_MOVEMENT"), "Nova movimentação");
    assert.equal(eventTypeLabel("SOURCE_CONFIRMATION"), "Confirmado em fonte oficial");
    assert.equal(COMMUNICATION_STATUS_LABELS.PENDING, "Pendente de ciência");
  });

  it("tipo de comunicação e detalhe do evento saem legíveis, sem payload bruto", () => {
    assert.equal(communicationTypeLabel("INTIMACAO"), "Intimação");
    assert.equal(communicationTypeLabel("citação"), "Citação");
    assert.equal(communicationTypeLabel("OUTRA"), "Outra comunicação");
    assert.equal(communicationTypeLabel(null), "Comunicação");
    assert.equal(eventDetail("NEW_MOVEMENT", { name: "Decurso de Prazo" }), "Decurso de Prazo");
    assert.equal(eventDetail("CASE_STATUS_CHANGED", { from: "Em andamento", to: "Arquivado" }), "Em andamento → Arquivado");
    assert.equal(eventDetail("CASE_POLE_CONFIRMED", { pole: "PASSIVE" }), "Polo: ré / polo passivo");
    assert.equal(eventDetail("NEW_INTIMATION", { communicationType: "Intimação" }), "Intimação");
    assert.equal(eventDetail("CANDIDATE_REVIEW", { name: "KOPPETEL" }), "Nome encontrado: KOPPETEL");
    assert.equal(eventDetail("NEW_MOVEMENT", "texto"), null);
    assert.equal(movementComplementsText([{ descricao: "tipo_de_distribuicao_redistribuicao", nome: "sorteio" }]), "tipo de distribuicao redistribuicao: sorteio");
    assert.equal(movementComplementsText(null), null);
  });
});

describe("leituras do feed dizem do que se trata", () => {
  it("comunicação traz processo, empresa, vara e prazo de ciência", () => {
    const page = listCommunications(memoryWithCase(), {});
    const [row] = page.items;
    assert.equal(row?.reference.processNumber, "0030701-80.2024.8.16.0001");
    assert.equal(row?.reference.entity?.legalName, "Industria Exemplo LTDA");
    assert.equal(row?.reference.entity?.displayCnpj, "11.222.333/0001-81");
    assert.equal(row?.reference.caseId, "case-1");
    assert.equal(row?.scienceDeadlineAt, "2026-09-11T03:00:00.000Z");
    assert.equal(row?.courtUnit, "10ª Vara Cível de Curitiba");
  });

  it("evento traz título legível, detalhe do payload e referência do processo", () => {
    const page = listEvents(memoryWithCase(), {});
    const byId = new Map(page.items.map((row) => [row.id, row]));
    assert.equal(byId.get("ev-mov")?.title, "Nova movimentação");
    assert.equal(byId.get("ev-mov")?.detail, "Decurso de Prazo");
    assert.equal(byId.get("ev-status")?.detail, "Em andamento → Arquivado");
    assert.equal(byId.get("ev-int")?.reference.processNumber, "0030701-80.2024.8.16.0001");
    assert.equal(byId.get("ev-src")?.reference.entity?.legalName, "Industria Exemplo LTDA");
    assert.ok(page.items.every((row) => !("payload" in row)), "payload bruto não sai na listagem");
  });

  it("alerta herda do evento o processo, a fonte e o detalhe", () => {
    const page = listAlerts(memoryWithCase(), { status: "OPEN" });
    const [row] = page.items;
    assert.equal(row?.title, "Intimação nova");
    assert.equal(row?.eventType, "NEW_INTIMATION");
    assert.equal(row?.source, "DATAJUD");
    assert.equal(row?.detail, "Intimação");
    assert.equal(row?.reference.processNumber, "0030701-80.2024.8.16.0001");
    assert.equal(row?.reference.courtUnit, "10ª Vara Cível de Curitiba");
    assert.equal(row?.reference.entity?.legalName, "Industria Exemplo LTDA");
  });

  it("linha do tempo do processo: cabeçalho do processo, movimentação com data real e sem eventos repetidos", () => {
    const page = caseTimeline(memoryWithCase(), "case-1", {});
    assert.equal(page.case?.processNumber, "0030701-80.2024.8.16.0001");
    assert.equal(page.case?.className, "Procedimento Comum Cível");
    assert.equal(page.case?.entity?.legalName, "Industria Exemplo LTDA");
    const kinds = page.items.map((row) => `${row.kind}:${row.title}`);
    // NEW_MOVEMENT e NEW_INTIMATION só repetiriam a movimentação e a comunicação; ficam de fora.
    assert.deepEqual(kinds, [
      "event:Situação do processo alterada",
      "event:Confirmado em fonte oficial",
      "communication:Intimação",
      "movement:Decurso de Prazo",
    ]);
    const movement = page.items.find((row) => row.kind === "movement");
    assert.equal(movement?.at, "2026-05-05T12:00:00.000Z");
    assert.equal(movement?.atKind, "OCCURRED");
    assert.equal(movement?.detail, "10ª Vara Cível de Curitiba · tipo de distribuicao redistribuicao: sorteio");
    const communication = page.items.find((row) => row.kind === "communication");
    assert.equal(communication?.atKind, "AVAILABLE");
    assert.equal(communication?.status, "PENDING");
    assert.equal(page.items.find((row) => row.title === "Situação do processo alterada")?.detail, "Em andamento → Arquivado");
    assert.equal(caseTimeline(memoryWithCase(), "nao-existe", {}).case, null);
  });
});

describe("tela", () => {
  it("as abas de leitura usam os cartões do feed e não imprimem código bruto de evento", () => {
    const page = readFileSync(path.join(ROOT, "src/components/legalExposure/ExposurePage.tsx"), "utf8");
    for (const name of ["ExposureAlertsTab", "ExposureCommunicationsTab", "ExposureTimelineTab", "ExposureCertificatesTab", "ExposureSourcesTab"]) {
      assert.match(page, new RegExp(`<${name}\\b`), name);
    }
    assert.match(page, /\/api\/legal-exposure\/events\?page=1/);
    assert.match(page, /\/api\/legal-exposure\/certificates/);
    assert.doesNotMatch(page, /\{item\.eventType\}|\{item\.severity\}|\{item\.detectedAt\}|\{item\.at\}/);
    const feed = readFileSync(path.join(ROOT, "src/components/legalExposure/ExposureFeed.tsx"), "utf8");
    assert.match(feed, /formatExposureDateTime/);
    assert.match(feed, /communicationTypeLabel\(/);
    assert.match(feed, /SEVERITY_LABELS\[/);
    assert.match(feed, /COMMUNICATION_STATUS_LABELS\[/);
    assert.match(feed, /CERTIFICATE_RESULT_LABELS\[/);
    assert.match(feed, /SOURCE_STATUS_HINTS\[/);
    assert.doesNotMatch(feed, /rawMetadata|payload/);
  });
});
