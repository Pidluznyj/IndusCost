import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeBillingHorizonBucketTotals,
  filterBillingHorizonOrdersByBucket,
  resolveBillingHorizonOperationNature,
} from "./financeBillingHorizonDrilldown.js";
import type { FinanceBillingHorizonOrderRow } from "./financeBillingHorizonDrilldownTypes.js";
import { buildFinanceBillingHorizonDrilldownQuery } from "./financeBillingHorizonDrilldownTypes.js";
import { buildFinanceBillingHorizonSummary } from "./financeHorizonAggregation.js";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

const REF = new Date(2026, 5, 9);

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function orderRow(
  partial: Partial<FinanceBillingHorizonOrderRow> & Pick<FinanceBillingHorizonOrderRow, "orderId">
): FinanceBillingHorizonOrderRow {
  return {
    orderCode: "PV-001",
    customerName: "Cliente A",
    customerDocument: "11.444.777/0001-61",
    nfeNumber: null,
    nfeSerie: null,
    expectedDeliveryDate: addDays(REF, 3).toISOString(),
    totalNetValue: 100,
    status: "SENT_TO_NOMUS",
    statusLabel: "Enviado ao Nomus",
    operationNature: "Venda mercado externo",
    ...partial,
  };
}

describe("financeBillingHorizonDrilldown", () => {
  it("filtra pedidos por faixa usando expectedDeliveryDate", () => {
    const rows = [
      orderRow({ orderId: "1", expectedDeliveryDate: addDays(REF, 3).toISOString(), totalNetValue: 100 }),
      orderRow({ orderId: "2", expectedDeliveryDate: addDays(REF, 10).toISOString(), totalNetValue: 200 }),
      orderRow({ orderId: "3", expectedDeliveryDate: addDays(REF, 50).toISOString(), totalNetValue: 300 }),
    ];

    const bucket0_7 = filterBillingHorizonOrdersByBucket(rows, "0_7", REF);
    assert.equal(bucket0_7.length, 1);
    assert.equal(bucket0_7[0]!.orderId, "1");

    const bucket8_15 = filterBillingHorizonOrdersByBucket(rows, "8_15", REF);
    assert.equal(bucket8_15.length, 1);
    assert.equal(bucket8_15[0]!.orderId, "2");

    const total60 = filterBillingHorizonOrdersByBucket(rows, "total_60", REF);
    assert.equal(total60.length, 3);
  });

  it("totais do bucket batem com soma dos pedidos", () => {
    const rows = [
      orderRow({ orderId: "1", totalNetValue: 150.25 }),
      orderRow({ orderId: "2", totalNetValue: 49.75 }),
    ];
    const totals = computeBillingHorizonBucketTotals(rows);
    assert.equal(totals.ordersCount, 2);
    assert.equal(totals.amount, 200);
  });

  it("totais do drilldown batem com buildFinanceBillingHorizonSummary", () => {
    const orders = [
      { totalNetValue: 100, expectedDeliveryDate: addDays(REF, 2) },
      { totalNetValue: 250, expectedDeliveryDate: addDays(REF, 12) },
    ];
    const summary = buildFinanceBillingHorizonSummary(orders, REF);
    const rows = orders.map((order, index) =>
      orderRow({
        orderId: String(index + 1),
        expectedDeliveryDate:
          order.expectedDeliveryDate instanceof Date
            ? order.expectedDeliveryDate.toISOString()
            : String(order.expectedDeliveryDate),
        totalNetValue: order.totalNetValue,
      })
    );
    const bucketRows = filterBillingHorizonOrdersByBucket(rows, "0_7", REF);
    const totals = computeBillingHorizonBucketTotals(bucketRows);
    const card = summary.buckets.find((b) => b.key === "0_7");
    assert.ok(card);
    assert.equal(totals.ordersCount, card!.count);
    assert.equal(totals.amount, card!.amount);
  });

  it("resolve natureza da operação com fallback seguro", () => {
    assert.equal(
      resolveBillingHorizonOperationNature({
        nfeNature: " Venda ",
        notes: "Nota interna",
        deliveryLocation: null,
      }),
      "Venda"
    );
    assert.equal(
      resolveBillingHorizonOperationNature({
        nfeNature: null,
        notes: " Entrega SP ",
        deliveryLocation: null,
      }),
      "Entrega SP"
    );
    assert.equal(
      resolveBillingHorizonOperationNature({
        nfeNature: null,
        notes: null,
        deliveryLocation: null,
      }),
      null
    );
  });

  it("monta query de drilldown com bucket e filtros", () => {
    const qs = buildFinanceBillingHorizonDrilldownQuery(
      { customerCnpj: "11444777", documentNumber: "PV-10" },
      { horizonBucket: "8_15", page: 2, limit: 25 }
    );
    assert.match(qs, /horizonBucket=8_15/);
    assert.match(qs, /customerCnpj=11444777/);
    assert.match(qs, /documentNumber=PV-10/);
    assert.match(qs, /page=2/);
  });
});

describe("FinanceBillingHorizonDrilldownSection — UI", () => {
  it("cards clicáveis abrem grid abaixo com limpar seleção", () => {
    const source = read("src/components/finance/billing/FinanceBillingHorizonDrilldownSection.tsx");
    assert.match(source, /aria-pressed/);
    assert.match(source, /Pedidos da faixa:/);
    assert.match(source, /Limpar seleção/);
    assert.match(source, /setSelectedKey\(\(current\) => \(current === key \? null : key\)\)/);
    assert.match(source, /\/api\/finance\/billing\/horizon\/orders/);
    assert.match(source, /bucketTotals/);
  });

  it("grid usa pedidos de faturamento e não coluna Centro de custo", () => {
    const source = read("src/components/finance/billing/FinanceBillingHorizonDrilldownSection.tsx");
    assert.match(source, /Cliente \/ Destinatário/);
    assert.match(source, /Descrição \/ Natureza/);
    assert.match(source, /Prev\. entrega/);
    assert.match(source, /orderId/);
    assert.doesNotMatch(source, /Centro de custo/i);
    assert.doesNotMatch(source, /FinanceApTitlesPayload|FinanceArTitlesPayload/);
    assert.doesNotMatch(source, /accounts-payable|accounts-receivable/);
  });

  it("FinanceBillingPage integra drilldown do horizonte", () => {
    assert.match(read("src/components/finance/FinanceBillingPage.tsx"), /enableDrilldown/);
    assert.match(read("src/components/finance/FinanceBillingPage.tsx"), /horizonDrilldownFilters/);
    assert.match(read("src/components/finance/shared/FinanceHorizonSection.tsx"), /FinanceBillingHorizonDrilldownSection/);
  });
});
