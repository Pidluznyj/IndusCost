/**
 * Consistência relatório/exportação — margem comercial canônica.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCommercialMarginPayloads,
  commercialMarginIdentityKey,
  resolveCommercialMarginDisplayLabel,
} from "./salesOrderCommercialMarginReadModel.js";
import {
  buildSalesOrderListReportExportWorkbook,
  type SalesOrderListReportExportPayload,
} from "./salesOrderListReportExport.js";
import {
  buildSalesOrderInternalMarginExportWorkbook,
  type SalesOrderInternalMarginExportPayload,
} from "./salesOrderInternalMarginExport.js";
import * as XLSX from "xlsx";

/** Fixture equivalente ao PD 02820. */
const PD02820_COMMERCIAL = {
  commercialMarginTotalValue: 416.39,
  commercialMarginTotalPercent: 15.0,
  commercialSoldTotalValue: 2775.9,
  totalActiveSoldValue: 2775.9,
  commercialMarginCoveragePercent: 100,
  itemsCalculated: 3,
  itemsUnavailable: 0,
  itemsActive: 3,
  isComplete: true,
  warnings: [] as string[],
};

describe("reports/exports — margem comercial canônica", () => {
  it("PD 02820: tela e exportação interna compartilham identidade comercial", () => {
    const screen = PD02820_COMMERCIAL;
    const exportPayload: SalesOrderInternalMarginExportPayload = {
      generatedAt: "2024-06-15T12:00:00.000Z",
      scopeLabel: "PD 02820",
      appliedFilters: [],
      summary: {
        netRevenue: screen.commercialSoldTotalValue,
        totalCost: 1000,
        marginValue: screen.commercialMarginTotalValue,
        marginPercent: screen.commercialMarginTotalPercent,
        marginCoveragePercent: screen.commercialMarginCoveragePercent,
        markup: null,
        ordersCount: 1,
        itemsCount: 3,
        ordersWithNegativeMargin: 0,
        itemsWithoutCost: 0,
        itemsWithoutProduct: 0,
      },
      orders: [
        {
          orderCode: "PD 02820",
          customerName: "Cliente",
          sellerName: "Vendedor",
          issueDate: "15/06/2024",
          grossValue: 2922,
          discountValue: 146.1,
          discountPercent: 5,
          netRevenue: 2775.9,
          totalCost: 1000,
          marginValue: screen.commercialMarginTotalValue,
          marginPercent: screen.commercialMarginTotalPercent,
          marginCoveragePercent: 100,
          managerialMarginValue: 900,
          managerialMarginPercent: 32,
          markup: null,
          marginStatusLabel: resolveCommercialMarginDisplayLabel(screen),
          itemsWithoutCost: 0,
          itemsWithoutProduct: 0,
          itemsWithNegativeMargin: 0,
        },
      ],
      items: [],
      alerts: [],
    };

    const wb = buildSalesOrderInternalMarginExportWorkbook(exportPayload);
    const pedidos = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Pedidos!);
    const row = pedidos.find((r) => r.Pedido === "PD 02820");
    assert.ok(row);
    assert.equal(row["Valor bruto"], 2922);
    assert.equal(row["Desconto R$"], 146.1);
    assert.equal(row["Valor líquido"], 2775.9);
    assert.equal(row["Margem comercial R$"], screen.commercialMarginTotalValue);
    assert.equal(row["Margem comercial %"], screen.commercialMarginTotalPercent);
    assert.equal(row["Cobertura margem %"], 100);
    assert.equal(row["Status margem comercial"], "Margem comercial");

    assert.deepEqual(
      commercialMarginIdentityKey(screen),
      commercialMarginIdentityKey({
        commercialMarginTotalValue: Number(row["Margem comercial R$"]),
        commercialMarginTotalPercent: Number(row["Margem comercial %"]),
        commercialMarginCoveragePercent: Number(row["Cobertura margem %"]),
        isComplete: true,
        itemsCalculated: 3,
        itemsUnavailable: 0,
      })
    );
  });

  it("list report export: rótulos comerciais e agregação ponderada", () => {
    const payload: SalesOrderListReportExportPayload = {
      generatedAt: "2024-06-15T12:00:00.000Z",
      appliedFilters: [],
      summary: {
        sellerLabel: "Todos",
        periodLabel: "2024",
        ordersCount: 2,
        totalNetAmount: 3775.9,
        totalItems: 4,
        averageTicket: 1887.95,
        averageMarginPercent: 20,
        invoicedCount: 1,
        notInvoicedCount: 1,
        cashOrdersCount: 0,
        installmentOrdersCount: 2,
        noPaymentInfoCount: 0,
        withRealTitlesCount: 1,
        withForecastOnlyCount: 1,
        reportFirstDueDate: "",
        reportLastDueDate: "",
        totalTitlesAmount: 0,
      },
      rows: [
        {
          orderCode: "PD 02820",
          customerName: "A",
          sellerName: "V",
          issueDate: "15/06/2024",
          status: "READY_TO_SEND",
          statusLabel: "Pronto",
          hasInvoice: false,
          grossValue: 2922,
          discountValue: 146.1,
          discountPercent: 5,
          netValue: 2775.9,
          marginPercent: 15,
          marginValue: 416.39,
          marginCoveragePercent: 100,
          marginStatusLabel: "Margem comercial",
          itemsCount: 3,
          nfeDocument: "",
          externalSalesOrderCode: "",
          paymentConditionLabel: "—",
          paymentSourceLabel: "—",
          installmentCount: 0,
          firstDueDate: "",
          lastDueDate: "",
          scheduleText: "",
          totalTitlesAmount: "",
          financialStatusLabel: "—",
        },
      ],
      paymentOpeningRows: [],
    };

    const wb = buildSalesOrderListReportExportWorkbook(payload);
    const pedidos = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Pedidos!);
    const row = pedidos[0];
    assert.ok(row);
    assert.equal(row["Margem comercial R$"], 416.39);
    assert.equal(row["Valor bruto"], 2922);
    assert.equal(row["Desconto %"], 5);
    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Resumo!);
    assert.ok(resumo.some((r) => r.Campo === "Margem comercial ponderada %"));
  });

  it("agregação ponderada de payloads comerciais (não média simples)", () => {
    const a = {
      ...PD02820_COMMERCIAL,
      commercialMarginTotalValue: 100,
      commercialMarginTotalPercent: 10,
      commercialSoldTotalValue: 1000,
      totalActiveSoldValue: 1000,
    };
    const b = {
      ...PD02820_COMMERCIAL,
      commercialMarginTotalValue: 900,
      commercialMarginTotalPercent: 45,
      commercialSoldTotalValue: 2000,
      totalActiveSoldValue: 2000,
    };
    const agg = aggregateCommercialMarginPayloads([a, b]);
    assert.equal(agg.commercialMarginTotalPercent, 33.33);
    assert.notEqual(agg.commercialMarginTotalPercent, 27.5);
  });

  it("cobertura parcial preserva status", () => {
    const partial = {
      ...PD02820_COMMERCIAL,
      isComplete: false,
      itemsCalculated: 2,
      itemsUnavailable: 1,
      commercialMarginCoveragePercent: 66.67,
    };
    assert.equal(resolveCommercialMarginDisplayLabel(partial), "Margem comercial parcial");
  });

  it("PDF cliente não expõe margem/custo/comissão", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const doc = readFileSync(
      join(import.meta.dirname, "../components/sales/SalesOrderClientDocument.tsx"),
      "utf8"
    );
    assert.doesNotMatch(doc, /commercialMargin|marginValue|unitCost|commission/i);
  });
});
