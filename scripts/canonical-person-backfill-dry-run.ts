/**
 * Atalho compatível: dry-run do backfill Person.
 * Preferir: npx tsx scripts/canonical-person-backfill.ts --dry-run
 *
 * Não grava. Não usar como migrate em produção.
 */

import "dotenv/config";

if (!process.argv.includes("--dry-run") && !process.argv.includes("--preview")) {
  process.argv.push("--dry-run");
}

import("./canonical-person-backfill.ts").catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
