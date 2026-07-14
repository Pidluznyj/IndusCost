/**
 * QA estático do fechamento mensal / ruleId no ledger.
 * Usage: npx tsx scripts/qaCommissionMonthlyClosingLedger.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMISSION_RULE_SNAPSHOT_WITHOUT_ACTIVE_RULE,
  RECEIPT_CLOSING_CONFIRM_APPLY,
  formatCriticalDivergenceAcceptanceNote,
  mapPreviewLineToLedgerCreateData,
  sanitizeLedgerLineRuleRefs,
} from "../src/lib/commissions/commissionReceiptClosing.ts";
import type { CommissionReceiptPreviewLine } from "../src/lib/commissions/commissionReceiptEngine.ts";

function ok(label: string) {
  console.log(`OK  ${label}`);
}
function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function sampleLine(partial: Partial<CommissionReceiptPreviewLine> = {}): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 6,
    ledgerLineKey: "qa-line",
    nomusReceivableId: 1,
    receivableNumber: "CR1",
    installmentNumber: 1,
    settlementDate: "2026-06-10T00:00:00.000Z",
    dueDate: null,
    receivableAmount: 100,
    receivedAmount: 100,
    receivedSharePercent: 100,
    customerExternalId: 1,
    customerId: null,
    customerName: "Cliente QA",
    nomusNfeId: null,
    nfeNumber: null,
    orderCode: "PED-QA",
    localOrderId: null,
    nomusOrderItemId: 1,
    localItemId: null,
    productCode: "P",
    productName: "Prod",
    rawSellerId: 1,
    rawSellerName: "V",
    canonicalSellerId: null,
    canonicalSellerName: "Vendedor",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    ratePercent: 2,
    commissionableBaseAmount: 100,
    expectedCommissionAmount: 2,
    releasedCommissionAmount: 2,
    grossCommissionAmount: 2,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "CALCULATED",
    ...partial,
  };
}

section("1–3. ruleId inválido não vai para createMany");
{
  const raw = mapPreviewLineToLedgerCreateData(
    sampleLine({
      ruleId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ruleName: "Histórica",
      status: "CUSTOMER_EXCLUDED",
      exclusionRuleId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    }),
    "closing-qa"
  );
  const sanitized = sanitizeLedgerLineRuleRefs(
    raw,
    new Set(),
    new Set(["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"])
  );
  assert.equal(sanitized.data.ruleId, null);
  assert.equal(sanitized.data.customerExclusionRuleId, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  assert.ok(sanitized.alerts.includes(COMMISSION_RULE_SNAPSHOT_WITHOUT_ACTIVE_RULE));
  ok("sanitize nullifica ruleId faltante e mantém exclusionRuleId válido");
}

section("4–6. service usa sanitização + transação + anti-duplicata");
{
  const server = read("src/lib/commissions/commissionReceiptClosing.server.ts");
  assert.match(server, /sanitizeLedgerLineRuleRefs/);
  assert.match(server, /\$transaction/);
  assert.match(server, /ReceiptClosingDuplicateError/);
  assert.match(server, /createMany/);
  ok("fechamento transacional com ruleId sanitizado");
}

section("7–8. divergência crítica");
{
  assert.equal(RECEIPT_CLOSING_CONFIRM_APPLY, "FECHAR COMISSAO");
  const api = read("src/lib/commissions/commissionApiValidation.ts");
  assert.match(api, /DIVERGENCIA CRITICA/);
  const note = formatCriticalDivergenceAcceptanceNote({
    acceptedBy: "user-1",
    divergentTitleCount: 10,
    acceptanceNote: "ok",
  });
  assert.match(note, /CRITICAL_DIVERGENCE_ACCEPTED/);
  assert.match(note, /divergentTitleCount=10/);
  const applyApi = read("src/lib/commissions/commissionReceiptClosingApi.server.ts");
  assert.match(applyApi, /formatCriticalDivergenceAcceptanceNote/);
  ok("aceite de divergência crítica gravado em notes");
}

section("9–11. consulta / PDF / XLSX");
{
  const routes = read("src/lib/commissionsRoutes.ts");
  assert.match(routes, /receipt-closing\/:year\/:month\/report/);
  assert.match(routes, /receipt-closing\/:year\/:month\/report\.xlsx/);
  assert.match(routes, /export-detail\.xlsx/);
  const page = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
  assert.match(page, /Carregar fechamento/);
  assert.match(page, /Imprimir \/ PDF/);
  assert.match(page, /CommissionClosingReportPrintDocument/);
  const printMeta = read("src/lib/commissions/commissionClosingReportPrintMeta.ts");
  assert.match(printMeta, /COMERCIAL: RELATÓRIO DE COMISSÕES/);
  ok("consulta + PDF + XLSX do fechamento");
}

section("12–13. exclusão não usa ruleId de CommissionRule + frontend sem Prisma");
{
  const engine = read("src/lib/commissions/commissionReceiptEngine.ts");
  assert.match(engine, /Gravar exclusion\.id em ruleId viola/);
  assert.doesNotMatch(
    engine,
    /ruleId:\s*input\.exclusion\.rule\.id/
  );
  const page = read("src/components/commissions/pages/CommissionsReceiptClosingPage.tsx");
  assert.doesNotMatch(page, /from ["']@prisma\/client["']/);
  ok("engine corrigido; frontend sem Prisma");
}

console.log("\n✅ qaCommissionMonthlyClosingLedger OK");
