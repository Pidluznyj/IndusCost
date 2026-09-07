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
  it("mostra score e veredito como tag com a cor do veredito e tooltip completo", () => {
    const html = renderToStaticMarkup(<CustomerCnpjRiskTag risk={risk} />);
    assert.ok(html.includes("83 · VENDA LIBERADA"));
    assert.match(html, /data-testid="customer-cnpj-risk-tag"/);
    assert.match(html, /data-tone="released"/);
    assert.match(html, /bg-emerald-100/);
    assert.match(html, /whitespace-nowrap/);
    assert.match(html, /title="Score 83\/100 · VENDA LIBERADA/);
    assert.match(html, /Risco: Baixo — Prazos comerciais convencionais\./);
  });

  it("cada veredito tem a sua cor; consulta vencida fica atenuada", () => {
    const blocked = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, score: 5, verdict: "VENDA BLOQUEADA" }} />);
    assert.match(blocked, /data-tone="blocked"/);
    assert.match(blocked, /bg-red-100/);
    const advance = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, score: 40, verdict: "APENAS PAGAMENTO ANTECIPADO" }} />);
    assert.match(advance, /data-tone="advance"/);
    assert.ok(advance.includes("40 · APENAS PAGAMENTO ANTECIPADO"));
    const conditional = renderToStaticMarkup(<CustomerCnpjRiskTag risk={{ ...risk, score: 70, verdict: "VENDA CONDICIONADA" }} />);
    assert.match(conditional, /data-tone="conditional"/);
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
