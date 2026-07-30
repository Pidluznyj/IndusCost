/**
 * Diagnóstico read-only — conferência CR/CP agrupados do Fluxo Gerencial.
 * Uso: npx tsx scripts/diagnose-treasury-predictive-crcp-by-account.ts --company=LAZARIOS --from=2026-07-30 --to=2026-08-28
 * Não escreve no banco.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { createTreasuryPredictiveCrCpByAccountService } from "../src/lib/treasury/services/treasuryPredictiveCrCpByAccountService.server.js";

function arg(name: string, fallback = ""): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

async function main() {
  const companyCode = arg("company") || arg("companyCode");
  const fromDate = arg("from") || arg("fromDate");
  const toDate = arg("to") || arg("toDate");
  if (!companyCode || !fromDate || !toDate) {
    console.error(
      "Uso: --company=CODE --from=YYYY-MM-DD --to=YYYY-MM-DD"
    );
    process.exitCode = 1;
    return;
  }

  const service = createTreasuryPredictiveCrCpByAccountService({ prisma });
  const board = await service.getBoard({ companyCode, fromDate, toDate });
  const d = board.diagnostics;

  console.log(
    JSON.stringify(
      {
        companyCode,
        fromDate,
        toDate,
        totals: board.totals,
        diagnostics: d,
        groups: board.groups.map((g) => ({
          treasuryAccountId: g.treasuryAccountId,
          accountName: g.accountName,
          nomusFinancialAccountId: g.nomusFinancialAccountId,
          isUnlinked: g.isUnlinked,
          accountsReceivableTotal: g.accountsReceivableTotal,
          accountsReceivableCount: g.accountsReceivableCount,
          accountsPayableTotal: g.accountsPayableTotal,
          accountsPayableCount: g.accountsPayableCount,
          netMovement: g.netMovement,
        })),
        check: {
          receivableDiffIsZero: d.receivableDiff === "0.00",
          payableDiffIsZero: d.payableDiff === "0.00",
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
