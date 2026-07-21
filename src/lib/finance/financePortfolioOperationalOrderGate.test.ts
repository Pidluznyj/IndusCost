import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import {
  filterPortfolioFactsByOperationalOrders,
  filterPortfolioOrderRowsByOperationalOrders,
  isPortfolioFactOperationallyVisible,
  selectOperationalPortfolioSalesOrderIds,
} from "./financePortfolioOperationalOrderGate.js";

const FLAG_ON = { [NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV]: "true" };

describe("financePortfolioOperationalOrderGate", () => {
  it("exclui MISSING_CONFIRMED quando a flag está on (PD 02739-eq)", () => {
    const allowed = selectOperationalPortfolioSalesOrderIds(
      [
        { id: "present", status: "OPEN", sourcePresenceStatus: "PRESENT" },
        {
          id: "pd-02739",
          status: "OPEN",
          sourcePresenceStatus: "MISSING_CONFIRMED",
        },
        { id: "cancelled", status: "CANCELLED", sourcePresenceStatus: "PRESENT" },
      ],
      FLAG_ON
    );
    assert.deepEqual([...allowed], ["present"]);
  });

  it("com flag off ainda exclui CANCELLED/ERROR, mas mantém MISSING_CONFIRMED", () => {
    const allowed = selectOperationalPortfolioSalesOrderIds(
      [
        {
          id: "missing",
          status: "OPEN",
          sourcePresenceStatus: "MISSING_CONFIRMED",
        },
        { id: "cancelled", status: "CANCELLED", sourcePresenceStatus: "PRESENT" },
        { id: "error", status: "ERROR", sourcePresenceStatus: "PRESENT" },
      ],
      {}
    );
    assert.deepEqual([...allowed], ["missing"]);
  });

  it("filtra facts e linhas de Status Pedidos pelo set operacional", () => {
    const allowed = new Set(["ok"]);
    const facts = filterPortfolioFactsByOperationalOrders(
      [
        { salesOrderId: "ok", orderCode: "PD 1" },
        { salesOrderId: "pd-02739", orderCode: "PD 02739" },
        { salesOrderId: null, orderCode: "orphan-line" },
      ],
      allowed
    );
    assert.equal(facts.length, 2);
    assert.ok(facts.every((f) => f.salesOrderId !== "pd-02739"));

    const rows = filterPortfolioOrderRowsByOperationalOrders(
      [
        { salesOrderId: "ok" },
        { salesOrderId: "pd-02739" },
      ],
      allowed
    );
    assert.equal(rows.length, 1);
    assert.equal(isPortfolioFactOperationallyVisible({ salesOrderId: "ok" }, allowed), true);
    assert.equal(
      isPortfolioFactOperationallyVisible({ salesOrderId: "pd-02739" }, allowed),
      false
    );
  });

  it("rebuild e loaders da Conciliação consomem o gate", () => {
    const root = process.cwd();
    const read = (rel: string) => readFileSync(join(root, rel), "utf8");

    assert.match(
      read("scripts/rebuildOrderToCashAudit.ts"),
      /mergeSalesOrderWhereWithPortfolioOperationalGate/
    );
    assert.match(
      read("scripts/rebuildPortfolioReconciliationFacts.ts"),
      /mergeSalesOrderWhereWithPortfolioOperationalGate/
    );
    assert.match(
      read("src/lib/financeOrderStatusPedidosApi.server.ts"),
      /filterFactsByOperationalPortfolioOrders|gateOrderToCashAuditFactWhere/
    );
    assert.match(
      read("src/lib/financeOrderToCashAuditApi.server.ts"),
      /gateOrderToCashAuditFactWhere/
    );
    assert.match(
      read("src/lib/financePortfolioReconciliationApi.server.ts"),
      /filterFactsByOperationalPortfolioOrders/
    );
    assert.match(
      read("src/lib/financePortfolioOrderStatusApi.server.ts"),
      /filterFactsByOperationalPortfolioOrders/
    );
    assert.match(
      read("src/lib/financePortfolioReconciliationRoutes.ts"),
      /isSalesOrderVisibleInPortfolioReconciliation/
    );
  });
});
