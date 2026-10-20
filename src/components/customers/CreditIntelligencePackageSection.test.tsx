import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditExternalDimensions, PackagePaidConsultationDialog } from "./CreditIntelligencePackageSection.js";

describe("pacote visual QUOD + IEPTB", () => {
  it("popup detalha 6,99 + 3,50 = 10,49 e exige checkbox", () => {
    const html = renderToStaticMarkup(
      <PackagePaidConsultationDialog
        companyName="Duarte"
        cnpj="28.199.918/0001-20"
        requestedBy="Super Admin"
        requestedAt="20/10/2026 às 12:00"
        quodLine={{ product: "Dossiê QUOD Completo", action: "QUERY", billedCents: 699, note: "Nova consulta prevista: R$ 6,99." }}
        ieptbLine={{ product: "Protestos Nacional — IEPTB Online", action: "QUERY", billedCents: 350, note: "Nova consulta prevista: R$ 3,50." }}
        totalLabel="R$ 10,49"
        forceRefresh={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    assert.match(html, /Confirmar análise completa de risco e crédito/);
    assert.match(html, /TOTAL PREVISTO: R\$ 10,49/);
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /api\/ProtestosOnline/);
  });

  it("quatro dimensões: Nomus, QUOD, IEPTB e qualidade cadastral, sem VENDA LIBERADA", () => {
    const html = renderToStaticMarkup(
      <CreditExternalDimensions
        creditLabel="Bloqueado"
        cadastralScore="91/100"
        quodScore="376"
        quodState="VALID"
        ieptbLabel="Não consultado"
        ieptbState="NOT_CONSULTED"
      />
    );
    assert.match(html, /Histórico financeiro — Nomus/);
    assert.match(html, /Risco externo — QUOD/);
    assert.match(html, /Protestos nacionais — IEPTB/);
    assert.match(html, /Qualidade cadastral/);
    assert.match(html, /91\/100/);
    assert.equal(html.includes("VENDA LIBERADA"), false);
  });
});
