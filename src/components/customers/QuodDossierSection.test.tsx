import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QuodIntelligenceHeader,
  QuodPaidConsultationDialog,
  QuodSuperAdminPanel,
} from "./QuodDossierSection.js";

describe("confirmação do dossiê QUOD", () => {
  it("deixa confirmar desabilitado até o checkbox e não dispara consulta ao abrir", () => {
    const html = renderToStaticMarkup(
      <QuodPaidConsultationDialog
        companyName="Empresa Teste"
        cnpj="11.444.777/0001-61"
        priceLabel="R$ 6,99"
        requestedBy="Super Admin"
        requestedAt="20/10/2026 09:00"
        previousLabel="Consulta anterior válida até amanhã. Atualizar gera nova consulta paga."
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    assert.match(html, /Confirmar consulta paga — Dossiê QUOD Completo/);
    assert.match(html, /Estou ciente do custo informado/);
    assert.match(html, /disabled=""/);
    assert.match(html, /quod-paid-consent/);
    assert.match(html, /R\$ 6,99/);
    assert.doesNotMatch(html, /api\/DossieCreditoCompleto/);
  });

  it("separa score cadastral, score externo e situação de crédito", () => {
    const html = renderToStaticMarkup(
      <QuodIntelligenceHeader
        cadastralScore="91/100"
        cadastralVerdict="VENDA LIBERADA"
        externalScore={null}
        externalState="NOT_CONSULTED"
        creditLabel="Bloqueado"
      />
    );
    assert.match(html, /91\/100/);
    assert.match(html, /Não consultado/);
    assert.match(html, /Bloqueado/);
    assert.match(html, /não remove bloqueio/);
    // Nomenclatura: o veredito cadastral "VENDA LIBERADA" não é exibido como autorização.
    assert.equal(html.includes("VENDA LIBERADA"), false);
    assert.match(html, /Qualidade cadastral/);
    assert.match(html, /Análise externa — QUOD/);
  });

  it("formata datas em pt-BR e destaca alertas do QUOD sem inferir negativação", () => {
    const html = renderToStaticMarkup(
      <QuodSuperAdminPanel
        state="VALID"
        consultedAt="2026-10-20T15:03:00.000Z"
        validUntil="2026-10-27T15:03:00.000Z"
        score={376}
        restrictionCount={0}
        priceLabel="R$ 6,99"
        canQuery={false}
        alerts={["Atrasos vigentes em contratos recentes", "Média elevada de dias em atraso"]}
        onView={() => undefined}
        onRequestPaid={() => undefined}
        report={null}
      />
    );
    assert.match(html, / às \d{2}:\d{2}/);
    assert.doesNotMatch(html, /2026-10-20T15:03/);
    assert.match(html, /QUOD identificou sinais de atraso/);
    assert.match(html, /Atrasos vigentes em contratos recentes/);
    assert.match(html, /Não equivalem a negativação confirmada/);
  });

  it("desabilita confirmar durante o envio e não usa crypto.randomUUID direto", () => {
    const html = renderToStaticMarkup(
      <QuodPaidConsultationDialog
        companyName="Empresa Teste"
        cnpj="11.444.777/0001-61"
        priceLabel="R$ 6,99"
        requestedBy="Super Admin"
        requestedAt="20/10/2026 09:00"
        previousLabel={null}
        submitting
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    assert.match(html, /Consultando…/);
    const matches = html.match(/disabled=""/g) ?? [];
    assert.ok(matches.length >= 2, "cancelar e confirmar ficam desabilitados no envio");

    const panel = readFileSync(join(process.cwd(), "src/components/customers/CustomerQuodDossierPanel.tsx"), "utf8");
    assert.equal(panel.includes("crypto.randomUUID()"), false);
    assert.match(panel, /generateIdempotencyKey\(\)/);
    assert.match(panel, /submitting/);
    assert.equal(panel.includes("if (!isSuperAdmin || !customerId)"), false);
    assert.match(panel, /canConsult=\{isSuperAdmin\}/);
    assert.match(panel, /paidConsultationMessage/);
    assert.doesNotMatch(panel, /Erro HTTP 409/);
  });
});
