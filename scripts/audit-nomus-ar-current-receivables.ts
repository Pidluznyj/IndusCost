#!/usr/bin/env npx tsx
/**
 * Auditoria dry-run — AR vigente vs obsoletos de pedido/parcela (read-only).
 *
 * Uso:
 *   npx tsx scripts/audit-nomus-ar-current-receivables.ts
 *   npx tsx scripts/audit-nomus-ar-current-receivables.ts --orderCode=PD02719
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  auditNomusAccountsReceivableCurrentState,
  parseOrderParcelFromArDescription,
} from "../src/lib/nomusAccountsReceivableCurrent.ts";
import {
  mapPrismaRowToFinanceArDashboardRow,
} from "../src/lib/financeAccountsReceivableDashboard.ts";
import { FINANCE_AR_TITLE_SELECT } from "../src/lib/financeAccountsReceivableTitles.ts";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

async function main() {
  const orderFilter = parseArg("orderCode");
  const arPrisma = await prisma.nomusAccountsReceivable.findMany({
    where: orderFilter
      ? {
          description: {
            contains: orderFilter.replace(/\D/g, "").padStart(5, "0"),
            mode: "insensitive",
          },
        }
      : { description: { contains: "Pedido PD", mode: "insensitive" } },
    select: FINANCE_AR_TITLE_SELECT,
    orderBy: { externalId: "asc" },
    take: orderFilter ? 50 : 10_000,
  });

  const rows = arPrisma.map(mapPrismaRowToFinanceArDashboardRow);
  const audit = auditNomusAccountsReceivableCurrentState(rows);

  const orderGroups = orderFilter
    ? audit.groups.filter((g) => g.orderCode.includes(orderFilter.replace(/\D/g, "").padStart(5, "0").replace(/^0+/, "") || orderFilter))
    : audit.groups;

  console.log(
    JSON.stringify(
      {
        scannedTitles: rows.length,
        duplicateGroupCount: audit.duplicateGroupCount,
        obsoleteTitleCount: audit.obsoleteTitleCount,
        obsoleteAmount: audit.obsoleteAmount,
        protectedConflictCount: audit.protectedConflictCount,
        grossAmount: audit.grossAmount,
        currentAmount: audit.currentAmount,
        impactDelta: audit.impactDelta,
        groups: orderGroups.slice(0, 100),
        conflicts: audit.conflicts.slice(0, 100),
        sampleParsed: rows
          .slice(0, 5)
          .map((r) => ({
            externalId: r.externalId,
            description: r.description,
            parsed: parseOrderParcelFromArDescription(r.description),
          })),
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
