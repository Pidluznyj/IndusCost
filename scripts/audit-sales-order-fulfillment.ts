import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildManagementRowsFromOrders,
  parseSalesOrderManagementFilters,
} from "../src/lib/salesOrderManagement.ts";
import {
  buildFulfillmentCharts,
  buildFulfillmentKpis,
} from "../src/lib/salesOrderManagementFulfillment.ts";
import { buildSalesOrderLinkedNfeContext } from "../src/lib/salesOrderLinkedNfe.ts";
import { loadSalesOrderLinkedNfeContextMap } from "../src/lib/salesOrderLinkedNfe.ts";

const REF = new Date();

function linkedContext(input: {
  links: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber?: string;
    dataProcessamento: Date;
    value: number;
  }>;
  totalNetValue: number;
  expectedDeliveryDate: Date;
}) {
  return buildSalesOrderLinkedNfeContext({
    links: input.links.map((link) => ({
      id: link.id,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber ?? String(link.nfeExternalId),
      nfeKey: null,
      nfeStatus: 100,
      tipoOperacao: 1,
      dataProcessamento: link.dataProcessamento,
      presentInLastPayload: true,
      nomusNfeId: `nomus-${link.nfeExternalId}`,
      rawPayload: { valor: link.value },
    })),
    nomusNfesByExternalId: new Map(
      input.links.map((link) => [
        link.nfeExternalId,
        {
          id: `nomus-${link.nfeExternalId}`,
          externalId: link.nfeExternalId,
          numero: link.nfeNumber ?? String(link.nfeExternalId),
          chave: null,
          status: 100,
          tipoOperacao: 1,
          dataProcessamento: link.dataProcessamento,
          xmlDhEmi: null,
          valorLiquido: link.value,
          xmlVNF: link.value,
        },
      ])
    ),
    totalNetValue: input.totalNetValue,
    issueDate: new Date(2026, 0, 10),
    expectedDeliveryDate: input.expectedDeliveryDate,
    referenceDate: REF,
  });
}

function sampleOrder(id: string, code: string, total: number, due: Date, ctx: ReturnType<typeof linkedContext> | null) {
  const map = new Map<string, ReturnType<typeof linkedContext>>();
  if (ctx) map.set(id, ctx);
  const filters = parseSalesOrderManagementFilters({ year: "2026" });
  const { rows, fulfillmentKpis } = buildManagementRowsFromOrders(
    [
      {
        id,
        orderCode: code,
        status: "SENT_TO_NOMUS",
        issueDate: new Date(2026, 0, 10),
        expectedDeliveryDate: due,
        totalNetValue: total,
        responsible: "Vendedor A",
        nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 1 }] },
        companyIssuer: "Empresa",
        Customer: { companyName: "Cliente X", tradeName: null, taxId: null },
        items: [{ id: "i1", externalProductId: 1, skuSnapshot: "SKU", productNameSnapshot: "Prod", quantity: 1 }],
      },
    ],
    filters,
    REF,
    map
  );
  return { rows, fulfillmentKpis };
}

async function main(): Promise<void> {
  const yearArg = process.argv.find((a) => a.startsWith("--year="));
  const year = yearArg ? Number(yearArg.split("=")[1]) : new Date().getFullYear();

  console.log(`=== Auditoria fulfillment — ano ${year} ===\n`);

  const orders = await prisma.salesOrder.findMany({
    where: {
      issueDate: {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      },
    },
    select: {
      id: true,
      orderCode: true,
      status: true,
      issueDate: true,
      expectedDeliveryDate: true,
      totalNetValue: true,
      responsible: true,
      nomusRawResponse: true,
      companyIssuer: true,
      Customer: { select: { companyName: true, tradeName: true, taxId: true } },
      items: {
        select: {
          id: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          quantity: true,
        },
      },
    },
  });

  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((o) => ({
      id: o.id,
      totalNetValue: o.totalNetValue,
      issueDate: o.issueDate,
      expectedDeliveryDate: o.expectedDeliveryDate,
      nomusRawResponse: o.nomusRawResponse,
    }))
  );

  const filters = parseSalesOrderManagementFilters({ year: String(year) });
  const { rows } = buildManagementRowsFromOrders(orders, filters, REF, linkedMap);
  const kpis = buildFulfillmentKpis(rows);
  const charts = buildFulfillmentCharts(rows);

  console.log("Totais por ano:");
  console.log(`  Pedidos: ${kpis.totalOrders}`);
  console.log(`  Vendido: ${kpis.totalSoldValue.toFixed(2)}`);
  console.log(`  Faturado: ${kpis.totalInvoicedValue.toFixed(2)}`);
  console.log(`  Gap: ${kpis.soldInvoicedGap.toFixed(2)}`);

  console.log("\nTotais por status logístico:");
  for (const point of charts.ordersByLogisticStatus) {
    console.log(`  ${point.label}: ${point.count}`);
  }

  console.log("\nSLA médio:", kpis.averageSlaDays?.toFixed(1) ?? "—");
  console.log("% no prazo:", kpis.onTimePercent ?? "—");
  console.log(
    "% atrasado:",
    kpis.totalOrders > 0
      ? Math.round(((kpis.deliveredLate + kpis.pendingLate) / kpis.totalOrders) * 10000) / 100
      : "—"
  );
  console.log(
    "% pendente:",
    kpis.totalOrders > 0
      ? Math.round(((kpis.pendingOnTime + kpis.pendingLate) / kpis.totalOrders) * 10000) / 100
      : "—"
  );

  console.log("\nExemplos (até 5):");
  for (const row of rows.slice(0, 5)) {
    console.log(
      `  ${row.orderCode} | ${row.logisticStatusLabel} | vendido=${row.totalNetValue} fat=${row.invoicedValue} SLA=${row.slaDays ?? "—"}`
    );
  }
}

main()
  .catch((error) => {
    console.error("[audit-sales-order-fulfillment]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
