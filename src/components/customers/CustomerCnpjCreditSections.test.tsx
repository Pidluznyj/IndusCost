import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerCnpjCreditSections } from "./CustomerCnpjCreditSections";
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
        <section data-testid="cnpj-cadastral-score">
          <p>1. Score cadastral</p>
          <p>Score cadastral: 91/100 · VENDA LIBERADA</p>
          <p>Veredito cadastral. Não autoriza crédito nem venda a prazo.</p>
        </section>
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
    assert.match(html, /91\/100 · VENDA LIBERADA/);
    assert.match(html, /CRÉDITO BLOQUEADO/);
    assert.match(html, /Não autoriza crédito nem venda a prazo/);
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
  });
});
