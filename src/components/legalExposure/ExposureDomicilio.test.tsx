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
import { ExposureSourcesTab, type ExposureSourceOperationItem } from "./ExposureFeed";

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
