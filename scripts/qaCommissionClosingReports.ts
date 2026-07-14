/**
 * QA do PDF/XLSX do relatório de comissão fechado.
 * Usage: npx tsx scripts/qaCommissionClosingReports.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  COMMISSION_CLOSING_REPORT_PRINT_TITLE,
} from "../src/lib/commissions/commissionClosingReportPrintMeta.ts";
import {
  buildReceiptClosingDetailExportWorkbook,
  RECEIPT_CLOSING_DETAIL_EXPORT_TITLE,
} from "../src/lib/commissions/commissionReceiptClosingDetailExport.shared.ts";
import { buildReceiptClosingPageFromLedger } from "../src/lib/commissions/commissionReceiptClosingApi.ts";

function ok(label: string) {
  console.log(`OK  ${label}`);
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

section("1–7. PDF do fechamento");
{
  const printDoc = read(
    "src/components/commissions/CommissionClosingReportPrintDocument.tsx"
  );
  const printMeta = read("src/lib/commissions/commissionClosingReportPrintMeta.ts");
  const page = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
  assert.equal(COMMISSION_CLOSING_REPORT_PRINT_TITLE, "COMERCIAL: RELATÓRIO DE COMISSÕES");
  assert.match(printMeta, /COMERCIAL: RELATÓRIO DE COMISSÕES/);
  assert.match(printDoc, /Resumo executivo/);
  assert.match(printDoc, /Por vendedor/);
  assert.match(printDoc, /Analítico/);
  assert.match(printDoc, /sales-orders-print-money/);
  assert.match(printDoc, /col-money/);
  assert.match(printDoc, /sales-order-report-print\.css/);
  assert.match(page, /Imprimir \/ PDF/);
  assert.match(page, /createPortal/);
  assert.match(page, /sales-orders-print-route/);
  assert.match(page, /requestCommissionClosingPrint|window\.print/);
  assert.match(printDoc, /id=\"sales-orders-print-root\"/);
  assert.match(printDoc, /PrintHeader/);
  assert.match(printDoc, /sales-orders-print-cover/);
  ok("PDF: título, resumo, tabelas, money no-wrap, padrão Pedidos");
}

section("8–11. XLSX Resumo / Por vendedor / Analítico");
{
  const page = buildReceiptClosingPageFromLedger({
    closing: {
      closingId: "11111111-1111-4111-8111-111111111111",
      year: 2026,
      month: 6,
      status: "CLOSED",
      calculationHash: "hash",
      totalReceivedAmount: 1000,
      totalCommissionableBase: 1000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      totalExcludedAmount: 0,
      totalExceptionAmount: 0,
      lineCount: 1,
      closedAt: "2026-07-01T12:00:00.000Z",
      closedBy: "user-qa",
      notes: "[CRITICAL_DIVERGENCE_ACCEPTED] | divergentTitleCount=10",
    },
    ledgerLines: [
      {
        id: "line-1",
        ledgerLineKey: "k1",
        nomusReceivableId: 9,
        installmentNumber: 1,
        settlementDate: "2026-06-10T00:00:00.000Z",
        customerName: "Cliente",
        orderCode: "PED-1",
        nfeNumber: "100",
        productCode: "A",
        canonicalSellerId: "s1",
        canonicalSellerName: "GISLENE LIMA",
        receivedAmount: 1000,
        allocatedCommercialBase: 1000,
        commissionRatePercent: 2,
        expectedCommissionAmount: 20,
        releasedCommissionAmount: 20,
        status: "COMMISSIONABLE",
        exceptionReason: null,
        exclusionReason: null,
        ruleNameSnapshot: "2%",
        ruleSnapshotJson: { ruleId: "r1" },
      },
    ],
  });
  assert.equal(page.mode, "CLOSED");
  const wb = buildReceiptClosingDetailExportWorkbook(page);
  assert.deepEqual(wb.SheetNames.slice(0, 3).sort(), ["Analítico", "Por vendedor", "Resumo"].sort());
  const resumo = XLSX.utils.sheet_to_json<{ Campo: string; Valor: unknown }>(wb.Sheets["Resumo"]!);
  assert.ok(
    resumo.some(
      (r) => r.Campo === "Relatório" && String(r.Valor).includes("COMISSÕES")
    ) ||
      resumo.some((r) => r.Campo === "Relatório" && r.Valor === RECEIPT_CLOSING_DETAIL_EXPORT_TITLE)
  );
  assert.ok(resumo.some((r) => r.Campo === "Status" && r.Valor === "FECHADO"));
  assert.ok(resumo.some((r) => r.Campo === "Divergências críticas aceitas" && r.Valor === "Sim"));
  assert.ok(XLSX.utils.sheet_to_json(wb.Sheets["Analítico"]!).length >= 1);
  assert.ok(XLSX.utils.sheet_to_json(wb.Sheets["Por vendedor"]!).length >= 1);
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 100);
  ok("XLSX abas + totalizadores + abre sem erro");
}

section("11. fonte ledger fechado");
{
  const routes = read("src/lib/commissionsRoutes.ts");
  assert.match(routes, /mode !== "CLOSED"/);
  assert.match(routes, /getReceiptClosingPage/);
  const exportSrv = read("src/lib/commissions/commissionReceiptClosingApi.server.ts");
  assert.match(exportSrv, /findClosedReceiptClosing|buildReceiptClosingPageFromLedger/);
  ok("report endpoints usam fechamento oficial");
}

console.log("\n✅ qaCommissionClosingReports OK");
