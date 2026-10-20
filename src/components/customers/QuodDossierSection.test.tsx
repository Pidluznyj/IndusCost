import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuodIntelligenceHeader, QuodPaidConsultationDialog } from "./QuodDossierSection.js";

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
  });
});
