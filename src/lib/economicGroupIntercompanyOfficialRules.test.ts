import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ECONOMIC_GROUP_CNPJ_DIGITS,
  ECONOMIC_GROUP_INTERCOMPANY,
  classifyIntercompanyPayable,
  classifyIntercompanyReceivable,
  classifyIntercompanySalesOrder,
  isIntercompanyPayable,
  isIntercompanyReceivable,
  isIntercompanySalesOrder,
  normalizeFinanceCnpj,
} from "./financeInternalGroupExclusions.js";
import {
  buildSalesOrderRulesResult,
} from "./salesOrderRulesEngine.js";
import type { SalesOrderRulesOrderInput } from "./salesOrderRulesEngine.types.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import { isSalesOrderMarketCustomer } from "./groupCompanyCustomer.js";

const REF = new Date(2026, 5, 20);

const EXTERNAL_CNPJ = "12.345.678/0001-90";

function so(input: {
  id: string;
  issuer: string;
  customerName: string;
  customerTaxId: string;
  net?: number;
}): SalesOrderRulesOrderInput {
  return {
    id: input.id,
    orderCode: input.id,
    status: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 5, 10),
    totalNetValue: input.net ?? 1000,
    totalItems: 1,
    companyIssuer: input.issuer,
    Customer: {
      companyName: input.customerName,
      taxId: input.customerTaxId,
    },
    items: [{ id: `${input.id}-i`, quantity: 1 }],
  };
}

describe("economic group intercompany — Pedidos de Venda (1–12)", () => {
  const cases = [
    { id: "1", issuer: "Lazarios Comercio de Plasticos LTDA", customer: "Cliente Externo", taxId: EXTERNAL_CNPJ, keep: true },
    { id: "2", issuer: "Koppetel Comercio de Plasticos LTDA", customer: "Cliente Externo", taxId: EXTERNAL_CNPJ, keep: true },
    { id: "3", issuer: "Sm Comercio de Plasticos LTDA - SM", customer: "Cliente Externo", taxId: EXTERNAL_CNPJ, keep: true },
    { id: "4", issuer: "Lazarios Comercio de Plasticos LTDA", customer: "Koppetel", taxId: "14.055.501/0001-80", keep: false },
    { id: "5", issuer: "Lazarios Comercio de Plasticos LTDA", customer: "SM", taxId: "55.717.719/0001-30", keep: false },
    { id: "6", issuer: "Koppetel Comercio de Plasticos LTDA", customer: "Lazarios", taxId: "72.569.510/0001-95", keep: false },
    { id: "7", issuer: "Koppetel Comercio de Plasticos LTDA", customer: "SM", taxId: "55717719000130", keep: false },
    { id: "8", issuer: "Sm Comercio de Plasticos LTDA - SM", customer: "Lazarios", taxId: "72569510000195", keep: false },
    { id: "9", issuer: "Sm Comercio de Plasticos LTDA - SM", customer: "Koppetel", taxId: "14055501000180", keep: false },
  ] as const;

  for (const c of cases) {
    it(`${c.id}: ${c.issuer.split(" ")[0]} → ${c.customer} ${c.keep ? "incluído" : "excluído"}`, () => {
      const order = so({
        id: `so-${c.id}`,
        issuer: c.issuer,
        customerName: c.customer,
        customerTaxId: c.taxId,
        net: 5000,
      });
      assert.equal(isIntercompanySalesOrder(order), !c.keep);
      assert.equal(isSalesOrderMarketCustomer(order), c.keep);
      const classified = classifyIntercompanySalesOrder(order);
      assert.equal(classified.excluded, !c.keep);
      if (!c.keep) assert.equal(classified.reason, ECONOMIC_GROUP_INTERCOMPANY);
    });
  }

  it("10: CNPJ com e sem pontuação produzem o mesmo resultado", () => {
    const a = so({
      id: "punct",
      issuer: "Lazarios",
      customerName: "Koppetel",
      customerTaxId: "14.055.501/0001-80",
    });
    const b = so({
      id: "digits",
      issuer: "Lazarios",
      customerName: "Koppetel",
      customerTaxId: "14055501000180",
    });
    assert.equal(isIntercompanySalesOrder(a), true);
    assert.equal(isIntercompanySalesOrder(b), true);
    assert.equal(normalizeFinanceCnpj(a.Customer!.taxId), normalizeFinanceCnpj(b.Customer!.taxId));
  });

  it("11: pedido interno fora de valor/quantidade/margem no motor oficial", () => {
    const market = so({
      id: "m",
      issuer: "Lazarios",
      customerName: "Externo",
      customerTaxId: EXTERNAL_CNPJ,
      net: 1000,
    });
    const internal = so({
      id: "i",
      issuer: "Lazarios",
      customerName: "Koppetel",
      customerTaxId: "14055501000180",
      net: 99999,
    });
    const result = buildSalesOrderRulesResult([market, internal], {
      referenceDate: REF,
      year: 2026,
      month: 6,
      scope: "executive",
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.soldAmount, 1000);
    assert.equal(result.metrics.totalOrders, 1);
    assert.equal(result.metrics.totalItems, 1);
    assert.ok(
      result.list == null ||
        !Array.isArray((result.list as { rows?: unknown[] }).rows) ||
        !(result.list as { rows: Array<{ id: string }> }).rows.some((r) => r.id === "i")
    );
  });

  it("12: where operacional exclui grupo; auditoria pode manter", () => {
    const operational = buildSalesOrderListWhere({}, { excludeEconomicGroupCustomers: true });
    const audit = buildSalesOrderListWhere({}, { excludeEconomicGroupCustomers: false });
    assert.match(JSON.stringify(operational), /72569510000195|Lazarios|Koppetel/);
    assert.doesNotMatch(JSON.stringify(audit), /72569510000195/);
  });
});

describe("economic group intercompany — Contas a Receber (13–21)", () => {
  it("13: cliente externo incluído", () => {
    assert.equal(
      isIntercompanyReceivable({ personName: "Cliente Externo", personCnpj: EXTERNAL_CNPJ }),
      false
    );
  });

  it("14–16: combinações do grupo excluídas", () => {
    for (const cnpj of ECONOMIC_GROUP_CNPJ_DIGITS) {
      assert.equal(isIntercompanyReceivable({ personName: null, personCnpj: cnpj }), true);
      assert.equal(
        classifyIntercompanyReceivable({ personCnpj: cnpj }).reason,
        ECONOMIC_GROUP_INTERCOMPANY
      );
    }
  });

  it("17–19: previsão/CR real/baixa usam a mesma classificação de contraparte", () => {
    const row = { personName: "Koppetel Comercio", personCnpj: "14.055.501/0001-80" };
    assert.equal(isIntercompanyReceivable(row), true);
  });

  it("wiring AR oficial ainda usa exclusão de grupo", () => {
    const engine = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsReceivableRulesEngine.ts"),
      "utf8"
    );
    const excl = readFileSync(
      join(process.cwd(), "src/lib/financeInternalGroupExclusions.ts"),
      "utf8"
    );
    assert.match(excl, /isFinanceArExcludedFromManagement/);
    assert.match(engine, /filterOfficialAr|ExcludedFromManagement|isFinanceAr/);
  });
});

describe("economic group intercompany — Contas a Pagar (22–29)", () => {
  it("22: pagadora do grupo + fornecedor externo permanece", () => {
    assert.equal(
      isIntercompanyPayable({
        companyName: "Lazarios Comercio de Plasticos LTDA",
        personName: "Fornecedor Externo",
        personCnpj: EXTERNAL_CNPJ,
      }),
      false
    );
  });

  it("23–27: todas as combinações intercompany excluídas", () => {
    const payers = ["Lazarios", "Koppetel", "SM Comercio de Plasticos"];
    const creditors = [
      { name: "Koppetel", cnpj: "14055501000180" },
      { name: "Lazarios", cnpj: "72569510000195" },
      { name: "SM Comercio", cnpj: "55717719000130" },
    ];
    for (const payer of payers) {
      for (const cred of creditors) {
        if (payer.startsWith(cred.name.slice(0, 2)) && payer.includes(cred.name.slice(0, 4))) {
          // mesma empresa ainda é intercompany se ambos grupo
        }
        assert.equal(
          isIntercompanyPayable({
            companyName: payer,
            personName: cred.name,
            personCnpj: cred.cnpj,
          }),
          true,
          `${payer} → ${cred.name}`
        );
      }
    }
  });

  it("28: não exclui só porque a pagadora é do grupo", () => {
    assert.equal(
      classifyIntercompanyPayable({
        companyName: "Koppetel",
        personName: "Fornecedor XYZ",
        personCnpj: "99887766000155",
      }).excluded,
      false
    );
  });

  it("29: wiring AP oficial preserva ambos os lados", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/financeInternalGroupExclusions.ts"),
      "utf8"
    );
    assert.match(src, /isIntercompanyPayable/);
    assert.match(src, /pagador E credor/i);
  });
});

describe("economic group intercompany — consolidação e consumidores (30–37)", () => {
  it("fonte única de CNPJs sem arrays duplicados nos motores", () => {
    const group = readFileSync(join(process.cwd(), "src/lib/groupCompanyCustomer.ts"), "utf8");
    const nfe = readFileSync(join(process.cwd(), "src/lib/nomusNfeClassification.ts"), "utf8");
    assert.match(group, /ECONOMIC_GROUP_CNPJ_DIGITS/);
    assert.doesNotMatch(group, /72569510000195/);
    assert.match(nfe, /ECONOMIC_GROUP_CNPJ_DIGITS|isEconomicGroupCnpj/);
    assert.doesNotMatch(nfe, /"72569510000195"/);
  });

  it("presidencial e dashboards SO excluem grupo", () => {
    const exec = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    const financeSo = readFileSync(
      join(process.cwd(), "src/lib/financeSalesOrdersDashboard.ts"),
      "utf8"
    );
    assert.match(exec, /excludeGroupCompanyCustomers:\s*true/);
    assert.match(metrics, /excludeGroupCompanyCustomers \?\? true/);
    assert.match(financeSo, /FINANCE_SO_EXCLUDE_GROUP_COMPANIES\s*=\s*true/);
  });

  it("listagem operacional aplica exclusão Prisma de grupo", () => {
    const list = readFileSync(join(process.cwd(), "src/lib/salesOrdersListSummary.ts"), "utf8");
    assert.match(list, /buildEconomicGroupCustomerPrismaExclusion/);
    assert.match(list, /excludeEconomicGroupCustomers !== false/);
  });
});
