/**
 * Atalho legado T02 → T03.
 * Preferir: npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run|--apply --confirm-apply
 *
 * Este arquivo apenas encaminha args (default --dry-run).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const forwarded = process.argv.slice(2);
if (
  !forwarded.includes("--dry-run") &&
  !forwarded.includes("--preview") &&
  !forwarded.includes("--apply") &&
  !forwarded.includes("--audit")
) {
  forwarded.unshift("--dry-run");
}

const script = join(process.cwd(), "scripts", "nomus-nfe-fiscal-backfill.ts");
const result = spawnSync(process.execPath, ["--import", "tsx", script, ...forwarded], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
