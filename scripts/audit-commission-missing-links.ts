#!/usr/bin/env npx tsx
/**
 * Lista vínculos ausentes na cadeia pedido → NF-e → CR → comissão.
 *
 * Uso:
 *   npx tsx scripts/audit-commission-missing-links.ts --year=2026 --month=6
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseCommissionApuracaoQuery, buildCommissionRecordsWhere } from "../src/lib/commissions/commissionQuery.ts";
import { requireDatabaseUrl } from "./commission-script-utils.ts";
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
  const year = parseArg("year") ?? "2026";
  const month = parseArg("month") ?? "6";

  const query = parseCommissionApuracaoQuery({
    year,
    month,
    page: "1",
    pageSize: "1",
  });

  const where = buildCommissionRecordsWhere(
    { ...query, statusIn: undefined, status: null },
    GLOBAL_SCOPE,
    { periodBasis: "confirmedAt" }
  );

  const records = await prisma.commissionRecord.findMany({
    where,
    include: {
      commissionPerson: { select: { name: true } },
      paymentSchedules: true,
    },
    take: 5000,
  });

  let noSeller = 0;
  let noNfe = 0;
  let noReceivable = 0;
  let noTier = 0;

  for (const r of records) {
    if (!r.nomusSellerId && !r.commissionPersonId) noSeller += 1;
    if (!r.nfeNumber && !r.nomusNfeId) noNfe += 1;
    const arSchedules = r.paymentSchedules.filter((s) => s.source === "ACCOUNTS_RECEIVABLE");
    if (
      ["CONFIRMED_BY_OUTPUT_DOCUMENT", "WAITING_RECEIVABLE", "WAITING_PAYMENT"].includes(r.status) &&
      arSchedules.length === 0
    ) {
      noReceivable += 1;
    }
    const meta = r.metadataJson as Record<string, unknown> | null;
    if (meta?.calculationType === "COMMERCIAL_PRICE_TIER" && !meta?.tierCode) noTier += 1;
  }

  console.log("=== Auditoria vínculos ausentes ===");
  console.log(`Período: ${month}/${year}`);
  console.log(`Registros analisados: ${records.length}`);
  console.log(`Sem vendedor: ${noSeller}`);
  console.log(`Sem NF-e: ${noNfe}`);
  console.log(`Confirmados sem conta a receber: ${noReceivable}`);
  console.log(`Regra faixa sem tier resolvido: ${noTier}`);
}

main()
  .catch((err) => {
    console.error("Erro:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
