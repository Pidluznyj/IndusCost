import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  mapExecutiveReportCompanyToEmitterCnpj,
  mapExecutiveReportCompanyToFilter,
} from "./financeExecutiveReportCompany.js";
import {
  applySalesOrderRulesUniverseFilters,
  buildSalesOrderRulesContext,
  buildSalesOrderRulesResult,
} from "./salesOrderRulesEngine.js";
import type { SalesOrderRulesOrderInput } from "./salesOrderRulesEngine.types.js";
import { isSalesOrderMarketCustomer } from "./groupCompanyCustomer.js";

const REF = new Date(2026, 5, 20);

const marketOrder: SalesOrderRulesOrderInput = {
  id: "so-market",
  orderCode: "PD-1",
  status: "SENT_TO_NOMUS",
  issueDate: new Date(2026, 5, 10),
  totalNetValue: 1000,
  totalItems: 1,
  companyIssuer: "Lazarios Comercio de Plasticos LTDA",
  Customer: { companyName: "Cliente Mercado", taxId: "12345678000199" },
  items: [{ id: "i1", quantity: 1 }],
};

const intercompanyOrder: SalesOrderRulesOrderInput = {
  ...marketOrder,
  id: "so-inter",
  orderCode: "PD-2",
  totalNetValue: 5000,
  Customer: { companyName: "Koppetel Comercio de Plasticos LTDA", taxId: "14.055.501/0001-80" },
};

const smOrder: SalesOrderRulesOrderInput = {
  ...marketOrder,
  id: "so-sm",
  orderCode: "PD-3",
  totalNetValue: 3000,
  companyIssuer: "Sm Comercio de Plasticos LTDA - SM",
  Customer: { companyName: "SM Comercio de Plasticos Ltda", taxId: "55.717.719/0001-30" },
};

describe("salesOrder executive market filters", () => {
  it("isSalesOrderMarketCustomer exclui clientes do grupo", () => {
    assert.equal(isSalesOrderMarketCustomer(marketOrder), true);
    assert.equal(isSalesOrderMarketCustomer(intercompanyOrder), false);
    assert.equal(isSalesOrderMarketCustomer(smOrder), false);
  });

  it("motor oficial exclui empresas do grupo dos KPIs executivos", () => {
    const result = buildSalesOrderRulesResult([marketOrder, intercompanyOrder, smOrder], {
      referenceDate: REF,
      year: 2026,
      month: 6,
      scope: "executive",
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.soldAmount, 1000);
    assert.equal(result.metrics.totalOrders, 1);
    assert.equal(result.context.excludeGroupCompanyCustomers, true);
  });

  it("filtro empresa restringe por companyIssuer", () => {
    const lazarios = { ...marketOrder, id: "so-l", companyIssuer: "Lazarios Comercio" };
    const koppetel = {
      ...marketOrder,
      id: "so-k",
      companyIssuer: "Koppetel Comercio de Plasticos LTDA",
      Customer: { companyName: "Cliente B", taxId: "99887766000155" },
    };
    const context = buildSalesOrderRulesContext({
      referenceDate: REF,
      managementFilters: { companyIssuer: "Koppetel" },
      excludeGroupCompanyCustomers: true,
    });
    const universe = applySalesOrderRulesUniverseFilters([lazarios, koppetel], context);
    assert.equal(universe.length, 1);
    assert.equal(universe[0]?.id, "so-k");
  });

  it("sem filtro empresa permanece consolidado (mercado, todas filiais)", () => {
    const lazarios = { ...marketOrder, id: "so-l", companyIssuer: "Lazarios Comercio" };
    const koppetel = {
      ...marketOrder,
      id: "so-k",
      companyIssuer: "Koppetel Comercio",
      Customer: { companyName: "Cliente B", taxId: "99887766000155" },
    };
    const result = buildSalesOrderRulesResult([lazarios, koppetel, intercompanyOrder], {
      referenceDate: REF,
      year: 2026,
      month: 6,
      scope: "executive",
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.totalOrders, 2);
    assert.equal(result.metrics.soldAmount, 2000);
  });
});

describe("financeExecutiveReport company filter wiring", () => {
  it("mapExecutiveReportCompanyToFilter e emitter CNPJ", () => {
    assert.equal(mapExecutiveReportCompanyToFilter("lazarios"), "Lazarios");
    assert.equal(mapExecutiveReportCompanyToEmitterCnpj("lazarios"), "72569510000195");
    assert.equal(mapExecutiveReportCompanyToEmitterCnpj("koppetel"), "14055501000180");
    assert.equal(mapExecutiveReportCompanyToEmitterCnpj("sm"), "55717719000130");
    assert.equal(mapExecutiveReportCompanyToEmitterCnpj("all"), undefined);
  });

  it("relatório presidencial repassa company a billing e pedidos", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.match(src, /company: filters\.company/);
    assert.match(src, /buildSalesOrdersDashboardTab\(yearCtx, \{ companyIssuer \}\)/);
  });

  it("faturamento NF-e aplica filtro cnpjEmitente", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeBillingNfeDashboard.ts"), "utf8");
    assert.match(src, /cnpjEmitente/);
    assert.match(src, /emitterCnpjDigits/);
  });
});

describe("financeExecutiveReportPresidentialAudit matrix", () => {
  it("não deixa PRECISA_VALIDACAO em grupo/filtro empresa", async () => {
    const { PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX } = await import(
      "./financeExecutiveReportPresidentialAudit.js"
    );
    const pending = PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX.filter(
      (row) => row.status === "PRECISA_VALIDACAO"
    );
    assert.equal(pending.length, 0);
    assert.ok(
      PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX.some((r) =>
        r.componentOrBuilder.includes("applySalesOrderRulesUniverseFilters")
      )
    );
  });
});
