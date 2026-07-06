#!/usr/bin/env npx tsx
/**
 * Auditoria da apuração de comissões por vendedor/período.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-apuracao.ts --year=2026 --month=6 --seller="GISLENE LIMA"
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { listCommissionApuracaoPage } from "../src/lib/commissions/commissionApuracao.server.ts";
import { parseCommissionApuracaoQuery } from "../src/lib/commissions/commissionQuery.ts";
import { requireDatabaseUrl, warnCommissionLegacyMode } from "./commission-script-utils.ts";
import type { CommissionAccessScope } from "../src/lib/commissions/commissionAccessScope.ts";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  warnCommissionLegacyMode("audit-commission-apuracao");
  const year = Number.parseInt(parseArg("year") ?? String(new Date().getFullYear()), 10);
  const month = Number.parseInt(parseArg("month") ?? "6", 10);
  const sellerName = parseArg("seller") ?? "";

  console.log("=== Auditoria Apuração de Comissões ===");
  console.log(`Período: ${month}/${year}`);
  if (sellerName) console.log(`Vendedor: ${sellerName}\n`);

  let commissionPersonId: string | undefined;
  if (sellerName) {
    const person = await prisma.commissionPerson.findFirst({
      where: { name: { contains: sellerName, mode: "insensitive" }, active: true },
      select: { id: true, name: true, nomusPersonId: true, source: true },
    });
    if (!person) {
      console.error(`Pessoa comissionada não encontrada: ${sellerName}`);
      process.exit(1);
    }
    commissionPersonId = person.id;
    console.log(
      `Pessoa canônica: ${person.name} | Nomus ${person.nomusPersonId ?? "—"} | ${person.source}\n`
    );
  }

  const query = parseCommissionApuracaoQuery({
    year: String(year),
    month: String(month),
    commissionPersonId,
    page: "1",
    pageSize: "50000",
    nomusReferenceBase: "808107.32",
    nomusReferenceCommission: "20926.56",
  });

  const payload = await listCommissionApuracaoPage(query, GLOBAL_SCOPE);
  const d = payload.diagnostics;
  const t = payload.totals;

  console.log("--- Diagnóstico ---");
  console.log(`Registros no período: ${d.recordsInPeriod}`);
  console.log(`Confirmados: ${d.recordsConfirmedStatus}`);
  console.log(`Somente previstos: ${d.recordsForecastOnly}`);
  console.log(`Sem confirmedAt: ${d.recordsWithoutConfirmedAt}`);
  if (d.message) console.log(`Mensagem: ${d.message}`);

  console.log("\n--- Totais IndusCost ---");
  console.log(`Base: R$ ${t.calculationBaseTotal.toFixed(2)}`);
  console.log(`Comissão calculada: R$ ${t.commissionCalculatedTotal.toFixed(2)}`);
  console.log(`Comissão liberada: R$ ${t.commissionReleasedTotal.toFixed(2)}`);
  console.log(`Linhas OK: ${t.linesOkCount} | Divergências: ${t.divergenceCount} | Bloqueadas: ${t.blockedCount}`);

  console.log("\n--- Comparação Nomus (ref.) ---");
  console.log(`Nomus comissão ref.: R$ ${t.nomusReferenceCommission?.toFixed(2) ?? "—"}`);
  console.log(`Diferença: R$ ${t.nomusDiffAmount?.toFixed(2) ?? "—"} (${t.nomusDiffPercent?.toFixed(2) ?? "—"}%)`);

  const blocked = payload.lines.filter((l) => l.blockReason);
  if (blocked.length > 0) {
    console.log("\n--- Motivos de bloqueio/divergência (amostra) ---");
    const reasons = new Map<string, number>();
    for (const line of blocked) {
      const r = line.blockReason ?? "—";
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    for (const [reason, count] of reasons) {
      console.log(`  • ${reason}: ${count}`);
    }
  }

  console.log("\nAuditoria concluída.");
}

main()
  .catch((err) => {
    console.error("Erro:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
