import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreditDecisionHeader,
  CreditDecisionReasons,
  CustomerCnpjCreditSections,
} from "./CustomerCnpjCreditSections";
import { buildCommercialCreditIntelligenceView } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { decideCommercialCredit } from "@/src/lib/commercial/commercialCreditDecision";
import type { CommercialDelinquencyAnalysis } from "@/src/lib/commercial/customerDelinquencyAnalysis";

const __dirname = dirname(fileURLToPath(import.meta.url));

function overdue(): CommercialDelinquencyAnalysis {
  return {
    status: "OVERDUE",
    unknownReason: null,
    overdueTitleCount: 1,
    overdueAmount: 3200,
    openAmount: 3200,
    maxDaysOverdue: 6,
    lastSyncedAt: "2026-10-19T12:00:00.000Z",
    evidence: {
      source: "NomusAccountsReceivable",
      toleranceDays: 0,
      toleranceUnit: "CALENDAR_DAYS",
      referenceDate: "2026-10-19",
      cnpj: "11444777000161",
      nomusPersonId: 100,
      identity: "RESOLVED",
      syncRunStatus: "SUCCESS",
      payloadComplete: true,
      sourceMaxSyncedAt: "2026-10-19T12:00:00.000Z",
      includedTitleIds: [4],
      overdueTitleIds: [4],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

describe("Consulta CNPJ — score 91 e crédito bloqueado", () => {
  it("mostra o score cadastral sem usá-lo como autorização e destaca o bloqueio", () => {
    const delinquency = overdue();
    const decision = decideCommercialCredit({
      customerId: "11111111-1111-4111-8111-111111111111",
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: new Date(2026, 9, 19, 12, 0, 0),
    });
    const credit = buildCommercialCreditIntelligenceView({
      decision,
      delinquency,
      externalProtest: "ABSENT",
      revealFinancial: true,
    });
    const html = renderToStaticMarkup(
      <div className="w-full max-w-5xl">
        <CreditDecisionHeader credit={credit} loading={false} error={null} />
        <CustomerCnpjCreditSections
          credit={credit}
          loading={false}
          error={null}
          sources={[
            { id: "bcb", label: "Banco Central do Brasil", status: "not_applicable" },
            { id: "brasilapi", label: "BrasilAPI (Receita Federal)", status: "ok" },
          ]}
        />
      </div>
    );
    // A decisão aparece primeiro e o cadastro vira "Qualidade cadastral" (sem "VENDA LIBERADA").
    assert.match(html, /CRÉDITO BLOQUEADO/);
    assert.match(html, /Qualidade cadastral: 91\/100/);
    assert.equal(html.includes("VENDA LIBERADA"), false);
    assert.match(html, /Não representa aprovação de crédito/);
    assert.match(html, /2\. Situação de crédito interno/);
    assert.match(html, /3\. Restrições externas verificadas/);
    assert.match(html, /4\. Decisão comercial final/);
    assert.match(html, /Não aplicável/);
    assert.match(html, /Nenhuma consulta ao Banco Central foi realizada/);
    assert.match(html, /sm:grid-cols-2/);
    assert.equal(html.includes("not_applicable"), false);
    assert.equal(decision.customerStatus, "BLOQUEADO");
  });

  it("mostra carregamento, erro e atualização sem reconstruir o modal", () => {
    const loading = renderToStaticMarkup(
      <CustomerCnpjCreditSections credit={null} loading error={null} onRefresh={() => undefined} />
    );
    const failed = renderToStaticMarkup(
      <CustomerCnpjCreditSections credit={null} loading={false} error="Falha de rede" onRefresh={() => undefined} />
    );
    assert.match(loading, /Carregando situação de crédito/);
    assert.match(loading, /Atualizar crédito/);
    assert.match(failed, /indisponível/i);
    const panel = readFileSync(join(__dirname, "CustomerCnpjIntelligencePanel.tsx"), "utf8");
    assert.ok(panel.includes("CustomerCnpjCreditSections"));
    assert.ok(panel.includes("Consulta CNPJ / Inteligência Comercial"));
    assert.ok(panel.includes('data-testid="customer-cnpj-intelligence-dialog"'));
    // Redesign: cabeçalho executivo presente e nenhum bloco verde "VENDA LIBERADA" no painel.
    assert.ok(panel.includes("CreditDecisionHeader"));
    assert.equal(panel.includes("VENDA LIBERADA"), false);
    assert.equal(panel.includes("bg-emerald-100"), false);
  });
});

describe("Cabeçalho executivo e motivos de crédito", () => {
  function blockedCredit() {
    const delinquency = overdue();
    const decision = decideCommercialCredit({
      customerId: "11111111-1111-4111-8111-111111111111",
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: new Date(2026, 9, 19, 12, 0, 0),
    });
    return buildCommercialCreditIntelligenceView({
      decision,
      delinquency,
      externalProtest: "ABSENT",
      revealFinancial: true,
    });
  }

  it("mostra a decisão bloqueada em destaque, com data e sem depender só de cor", () => {
    const html = renderToStaticMarkup(
      <CreditDecisionHeader credit={blockedCredit()} loading={false} error={null} />
    );
    assert.match(html, /CRÉDITO BLOQUEADO/);
    assert.match(html, /Venda a prazo não autorizada/);
    assert.match(html, /data-decision-state="BLOQUEADO"/);
    assert.match(html, /Última avaliação/);
    assert.match(html, /role="status"/);
  });

  it("sem crédito ou com erro apresenta CRÉDITO NÃO DETERMINADO, nunca verde", () => {
    const err = renderToStaticMarkup(
      <CreditDecisionHeader credit={null} loading={false} error="Falha de rede" />
    );
    assert.match(err, /CRÉDITO NÃO DETERMINADO/);
    assert.match(err, /data-decision-state="NAO_DETERMINADO"/);
    assert.equal(err.includes("bg-emerald-50"), false);
  });

  it("lista os motivos reais do bloqueio com origem e gravidade", () => {
    const html = renderToStaticMarkup(<CreditDecisionReasons credit={blockedCredit()} />);
    assert.match(html, /POR QUE ESTE CLIENTE ESTÁ BLOQUEADO\?/);
    assert.match(html, /Títulos vencidos em aberto/);
    assert.match(html, /Origem: Contas a Receber — Nomus/);
    assert.match(html, /data-reason-code="OVERDUE_OPEN_BALANCE"/);
  });

  it("não renderiza seção de motivos quando não há bloqueio", () => {
    const html = renderToStaticMarkup(<CreditDecisionReasons credit={null} />);
    assert.equal(html, "");
  });
});
