#!/usr/bin/env npx tsx
/**
 * CLI de reprocessamento de comissões (preview/apply).
 * Usa o mesmo serviço server-side das rotas /api/commissions/reprocess/*.
 * Motor oficial: materializeCommissionForSalesOrder + rebuildCommissionReceivableSchedule.
 *
 * Uso:
 *   npx tsx scripts/reprocessCommissions.ts --preview --from=2026-01-01 --to=2026-06-30
 *   npx tsx scripts/reprocessCommissions.ts --preview --sellerExternalId=42 --productCode=SKU-1
 *   npx tsx scripts/reprocessCommissions.ts --apply --runToken=<id> --reason="Correção de regra X" --userId=<id> [--role=ADMIN]
 *
 * Flags de filtro (todas opcionais, iguais ao painel/API):
 *   --from=YYYY-MM-DD --to=YYYY-MM-DD --dateAxis=issue|nfe|settlement
 *   --customerExternalId=<n> --sellerExternalId=<n> --salesOrderCode=<code>
 *   --productCode=<code> --priceTableId=<id>
 *   --statuses=forecast,confirmed,released,paid
 *   --includeConfirmedNotPaid --includeReleasedNotPaid --includePaid
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  applyCommissionReprocess,
  previewCommissionReprocess,
  CommissionReprocessError,
  MAX_ORDERS,
} from "../src/lib/commissions/commissionReprocess.server.ts";
import type {
  CommissionReprocessFilters,
  CommissionReprocessSummary,
} from "../src/lib/commissions/commissionReprocess.ts";
import { fmtBrl } from "./commission-script-utils.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-audit-args.ts";

function parseNumberArg(name: string): number | null {
  const raw = parseArg(name);
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Valor inválido em --${name}: ${raw}`);
  return n;
}

function parseStatusesArg(): CommissionReprocessFilters["statuses"] | undefined {
  const raw = parseArg("statuses");
  if (!raw) return undefined;
  const allowed = new Set(["forecast", "confirmed", "released", "paid"]);
  const statuses = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is CommissionReprocessFilters["statuses"][number] => allowed.has(s));
  return statuses.length > 0 ? (statuses as CommissionReprocessFilters["statuses"]) : undefined;
}

function buildFiltersFromArgs(): Partial<CommissionReprocessFilters> & Record<string, unknown> {
  const dateAxisRaw = parseArg("dateAxis");
  return {
    from: parseArg("from") ?? null,
    to: parseArg("to") ?? null,
    dateAxis:
      dateAxisRaw === "nfe" || dateAxisRaw === "settlement" ? dateAxisRaw : "issue",
    customerExternalId: parseNumberArg("customerExternalId"),
    sellerExternalId: parseNumberArg("sellerExternalId"),
    salesOrderCode: parseArg("salesOrderCode") ?? null,
    productCode: parseArg("productCode") ?? null,
    priceTableId: parseArg("priceTableId") ?? null,
    statuses: parseStatusesArg() ?? ["forecast", "confirmed", "released", "paid"],
    includeConfirmedNotPaid: hasFlag("includeConfirmedNotPaid") ? true : true,
    includeReleasedNotPaid: hasFlag("includeReleasedNotPaid"),
    includePaid: hasFlag("includePaid"),
  };
}

/** Contagem: 0 é válido, ausente/NaN não — nunca imprimir undefined. */
function fmtCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "indisponível";
}

/** Dinheiro: só formata número finito; ausência é declarada, não vira R$ 0,00. */
function fmtMoney(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? fmtBrl(value)
    : "indisponível";
}

function printSummary(summary: CommissionReprocessSummary): void {
  console.log("\n--- Resumo ---");
  console.log(
    `Pedidos avaliados: ${fmtCount(summary.analyzedCount)} (limite ${MAX_ORDERS})`
  );
  console.log(`Pedidos alterados: ${fmtCount(summary.changedCount)}`);
  console.log(
    `Pedidos bloqueados (pagos/fechados): ${fmtCount(summary.blockedCount)}`
  );
  console.log(`Pedidos com erro: ${fmtCount(summary.errorCount)}`);
  console.log(`Valor atual total: ${fmtMoney(summary.currentTotal)}`);
  console.log(`Valor recalculado total: ${fmtMoney(summary.recalculatedTotal)}`);
  console.log(`Diferença total: ${fmtMoney(summary.differenceTotal)}`);
}

function printErrors(
  errors: ReadonlyArray<{ salesOrderId?: string; message?: string }>
): void {
  if (errors.length === 0) return;
  console.log(`\n--- Erros (${errors.length}) ---`);
  for (const e of errors) {
    console.log(`  • Pedido ${e.salesOrderId ?? "(sem id)"}: ${e.message ?? "(sem mensagem)"}`);
  }
}

/** true = houve erro; o chamador decide o exit code. */
async function runPreview(): Promise<boolean> {
  const filters = buildFiltersFromArgs();
  const userId = parseArg("userId") ?? "cli-script";
  const userRole = parseArg("role") ?? "ADMIN";

  console.log("=== Reprocessamento de comissões — PREVIEW (dry-run) ===");
  const result = await previewCommissionReprocess(prisma, {
    filters,
    userId,
    userRole,
  });

  printSummary(result.summary);
  printErrors(result.errors);

  const hasErrors =
    result.errors.length > 0 ||
    (Number.isFinite(result.summary.errorCount) && result.summary.errorCount > 0);

  if (hasErrors) {
    // Prévia com erro não pode virar apply: o token liberaria uma execução
    // que já se sabe incompleta.
    console.error(
      "\n❌ Prévia inválida: há pedidos com erro. O runToken NÃO será exibido."
    );
    console.error("Corrija os erros acima e rode a prévia novamente.");
    return true;
  }

  console.log(`\nrunToken (usar em --apply): ${result.runToken}`);
  console.log("\nPreview concluído. Nenhuma alteração foi feita no banco.");
  return false;
}

/** true = houve erro; o chamador decide o exit code. */
async function runApply(): Promise<boolean> {
  const filters = buildFiltersFromArgs();
  const userId = parseArg("userId");
  const userRole = parseArg("role") ?? "ADMIN";
  const reason = parseArg("reason");
  const runToken = parseArg("runToken");

  if (!userId) throw new Error("Informe --userId=<id do usuário responsável>.");
  if (!reason) throw new Error("Informe --reason=\"motivo do reprocessamento\" (mínimo 3 caracteres).");
  if (!runToken) throw new Error("Informe --runToken=<id retornado pelo --preview>.");

  console.log("=== Reprocessamento de comissões — APPLY ===");
  console.log(`Usuário: ${userId} (role=${userRole})`);
  console.log(`Motivo: ${reason}`);
  console.log(`runToken: ${runToken}\n`);

  const result = await applyCommissionReprocess(prisma, {
    filters,
    userId,
    userRole,
    reason,
    runToken,
  });

  printSummary(result.summary);
  console.log(`\nPedidos alterados: ${fmtCount(result.summary.changedCount)}`);
  console.log(`Run ID: ${result.runId ?? "(sem id)"}`);
  console.log(`Run ID (auditoria): ${result.auditId ?? "(sem id)"}`);
  printErrors(result.errors ?? []);

  // Fonte única da contagem de erro: o array de erros e o summary oficial.
  const errorsCount = Math.max(
    result.errors?.length ?? 0,
    Number.isFinite(result.summary.errorCount) ? result.summary.errorCount : 0
  );
  if (errorsCount > 0) {
    // Execução parcial não é sucesso: parte dos pedidos ficou para trás e o
    // estado do período segue divergente.
    console.error(
      `\n❌ Reprocessamento PARCIAL: ${errorsCount} pedido(s) falharam.`
    );
    console.error(
      "Os pedidos sem erro foram aplicados. Rode nova prévia para ver o que ainda diverge."
    );
    return true;
  }

  console.log("\n✅ Reprocessamento aplicado sem erros.");
  return false;
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const preview = hasFlag("preview") || hasFlag("dry-run");
  const apply = hasFlag("apply");
  if (!preview && !apply) {
    throw new Error("Informe --preview (ou --dry-run) ou --apply.");
  }
  if (preview && apply) {
    throw new Error("Use apenas um modo: --preview/--dry-run ou --apply.");
  }

  const hadErrors = preview ? await runPreview() : await runApply();
  // Erro em qualquer pedido = saída diferente de zero, para o chamador
  // (cron, pipeline, operador) não tratar execução parcial como sucesso.
  if (hadErrors) process.exitCode = 3;
}

main()
  .catch((err) => {
    if (err instanceof CommissionReprocessError) {
      console.error(`\n❌ [${err.code}] ${err.message}`);
      process.exit(2);
    }
    console.error("Erro no reprocessamento de comissões:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
