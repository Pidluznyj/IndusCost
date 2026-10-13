import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatCnpj } from "@/src/lib/companyCnpjFormat";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions";
import { applyBatchToMemory } from "@/src/lib/legalExposure/legalExposureApply";
import type { NormalizedSourceBatch } from "@/src/lib/legalExposure/legalExposureContracts";
import { buildExposureProcessDossier } from "@/src/lib/legalExposure/legalExposureExecutive";
import { createEmptyExposureMemory } from "@/src/lib/legalExposure/legalExposureStore";
import { ExposureCaseDossier } from "./ExposureCaseDossier";
import {
  formatCommunicationScienceDeadline,
  formatDomicilioScienceDeadline,
  formatExposureDateTime,
} from "@/src/lib/legalExposure/legalExposureCaseListUi";
import { DOMICILIO_PORTAL_URL, OFFICIAL_COMMUNICATIONS_PORTAL_URL } from "@/src/lib/legalExposure/legalExposureContracts";
import { communicationPortalLink } from "@/src/lib/legalExposure/legalExposureFeedUi";
import {
  EMPTY_COMMUNICATION_FILTERS,
  ExposureCommunicationsTab,
  ExposureSourcesTab,
  type ExposureCommunicationItem,
  type ExposureSourceOperationItem,
} from "./ExposureFeed";

const NOW = "2026-10-13T12:00:00.000Z";
const COMPANY = FINANCE_INTERNAL_GROUP_COMPANIES[0]!;
const CNPJ = COMPANY.cnpj;
const PROCESS = "00002860620215090021";

const HANDLERS = { onClose: () => {}, onRefresh: () => {}, onCompleteData: () => {}, onPdf: () => {} };

function batch(partial: Partial<NormalizedSourceBatch>): NormalizedSourceBatch {
  return {
    source: "DOMICILIO",
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

function dossierWith(communications: NormalizedSourceBatch["communications"]) {
  const memory = createEmptyExposureMemory();
  memory.entities.push({
    id: "entity-1",
    cnpj: CNPJ,
    legalName: COMPANY.name,
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
    createdAt: NOW,
    updatedAt: NOW,
  });
  let n = 0;
  const createId = () => `id-${++n}`;
  applyBatchToMemory(memory, {
    entityId: "entity-1",
    now: NOW,
    createId,
    batch: batch({
      communications,
      cases: [
        {
          processNumber: PROCESS,
          tribunal: "TRT9",
          jurisdiction: null,
          degree: null,
          courtUnit: "1ª Vara do Trabalho",
          classCode: null,
          className: "Ação Trabalhista",
          filedAt: null,
          currentStatus: null,
          entityPole: "UNKNOWN",
          sourceIdentifier: PROCESS,
          sourceUpdatedAt: null,
          explicitCnpj: CNPJ,
          candidateName: null,
          officialIdentifier: null,
          parties: [],
          movements: [],
          rawMetadata: {},
        },
      ],
    }),
  });
  return buildExposureProcessDossier(memory, memory.cases[0]!.id, new Date(NOW));
}

function operation(partial: Partial<ExposureSourceOperationItem>): ExposureSourceOperationItem {
  return {
    source: "DOMICILIO",
    label: "Domicílio",
    description: "",
    readiness: "READY",
    configured: true,
    enabled: true,
    missingEnvVars: [],
    hint: "",
    running: false,
    interrupted: false,
    lastRun: null,
    nextScheduledAt: null,
    frequencyLabel: "Manual / sob demanda",
    times: [],
    coverage: null,
    ...partial,
  };
}

function company(partial: Partial<NonNullable<ExposureSourceOperationItem["companies"]>[number]>) {
  return {
    entityId: "entity-1",
    legalName: COMPANY.name,
    cnpj: CNPJ,
    accountConfigured: true,
    status: "HEALTHY",
    lastAttemptAt: NOW,
    lastSuccessfulAt: NOW,
    checkpoint: NOW,
    stale: false,
    lastErrorCode: null,
    lastErrorMessage: null,
    communications: 0,
    pendingScience: 0,
    pendingReconciliation: 0,
    ...partial,
  };
}

describe("ficha do processo — comunicações do Domicílio", () => {
  it("mostra destinatária, situação oficial, prazo, coleta e o aviso de que revisão interna não é ciência", () => {
    const dossier = dossierWith([
      {
        sourceCommunicationId: "com-123",
        tenantId: "tenant-1",
        processNumber: PROCESS,
        communicationType: "CITACAO",
        subject: "Reclamação trabalhista",
        sourceStatus: "EM_CURSO",
        availableAt: "2026-10-12T10:00:00.000Z",
        scienceDeadlineAt: "2026-10-22T10:00:00.000Z",
        sourceScienceAt: null,
        tribunal: "TRT9",
        courtUnit: "1ª Vara do Trabalho",
        rawMetadata: {},
      },
    ]);
    const html = renderToStaticMarkup(
      <ExposureCaseDossier dossier={dossier as never} initialTab="comunicacoes" {...HANDLERS} />
    );
    assert.match(html, /data-testid="exposure-communication"/);
    assert.match(html, /data-source="DOMICILIO"/);
    assert.match(html, /Fonte: Domicílio/);
    assert.ok(html.includes(`Destinatária ${COMPANY.name} · ${formatCnpj(CNPJ)}`));
    assert.match(html, /Situação oficial <!-- -->Pendente de ciência|Situação oficial\s*(<!-- -->)?\s*Pendente de ciência/);
    assert.match(html, /Prazo para ciência/);
    assert.match(html, /referência com-123/);
    assert.match(html, /não registra ciência/);
    // Nenhum atalho para abrir o teor: é a abertura que gera ciência.
    assert.equal(html.includes("Ver comunicação oficial"), false);
    assert.equal(html.includes("Abrir portal oficial"), false);
  });

  it("processo sem comunicações mostra o estado vazio", () => {
    const html = renderToStaticMarkup(
      <ExposureCaseDossier dossier={dossierWith([]) as never} initialTab="comunicacoes" {...HANDLERS} />
    );
    assert.match(html, /Nenhuma comunicação vinculada a este processo/);
    assert.equal(html.includes('data-testid="exposure-communication"'), false);
  });
});

describe("central de fontes — Domicílio por empresa", () => {
  it("coleta em dia sem comunicações não mostra aviso de defasagem", () => {
    const html = renderToStaticMarkup(
      <ExposureSourcesTab sources={[]} operations={[operation({ companies: [company({})] })]} onRun={() => {}} />
    );
    assert.match(html, /data-testid="exposure-domicilio-companies"/);
    assert.match(html, /Credencial configurada/);
    assert.match(html, /0<!-- --> ?\s*(<!-- -->)?\s*comunicações|0 comunicações/);
    assert.equal(html.includes("ausência de comunicações não está confirmada"), false);
  });

  it("coleta defasada ou com erro avisa que a ausência de comunicações não está confirmada", () => {
    const html = renderToStaticMarkup(
      <ExposureSourcesTab
        sources={[]}
        operations={[
          operation({
            companies: [
              company({ stale: true, status: "AUTH_ERROR", checkpoint: null, lastErrorMessage: "HTTP 401" }),
              company({ entityId: "entity-2", legalName: "Koppetel Comercio de Plasticos LTDA", accountConfigured: false, stale: true, status: "NOT_CONFIGURED", checkpoint: null }),
            ],
          }),
        ]}
        onRun={() => {}}
      />
    );
    assert.equal((html.match(/ausência de comunicações não está confirmada/g) ?? []).length, 1);
    assert.match(html, /Último erro: HTTP 401/);
    assert.match(html, /Sem credencial para este CNPJ/);
    assert.match(html, /Última coleta completa <!-- -->nunca|Última coleta completa\s*(<!-- -->)?\s*nunca/);
  });
});

/**
 * Caso real validado em produção (processo 0001384-86.2026.5.09.0009): o portal do CNJ
 * mostra a data final de ciência 05/10/2026 e a tela mostrava 04/10/2026, 21:00.
 */
const REAL_DEADLINE = "2026-10-05T00:00:00.000Z";
const REAL_SCIENCE_AT = "2026-10-05T23:59:59.000Z";

describe("Domicílio — data final de ciência é data civil", () => {
  it("meia-noite UTC mostra a própria data, sem hora e sem voltar para a véspera", () => {
    assert.equal(formatDomicilioScienceDeadline(REAL_DEADLINE), "05/10/2026");
    assert.equal(formatCommunicationScienceDeadline("DOMICILIO", REAL_DEADLINE), "05/10/2026");
    // O formatador geral, que converte para Brasília, é o que produzia a véspera.
    assert.match(formatExposureDateTime(REAL_DEADLINE) ?? "", /^04\/10\/2026/);
    assert.equal(formatDomicilioScienceDeadline("2026-01-01T00:00:00.000Z"), "01/01/2026");
    assert.equal(formatDomicilioScienceDeadline("2026-12-31T00:00:00.000Z"), "31/12/2026");
  });

  it("horário diferente de meia-noite UTC não é tratado como data civil: segue como instante em Brasília", () => {
    assert.equal(formatDomicilioScienceDeadline("2026-10-05T15:30:00.000Z"), formatExposureDateTime("2026-10-05T15:30:00.000Z"));
    assert.equal(formatDomicilioScienceDeadline("2026-10-05T03:00:00.000Z"), formatExposureDateTime("2026-10-05T03:00:00.000Z"));
    assert.equal(formatDomicilioScienceDeadline("2026-10-05T00:00:00.001Z"), formatExposureDateTime("2026-10-05T00:00:00.001Z"));
  });

  it("vazio ou inválido não vira data", () => {
    for (const value of [null, undefined, "", "sem data"]) assert.equal(formatDomicilioScienceDeadline(value), null);
  });

  it("só o Domicílio usa a data civil; DJEN e DataJud continuam com data e hora de Brasília", () => {
    for (const source of ["DJEN", "DATAJUD", "ESCAVADOR", null]) {
      assert.equal(formatCommunicationScienceDeadline(source, REAL_DEADLINE), formatExposureDateTime(REAL_DEADLINE), String(source));
    }
  });
});

describe("Domicílio — atalho para o portal oficial", () => {
  it("só comunicação pendente convida a dar ciência; as encerradas recebem texto neutro", () => {
    assert.equal(communicationPortalLink({ source: "DOMICILIO", normalizedStatus: "PENDING" }).label, "Abrir portal oficial para dar ciência");
    for (const status of ["ACKNOWLEDGED", "CANCELED", "EXPIRED", "UNKNOWN", null]) {
      assert.equal(communicationPortalLink({ source: "DOMICILIO", normalizedStatus: status }).label, "Consultar no portal oficial", String(status));
      assert.equal(communicationPortalLink({ source: "DJEN", normalizedStatus: status }).label, "Consultar no portal oficial", String(status));
    }
    assert.equal(communicationPortalLink({ source: "DJEN", normalizedStatus: "PENDING" }).label, "Abrir portal oficial para dar ciência");
  });

  it("o destino é sempre a página inicial do portal da fonte, nunca uma comunicação", () => {
    for (const status of ["PENDING", "ACKNOWLEDGED", "CANCELED"]) {
      assert.equal(communicationPortalLink({ source: "DOMICILIO", normalizedStatus: status }).href, DOMICILIO_PORTAL_URL);
      assert.equal(communicationPortalLink({ source: "DJEN", normalizedStatus: status }).href, OFFICIAL_COMMUNICATIONS_PORTAL_URL);
    }
    for (const url of [DOMICILIO_PORTAL_URL, OFFICIAL_COMMUNICATIONS_PORTAL_URL]) {
      const parsed = new URL(url);
      assert.equal(parsed.protocol, "https:");
      assert.equal(parsed.pathname, "/");
      assert.equal(parsed.search, "");
    }
  });
});

describe("Domicílio — caso real nas duas telas", () => {
  const feedItem = (patch: Partial<ExposureCommunicationItem> = {}): ExposureCommunicationItem => ({
    id: "com-real",
    caseId: "case-1",
    source: "DOMICILIO",
    processNumber: "0001384-86.2026.5.09.0009",
    communicationType: "INTIMACAO",
    subject: "Intimação",
    sourceStatus: "CIENCIA_AUTOMATICA",
    normalizedStatus: "ACKNOWLEDGED",
    availableAt: "2026-09-25T13:00:00.000Z",
    detectedAt: "2026-10-13T15:00:00.000Z",
    tribunal: "TRT9",
    courtUnit: "09ª Vara do Trabalho",
    scienceDeadlineAt: REAL_DEADLINE,
    reference: {
      caseId: "case-1",
      processNumber: "0001384-86.2026.5.09.0009",
      tribunal: "TRT9",
      courtUnit: "09ª Vara do Trabalho",
      entity: { id: "entity-1", legalName: COMPANY.name, displayCnpj: formatCnpj(CNPJ) },
    },
    ...patch,
  });
  const feed = (items: ExposureCommunicationItem[]) =>
    renderToStaticMarkup(
      <ExposureCommunicationsTab
        communications={items}
        entities={[{ id: "entity-1", legalName: COMPANY.name }]}
        filters={EMPTY_COMMUNICATION_FILTERS}
        onFilterChange={() => {}}
        onOpenCase={() => {}}
      />
    );

  it("central de comunicações: prazo 05/10/2026, horário efetivo em Brasília e atalho neutro", () => {
    const html = feed([feedItem()]);
    assert.ok(html.includes("05/10/2026"), "prazo como data civil");
    assert.equal(html.includes("04/10/2026"), false, "nunca a véspera");
    assert.equal(html.includes("21:00"), false);
    // Disponibilização é horário efetivo: 13:00 UTC = 10:00 em Brasília.
    assert.ok(html.includes("25/09/2026, 10:00"));
    assert.equal(html.includes("para dar ciência"), false);
    assert.ok(html.includes("Consultar no portal oficial"));
    assert.ok(html.includes(`href="${DOMICILIO_PORTAL_URL}"`));
    assert.equal(html.includes(OFFICIAL_COMMUNICATIONS_PORTAL_URL), false);
    // Aviso de segurança jurídica da central permanece.
    assert.ok(html.includes("A ciência válida é a registrada no portal oficial."));
  });

  it("central de comunicações: pendente mantém o convite; DJEN não muda de formato nem de portal", () => {
    const pending = feed([feedItem({ normalizedStatus: "PENDING", sourceStatus: "EM_CURSO" })]);
    assert.ok(pending.includes("Abrir portal oficial para dar ciência"));
    assert.ok(pending.includes("05/10/2026"));
    assert.ok(pending.includes(`href="${DOMICILIO_PORTAL_URL}"`));

    const djen = feed([feedItem({ source: "DJEN", normalizedStatus: "PENDING", sourceStatus: "N" })]);
    assert.ok(djen.includes("04/10/2026, 21:00"), "DJEN segue como data e hora em Brasília");
    assert.ok(djen.includes(`href="${OFFICIAL_COMMUNICATIONS_PORTAL_URL}"`));
    assert.ok(djen.includes("Abrir portal oficial para dar ciência"));
  });

  it("ficha do processo: prazo 05/10/2026, ciência em Brasília, atalho neutro e aviso preservado", () => {
    const dossier = dossierWith([
      {
        sourceCommunicationId: "com-real",
        tenantId: "tenant-1",
        processNumber: PROCESS,
        communicationType: "INTIMACAO",
        subject: "Intimação",
        sourceStatus: "CIENCIA_AUTOMATICA",
        availableAt: "2026-09-25T13:00:00.000Z",
        scienceDeadlineAt: REAL_DEADLINE,
        sourceScienceAt: REAL_SCIENCE_AT,
        tribunal: "TRT9",
        courtUnit: "09ª Vara do Trabalho",
        rawMetadata: {},
      },
    ]);
    const html = renderToStaticMarkup(
      <ExposureCaseDossier dossier={dossier as never} initialTab="comunicacoes" {...HANDLERS} />
    );
    assert.match(html, /Prazo para ciência\s*(<!-- -->)?\s*05\/10\/2026</);
    assert.equal(html.includes("04/10/2026"), false, "nunca a véspera");
    // Ciência registrada é horário efetivo: 23:59:59 UTC = 20:59 em Brasília.
    assert.match(html, /Ciência registrada em\s*(<!-- -->)?\s*05\/10\/2026, 20:59/);
    assert.ok(html.includes("Ciência registrada"));
    assert.equal(html.includes("para dar ciência"), false);
    assert.ok(html.includes("Consultar no portal oficial"));
    assert.ok(html.includes(`href="${DOMICILIO_PORTAL_URL}"`));
    assert.equal(html.includes("Ver comunicação oficial"), false, "sem link direto para a comunicação");
    assert.match(html, /não registra ciência/);
  });
});
