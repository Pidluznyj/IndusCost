/**
 * O mesmo resumo de crédito nas telas comerciais.
 * A consulta não grava pedido nem trata falha de filtro como liberação.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import { buildCommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import {
  buildCommercialCreditOperationSummary,
  commercialCreditEvaluationDraft,
  formatCommercialCreditException,
  matchesCommercialCreditPortfolioFilter,
  presentCommercialCreditEvaluation,
  readStoredCadastralScore,
} from "./commercialCreditOperation.js";
import { filterCustomersByCommercialCredit } from "./commercialCreditOperation.server.js";
import { CustomerCreditOperationSummaryView } from "@/src/components/customers/CustomerCreditOperationCard";
import type { CommercialDelinquencyAnalysis } from "./customerDelinquencyAnalysis.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function overdue(): CommercialDelinquencyAnalysis {
  return {
    status: "OVERDUE",
    unknownReason: null,
    overdueTitleCount: 2,
    overdueAmount: 1500,
    openAmount: 1500,
    maxDaysOverdue: 4,
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
      includedTitleIds: [1],
      overdueTitleIds: [1],
      protestedTitleIds: [],
      protestReading: "NOT_IN_SOURCE",
      exclusions: [],
    },
  };
}

describe("operação comercial de crédito", () => {
  it("mostra score, bloqueio e valores só com permissão, sem autorizar pelo score", () => {
    const delinquency = overdue();
    const decision = decideCommercialCredit({
      customerId: "11111111-1111-4111-8111-111111111111",
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: new Date(2026, 9, 19),
    });
    const visible = buildCommercialCreditOperationSummary(
      buildCommercialCreditIntelligenceView({
        decision,
        delinquency,
        externalProtest: "ABSENT",
        revealFinancial: true,
        authorizedExceptions: [
          formatCommercialCreditException({
            scope: "OVERDUE",
            expiresAt: new Date(2026, 10, 19),
            permission: "commercial.credit.exception.grant",
          }),
        ],
      }),
      ["19/10/2026 · usuário · Recusada"]
    );
    const hidden = buildCommercialCreditOperationSummary(
      buildCommercialCreditIntelligenceView({
        decision,
        delinquency,
        externalProtest: "ABSENT",
        revealFinancial: false,
      })
    );
    assert.equal(visible.cadastralScoreLabel, "91/100");
    assert.equal(visible.headline, "CRÉDITO BLOQUEADO");
    assert.equal(visible.visualOnly, true);
    assert.match(visible.overdueAmountLabel, /1\.?500/);
    assert.equal(visible.overdueTitleCountLabel, "2");
    assert.match(visible.exceptions[0] ?? "", /Títulos vencidos/);
    assert.equal(hidden.overdueAmountLabel, "Restrito");
    const html = renderToStaticMarkup(React.createElement(CustomerCreditOperationSummaryView, { summary: visible }));
    assert.match(html, /Score cadastral/);
    assert.match(html, /91\/100/);
    assert.match(html, /CRÉDITO BLOQUEADO/);
    assert.match(html, /servidor autorizar/);
  });

  it("separa bloqueio, protesto pendente e análise", () => {
    assert.equal(
      matchesCommercialCreditPortfolioFilter({
        filter: "blocked",
        customerStatus: "BLOQUEADO",
        confirmedPendingProtest: false,
        externalProtestConfirmed: false,
      }),
      true
    );
    assert.equal(
      matchesCommercialCreditPortfolioFilter({
        filter: "pending_protest",
        customerStatus: "LIBERADO",
        confirmedPendingProtest: true,
        externalProtestConfirmed: false,
      }),
      true
    );
    assert.equal(
      matchesCommercialCreditPortfolioFilter({
        filter: "under_review",
        customerStatus: "EM_ANALISE",
        confirmedPendingProtest: false,
        externalProtestConfirmed: false,
      }),
      true
    );
    assert.equal(
      matchesCommercialCreditPortfolioFilter({
        filter: "blocked",
        customerStatus: "EM_ANALISE",
        confirmedPendingProtest: false,
        externalProtestConfirmed: false,
      }),
      false
    );
  });

  it("não trata falha de consulta como cliente liberado e não grava", async () => {
    const db = {
      customer: { findUnique: async () => null, findMany: async () => [] },
      customerCorporateLink: { findMany: async () => [] },
      commercialExternalProtest: { findMany: async () => [] },
      commercialCreditException: { findMany: async () => [] },
      commercialCreditOccurrence: { findMany: async () => [] },
      commercialCorporateMembership: { findMany: async () => [], findFirst: async () => null },
      customerCnpjLookup: { findFirst: async () => null },
    };
    const blocked = await filterCustomersByCommercialCredit(db as never, {
      customerIds: ["11111111-1111-4111-8111-111111111111"],
      filter: "blocked",
      now: new Date(2026, 9, 19),
    });
    const review = await filterCustomersByCommercialCredit(db as never, {
      customerIds: ["11111111-1111-4111-8111-111111111111"],
      filter: "under_review",
      now: new Date(2026, 9, 19),
    });
    assert.deepEqual(blocked.matches, []);
    assert.equal(blocked.failed, 0);
    assert.equal(blocked.writes, "NONE");
    assert.equal(review.matches.length, 1);
    assert.equal(review.writes, "NONE");
  });

  it("registra decisão sem saldo e sem título", () => {
    const decision = decideCommercialCredit({
      customerId: "11111111-1111-4111-8111-111111111111",
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: overdue(),
      now: new Date(2026, 9, 19),
    });
    const draft = commercialCreditEvaluationDraft({
      customerId: "11111111-1111-4111-8111-111111111111",
      decision,
      evaluatedAt: new Date(2026, 9, 19, 10),
      evaluatedBy: "55555555-5555-4555-8555-555555555555",
      enforcement: "CREDIT_GRANT",
      validUntil: new Date(2026, 10, 19),
      entityType: "CommercialCreditDecision",
      entityId: "66666666-6666-4666-8666-666666666666",
    });
    const serialized = JSON.stringify(draft);
    assert.equal(serialized.includes("1500"), false);
    assert.equal(serialized.includes("includedTitleIds"), false);
    assert.match(presentCommercialCreditEvaluation(draft), /usuário 55555555/);
    assert.match(presentCommercialCreditEvaluation(draft), /válida até/);
    assert.equal(readStoredCadastralScore({ riskScore: 91, riskVerdict: "VENDA LIBERADA" })?.score, 91);
    assert.equal(readStoredCadastralScore({ partners: [] }), null);
  });

  it("liga as telas existentes e mantém a consulta sem efeito em pedido", () => {
    const read = (path: string) => readFileSync(join(root, path), "utf8");
    for (const path of [
      "src/components/customers/CustomerCommercial360.tsx",
      "src/components/crm/CustomerIntelligencePage.tsx",
      "src/components/crm/CrmCustomerPortfolioSection.tsx",
      "src/components/ProposalModule.tsx",
      "src/components/sales/SalesOrderDetailDialog.tsx",
    ]) {
      assert.equal(read(path).includes("CustomerCreditOperationCard"), true, path);
    }
    const portfolio = read("src/components/crm/CrmCustomerPortfolioSection.tsx");
    assert.match(portfolio, /COMMERCIAL_CREDIT_PORTFOLIO_FILTER_LABEL/);
    assert.match(portfolio, /bloqueio de venda continua no servidor/);
    const labels = read("src/lib/commercial/commercialCreditOperation.ts");
    assert.match(labels, /Crédito bloqueado/);
    assert.match(labels, /Protesto pendente/);
    assert.match(labels, /Restrição em análise/);
    const routes = read("src/lib/companyIntelligenceRoutes.ts");
    const getStart = routes.indexOf('"/api/customers/:id/commercial-credit"');
    const historyStart = routes.indexOf('"/api/customers/:id/commercial-credit/history"');
    const getHandler = routes.slice(getStart, historyStart);
    assert.equal(getHandler.includes("commercialCreditEvaluation"), false);
    assert.equal(getHandler.includes("salesOrder.update"), false);
    assert.equal(routes.includes('"/api/commercial/credit-portfolio-filter"'), true);
    const operation = read("src/lib/commercial/commercialCreditOperation.server.ts");
    assert.equal(operation.includes("salesOrder"), false);
    assert.equal(operation.includes("notification"), false);
    assert.equal(operation.includes("NomusAccountsReceivable"), false);
  });
});
