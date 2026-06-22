import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const COMPONENTS_DIR = join(ROOT, "src/components");

/** Módulos server-only conhecidos (importam Prisma ou rotas Express). */
const SERVER_ONLY_LIB_PATTERNS = [
  /financeAccountsPayableCostCenterIntegration/,
  /financeAccountsPayableRoutes/,
  /financeAccountsPayableCostCenterAllocation/,
  /financeSupplierCostCenterRules/,
  /financeCostCenterDashboard/,
  /financeCostCenters(?!Permissions|PageTypes)/,
  /adminSellerOptions(?!Types)/,
  /nomusAutoApplyBomDashboard(?!Client|Shared|Types|Routes)/,
  /nomusAutoApplyDashboardRevalidationJob(?!Types)/,
  /\/prisma(\.js)?["']/,
  /@prisma\/client/,
];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

function collectImportBlocks(source: string): Array<{ typeOnly: boolean; spec: string }> {
  const blocks: Array<{ typeOnly: boolean; spec: string }> = [];
  const importRe = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    blocks.push({ typeOnly: Boolean(match[1]), spec: match[3]! });
  }
  return blocks;
}

describe("frontendPrismaImportGuard", () => {
  it("componentes React não importam módulos server-only como valor", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(COMPONENTS_DIR)) {
      const rel = file.replace(ROOT + "\\", "").replace(ROOT + "/", "");
      const source = readFileSync(file, "utf8");

      for (const block of collectImportBlocks(source)) {
        if (block.typeOnly) continue;
        if (!block.spec.includes("/src/lib/") && !block.spec.startsWith("@/src/lib/")) continue;
        if (SERVER_ONLY_LIB_PATTERNS.some((re) => re.test(block.spec))) {
          offenders.push(`${rel} → ${block.spec}`);
        }
      }
    }

    assert.equal(
      offenders.length,
      0,
      `Imports server-side no frontend:\n${offenders.join("\n")}`
    );
  });
});
