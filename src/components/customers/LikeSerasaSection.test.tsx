import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBoaVistaDemoResponse } from "@/src/lib/boaVistaDefineLimite/fixtures.js";
import { parseBoaVistaDefineLimite } from "@/src/lib/boaVistaDefineLimite/parse.js";
import type { LikeSerasaReportView, LikeSerasaStatusPayload } from "@/src/lib/boaVistaDefineLimite/view.js";
import { CreditIntelligenceSourceCards } from "./CreditIntelligencePackageSection.js";
import { LikeSerasaActionButton, LikeSerasaHistory, LikeSerasaPaidConsultationDialog, LikeSerasaReport, LikeSerasaSourceCard } from "./LikeSerasaSection.js";

const CNPJ = "11444777000161";

function report(overrides: Partial<LikeSerasaReportView> = {}): LikeSerasaReportView {
  const parsed = parseBoaVistaDefineLimite(buildBoaVistaDemoResponse({ cnpj: CNPJ, now: new Date("2026-10-28T12:00:00Z") }));
  return {
    id: "c1",
    mode: "LIVE",
    displayName: "LIKE SERASA",
    product: "Boa Vista — Define Limite Positivo Pessoa Jurídica",
    provider: "Direct Data",
    source: "Boa Vista",
    attribution: "Boa Vista — consulta disponibilizada pela Direct Data.",
    companyName: "Empresa Teste",
    cnpj: CNPJ,
    cnpjFormatted: "11.444.777/0001-61",
    status: "SUCCEEDED",
    billingStatus: "ESTIMATED",
    billingLabel: "Estimada pelo valor autorizado",
    authorizedCostCents: 2150,
    chargedCostCents: 2150,
    providerQueryId: "direct-abc",
    providerResult: "Sucesso",
    failureCode: null,
    consultedAt: "2026-10-28T12:00:00.000Z",
    validUntil: "2026-11-04T12:00:00.000Z",
    requestedByUserId: "admin",
    score: parsed.score,
    scoreRaw: parsed.scoreRaw,
    scoreClass: parsed.scoreClass,
    riskText: parsed.riskText,
    defaultProbability: parsed.defaultProbability,
    suggestedLimitCents: parsed.suggestedLimitCents,
    suggestedLimitLabel: parsed.suggestedLimitLabel,
    restrictionCount: parsed.restrictionCount,
    confirmedRestriction: parsed.confirmedRestriction,
    insufficient: false,
    parserVersion: "bvdl-pj-1",
    hasReceipt: false,
    sections: parsed.sections,
    ...overrides,
  };
}

function status(overrides: Partial<LikeSerasaStatusPayload> = {}): LikeSerasaStatusPayload {
  return {
    displayName: "LIKE SERASA",
    product: "Boa Vista — Define Limite Positivo Pessoa Jurídica",
    provider: "Direct Data",
    source: "Boa Vista",
    attribution: "Boa Vista — consulta disponibilizada pela Direct Data.",
    unitPriceCents: 2150,
    priceLabel: "R$ 21,50",
    cacheTtlMs: 604800000,
    document: { kind: "CNPJ", valid: true, formatted: "11.444.777/0001-61" },
    live: { allowed: true, reason: "OK", message: "Consulta real habilitada neste servidor." },
    demo: { allowed: false, reason: "DEMO_DISABLED" },
    canRequest: true,
    state: "NOT_CONSULTED",
    stateLabel: "Nunca consultado",
    consultation: null,
    history: [],
    ...overrides,
  };
}

const cardsProps = {
  quodState: "NOT_CONSULTED",
  quodScore: null,
  quodAlerts: [],
  quodConsultedAt: null,
  quodValidUntil: null,
  ieptbState: "NOT_CONSULTED",
  ieptbConfirmed: false,
  ieptbClear: false,
  ieptbCount: null,
  ieptbTotal: null,
  ieptbStates: [],
  ieptbConsultedAt: null,
  ieptbValidUntil: null,
  complete: false,
  ieptbEnabled: true,
  canQuery: true,
  onViewQuod: () => undefined,
  onViewIeptb: () => undefined,
  onRequestPackage: () => undefined,
  onForceRefresh: () => undefined,
};

describe("LIKE SERASA — interface no cadastro de clientes", () => {
  it("o botão LIKE SERASA fica na mesma linha de ações do botão QUOD + Protestos, com o valor de R$ 21,50", () => {
    const html = renderToStaticMarkup(
      <CreditIntelligenceSourceCards {...cardsProps} canConsult extraActions={<LikeSerasaActionButton status={status()} canConsult onRequest={() => undefined} />} />
    );
    const quod = html.indexOf('data-testid="package-request-paid"');
    const serasa = html.indexOf('data-testid="like-serasa-request-paid"');
    assert.ok(quod > 0 && serasa > quod, "botão LIKE SERASA depois do botão do pacote, no mesmo bloco");
    assert.match(html.slice(quod, serasa + 400), /LIKE SERASA — R\$ 21,50/);
    assert.doesNotMatch(html, /disabled=""[^>]*data-testid="like-serasa-request-paid"/);
    assert.doesNotMatch(html, /serasa\.com|<img|logotipo/i, "sem logotipo nem referência ao site da Serasa");
  });

  it("sem permissão (não Super Admin) o botão não existe; o pacote QUOD continua idêntico", () => {
    const html = renderToStaticMarkup(<CreditIntelligenceSourceCards {...cardsProps} canConsult={false} extraActions={<LikeSerasaActionButton status={status()} canConsult={false} onRequest={() => undefined} />} />);
    assert.doesNotMatch(html, /like-serasa-request-paid/);
    assert.doesNotMatch(html, /package-request-paid/);
  });

  it("pessoa física: botão desabilitado com a explicação; CNPJ inválido: idem; ambiente sem consulta real: aviso 'somente em produção'", () => {
    const pf = renderToStaticMarkup(<LikeSerasaActionButton status={status({ document: { kind: "CPF", valid: false, formatted: "123.456.789-09" } })} canConsult onRequest={() => undefined} />);
    assert.match(pf, /disabled=""/);
    assert.match(pf, /exclusivamente para pessoa jurídica/);
    const invalid = renderToStaticMarkup(<LikeSerasaActionButton status={status({ document: { kind: "INVALID", valid: false, formatted: "—" } })} canConsult onRequest={() => undefined} />);
    assert.match(invalid, /CNPJ ausente ou inválido/);
    const homolog = renderToStaticMarkup(
      <LikeSerasaActionButton status={status({ live: { allowed: false, reason: "ROLE_NOT_PRODUCTION", message: "A consulta real LIKE SERASA está disponível somente em produção." } })} canConsult onRequest={() => undefined} />
    );
    assert.match(homolog, /disabled=""/);
    assert.match(homolog, /somente em produção/);
    const demo = renderToStaticMarkup(
      <LikeSerasaActionButton status={status({ live: { allowed: false, reason: "ROLE_NOT_PRODUCTION", message: "x" }, demo: { allowed: true, reason: "OK" } })} canConsult onRequest={() => undefined} />
    );
    assert.doesNotMatch(demo, /disabled=""/);
    assert.match(demo, /LIKE SERASA — simulação/);
    assert.match(demo, /SIMULADO, sem cobrança/);
  });

  it("modal de confirmação: fonte, cliente, CNPJ, R$ 21,50, aviso de cobrança, confirmar desabilitado até o consentimento, sem chamada ao abrir", () => {
    const html = renderToStaticMarkup(
      <LikeSerasaPaidConsultationDialog companyName="Empresa Teste" cnpj="11.444.777/0001-61" requestedBy="Super Admin" requestedAt="28/10/2026 às 12:00" priceLabel="R$ 21,50" forceRefresh={false} demo={false} onCancel={() => undefined} onConfirm={() => undefined} />
    );
    assert.match(html, /Consulta LIKE SERASA/);
    assert.match(html, /Boa Vista via Direct Data/);
    assert.match(html, /Empresa Teste/);
    assert.match(html, /11\.444\.777\/0001-61/);
    assert.match(html, /data-testid="like-serasa-paid-price">R\$ 21,50/);
    assert.match(html, /poderá gerar cobrança pelo fornecedor/);
    assert.match(html, /Confirmar consulta de R\$ 21,50/);
    assert.match(html, /disabled=""[^>]*data-testid="like-serasa-paid-confirm"/);
    assert.match(html, /Abrir esta janela não consulta o provedor/);
    assert.doesNotMatch(html, /BoaVistaDefineLimitePositivoPJ|directd\.com\.br/);
    const demo = renderToStaticMarkup(
      <LikeSerasaPaidConsultationDialog companyName="E" cnpj="C" requestedBy="U" requestedAt="D" priceLabel="R$ 21,50" forceRefresh={false} demo onCancel={() => undefined} onConfirm={() => undefined} />
    );
    assert.match(demo, /simulação/);
    assert.match(demo, /R\$ 0,00 \(simulação, sem cobrança\)/);
  });

  it("relatório: seções A–F, limite sugerido separado do limite interno, score sem conversão, restrições por categoria, sócios mascarados, evidências", () => {
    const html = renderToStaticMarkup(<LikeSerasaReport report={report()} internalCreditLabel="VENDA EM ANÁLISE" customerId="cust-1" />);
    for (const section of ["limit", "score", "behavior", "restrictions", "company", "evidence"]) assert.match(html, new RegExp(`like-serasa-section-${section}`));
    assert.match(html, /LIMITE DE CRÉDITO SUGERIDO PELA BOA VISTA/i);
    assert.match(html, /R\$(\s|&nbsp;|&#xa0;| )316\.700,00/);
    assert.match(html, /Limite aprovado internamente/);
    assert.match(html, /Não cadastrado/);
    assert.match(html, /VENDA EM ANÁLISE/);
    assert.match(html, /data-testid="like-serasa-score">[\s\S]*?leading-tight">593</);
    assert.match(html, /não é convertido para o Score de Confiança V1/);
    assert.match(html, /Pendências financeiras/);
    assert.match(html, /Protestos/);
    assert.match(html, /Ações cíveis/);
    assert.match(html, /Falência e recuperação judicial/);
    assert.match(html, /não são somados como dívida líquida/);
    assert.match(html, /•••91/);
    assert.doesNotMatch(html, /00000000191/);
    assert.match(html, /Estimada pelo valor autorizado/);
    assert.match(html, /direct-abc/);
    assert.match(html, /Boa Vista — consulta disponibilizada pela Direct Data/);
    assert.doesNotMatch(html, /like-serasa-demo-badge/);
  });

  it("limite ausente e score ausente aparecem como informação indisponível, nunca como zero; retorno parcial avisa", () => {
    const parsed = parseBoaVistaDefineLimite({ metaDados: { consultaUid: "u" }, retorno: { razaoSocial: "X", restricoes: { protestos: { quantidade: "0" } } } });
    const html = renderToStaticMarkup(
      <LikeSerasaReport report={report({ status: "PARTIAL", score: null, scoreRaw: null, suggestedLimitCents: null, suggestedLimitLabel: null, sections: parsed.sections, restrictionCount: parsed.restrictionCount })} />
    );
    assert.match(html, /data-testid="like-serasa-limit">[\s\S]*?leading-tight">Informação indisponível</);
    assert.match(html, /data-testid="like-serasa-score">[\s\S]*?leading-tight">Informação indisponível</);
    assert.doesNotMatch(html, /data-testid="like-serasa-limit">[\s\S]*?leading-tight">R\$/);
    assert.match(html, /Retorno parcial do provedor/);
    assert.match(html, /Pendências financeiras \(negativações\)[\s\S]*Informação indisponível neste retorno/);
  });

  it("resultado simulado (DEMO) é marcado no cartão, no relatório e no histórico", () => {
    const demoReport = report({ mode: "DEMO", billingStatus: "NOT_APPLICABLE", billingLabel: "Não se aplica (simulação)", authorizedCostCents: 0, chargedCostCents: 0, providerQueryId: "demo-1" });
    const card = renderToStaticMarkup(<LikeSerasaSourceCard status={status({ state: "VALID", stateLabel: "Consulta válida", consultation: demoReport })} onView={() => undefined} />);
    assert.match(card, /simulado/);
    assert.match(card, /Consulta válida/);
    const html = renderToStaticMarkup(<LikeSerasaReport report={demoReport} />);
    assert.match(html, /like-serasa-demo-badge/);
    assert.match(html, /Resultado simulado — sem consulta real e sem cobrança/);
    const history = renderToStaticMarkup(
      <LikeSerasaHistory
        history={[
          { id: "h1", mode: "DEMO", status: "SUCCEEDED", billingStatus: "NOT_APPLICABLE", billingLabel: "Não se aplica (simulação)", authorizedCostCents: 0, chargedCostCents: 0, failureCode: null, providerQueryId: "demo-1", requestedByUserId: "admin", consultedAt: "2026-10-28T12:00:00.000Z", createdAt: "2026-10-28T12:00:00.000Z", validUntil: null, score: 593, suggestedLimitLabel: "316700,00" },
          { id: "h2", mode: "LIVE", status: "UNKNOWN_BILLING", billingStatus: "UNKNOWN", billingLabel: "Indeterminada — conciliar com a Direct Data", authorizedCostCents: 2150, chargedCostCents: null, failureCode: "TIMEOUT", providerQueryId: null, requestedByUserId: "admin", consultedAt: null, createdAt: "2026-10-27T12:00:00.000Z", validUntil: null, score: null, suggestedLimitLabel: null },
        ]}
      />
    );
    assert.match(history, /Simulação/);
    assert.match(history, /Indeterminada — conciliar com a Direct Data/);
    assert.match(history, /TIMEOUT/);
  });

  it("o painel do cliente monta o botão na linha do pacote e a seção LIKE SERASA abaixo; o QUOD continua usando o pacote", () => {
    const source = readFileSync(join(process.cwd(), "src/components/customers/CustomerQuodDossierPanel.tsx"), "utf8");
    assert.match(source, /extraActions=\{<LikeSerasaActionButton/);
    assert.match(source, /<LikeSerasaSection/);
    assert.match(source, /credit-intelligence-package`/);
    const section = readFileSync(join(process.cwd(), "src/components/customers/LikeSerasaSection.tsx"), "utf8");
    assert.match(section, /generateIdempotencyKey\(\)/);
    assert.match(section, /\/like-serasa`/);
    assert.doesNotMatch(section, /crypto\.randomUUID\(\)/);
    assert.doesNotMatch(section, /DIRECT_DATA_TOKEN/);
  });
});
