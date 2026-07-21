/**
 * Carteira AR operacional — FIN-02 portfólio (PD 02719).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  filterFinanceArOperationalPortfolioRows,
  suppressInferiorPreNfNomusArRows,
} from "./financeArOperationalPortfolio.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);

function nomusCr(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personId: 88001,
    personName: "Cliente",
    personCnpj: "11222333000181",
    description: null,
    comments: null,
    dueDate: new Date(2026, 8, 10),
    competenceDate: new Date(2026, 6, 1),
    settlementDate: null,
    amountReceivable: 10000,
    amountReceived: 0,
    balanceReceivable: 10000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
    ...partial,
  };
}

describe("financeArOperationalPortfolio", () => {
  it("PD 02719: suppress pré-NF quando o Pedido já tem CR com NF", () => {
    const rows = [
      nomusCr({
        externalId: 17874,
        sourceInvoiceId: 7311,
        sourceInvoiceNumber: "7311",
        description: "Pedido PD 02719 NF 7311",
        amountReceivable: 158505,
        balanceReceivable: 156750,
        amountReceived: 1755,
      }),
      nomusCr({
        externalId: 18077,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 02719 — Depósito Bancário",
        amountReceivable: 158505,
        balanceReceivable: 158505,
      }),
      nomusCr({
        externalId: 18076,
        sourceInvoiceId: 7382,
        sourceInvoiceNumber: "7382",
        description: "Pedido PD 02719 NF 7382",
        amountReceivable: 146974,
        balanceReceivable: 146974,
        dueDate: new Date(2026, 8, 20),
      }),
      nomusCr({
        externalId: 18079,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 02719 — Depósito Bancário",
        amountReceivable: 161111,
        balanceReceivable: 161111,
        dueDate: new Date(2026, 8, 30),
      }),
    ];

    const kept = suppressInferiorPreNfNomusArRows(rows);
    assert.deepEqual(
      kept.map((r) => r.externalId).sort((a, b) => a - b),
      [17874, 18076]
    );
  });

  it("PD 02740: pré-NF sozinho permanece", () => {
    const rows = [
      nomusCr({
        externalId: 19001,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 02740 — Depósito",
        amountReceivable: 5000,
        balanceReceivable: 5000,
      }),
    ];
    const kept = suppressInferiorPreNfNomusArRows(rows);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.externalId, 19001);
  });

  it("superiorOrderCodes omite pré-NF mesmo sem WITH_NFE no lote", () => {
    const rows = [
      nomusCr({
        externalId: 18077,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 02719 — Depósito",
      }),
    ];
    const kept = suppressInferiorPreNfNomusArRows(rows, {
      superiorOrderCodes: ["PD 02719"],
    });
    assert.equal(kept.length, 0);
  });

  it("filterFinanceArOperationalPortfolioRows aplica management + suppress", () => {
    const rows = [
      nomusCr({
        externalId: 1,
        sourceInvoiceId: 10,
        sourceInvoiceNumber: "10",
        description: "Pedido PD 100 NF 10",
        dueDate: new Date(2026, 8, 15),
      }),
      nomusCr({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 100 — pré",
        dueDate: new Date(2026, 8, 15),
      }),
      // vencido sem NF — excluído pelo management
      nomusCr({
        externalId: 3,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        description: "Pedido PD 200 — órfão vencido",
        dueDate: new Date(2026, 5, 1),
      }),
    ];

    const filtered = filterFinanceArOperationalPortfolioRows(
      rows,
      { status: "all" },
      REF
    );
    assert.deepEqual(
      filtered.map((r) => r.externalId).sort((a, b) => a - b),
      [1]
    );
  });
});
