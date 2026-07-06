#!/usr/bin/env npx tsx
/**
 * Fechamento mensal de comissão por recebimento (ledger persistido).
 *
 * Uso:
 *   npx tsx scripts/apply-commission-receipt-closing.ts --year=2026 --month=6 --preview
 *   npx tsx scripts/apply-commission-receipt-closing.ts --year=2026 --month=6 --apply --confirm="FECHAR COMISSAO"
 *   npx tsx scripts/apply-commission-receipt-closing.ts --year=2026 --month=6 --reprocess-preview
 *   npx tsx scripts/apply-commission-receipt-closing.ts --year=2026 --month=6 --reprocess-apply --reason="Correção de vínculos" --confirm="REPROCESSAR COMISSAO"
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.ts";
import {
  RECEIPT_CLOSING_CONFIRM_APPLY,
  RECEIPT_CLOSING_CONFIRM_REPROCESS,
  receiptClosingLedgerCsvHeader,
  receiptClosingLedgerLineToCsvRow,
  validateReceiptClosingConfirmPhrase,
} from "../src/lib/commissions/commissionReceiptClosing.ts";
import {
  applyCommissionReceiptClosing,
  cancelCommissionReceiptClosing,
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  previewCommissionReceiptClosing,
  reprocessCommissionReceiptClosingApply,
  reprocessCommissionReceiptClosingPreview,
} from "../src/lib/commissions/commissionReceiptClosing.server.ts";
import {
  receiptPreviewCsvHeader,
  receiptPreviewLineToCsvRow,
} from "../src/lib/commissions/commissionReceiptEngine.ts";
import { csvLine, fmtBrl, hasFlag, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();

  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? String(new Date().getMonth() + 1), 10);
  const seller = parseArg("seller");
  const customer = parseArg("customer");
  const notes = parseArg("notes");
  const reason = parseArg("reason");
  const confirm = parseArg("confirm");
  const userId = parseArg("user") ?? parseArg("userId") ?? "cli-script";
  const asJson = hasFlag("json");
  const asCsv = hasFlag("csv");

  const filters = { year, month, seller, customer, includeExcluded: true, includeExceptions: true };
  const outputPath = `commission-receipt-closing-${year}-${String(month).padStart(2, "0")}`;

  const isApply = hasFlag("apply");
  const isPreview = hasFlag("preview") || (!isApply && !hasFlag("reprocess-preview") && !hasFlag("reprocess-apply"));
  const isReprocessPreview = hasFlag("reprocess-preview");
  const isReprocessApply = hasFlag("reprocess-apply");

  if ([isApply, isReprocessApply].filter(Boolean).length > 1) {
    throw new Error("Use apenas um modo de gravação: --apply ou --reprocess-apply.");
  }

  if (isReprocessPreview || isReprocessApply) {
    if (isReprocessApply) {
      validateReceiptClosingConfirmPhrase(confirm, RECEIPT_CLOSING_CONFIRM_REPROCESS);
      if (!reason?.trim()) {
        throw new Error("Reprocessamento exige --reason.");
      }
      const result = await reprocessCommissionReceiptClosingApply(prisma, {
        ...filters,
        userId,
        reason: reason.trim(),
      });
      const payload = { mode: "reprocess-apply", result };
      if (asJson) {
        writeFileSync(`${outputPath}-reprocess-apply.json`, JSON.stringify(payload, null, 2), "utf8");
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log("=== Reprocessamento aplicado ===");
      console.log(`Fechamento anterior: ${result.supersededClosingId}`);
      console.log(`Novo fechamento: ${result.closingId}`);
      console.log(`Linhas: ${result.lineCount}`);
      console.log(`Comissão liberada: ${fmtBrl(result.summary.totalReleasedCommission)}`);
      return;
    }

    const reprocess = await reprocessCommissionReceiptClosingPreview(filters);
    const payload = { mode: "reprocess-preview", reprocess };
    if (asJson) {
      writeFileSync(`${outputPath}-reprocess-preview.json`, JSON.stringify(payload, null, 2), "utf8");
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log("=== Reprocessamento — prévia antes/depois ===");
    console.log(`Fechamento atual: ${reprocess.existingClosing.closingId}`);
    console.log(`Hash antes: ${reprocess.before.calculationHash}`);
    console.log(`Hash depois: ${reprocess.afterTotals.calculationHash}`);
    console.log(`Δ recebido: ${fmtBrl(reprocess.diff.receivedAmountDiff)}`);
    console.log(`Δ comissão liberada: ${fmtBrl(reprocess.diff.releasedCommissionDiff)}`);
    console.log(`Δ linhas: ${reprocess.diff.lineCountDiff}`);
    return;
  }

  if (isApply) {
    validateReceiptClosingConfirmPhrase(confirm, RECEIPT_CLOSING_CONFIRM_APPLY);
    const result = await applyCommissionReceiptClosing(prisma, {
      ...filters,
      userId,
      notes,
    });
    const payload = { mode: "apply", result };
    if (asJson) {
      writeFileSync(`${outputPath}-apply.json`, JSON.stringify(payload, null, 2), "utf8");
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log("=== Fechamento aplicado ===");
    console.log(`ID: ${result.closingId}`);
    console.log(`Hash: ${result.calculationHash}`);
    console.log(`Linhas: ${result.lineCount}`);
    console.log(`Comissão liberada: ${fmtBrl(result.summary.totalReleasedCommission)}`);
    return;
  }

  const payload = await previewCommissionReceiptClosing(filters);
  const closed = await findClosedReceiptClosing(prisma, year, month);
  const ledgerLines = closed
    ? await loadReceiptClosingLedgerLines(prisma, closed.closingId)
    : [];

  if (asCsv && closed) {
    const rows = [
      receiptClosingLedgerCsvHeader(),
      ...ledgerLines.map(receiptClosingLedgerLineToCsvRow),
    ];
    const content = rows.map((row) => csvLine(row)).join("\n");
    writeFileSync(`${outputPath}-ledger.csv`, content, "utf8");
    console.log(content);
    return;
  }

  if (asCsv) {
    const rows = [
      receiptPreviewCsvHeader(),
      ...payload.preview.lines.map(receiptPreviewLineToCsvRow),
    ];
    const content = rows.map((row) => csvLine(row)).join("\n");
    writeFileSync(`${outputPath}-preview.csv`, content, "utf8");
    console.log(content);
    return;
  }

  if (asJson) {
    const jsonPayload = {
      mode: "preview",
      ...payload,
      persistedClosing: closed,
      persistedLineCount: ledgerLines.length,
    };
    writeFileSync(`${outputPath}-preview.json`, JSON.stringify(jsonPayload, null, 2), "utf8");
    console.log(JSON.stringify(jsonPayload, null, 2));
    return;
  }

  console.log("=== Prévia de fechamento por recebimento ===");
  console.log(`Período: ${month}/${year}`);
  if (payload.existingClosing) {
    console.log(`Fechamento CLOSED existente: ${payload.existingClosing.closingId}`);
    console.log(`Pode aplicar: não — use --reprocess-preview / --reprocess-apply`);
  } else {
    console.log("Fechamento CLOSED existente: nenhum");
    console.log("Pode aplicar: sim (com --apply --confirm)");
  }
  console.log();
  console.log(`Títulos: ${payload.preview.totalReceivables}`);
  console.log(`Recebido: ${fmtBrl(payload.preview.totalReceivedAmount)}`);
  console.log(`Comissão liberada: ${fmtBrl(payload.preview.totalReleasedCommission)}`);

  const cancelId = parseArg("cancel-closing-id");
  if (cancelId && reason?.trim()) {
    const cancelled = await cancelCommissionReceiptClosing(prisma, {
      closingId: cancelId,
      userId,
      reason: reason.trim(),
    });
    console.log(`\nFechamento cancelado: ${cancelled.closingId} → ${cancelled.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
