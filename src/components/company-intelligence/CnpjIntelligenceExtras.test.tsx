import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CnpjSourceConflictsPanel,
  CnpjSourcesStatusPanel,
  EconomicContextPanel,
} from "./CnpjIntelligenceExtras";

describe("CnpjIntelligenceExtras — UI de fontes", () => {
  it("mostra Fontes consultadas com status por provider", () => {
    const html = renderToStaticMarkup(
      <CnpjSourcesStatusPanel
        sources={[
          {
            source: "publica.cnpj.ws",
            displayName: "publica.cnpj.ws",
            role: "primary",
            status: "SUCCESS",
            fetchedAt: "2026-09-04T12:00:00.000Z",
            fromCache: false,
            latencyMs: 120,
            message: null,
          },
          {
            source: "brasilapi.com.br",
            displayName: "BrasilAPI",
            role: "secondary",
            status: "TIMEOUT",
            fetchedAt: "2026-09-04T12:00:00.000Z",
            fromCache: false,
            latencyMs: 8000,
            message: "Tempo esgotado na BrasilAPI.",
          },
          {
            source: "bcb.gov.br",
            displayName: "Banco Central do Brasil",
            role: "economic",
            status: "UNAVAILABLE",
            fetchedAt: "2026-09-04T12:00:00.000Z",
            fromCache: false,
            latencyMs: null,
            message: "Contexto econômico temporariamente indisponível",
          },
        ]}
      />
    );
    assert.ok(html.includes("Fontes consultadas"));
    assert.ok(html.includes("publica.cnpj.ws"));
    assert.ok(html.includes("BrasilAPI"));
    assert.ok(html.includes("Banco Central do Brasil"));
    assert.ok(html.includes("OK"));
    assert.ok(html.includes("Tempo esgotado"));
    assert.ok(html.includes("Indisponível"));
    assert.equal(html.includes("Authorization"), false);
    assert.equal(html.includes("api key"), false);
  });

  it("mostra divergências sem aplicar automaticamente", () => {
    const html = renderToStaticMarkup(
      <CnpjSourceConflictsPanel
        conflicts={[
          {
            field: "companyName",
            label: "Razão social",
            chosenValue: "EMPRESA TESTE LTDA",
            chosenSource: "publica.cnpj.ws",
            values: [
              { source: "publica.cnpj.ws", value: "EMPRESA TESTE LTDA" },
              { source: "brasilapi.com.br", value: "OUTRA RAZAO" },
            ],
            status: "DIFFERENT",
          },
        ]}
      />
    );
    assert.ok(html.includes("Divergências cadastrais entre fontes"));
    assert.ok(html.includes("EMPRESA TESTE LTDA"));
    assert.ok(html.includes("Não é aplicado ao cadastro automaticamente") || html.includes("Nada é aplicado"));
  });

  it("contexto econômico declara que não é score da empresa", () => {
    const html = renderToStaticMarkup(
      <EconomicContextPanel
        economicContext={{
          status: "ok",
          fetchedAt: "2026-09-04T12:00:00.000Z",
          fromCache: false,
          sourceLabel: "Banco Central do Brasil",
          disclaimer:
            "Contexto macroeconômico brasileiro (Banco Central). Não é score, rating, risco de crédito nem capacidade de pagamento desta empresa.",
          indicators: [
            {
              code: "SELIC_TARGET",
              name: "Meta Selic definida pelo Copom",
              value: 15,
              unit: "% a.a.",
              referenceDate: "2026-09-04",
              displayValue: "15,00% a.a.",
              status: "ok",
              source: "BCB SGS 432",
            },
          ],
        }}
      />
    );
    assert.ok(html.includes("Contexto econômico — Brasil"));
    assert.ok(html.includes("Não é score"));
  });
});
