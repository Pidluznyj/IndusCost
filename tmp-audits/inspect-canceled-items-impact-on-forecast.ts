/**
 * Diagnóstico — forecast não deve incluir itens cancelados/stale.
 * Uso: npx tsx tmp-audits/inspect-canceled-items-impact-on-forecast.ts
 */
import "dotenv/config";
import {
  buildOrderPaymentPlan,
  buildOrderToCashAuditRows,
} from "../src/lib/sales/orderToCashAuditBuilder.js";
import { isSalesOrderItemActiveForReceivableForecast } from "../src/lib/sales/nomusSalesOrderItemStatus.js";
import { buildOrderCashForecastLine } from "../src/lib/finance/portfolioCashForecastMaturity.js";

async function main() {
  console.log("=== inspect-canceled-items-impact-on-forecast ===\n");

  console.log(
    "gate cancelado ativo?",
    isSalesOrderItemActiveForReceivableForecast({ nomusIsCanceled: true })
  );

  const built = buildOrderToCashAuditRows({
    orders: [
      {
        id: "o1",
        orderCode: "PD 02207",
        totalNetValue: 197_030,
        issueDate: new Date("2026-01-10"),
        paymentTerms: "30 DDL",
        nomusRawResponse: { parcelas: [{ dias: 30, percentual: 100 }] },
      },
    ],
    orderItems: [
      {
        id: "a",
        salesOrderId: "o1",
        quantity: 8000,
        unitPrice: 4.92,
        totalNetValue: 39360,
        nomusIsCanceled: false,
      },
      {
        id: "b",
        salesOrderId: "o1",
        quantity: 6500,
        unitPrice: 4.93,
        totalNetValue: 32045,
        nomusIsCanceled: false,
      },
      {
        id: "c",
        salesOrderId: "o1",
        quantity: 16500,
        unitPrice: 4.93,
        totalNetValue: 81345,
        nomusIsCanceled: true,
        itemStatus: "CANCELADO",
      },
      {
        id: "d",
        salesOrderId: "o1",
        quantity: 9000,
        unitPrice: 4.92,
        totalNetValue: 44280,
        nomusIsCanceled: true,
        itemStatus: "CANCELADO",
      },
    ],
    options: { today: new Date("2026-07-11") },
  });

  const canceled = built.rows.filter((r) => r.lineType === "ORDER_ITEM_CANCELED");
  const pending = built.rows.filter((r) => r.lineType === "ORDER_ITEM_PENDING");
  console.log("canceled lines:", canceled.length);
  console.log(
    "canceled plannedReceivable all null?",
    canceled.every((r) => r.plannedReceivableValue == null)
  );
  console.log(
    "pending plannedReceivable (active base):",
    pending.map((r) => r.plannedReceivableValue)
  );

  const planHeader = buildOrderPaymentPlan({
    id: "o1",
    orderCode: "PD 02207",
    totalNetValue: 197_030,
    issueDate: new Date("2026-01-10"),
    paymentTerms: "30 DDL",
  });
  const planActive = buildOrderPaymentPlan(
    {
      id: "o1",
      orderCode: "PD 02207",
      totalNetValue: 197_030,
      issueDate: new Date("2026-01-10"),
      paymentTerms: "30 DDL",
    },
    { plannedBaseValue: 71_405 }
  );
  console.log("plan header value:", planHeader.plannedReceivableValue);
  console.log("plan active value:", planActive.plannedReceivableValue);

  const line = buildOrderCashForecastLine({
    orderCode: "PD 02207",
    orderValue: 197_030,
    activeOrderValue: 71_405,
    receivedValue: 0,
    openReceivableValue: 0,
    hasNfe: false,
    hasStockDocument: false,
    expectedDeliveryDate: "2026-08-01",
    orderIssueDate: "2026-01-10",
    asOfDate: "2026-07-11",
  });
  console.log("cash forecast line:", {
    sourceType: line.sourceType,
    forecastValue: line.forecastValue,
  });
  console.log("\nEsperado: forecastValue=71405 (ativo), não 197030.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
