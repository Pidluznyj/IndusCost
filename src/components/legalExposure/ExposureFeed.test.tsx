import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  NO_ACTION_REQUIRED_COPY,
  NO_CERTIFICATES_COPY,
  NO_COMMUNICATIONS_FILTER_COPY,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  EMPTY_COMMUNICATION_FILTERS,
  ExposureAlertsTab,
  ExposureCertificatesTab,
  ExposureCommunicationsTab,
  ExposureSourcesTab,
} from "./ExposureFeed";

describe("ExposureAlertsTab", () => {
  it("mostra severidade, empresa, CNJ, tipo, motivo, data, fonte e ações", () => {
    const html = renderToStaticMarkup(
      <ExposureAlertsTab
        alerts={[
          {
            id: "alert-1",
            severity: "HIGH",
            status: "OPEN",
            requiresAction: true,
            title: "Citação recebida",
            summary: "Prazo de ciência em aberto",
            createdAt: "2026-09-30T12:00:00.000Z",
            eventType: "NEW_CITATION",
            source: "DJEN",
            detail: "Citação",
            reference: {
              caseId: "case-1",
              processNumber: "0001234-56.2024.5.09.0001",
              tribunal: "TRT9",
              courtUnit: "09ª VARA",
              entity: { id: "ent-a", legalName: "Industria Exemplo LTDA", displayCnpj: "11.222.333/0001-81" },
            },
          },
        ]}
        canManage
        busy={false}
        onOpenCase={() => {}}
        onAcknowledge={() => {}}
        onResolve={() => {}}
      />
    );
    assert.ok(html.includes("Alto"));
    assert.ok(html.includes("Industria Exemplo LTDA"));
    assert.ok(html.includes("0001234-56.2024.5.09.0001"));
    assert.ok(html.includes("Revisar nova citação"));
    assert.ok(html.includes("DJEN") || html.includes("Djen") || html.includes("fonte"));
    assert.ok(html.includes("Reconhecer"));
    assert.ok(html.includes("Resolver"));
    assert.ok(html.includes("Ver processo"));
    assert.ok(html.includes("Ação jurídica"));
    assert.ok(html.includes('data-alert-channel="LEGAL"'));
  });

  it("separa alerta jurídico de falha técnica", () => {
    const html = renderToStaticMarkup(
      <ExposureAlertsTab
        alerts={[
          {
            id: "alert-legal",
            severity: "HIGH",
            status: "OPEN",
            requiresAction: true,
            title: "Citação recebida",
            summary: "Nova citação identificada no DJEN.",
            createdAt: "2026-09-30T12:00:00.000Z",
            eventType: "NEW_CITATION",
            source: "DJEN",
            detail: "Citação",
            reference: {
              caseId: "case-1",
              processNumber: "0001234-56.2024.5.09.0001",
              tribunal: "TRT9",
              courtUnit: "09ª VARA",
              entity: { id: "ent-a", legalName: "Industria Exemplo LTDA", displayCnpj: "11.222.333/0001-81" },
            },
          },
          {
            id: "alert-tech",
            severity: "MEDIUM",
            status: "OPEN",
            requiresAction: true,
            title: "Falha DataJud",
            summary: "A consulta DataJud falhou.",
            createdAt: "2026-09-30T12:05:00.000Z",
            eventType: "SOURCE_FAILED",
            source: "DATAJUD",
            detail: "Falha",
            reference: {
              caseId: null,
              processNumber: null,
              tribunal: null,
              courtUnit: null,
              entity: { id: "ent-a", legalName: "Industria Exemplo LTDA", displayCnpj: "11.222.333/0001-81" },
            },
          },
        ]}
        canManage
        busy={false}
        onOpenCase={() => {}}
        onAcknowledge={() => {}}
        onResolve={() => {}}
      />
    );
    assert.ok(html.includes("Revisar nova citação"));
    assert.ok(html.includes("Verificar falha da fonte"));
    assert.ok(html.includes("Ação jurídica"));
    assert.ok(html.includes("Integração / fonte"));
    assert.ok(html.includes('data-alert-channel="LEGAL"'));
    assert.ok(html.includes('data-alert-channel="TECHNICAL"'));
    assert.ok(html.includes("Jurídicas"));
    assert.ok(html.includes("Integração/fontes"));
  });

  it("vazio de ação requerida não usa copy de processo", () => {
    const html = renderToStaticMarkup(
      <ExposureAlertsTab alerts={[]} canManage busy={false} onOpenCase={() => {}} onAcknowledge={() => {}} onResolve={() => {}} />
    );
    assert.ok(html.includes(NO_ACTION_REQUIRED_COPY));
    assert.equal(html.includes("Nenhum processo identificado"), false);
  });
});

describe("ExposureCommunicationsTab", () => {
  it("mostra filtros e dados da comunicação", () => {
    const html = renderToStaticMarkup(
      <ExposureCommunicationsTab
        communications={[
          {
            id: "com-1",
            caseId: "case-1",
            source: "DJEN",
            processNumber: "0001234-56.2024.5.09.0001",
            communicationType: "Intimação",
            subject: "Intimação para audiência",
            sourceStatus: "N",
            normalizedStatus: "PENDING",
            availableAt: "2026-09-30T12:00:00.000Z",
            detectedAt: "2026-09-30T13:00:00.000Z",
            tribunal: "TRT9",
            courtUnit: "09ª VARA",
            scienceDeadlineAt: null,
            reference: {
              caseId: "case-1",
              processNumber: "0001234-56.2024.5.09.0001",
              tribunal: "TRT9",
              courtUnit: "09ª VARA",
              entity: { id: "ent-a", legalName: "Industria Exemplo LTDA", displayCnpj: "11.222.333/0001-81" },
            },
          },
        ]}
        entities={[{ id: "ent-a", legalName: "Industria Exemplo LTDA" }]}
        filters={EMPTY_COMMUNICATION_FILTERS}
        onFilterChange={() => {}}
        onOpenCase={() => {}}
      />
    );
    assert.ok(html.includes("Empresa"));
    assert.ok(html.includes("CNJ"));
    assert.ok(html.includes("Tipo"));
    assert.ok(html.includes("Status"));
    assert.ok(html.includes("Tribunal"));
    assert.ok(html.includes("Fonte"));
    assert.ok(html.includes("Intimação para audiência"));
    assert.ok(html.includes("Industria Exemplo LTDA"));
  });

  it("vazio respeita o recado dos filtros", () => {
    const html = renderToStaticMarkup(
      <ExposureCommunicationsTab
        communications={[]}
        entities={[]}
        filters={EMPTY_COMMUNICATION_FILTERS}
        onFilterChange={() => {}}
        onOpenCase={() => {}}
      />
    );
    assert.ok(html.includes(NO_COMMUNICATIONS_FILTER_COPY));
  });
});

describe("ExposureCertificatesTab", () => {
  it("lista histórico, validade, arquivo, registrado por e aviso CNDT", () => {
    const html = renderToStaticMarkup(
      <ExposureCertificatesTab
        certificates={[
          {
            id: "cert-1",
            entityId: "ent-a",
            type: "CNDT",
            tribunal: "TST",
            issuedAt: "2026-09-01T00:00:00.000Z",
            validUntil: "2027-03-01T00:00:00.000Z",
            result: "NEGATIVE",
            verificationCode: "ABC",
            originalFileName: "cndt.pdf",
            notes: null,
            registeredByUserId: "user-1",
            createdAt: "2026-09-02T00:00:00.000Z",
          },
        ]}
        entities={[{ id: "ent-a", legalName: "Industria Exemplo LTDA", cnpj: "11222333000181" }]}
        note={CNDT_DOES_NOT_MEAN_NO_CASES_COPY}
        canManage
        onRegister={async () => {}}
      />
    );
    assert.ok(html.includes("CNDT"));
    assert.ok(html.includes("cndt.pdf"));
    assert.ok(html.includes("user-1"));
    assert.ok(html.includes(CNDT_DOES_NOT_MEAN_NO_CASES_COPY));
    assert.ok(html.includes("Registrar certidão"));
  });

  it("vazio de certidão não fala de processo", () => {
    const html = renderToStaticMarkup(
      <ExposureCertificatesTab certificates={[]} entities={[]} note={CNDT_DOES_NOT_MEAN_NO_CASES_COPY} canManage={false} onRegister={async () => {}} />
    );
    assert.ok(html.includes(NO_CERTIFICATES_COPY));
    assert.equal(html.includes("Nenhum processo identificado"), false);
  });
});

describe("ExposureSourcesTab", () => {
  it("Escavador e Domicílio desligados não usam vermelho", () => {
    const html = renderToStaticMarkup(
      <ExposureSourcesTab
        sources={[
          {
            source: "ESCAVADOR",
            label: "Escavador",
            status: "DISABLED",
            statusLabel: "Desligado",
            lastSuccessfulAt: null,
            lastAttemptAt: null,
            lastErrorCode: null,
            enabled: false,
            healthy: false,
          },
          {
            source: "DOMICILIO",
            label: "Domicílio",
            status: "DISABLED",
            statusLabel: "Desligado",
            lastSuccessfulAt: null,
            lastAttemptAt: null,
            lastErrorCode: null,
            enabled: false,
            healthy: false,
          },
        ]}
        onRun={() => {}}
      />
    );
    assert.equal((html.match(/Desligad/g) ?? []).length >= 2, true);
    assert.equal(html.includes("bg-red-"), false);
    assert.ok(html.includes("Executar agora") || html.includes("política"));
  });
});
