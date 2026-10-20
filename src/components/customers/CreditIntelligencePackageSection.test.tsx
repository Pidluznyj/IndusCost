import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreditExternalDimensions,
  IeptbOnlineReport,
  PackagePaidConsultationDialog,
} from "./CreditIntelligencePackageSection.js";

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

  it("IEPTB lista um título por linha, sem despejar valores em um único parágrafo", () => {
    const html = renderToStaticMarkup(
      <IeptbOnlineReport
        sections={{
          coverageNote: "Cobertura nacional.",
          document: "28199918000120",
          hasProtests: true,
          protestCount: 2,
          totalAmountLabel: "R$ 25.000,00",
          totalAmount: 25000,
          notes: null,
          async: false,
          consultedAtLabel: null,
          providerQueryId: null,
          providerMessage: null,
          states: [
            {
              state: "PB",
              protestCount: 2,
              totalAmountLabel: "R$ 25.000,00",
              totalAmount: 25000,
              offices: [
                {
                  cityCode: "1",
                  city: "ESPERANÇA",
                  protestCount: 2,
                  totalAmountLabel: "R$ 25.000,00",
                  totalAmount: 25000,
                  titles: [
                    { protestedAt: "03/09/2026", amountLabel: "R$ 20.000,00", amount: 20000, document: "NF-1" },
                    { protestedAt: "09/10/2026", amountLabel: "R$ 5.000,00", amount: 5000, document: "NF-2" },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );
    assert.match(html, />UF</);
    assert.match(html, />Cidade</);
    assert.match(html, />Data</);
    assert.match(html, /ESPERANÇA/);
    assert.match(html, /03\/09\/2026/);
    assert.match(html, /09\/10\/2026/);
    assert.doesNotMatch(html, /03\/09\/2026 · R\$ 20\.000,00<\/p>/);
  });
});
