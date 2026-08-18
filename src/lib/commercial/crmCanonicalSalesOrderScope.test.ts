import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEconomicGroupCustomerMatchOr,
  buildEconomicGroupCustomerPrismaExclusion,
} from "@/src/lib/financeInternalGroupExclusions.js";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import { crmCanonicalIssueRange, crmCanonicalSalesOrderWhere } from "./crmCanonicalSalesOrderScope.server.js";

/**
 * A extração de `buildEconomicGroupCustomerMatchOr` é refatoração pura: o
 * consumidor oficial (Pedidos de Venda / Financeiro) precisa continuar
 * produzindo EXATAMENTE a mesma cláusula de antes.
 */
describe("extração intercompany — comportamento preservado", () => {
  it("a cláusula de SalesOrder continua sendo Customer.isNot com o mesmo OR", () => {
    const exclusion = buildEconomicGroupCustomerPrismaExclusion();
    assert.deepEqual(exclusion, {
      Customer: { isNot: { OR: buildEconomicGroupCustomerMatchOr() } },
    });
  });

  it("o OR extraído mantém CNPJ cru, CNPJ formatado, núcleo e nomes null-safe", () => {
    const or = buildEconomicGroupCustomerMatchOr();
    const json = JSON.stringify(or);
    assert.match(json, /72569510000195/);
    assert.match(json, /72\.569\.510/);
    assert.match(json, /Koppetel/);
    assert.match(json, /SM Comércio|SM Comercio/);
    // tradeName sempre protegido contra NULL (bug dos 127 pedidos zerados).
    const tradeBranches = or.filter((clause) => JSON.stringify(clause).includes("tradeName"));
    assert.ok(tradeBranches.length > 0);
    for (const branch of tradeBranches) {
      assert.match(JSON.stringify(branch), /"tradeName":\{"not":null\}/);
    }
  });
});

/**
 * O CRM não pode ter régua própria: o where dele tem que ser byte a byte o
 * mesmo que a tela Pedidos de Venda produz para o mesmo recorte.
 */
describe("crmCanonicalSalesOrderWhere — consome o construtor oficial", () => {
  it("ano/mês produzem o MESMO where da tela Pedidos de Venda", () => {
    const crm = crmCanonicalSalesOrderWhere({ year: 2026, month: 3 });
    const oficial = buildSalesOrderListWhere(
      { year: 2026, month: 3 },
      { excludeEconomicGroupCustomers: true }
    );
    assert.deepEqual(crm, oficial);
  });

  it("ano inteiro produz o MESMO where da tela Pedidos de Venda", () => {
    assert.deepEqual(
      crmCanonicalSalesOrderWhere({ year: 2026 }),
      buildSalesOrderListWhere({ year: 2026 }, { excludeEconomicGroupCustomers: true })
    );
  });

  it("todos os anos = sem recorte de emissão, mantendo as demais regras", () => {
    assert.deepEqual(
      crmCanonicalSalesOrderWhere({ allYears: true }),
      buildSalesOrderListWhere({}, { excludeEconomicGroupCustomers: true })
    );
  });

  it("carteira aberta e faturado saem do filtro canônico hasInvoice", () => {
    assert.deepEqual(
      crmCanonicalSalesOrderWhere({ year: 2026 }, { hasInvoice: false }),
      buildSalesOrderListWhere(
        { year: 2026, hasInvoice: false },
        { excludeEconomicGroupCustomers: true }
      )
    );
    assert.deepEqual(
      crmCanonicalSalesOrderWhere({ year: 2026 }, { hasInvoice: true }),
      buildSalesOrderListWhere(
        { year: 2026, hasInvoice: true },
        { excludeEconomicGroupCustomers: true }
      )
    );
  });

  it("faixa de emissão é meio-aberta [gte, lt) — mesma borda do oficial", () => {
    const range = crmCanonicalIssueRange({ year: 2026, month: 12 });
    assert.ok(range);
    assert.equal(range!.gte.getFullYear(), 2026);
    assert.equal(range!.gte.getMonth(), 11);
    assert.equal(range!.lt.getFullYear(), 2027);
    assert.equal(range!.lt.getMonth(), 0);
    assert.equal(crmCanonicalIssueRange({ allYears: true }), null);
  });
});
