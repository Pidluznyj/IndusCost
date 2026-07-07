import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { CommissionReceiptPreviewLine } from "./commissionReceiptEngine.js";
import {
  buildReceiptClosingPageFromPreview,
  sumUniqueReceivedFromLines,
} from "./commissionReceiptClosingApi.js";
import {
  buildReceiptClosingDetailExportFilename,
  buildReceiptClosingDetailExportWorkbook,
  RECEIPT_CLOSING_DETAIL_EXPORT_TITLE,
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
  it("workbook contém abas Resumo e Detalhamento com colunas obrigatórias", () => {
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
    assert.ok(wb.SheetNames.includes("Detalhamento"));

    const resumo = XLSX.utils.sheet_to_json<{ Campo: string; Valor: unknown }>(wb.Sheets["Resumo"]!);
    assert.ok(resumo.some((row) => row.Campo === "Relatório" && row.Valor === RECEIPT_CLOSING_DETAIL_EXPORT_TITLE));
    assert.ok(resumo.some((row) => row.Campo === "Ano" && row.Valor === 2026));
    assert.ok(resumo.some((row) => row.Campo === "Mês" && row.Valor === 6));
    assert.ok(
      resumo.some(
        (row) =>
          row.Campo === "Total recebido no mês" &&
          parseCurrencyBr(row.Valor) === page.cards.totalReceivedAmount
      )
    );

    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Detalhamento"]!);
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
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Detalhamento"]!);
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
});
