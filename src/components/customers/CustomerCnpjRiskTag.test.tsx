/**
 * Tag de score CNPJ do grid de Clientes — render estático.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerCnpjRiskSummary } from "@/src/lib/customerCnpjRiskSummary";
import { CustomerCnpjRiskTag } from "./CustomerCnpjRiskTag";

const risk: CustomerCnpjRiskSummary = {
  lookupId: "l1",
  score: 83,
  verdict: "VENDA LIBERADA",
  riskLevel: "Baixo",
  saleRecommendation: "Prazos comerciais convencionais.",
  source: "brasilapi+publica.cnpj.ws",
  fetchedAt: "2026-09-07T12:00:00.000Z",
  expiresAt: "2026-09-08T12:00:00.000Z",
  expired: false,
};

describe("CustomerCnpjRiskTag", () => {
  it("mostra o Score de Confiança sem o veredito de venda", () => {
    const html = renderToStaticMarkup(<CustomerCnpjRiskTag risk={risk} />);
    assert.ok(html.includes("66/100 · Regular"));
    assert.equal(html.includes("VENDA LIBERADA"), false);
    assert.match(html, /data-testid="customer-cnpj-risk-tag"/);
    assert.match(html, /data-tone="unknown"/);
    assert.match(html, /whitespace-nowrap/);
    assert.match(html, /title="Score de Confiança 66\/100 · Regular/);
    assert.match(html, /Score cadastral original: 83\/100/);
  });

  it("a faixa muda com o score cadastral; consulta vencida fica atenuada", () => {
    const blocked = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, score: 5, verdict: "VENDA BLOQUEADA" }} />);
    assert.match(blocked, /data-tone="unknown"/);
    assert.ok(blocked.includes("4/100 · Baixo"));
    assert.equal(blocked.includes("VENDA BLOQUEADA"), false);
    const advance = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, score: 40, verdict: "APENAS PAGAMENTO ANTECIPADO" }} />);
    assert.ok(advance.includes("32/100 · Baixo"));
    const conditional = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, score: 70, verdict: "VENDA CONDICIONADA" }} />);
    assert.ok(conditional.includes("56/100 · Regular"));
    const stale = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, expired: true }} />);
    assert.match(stale, /data-expired="true"/);
    assert.match(stale, /opacity-70/);
  });

  it("sem consulta: chip neutro 'Sem consulta' — nunca um score; vira botão quando há ação", () => {
    const plain = renderToStaticMarkup(<CustomerCnpjRiskTag risk={null} />);
    assert.ok(plain.includes("Sem consulta"));
    assert.match(plain, /data-testid="customer-cnpj-risk-none"/);
    assert.doesNotMatch(plain, /<button/);
    assert.doesNotMatch(plain, /\d+ · /);
    const clickable = renderToStaticMarkup(<CustomerCnpjRiskTag risk={undefined} onConsult={() => undefined} />);
    assert.match(clickable, /<button[^>]*data-testid="customer-cnpj-risk-none"/);
  });
});
