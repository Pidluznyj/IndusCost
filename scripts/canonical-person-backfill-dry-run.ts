/**
 * Dry-run: possíveis vínculos inequívocos Person (e-mail/CPF).
 * Não grava. Não executar em produção como migrate.
 *
 * Uso: npx tsx scripts/canonical-person-backfill-dry-run.ts
 */

import { prisma } from "../src/lib/prisma.ts";
import { diagnoseUnequivocalPersonMatches } from "../src/lib/canonicalPersonService.server.ts";

async function main() {
  const report = await diagnoseUnequivocalPersonMatches(prisma);
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nResumo: ${report.unequivocalMatches.length} match(es) inequívoco(s) em ${report.scannedEmployees} colaboradores × ${report.scannedUsers} usuários.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
