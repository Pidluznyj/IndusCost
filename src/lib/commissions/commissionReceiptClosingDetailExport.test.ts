import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { CommissionReceiptPreviewLine } from "./commissionReceiptEngine.js";
import {
  buildReceiptClosingBySeller,
  buildReceiptClosingExportCsv,
  buildReceiptClosingPageFromPreview,
  sumUniqueReceivedFromLines,
} from "./commissionReceiptClosingApi.js";
import { RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL } from "./commissionReceiptClosingApi.shared.js";
import {
  buildReceiptClosingDetailExportFilename,
  buildReceiptClosingDetailExportWorkbook,
  RECEIPT_CLOSING_DETAIL_EXPORT_TITLE_PREVIEW,
} from "./commissionReceiptClosingDetailExport.js";

function previewLine(
  partial: Partial<CommissionReceiptPreviewLine> & Pick<CommissionReceiptPreviewLine, "ledgerLineKey">
): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 6,
    nomusReceivableId: 100,
    receivableNumber: "CR-100",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: "2026-06-10T00:00:00.000Z",
    receivableAmount: 1000,
    receivedAmount: 1000,
    receivedSharePercent: 100,
    customerExternalId: 10,
    customerId: "cust-1",
    customerName: "Cliente",
    nomusNfeId: 200,
    nfeNumber: "123",
    orderCode: "PED-1",
    localOrderId: "order-1",
    nomusOrderItemId: 1,
    localItemId: "item-1",
    productCode: "A",
    productName: "Produto A",
    rawSellerId: 464,
    rawSellerName: "GISLENE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: "sched-1",
    ruleId: "rule-1",
    ruleName: "2%",
    ratePercent: 2,
    commissionableBaseAmount: 1000,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "MATERIALIZED_SCHEDULE",
    ...partial,
  };
}

function parseCurrencyBr(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const normalized = value
    .replace(/\s/g, "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

describe("commissionReceiptClosingDetailExport", () => {
  it("workbook contém abas Resumo e Analítico com colunas obrigatórias", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 1,
        totalReceivedAmount: 1000,
        totalCommissionableBase: 1000,
        totalExpectedCommission: 20,
        totalReleasedCommission: 20,
        totalExcludedAmount: 0,
        totalExceptionAmount: 0,
        countByStatus: { COMMISSIONABLE: 1 },
        bySeller: [],
        byCustomer: [],
        lines: [previewLine({ ledgerLineKey: "line-1" })],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    const wb = buildReceiptClosingDetailExportWorkbook(page);
    assert.ok(wb.SheetNames.includes("Resumo"));
    assert.ok(wb.SheetNames.includes("Analítico"));
    assert.ok(wb.SheetNames.includes("Por vendedor"));

    const resumo = XLSX.utils.sheet_to_json<{ Campo: string; Valor: unknown }>(wb.Sheets["Resumo"]!);
    assert.ok(
      resumo.some(
        (row) => row.Campo === "Relatório" && row.Valor === RECEIPT_CLOSING_DETAIL_EXPORT_TITLE_PREVIEW
      )
    );
    assert.ok(resumo.some((row) => row.Campo === "Ano" && row.Valor === 2026));
    assert.ok(resumo.some((row) => row.Campo === "Mês" && row.Valor === 6));
    assert.ok(
      resumo.some(
        (row) =>
          row.Campo === "Total recebido no mês" &&
          parseCurrencyBr(row.Valor) === page.cards.totalReceivedAmount
      )
    );

    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Analítico"]!);
    assert.equal(detail.length, 1);
    assert.equal(detail[0]?.CR, "CR-100");
    assert.equal(detail[0]?.["ID interno do título"], "line-1");
    assert.equal(detail[0]?.["ID externo/Nomus"], "100");
    assert.equal(detail[0]?.["Vendedor resolvido?"], "Sim");
    assert.equal(detail[0]?.["Origem do dado"], "Schedule materializado");
  });

  it("soma de Valor recebido bate com cards.totalReceivedAmount (âncoras por título)", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 2,
        totalReceivedAmount: 1500,
        totalCommissionableBase: 1500,
        totalExpectedCommission: 30,
        totalReleasedCommission: 30,
        totalExcludedAmount: 0,
        totalExceptionAmount: 0,
        countByStatus: { COMMISSIONABLE: 2, NO_SCHEDULE: 1 },
        bySeller: [],
        byCustomer: [],
        lines: [
          previewLine({ ledgerLineKey: "a", nomusReceivableId: 1, receivedAmount: 800 }),
          previewLine({
            ledgerLineKey: "b",
            nomusReceivableId: 1,
            receivedAmount: 800,
            nomusOrderItemId: 2,
            localItemId: "item-2",
          }),
          previewLine({
            ledgerLineKey: "c",
            nomusReceivableId: 2,
            receivedAmount: 700,
            receivableNumber: "CR-2",
            status: "NO_SCHEDULE",
            source: "EXCEPTION",
            commissionReceivableScheduleId: null,
          }),
        ],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    assert.equal(sumUniqueReceivedFromLines(page.lines), page.cards.totalReceivedAmount);

    const wb = buildReceiptClosingDetailExportWorkbook(page);
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Analítico"]!);
    assert.equal(detail.length, 3);

    const sumFromSheet = detail.reduce(
      (sum, row) => sum + parseCurrencyBr(row["Valor recebido"]),
      0
    );
    assert.equal(sumFromSheet, page.cards.totalReceivedAmount);
    assert.equal(page.cards.totalReceivedAmount, 1500);
  });

  it("nome de arquivo segue padrão por período e modo", () => {
    assert.equal(
      buildReceiptClosingDetailExportFilename(2026, 6, "PREVIEW"),
      "commission-receipt-closing-detalhamento-2026-06-previa.xlsx"
    );
    assert.equal(
      buildReceiptClosingDetailExportFilename(2026, 6, "CLOSED"),
      "commission-receipt-closing-detalhamento-2026-06-fechado.xlsx"
    );
  });

  it("NO_SCHEDULE com vendedor por CommissionRecord exporta vendedor correto", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 1,
        totalReceivedAmount: 1000,
        totalCommissionableBase: 0,
        totalExpectedCommission: 0,
        totalReleasedCommission: 0,
        totalExcludedAmount: 0,
        totalExceptionAmount: 1000,
        countByStatus: { NO_SCHEDULE: 1 },
        bySeller: [],
        byCustomer: [],
        lines: [
          previewLine({
            ledgerLineKey: "no-sched-record",
            status: "NO_SCHEDULE",
            statusReason: "sem schedule",
            source: "EXCEPTION",
            commissionReceivableScheduleId: null,
            releasedCommissionAmount: 0,
            expectedCommissionAmount: 0,
            canonicalSellerId: "person-rodrigo",
            canonicalSellerName: "RODRIGO SILVA",
            rawSellerId: 512,
            rawSellerName: "512",
            sellerResolutionStatus: "RESOLVED_FROM_COMMISSION_RECORD",
          }),
        ],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    const wb = buildReceiptClosingDetailExportWorkbook(page);
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Analítico"]!);
    assert.equal(detail[0]?.Status, "NO_SCHEDULE");
    assert.equal(detail[0]?.["Vendedor Raw"], "512");
    assert.equal(detail[0]?.["Vendedor Canônico"], "RODRIGO SILVA");
    assert.equal(detail[0]?.["Vendedor resolvido?"], "Sim");

    const porVendedor = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Por vendedor"]!
    );
    assert.equal(porVendedor.length, 1);
    assert.equal(porVendedor[0]?.["Vendedor canônico"], "RODRIGO SILVA");
    assert.notEqual(porVendedor[0]?.["Vendedor canônico"], RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL);
  });

  it("NO_SCHEDULE com vendedor por SalesOrder exporta vendedor resolvido", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 1,
        totalReceivedAmount: 800,
        totalCommissionableBase: 0,
        totalExpectedCommission: 0,
        totalReleasedCommission: 0,
        totalExcludedAmount: 0,
        totalExceptionAmount: 800,
        countByStatus: { NO_SCHEDULE: 1 },
        bySeller: [],
        byCustomer: [],
        lines: [
          previewLine({
            ledgerLineKey: "no-sched-order",
            status: "NO_SCHEDULE",
            source: "EXCEPTION",
            commissionReceivableScheduleId: null,
            receivedAmount: 800,
            canonicalSellerId: "person-gislene",
            canonicalSellerName: "GISLENE LIMA",
            rawSellerId: 464,
            rawSellerName: "464",
            sellerResolutionStatus: "RESOLVED_FROM_SALES_ORDER",
          }),
        ],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    const csv = buildReceiptClosingExportCsv({
      year: 2026,
      month: 6,
      closing: null,
      exportMode: "PREVIEW",
      lines: page.lines,
    });
    assert.match(csv, /NO_SCHEDULE/);
    assert.match(csv, /GISLENE LIMA/);
    assert.match(csv, /464/);
  });

  it("linha sem vendedor exporta labels técnicos e agrupa em Sem vendedor / Excluído", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 1,
        totalReceivedAmount: 500,
        totalCommissionableBase: 0,
        totalExpectedCommission: 0,
        totalReleasedCommission: 0,
        totalExcludedAmount: 0,
        totalExceptionAmount: 500,
        countByStatus: { NO_SELLER: 1 },
        bySeller: [],
        byCustomer: [],
        lines: [
          previewLine({
            ledgerLineKey: "no-seller",
            status: "NO_SELLER",
            source: "EXCEPTION",
            commissionReceivableScheduleId: null,
            canonicalSellerId: null,
            canonicalSellerName: "Sem vendedor no pedido Nomus",
            rawSellerId: null,
            rawSellerName: null,
            sellerResolutionStatus: "NO_SELLER",
          }),
        ],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });

    const wb = buildReceiptClosingDetailExportWorkbook(page);
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Analítico"]!);
    assert.equal(detail[0]?.["Vendedor Canônico"], "Sem vendedor no pedido Nomus");
    assert.equal(detail[0]?.["Vendedor resolvido?"], "Não");

    const rows = buildReceiptClosingBySeller(page.lines);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sellerName, "Sem vendedor no pedido Nomus");
  });
});
