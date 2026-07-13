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
import type { CommissionReprocessFilters } from "../src/lib/commissions/commissionReprocess.ts";
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

function printSummary(summary: {
  totalOrders: number;
  changedOrders: number;
  blockedOrders: number;
  errorOrders: number;
  totalDeltaAmount: number;
  totalOldAmount: number;
  totalNewAmount: number;
}): void {
  console.log("\n--- Resumo ---");
  console.log(`Pedidos avaliados: ${summary.totalOrders} (limite ${MAX_ORDERS})`);
  console.log(`Pedidos alterados: ${summary.changedOrders}`);
  console.log(`Pedidos bloqueados (pagos/fechados): ${summary.blockedOrders}`);
  console.log(`Pedidos com erro: ${summary.errorOrders}`);
  console.log(`Valor antigo total: ${fmtBrl(summary.totalOldAmount)}`);
  console.log(`Valor novo total: ${fmtBrl(summary.totalNewAmount)}`);
  console.log(`Delta total: ${fmtBrl(summary.totalDeltaAmount)}`);
}

async function runPreview(): Promise<void> {
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
  console.log(`\nrunToken (usar em --apply): ${result.runToken}`);

  if (result.errors.length > 0) {
    console.log("\n--- Erros ---");
    for (const e of result.errors) {
      console.log(`  • Pedido ${e.salesOrderId}: ${e.message}`);
    }
  }

  console.log("\nPreview concluído. Nenhuma alteração foi feita no banco.");
}

async function runApply(): Promise<void> {
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
  console.log(`\nComissões atualizadas: ${result.commissionsUpdated}`);
  console.log(`Erros durante apply: ${result.errorsCount}`);
  console.log(`Run ID (auditoria): ${result.auditId}`);
  console.log("\nReprocessamento aplicado com sucesso.");
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

  if (preview) {
    await runPreview();
  } else {
    await runApply();
  }
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
