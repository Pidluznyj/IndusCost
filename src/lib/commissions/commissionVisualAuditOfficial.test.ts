import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildReceiptClosingPageFromPreview,
  buildReceiptClosingReconciliationFromApiLines,
  mapPreviewLineToApiLine,
} from "./commissionReceiptClosingApi.js";
import type { CommissionReceiptPreviewLine } from "./commissionReceiptEngine.js";
import {
  buildVisualAuditClosingRows,
  countVisualAuditCriticalDivergenceReceivables,
  filterVisualAuditClosingRows,
  mapClosingMaterializationToVisualAuditCards,
  mapReceiptClosingLineToVisualAuditRow,
  resolveVisualAuditOfficialCategory,
} from "./commissionVisualAuditOfficial.js";

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

describe("commissionVisualAuditOfficial", () => {
  it("auditoria PAYABLE usa settlementDate e mesmo payload do fechamento", () => {
    const preview = {
      year: 2026,
      month: 6,
      totalReceivables: 2,
      totalReceivedAmount: 2000,
      totalCommissionableBase: 1000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      lines: [
        previewLine({ ledgerLineKey: "ok-1", nomusReceivableId: 100 }),
        previewLine({
          ledgerLineKey: "unresolved-2",
          nomusReceivableId: 101,
          status: "SELLER_UNRESOLVED",
          statusReason: "Vendedor não resolvido",
          canonicalSellerId: null,
          releasedCommissionAmount: 0,
        }),
      ],
    };
    const closingPage = buildReceiptClosingPageFromPreview({
      preview,
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    const auditRows = buildVisualAuditClosingRows(closingPage);
    assert.equal(auditRows.length, closingPage.lines.length + closingPage.groupCompanyAuditLines.length);
    assert.equal(auditRows[0]!.settlementDate, "2026-06-15T00:00:00.000Z");
    assert.equal(
      closingPage.materializationSummary.totalReceivablesCount,
      closingPage.materializationSummary.totalReceivablesCount
    );
  });

  it("contagem de divergências críticas bate com reconciliação do fechamento", () => {
    const lines = [
      previewLine({ ledgerLineKey: "ok", nomusReceivableId: 1 }),
      previewLine({
        ledgerLineKey: "div-1",
        nomusReceivableId: 2,
        status: "SELLER_UNRESOLVED",
        canonicalSellerId: null,
      }),
      previewLine({
        ledgerLineKey: "div-2",
        nomusReceivableId: 3,
        status: "NO_SCHEDULE",
        commissionReceivableScheduleId: null,
      }),
    ];
    const apiLines = lines.map(mapPreviewLineToApiLine);
    const reconciliation = buildReceiptClosingReconciliationFromApiLines({
      lines: apiLines,
      nomusBase: null,
      nomusCommission: null,
    });
    const auditRows = apiLines.map(mapReceiptClosingLineToVisualAuditRow);
    assert.equal(
      countVisualAuditCriticalDivergenceReceivables(auditRows),
      reconciliation.divergentReceivableCount
    );
    assert.equal(reconciliation.divergentReceivableCount, 2);
  });

  it("filtro Divergentes lista títulos com status crítico, inclusive vendedor não resolvido", () => {
    const rows = [
      mapReceiptClosingLineToVisualAuditRow(
        mapPreviewLineToApiLine(
          previewLine({ ledgerLineKey: "ok", nomusReceivableId: 10, status: "COMMISSIONABLE" })
        )
      ),
      mapReceiptClosingLineToVisualAuditRow(
        mapPreviewLineToApiLine(
          previewLine({
            ledgerLineKey: "unresolved",
            nomusReceivableId: 11,
            status: "SELLER_UNRESOLVED",
          })
        )
      ),
    ];
    const filtered = filterVisualAuditClosingRows(rows, { auditCategory: "DIVERGENT" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.nomusReceivableId, 11);
    assert.equal(filtered[0]!.isCriticalDivergence, true);
  });

  it("cliente excluído e empresa do grupo seguem categorias do fechamento", () => {
    assert.equal(
      resolveVisualAuditOfficialCategory(
        mapPreviewLineToApiLine(
          previewLine({ ledgerLineKey: "cust", status: "CUSTOMER_EXCLUDED" })
        )
      ),
      "CUSTOMER_EXCLUDED"
    );
    assert.equal(
      resolveVisualAuditOfficialCategory(
        mapPreviewLineToApiLine(
          previewLine({ ledgerLineKey: "group", status: "GROUP_COMPANY_EXCLUDED" })
        )
      ),
      "GROUP_COMPANY_EXCLUDED"
    );
  });

  it("cards da auditoria usam totais oficiais do fechamento", () => {
    const closingPage = buildReceiptClosingPageFromPreview({
      preview: {
        year: 2026,
        month: 6,
        totalReceivables: 1,
        totalReceivedAmount: 1000,
        totalCommissionableBase: 1000,
        totalExpectedCommission: 20,
        totalReleasedCommission: 20,
        lines: [previewLine({ ledgerLineKey: "ok" })],
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    const cards = mapClosingMaterializationToVisualAuditCards(
      closingPage.materializationSummary,
      closingPage.cards,
      closingPage.reconciliation
    );
    assert.equal(cards.receivableCount, closingPage.materializationSummary.totalReceivablesCount);
    assert.equal(cards.divergenceCount, closingPage.reconciliation.divergentReceivableCount);
    assert.equal(cards.receivedAmountTotal, closingPage.cards.totalReceivedAmount);
  });

  it("server PAYABLE delega ao universo do fechamento, não ao visual audit legado", () => {
    const server = readFileSync(join(import.meta.dirname, "commissionVisualAudit.server.ts"), "utf8");
    assert.match(server, /loadVisualAuditClosingUniverse/);
    assert.match(server, /listCommissionVisualAuditClosingPage/);
    assert.match(server, /seller: null/);
    assert.doesNotMatch(server, /listPayableVisualAuditRows\(query/);
  });

  it("auditoria não recalcula comissão no frontend", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../../components/commissions/pages/CommissionsVisualAuditPage.tsx"),
      "utf8"
    );
    assert.match(page, /Resumo oficial/);
    assert.doesNotMatch(page, /commissionExpected\s*\*/);
    assert.doesNotMatch(page, /ratePercent\s*\*/);
  });
});
