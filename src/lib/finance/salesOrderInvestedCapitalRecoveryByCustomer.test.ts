import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  aggregateInvestedCapitalRecoveryByCustomer,
  INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_NAME,
  sumInvestedCapitalRecoveryCustomerMoney,
} from "./salesOrderInvestedCapitalRecoveryByCustomer.js";
import { buildSalesOrderInvestedCapitalRecoverySnapshot } from "./salesOrderInvestedCapitalRecoverySnapshot.js";
import type { SalesOrderInvestedCapitalRecoveryOrderInput } from "./salesOrderInvestedCapitalRecoverySnapshot.js";

const TODAY = "2026-09-01";

function order(
  partial: Partial<SalesOrderInvestedCapitalRecoveryOrderInput> &
    Pick<SalesOrderInvestedCapitalRecoveryOrderInput, "salesOrderId">
): SalesOrderInvestedCapitalRecoveryOrderInput {
  return {
    orderCode: partial.salesOrderId,
    customerId: "customer-a",
    customerName: "Cliente A",
    sellerName: null,
    saleValue: 0,
    invoicedValue: 0,
    investedCapital: 100,
    investedCapitalUnavailableReason: null,
    orderStatus: "SENT_TO_NOMUS",
    orderStatusLabel: "Enviado",
    industrialCost: 80,
    totalTaxes: 20,
    taxSourceLabel: null,
    realReceivables: [],
    ...partial,
  };
}

function snap(
  partial: Partial<SalesOrderInvestedCapitalRecoveryOrderInput> &
    Pick<SalesOrderInvestedCapitalRecoveryOrderInput, "salesOrderId">
) {
  return buildSalesOrderInvestedCapitalRecoverySnapshot(order(partial), TODAY);
}

function received(amount: number, externalId: number) {
  return {
    externalId,
    dueDate: "2026-08-01",
    settlementDate: "2026-08-10",
    amountReceivable: amount,
    amountReceived: amount,
    balanceReceivable: 0,
  };
}

describe("Recuperação do Dinheiro Investido — agregação por cliente", () => {
  it("pedido totalmente recuperado com ganho: recebido acima do capital não vira dinheiro na rua", () => {
    const row = snap({
      salesOrderId: "so-1",
      saleValue: 180,
      invoicedValue: 180,
      investedCapital: 100,
      realReceivables: [received(150, 1)],
    });
    assert.equal(row.capitalRecovered, 100);
    assert.equal(row.moneyOnStreet, 0);
    assert.equal(row.realizedGain, 50);
    assert.equal(row.potentialResult, 80);
    assert.equal(row.status, "CAPITAL_RECUPERADO");
  });

  it("pedido parcialmente recuperado", () => {
    const row = snap({
      salesOrderId: "so-2",
      invoicedValue: 90,
      investedCapital: 100,
      realReceivables: [received(20, 1)],
    });
    assert.equal(row.capitalRecovered, 20);
    assert.equal(row.moneyOnStreet, 80);
    assert.equal(row.realizedGain, 0);
    assert.equal(row.status, "EM_RECUPERACAO");
  });

  it("pedido parcialmente faturado: saldo é faturado menos o capital integral, não vendido menos capital", () => {
    const row = snap({
      salesOrderId: "parcial",
      saleValue: 200000,
      invoicedValue: 30000,
      investedCapital: 100000,
      industrialCost: 80000,
      totalTaxes: 20000,
    });
    assert.equal(row.saleValue, 200000);
    assert.equal(row.invoicedValue, 30000);
    assert.equal(row.investedCapital, 100000);
    assert.equal(row.potentialResult, -70000);
    assert.notEqual(row.potentialResult, 200000 - 100000);
  });

  it("pedido sem recebimento", () => {
    const row = snap({
      salesOrderId: "so-3",
      invoicedValue: 40,
      investedCapital: 100,
      realReceivables: [],
    });
    assert.equal(row.actualReceived, 0);
    assert.equal(row.capitalRecovered, 0);
    assert.equal(row.moneyOnStreet, 100);
    assert.equal(row.realizedGain, 0);
    assert.equal(row.status, "SEM_RECUPERACAO");
  });

  it("dois pedidos do mesmo cliente não fazem ganho realizado = recebido total − capital total", () => {
    const result = aggregateInvestedCapitalRecoveryByCustomer([
      snap({
        salesOrderId: "p1",
        customerId: "customer-a",
        customerName: "CLIENTE ABC",
        saleValue: 160,
        invoicedValue: 150,
        investedCapital: 100,
        industrialCost: 70,
        totalTaxes: 30,
        realReceivables: [received(150, 1)],
      }),
      snap({
        salesOrderId: "p2",
        customerId: "customer-a",
        customerName: "Cliente ABC",
        saleValue: 80,
        invoicedValue: 20,
        investedCapital: 100,
        industrialCost: 90,
        totalTaxes: 10,
        realReceivables: [received(20, 2)],
      }),
    ]);

    assert.equal(result.customers.length, 1);
    assert.equal(result.customers[0]?.customerId, "customer-a");
    assert.equal(result.customers[0]?.orders, 2);
    const row = result.customers[0]!;
    assert.equal(row.investedCapital, 200);
    assert.equal(row.received, 170);
    assert.equal(row.recoveredCapital, 120);
    assert.equal(row.capitalAtRisk, 80);
    assert.equal(row.realizedGain, 50);
    assert.notEqual(row.realizedGain, -30);
    assert.equal(row.sold, 240);
    assert.equal(row.invoiced, 170);
    assert.equal(row.industrialCost, 160);
    assert.equal(row.taxes, 40);
    assert.equal(row.potentialResult, 170 - 200);
  });

  it("dois clientes permanecem separados pelo id oficial, mesmo com nome parecido", () => {
    const result = aggregateInvestedCapitalRecoveryByCustomer([
      snap({
        salesOrderId: "a",
        customerId: "id-1",
        customerName: "CLIENTE ABC",
        invoicedValue: 300,
        investedCapital: 100,
        realReceivables: [received(100, 1)],
      }),
      snap({
        salesOrderId: "b",
        customerId: "id-2",
        customerName: "CLIENTE ABC",
        invoicedValue: 50,
        investedCapital: 40,
        industrialCost: 30,
        totalTaxes: 10,
        realReceivables: [received(10, 2)],
      }),
    ]);
    assert.equal(result.customers.length, 2);
    assert.equal(result.summary.customers, 2);
    assert.equal(result.summary.invoicedCustomers, 2);
    assert.equal(result.charts.topInvoiced[0]?.amount, 300);
    assert.equal(result.charts.topRealizedGain.length, 0);
  });

  it("pedido sem custo fica em dados insuficientes e não vira capital zero", () => {
    const result = aggregateInvestedCapitalRecoveryByCustomer([
      snap({
        salesOrderId: "sem-custo",
        customerId: "id-1",
        saleValue: 80,
        invoicedValue: 80,
        investedCapital: null,
        industrialCost: null,
        totalTaxes: 15,
        investedCapitalUnavailableReason: "Custo industrial indisponível para este pedido",
        realReceivables: [received(10, 1)],
      }),
    ]);
    const row = result.customers[0]!;
    assert.equal(row.insufficientDataOrders, 1);
    assert.equal(row.investedCapital, null);
    assert.equal(row.realizedGain, null);
    assert.equal(row.potentialResult, null);
    assert.equal(row.received, 10);
    assert.equal(row.sold, 80);
    assert.equal(row.invoiced, 80);
    assert.equal(result.summary.investedCapital, null);
    assert.equal(result.summary.received, 10);
  });

  it("pedido sem cliente oficial entra em Cliente não identificado", () => {
    const result = aggregateInvestedCapitalRecoveryByCustomer([
      snap({
        salesOrderId: "sem-id",
        customerId: "  ",
        customerName: "Nome solto",
        invoicedValue: 25,
        investedCapital: 10,
        industrialCost: 8,
        totalTaxes: 2,
      }),
    ]);
    assert.equal(result.customers.length, 1);
    assert.equal(result.customers[0]?.unidentified, true);
    assert.equal(result.customers[0]?.customerName, INVESTED_CAPITAL_RECOVERY_UNIDENTIFIED_CUSTOMER_NAME);
    assert.equal(result.customers[0]?.invoiced, 25);
  });

  it("várias NF e vários recebíveis não multiplicam venda, faturado nem capital", () => {
    const row = snap({
      salesOrderId: "nf",
      saleValue: 200,
      invoicedValue: 150,
      investedCapital: 100,
      realReceivables: [received(40, 1), received(30, 2)],
    });
    assert.equal(row.saleValue, 200);
    assert.equal(row.invoicedValue, 150);
    assert.equal(row.investedCapital, 100);
    assert.equal(row.actualReceived, 70);
    const result = aggregateInvestedCapitalRecoveryByCustomer([row]);
    assert.equal(result.summary.sold, 200);
    assert.equal(result.summary.invoiced, 150);
    assert.equal(result.summary.investedCapital, 100);
    assert.equal(result.summary.received, 70);
  });

  it("soma dos clientes reconcilia com o resumo da mesma população", () => {
    const result = aggregateInvestedCapitalRecoveryByCustomer([
      snap({
        salesOrderId: "p1",
        customerId: "a",
        customerName: "A",
        saleValue: 160,
        invoicedValue: 150,
        investedCapital: 100,
        industrialCost: 70,
        totalTaxes: 30,
        realReceivables: [received(150, 1)],
      }),
      snap({
        salesOrderId: "p2",
        customerId: "a",
        customerName: "A",
        saleValue: 80,
        invoicedValue: 20,
        investedCapital: 100,
        industrialCost: 90,
        totalTaxes: 10,
        realReceivables: [received(20, 2)],
      }),
      snap({
        salesOrderId: "p3",
        customerId: "b",
        customerName: "B",
        saleValue: 40,
        invoicedValue: 0,
        investedCapital: 50,
        industrialCost: 40,
        totalTaxes: 10,
        realReceivables: [],
      }),
      snap({
        salesOrderId: "p4",
        customerId: null,
        customerName: null,
        saleValue: 15,
        invoicedValue: 15,
        investedCapital: null,
        industrialCost: null,
        totalTaxes: null,
        realReceivables: [received(5, 9)],
      }),
    ]);
    const summed = sumInvestedCapitalRecoveryCustomerMoney(result.customers);
    const summary = result.summary;
    assert.equal(summed.sold, summary.sold);
    assert.equal(summed.invoiced, summary.invoiced);
    assert.equal(summed.industrialCost, summary.industrialCost);
    assert.equal(summed.taxes, summary.taxes);
    assert.equal(summed.investedCapital, summary.investedCapital);
    assert.equal(summed.received, summary.received);
    assert.equal(summed.recoveredCapital, summary.recoveredCapital);
    assert.equal(summed.capitalAtRisk, summary.capitalAtRisk);
    assert.equal(summed.realizedGain, summary.realizedGain);
    assert.equal(summed.potentialResult, summary.potentialResult);
    assert.equal(summary.investedCapital, 250);
    assert.equal(summary.received, 175);
    assert.equal(summary.recoveredCapital, 120);
    assert.equal(summary.capitalAtRisk, 130);
    assert.equal(summary.realizedGain, 50);
  });

  it("a visão por cliente reutiliza a população já filtrada e não cria outro motor", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts"),
      "utf8"
    );
    const aggregator = readFileSync(
      join(process.cwd(), "src/lib/finance/salesOrderInvestedCapitalRecoveryByCustomer.ts"),
      "utf8"
    );
    const listWhere = readFileSync(join(process.cwd(), "src/lib/salesOrdersListSummary.ts"), "utf8");
    assert.match(service, /excludeEconomicGroupCustomers:\s*true/);
    assert.match(service, /aggregateInvestedCapitalRecoveryByCustomer\(rows\)/);
    assert.match(listWhere, /status:\s*\{\s*not:\s*"CANCELLED"\s*\}/);
    assert.doesNotMatch(aggregator, /prisma|loadFinanceAr|loadSalesOrder/);
  });

  it("a aba Por Cliente fica na mesma página, com os mesmos filtros e o mesmo endpoint", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"),
      "utf8"
    );
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeInvestedCapitalRecoveryRoutes.ts"),
      "utf8"
    );
    assert.match(page, /Visão Geral/);
    assert.match(page, /Por Cliente/);
    assert.match(page, /invested-capital-recovery-view-customer/);
    assert.match(page, /\/api\/finance\/invested-capital-recovery\?/);
    assert.match(page, /InvestedCapitalRecoveryCustomerPanel/);
    assert.match(page, /InvestedCapitalRecoveryCustomerPrintDocument/);
    assert.match(page, /Nenhum dado encontrado para os filtros selecionados/);
    const panel = readFileSync(
      join(process.cwd(), "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPanel.tsx"),
      "utf8"
    );
    assert.match(panel, /Saldo econômico atual/);
    assert.doesNotMatch(panel, /Resultado potencial/);
    assert.match(routes, /finance\.invested_capital_recovery|FINANCE_MODULE_RESOURCE_KEYS\.investedCapitalRecovery/);
    assert.equal(page.match(/\/api\/finance\/invested-capital-recovery/g)?.length, 2);
  });
});
