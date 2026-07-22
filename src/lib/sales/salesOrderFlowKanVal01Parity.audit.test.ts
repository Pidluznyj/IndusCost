/**
 * KAN-VAL-01 — Auditoria estática de paridade e ausência de exceções.
 * Read-only: não altera banco.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("KAN-VAL-01 — auditoria de paridade e regra genérica", () => {
  it("frontend do Kanban não recalcula estágio/gargalo/obrigação", () => {
    const moduleSrc = read("src/components/commercial/SalesOrderFlowModule.tsx");
    const boardSrc = read("src/components/commercial/SalesOrderFlowKanbanBoard.tsx");
    const drawerSrc = read("src/components/commercial/SalesOrderFlowDetailDrawer.tsx");
    for (const src of [moduleSrc, boardSrc, drawerSrc]) {
      assert.doesNotMatch(src, /resolveSalesOrderItemFlow\b/);
      assert.doesNotMatch(src, /resolveSalesOrderFlow\b/);
      assert.doesNotMatch(src, /remainingFulfillmentQuantity\s*[=-]/);
      assert.doesNotMatch(src, /activeObligationQuantity\s*[=-]/);
    }
  });

  it("API Kanban lê snapshots; motor canônico é único", () => {
    const routes = read("src/lib/salesOrderFlowRoutes.ts");
    const list = read("src/lib/sales/salesOrderFlowList.server.ts");
    assert.match(routes, /\/api\/commercial\/sales-order-flow/);
    assert.match(list, /SalesOrderFlowSnapshot|salesOrderFlowSnapshot/i);
    const itemEngine = read("src/lib/sales/salesOrderItemFlowEngine.ts");
    const orderEngine = read("src/lib/sales/salesOrderFlowEngine.ts");
    assert.match(itemEngine, /export function resolveSalesOrderItemFlow/);
    assert.match(orderEngine, /export function resolveSalesOrderFlow/);
    assert.match(itemEngine, /activeObligationQuantity/);
    assert.match(itemEngine, /remainingFulfillmentQuantity/);
  });

  it("código de produção do motor não tem exceção por pedido/cliente", () => {
    const files = [
      "src/lib/sales/salesOrderItemFlowEngine.ts",
      "src/lib/sales/salesOrderFlowEngine.ts",
      "src/lib/sales/salesOrderFlowCatalog.ts",
      "src/lib/sales/salesOrderFlowRecompute.ts",
      "src/lib/sales/salesOrderFlowList.ts",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /orderCode\s*===\s*["']PD\s/);
      assert.doesNotMatch(src, /customer(?:Name)?\s*===\s*["']/i);
      assert.doesNotMatch(src, /if\s*\(\s*orderCode\s*===/);
    }
  });

  it("recompute pós-sync e rebuild direcionável existem", () => {
    const afterSync = read("src/lib/sales/salesOrderFlowRecomputeAfterNomusSync.server.ts");
    const rebuild = read("src/lib/sales/salesOrderFlowRebuild.ts");
    assert.match(afterSync, /runSalesOrderFlowRecomputeAfterNomusSync/);
    assert.match(rebuild, /--order=/);
  });
});
