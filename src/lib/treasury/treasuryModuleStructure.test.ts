import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createTreasuryRepository } from "./repositories/treasuryRepository.server.js";
import { listTreasuryJobs, startTreasuryScheduledJobs } from "./jobs/treasuryJobs.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

describe("treasuryModuleStructure", () => {
  it("pastas scaffold existem", () => {
    for (const dir of [
      "controllers",
      "services",
      "repositories",
      "domain",
      "queries",
      "mappers",
      "jobs",
      "contracts",
      "adapters",
    ]) {
      assert.ok(existsSync(join(here, dir)), dir);
    }
    assert.ok(
      existsSync(join(here, "adapters/treasuryOfficialTitlesAdapter.server.ts"))
    );
    assert.ok(
      existsSync(
        join(here, "repositories/treasuryOfficialTitlesRepository.server.ts")
      )
    );
    assert.ok(
      existsSync(join(repoRoot, "src/components/finance/treasury/TreasuryScaffoldPage.tsx"))
    );
  });

  it("repository scaffold lista vazio sem Prisma", async () => {
    const repo = createTreasuryRepository();
    assert.deepEqual(await repo.listFinancialAccounts(), []);
  });

  it("jobs scaffold não iniciam timers", () => {
    assert.ok(listTreasuryJobs().length >= 1);
    const start = startTreasuryScheduledJobs();
    assert.equal(start.started, false);
  });

  it("frontend treasury não importa Prisma e usa contratos client-safe", () => {
    const feDir = join(repoRoot, "src/components/finance/treasury");
    const files = readdirSync(feDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    assert.ok(files.length > 0);
    let importsContracts = false;
    for (const file of files) {
      const source = readFileSync(join(feDir, file), "utf8");
      assert.doesNotMatch(source, /@prisma\/client|from ["'].*prisma/);
      assert.doesNotMatch(source, /\.server\.js|\.server["']/);
      assert.doesNotMatch(source, /from ["'].*\/treasury\/index/);
      if (/treasury\/contracts\//.test(source)) importsContracts = true;
    }
    assert.equal(importsContracts, true);
  });

  it("server.ts registra registerTreasuryRoutes sem lógica de domínio", () => {
    const server = readFileSync(join(repoRoot, "server.ts"), "utf8");
    assert.match(server, /registerTreasuryRoutes/);
    assert.match(server, /from ["']\.\/src\/lib\/treasury\/treasuryRoutes\.js["']/);
  });
});
