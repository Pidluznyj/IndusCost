/**
 * Validação operacional OP-12: scripts npm, parsers CLI e shell — sem API/DB real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProductionOrdersSyncCli } from "@/src/lib/nomusProductionOrdersSyncLogic.js";
import { parseProductionOrdersBackfillCli } from "@/src/lib/nomusProductionOrdersBackfill.js";
import { parseProductionOrdersIncrementalCli } from "@/src/lib/nomusProductionOrdersIncremental.js";
import { parseProductionOrdersLookupCli } from "@/src/lib/nomusProductionOrdersLookup.js";

const ROOT = process.cwd();

function readPkgScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  return pkg.scripts;
}

describe("production orders operations — package.json", () => {
  it("expõe todos os comandos oficiais OP-12", () => {
    const scripts = readPkgScripts();
    const required: Record<string, RegExp> = {
      "sync:nomus:production-orders:preview": /SyncV1\.ts preview/,
      "sync:nomus:production-orders:apply": /SyncV1\.ts apply/,
      "sync:nomus:production-orders:backfill:preview": /Backfill\.ts preview/,
      "sync:nomus:production-orders:backfill:apply": /Backfill\.ts apply/,
      "sync:nomus:production-orders:incremental:preview": /Incremental\.ts preview/,
      "sync:nomus:production-orders:incremental:apply": /Incremental\.ts apply/,
      "sync:nomus:production-orders:reconcile": /Lookup\.ts apply --reconcile-unresolved/,
      "sync:nomus:production-orders:lookup:preview": /Lookup\.ts preview/,
      "sync:nomus:production-orders:lookup:apply": /Lookup\.ts apply/,
      "test:nomus:production-orders": /Operations\.test/,
    };
    for (const [name, pattern] of Object.entries(required)) {
      assert.match(scripts[name] ?? "", pattern, `script ausente/inválido: ${name}`);
    }
  });

  it("shell runner existe no padrão dos demais syncs", () => {
    const shellPath = join(ROOT, "scripts/runNomusProductionOrdersSync.sh");
    assert.equal(existsSync(shellPath), true);
    const shell = readFileSync(shellPath, "utf8");
    assert.match(shell, /flock -n/);
    assert.match(shell, /\[nomus-production-orders\]/);
    assert.match(shell, /incremental\|backfill/);
    assert.doesNotMatch(shell, /NOMUS_TOKEN=|Authorization:/);

    // Demais sincronizadores também usam shell+flock — padrão confirmado.
    assert.equal(existsSync(join(ROOT, "scripts/runNomusAccountsReceivableSync.sh")), true);
    assert.equal(existsSync(join(ROOT, "scripts/runNomusNfesSync.sh")), true);
  });

  it("documentação operacional cobre seções obrigatórias", () => {
    const ops = readFileSync(join(ROOT, "docs/production-orders/operations.md"), "utf8");
    for (const heading of [
      "## 1. Arquitetura",
      "## 2. Models",
      "## 3. Endpoint",
      "## 4. Filtros",
      "## 5. Parsing",
      "## 6. Modos",
      "## 7. Backfill",
      "## 8. Incremental",
      "## 9. Consulta pontual",
      "## 10. Reconciliação",
      "## 11. Lock",
      "## 12. Logs",
      "## 13. Rate limit",
      "## 14. Rollback",
      "## 15. Comandos de produção",
      "## 16. Critérios de validação",
      "## 17. Roteiro de deploy",
    ]) {
      assert.match(ops, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(ops, /NÃO executar/);
    assert.match(ops, /sync:nomus:production-orders:reconcile/);
  });
});

describe("production orders operations — CLI mocks", () => {
  it("preview/apply SyncV1", () => {
    assert.equal(parseProductionOrdersSyncCli(["preview"]).mode, "preview");
    assert.equal(parseProductionOrdersSyncCli(["apply"]).mode, "apply");
    const point = parseProductionOrdersSyncCli([
      "preview",
      "--name=OP 05800 - 003",
      "--externalId=30347",
    ]);
    assert.equal(point.strategy, "point");
  });

  it("backfill preview/apply", () => {
    assert.equal(parseProductionOrdersBackfillCli(["preview"]).mode, "preview");
    assert.equal(parseProductionOrdersBackfillCli(["apply", "--max-pages=2"]).maxPages, 2);
  });

  it("incremental preview/apply", () => {
    assert.equal(parseProductionOrdersIncrementalCli(["preview"]).mode, "preview");
    assert.equal(
      parseProductionOrdersIncrementalCli(["apply", "--overlap-hours=72"]).overlapHours,
      72
    );
  });

  it("reconcile e lookup pontual", () => {
    const reconcile = parseProductionOrdersLookupCli(["apply", "--reconcile-unresolved"]);
    assert.equal(reconcile.mode, "apply");
    assert.equal(reconcile.reconcileUnresolved, true);
    assert.deepEqual(reconcile.externalIds, []);

    const point = parseProductionOrdersLookupCli([
      "preview",
      "--name=OP 05800 - 003",
      "--external-id=30347",
      "--sales-order-external-id=2530",
      "--sales-order-item-external-id=11324",
    ]);
    assert.deepEqual(point.names, ["OP 05800 - 003"]);
    assert.deepEqual(point.externalIds, [30347]);
    assert.deepEqual(point.salesOrderExternalIds, [2530]);
    assert.deepEqual(point.salesOrderItemExternalIds, [11324]);
  });
});

describe("production orders operations — orquestrador", () => {
  it("não inclui backfill/incremental/reconcile OP no cron orquestrador", () => {
    const orchestrator = readFileSync(join(ROOT, "scripts/nomusSyncOrchestrator.ts"), "utf8");
    assert.doesNotMatch(orchestrator, /production-orders:backfill/);
    assert.doesNotMatch(orchestrator, /production-orders:incremental/);
    assert.doesNotMatch(orchestrator, /production-orders:reconcile/);
    assert.doesNotMatch(orchestrator, /nomusProductionOrdersBackfill/);
  });
});
