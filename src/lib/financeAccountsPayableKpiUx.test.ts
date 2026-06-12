import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getAccountsPayableOperationalDueDate,
  isAccountsPayableOverdue,
  isAccountsPayablePurchaseOrderSchedule,
} from "./financeAccountsPayableOperational.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";

const pagePath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "FinanceAccountsPayablePage.tsx"
);
const kpiCardPath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "shared",
  "FinanceKpiCard.tsx"
);

describe("financeAccountsPayableKpiUx", () => {
  it("página AP usa labels curtos alinhados ao padrão AR", () => {
    const page = readFileSync(pagePath, "utf8");
    const labels = [
      "Total a pagar",
      "Pago no mês",
      "Em aberto",
      "Vencido gerencial",
      "Vence hoje",
      "Próx. 7 dias",
      "Próx. 30 dias",
      "Agendados",
    ];
    for (const label of labels) {
      assert.ok(page.includes(label), `label ausente: ${label}`);
    }
    assert.equal(page.includes("AGENDADOS / REMARCADOS"), false);
    assert.equal(page.includes("Próximos 30 dias"), false);
    assert.equal(page.includes("xl:grid-cols-8"), false);
    assert.match(page, /lg:grid-cols-4 xl:grid-cols-4/);
    assert.match(page, /FinanceKpiCard/);
  });

  it("card Pago no mês usa subtítulo curto e explicação longa no tooltip", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.ok(page.includes("Mês atual, dentro do filtro"));
    assert.ok(page.includes("FINANCE_AP_PAID_THIS_MONTH_SCOPE"));
    assert.equal(page.includes("scopeNote={FINANCE_AP_PAID_THIS_MONTH_SCOPE}"), false);
  });

  it("FinanceKpiCard evita quebra de valor monetário", () => {
    const biKpi = readFileSync(
      join(process.cwd(), "src", "components", "finance", "bi", "FinanceBiKpiCard.tsx"),
      "utf8"
    );
    const kpi = readFileSync(kpiCardPath, "utf8");
    assert.match(biKpi, /whitespace-nowrap/);
    assert.match(kpi, /text-xl font-semibold sm:text-2xl/);
  });

  it("regra operacional AP preservada (max due/schedule, pedido de compra)", () => {
    const poRow = apRow({
      externalId: 1,
      description: "PEDIDO DE COMPRA",
      dueDate: new Date(2026, 4, 1),
    });
    assert.equal(isAccountsPayablePurchaseOrderSchedule(poRow), true);
    const ref = new Date(2026, 5, 15);
    const operational = apRow({
      externalId: 2,
      dueDate: new Date(2026, 5, 1),
      scheduleDate: new Date(2026, 5, 20),
      balancePayable: 50,
      description: "Serviço",
    });
    assert.equal(
      getAccountsPayableOperationalDueDate(operational)?.toISOString(),
      operational.scheduleDate?.toISOString()
    );
    assert.equal(isAccountsPayableOverdue(operational, ref), false);
  });
});

function apRow(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Fornecedor",
    personCnpj: null,
    description: "Serviço",
    dueDate: new Date(2026, 5, 1),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 100,
    amountPaid: 0,
    balancePayable: 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: false,
    syncedAt: new Date(),
    ...partial,
  };
}
