import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFinanceCashFlowDashboard } from "./financeCashFlowDashboard.js";
import { buildFinanceCashFlowExportCsv } from "./financeCashFlowExport.js";

describe("financeCashFlowExport", () => {
  it("export CSV mensal com séries do dashboard", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        {
          externalId: 1,
          companyName: "A",
          personName: "C",
          personCnpj: null,
          description: null,
          dueDate: new Date(2026, 0, 10),
          settlementDate: null,
          competenceDate: null,
          amountReceivable: 100,
          amountReceived: 0,
          balanceReceivable: 100,
          paymentMethodName: null,
          bankAccountName: null,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          suspendCollection: false,
          nomusStatus: true,
          syncedAt: new Date(),
        },
      ],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 }
    );
    const csv = buildFinanceCashFlowExportCsv(payload);
    assert.ok(csv.includes("tipo,ano,mes,entradas,saidas"));
    assert.ok(csv.includes("cenario_base_liquido,conservador_liquido,critico_liquido"));
    assert.ok(csv.includes("mensal,2026,1"));
    assert.ok(csv.includes("necessidade_caixa"));
    assert.ok(csv.includes("horizonte_12m"));
  });
});
