import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildOrderFullAuditProductionAlerts,
  mapOrderFullAuditProduction,
} from "./orderFullAuditProduction.js";
import { ORDER_FULL_AUDIT_TABS } from "./orderFullAuditClient.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mapOrderFullAuditProduction", () => {
  it("mapeia OPs, vínculos e totais sem inventar produzido", () => {
    const mapped = mapOrderFullAuditProduction({
      productionOrders: [
        {
          id: "op-1",
          externalId: 501,
          status: "ABERTA",
          plannedQuantity: 10,
          producedQuantity: null,
          productCode: "SKU-A",
          openedAt: "2026-07-01T00:00:00.000Z",
          closedAt: null,
        },
      ],
      productionLinks: [
        {
          id: "link-1",
          productionOrderId: "op-1",
          productionOrderExternalId: 501,
          salesOrderId: "so-1",
          salesOrderItemId: "item-1",
          externalSalesOrderId: 100,
          externalSalesOrderItemId: 11,
          linkedQuantity: 8,
          isCurrent: true,
          linkKey: "k1",
        },
      ],
      linkConflicts: [],
    });

    assert.equal(mapped.productionOrders.length, 1);
    assert.equal(mapped.productionOrders[0]!.externalId, 501);
    assert.equal(mapped.productionOrders[0]!.producedQuantity, null);
    assert.equal(mapped.productionOrders[0]!.linkedQuantity, 8);
    assert.equal(mapped.totals.productionOrderCount, 1);
    assert.equal(mapped.totals.plannedQuantitySum, 10);
    assert.equal(mapped.totals.linkedQuantitySum, 8);
    assert.match(mapped.productionOrders[0]!.href, /production-orders\?search=501/);
  });

  it("gera alerta quando pedido ativo não tem OP", () => {
    const empty = mapOrderFullAuditProduction({
      productionOrders: [],
      productionLinks: [],
      linkConflicts: [],
    });
    const alerts = buildOrderFullAuditProductionAlerts({
      salesOrderId: "so-1",
      orderCode: "PD-1",
      activeItemIds: ["item-1"],
      production: empty,
    });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]!.code, "ORDER_WITHOUT_PRODUCTION_ORDER");
    assert.equal(alerts[0]!.linkedTab, "productionOrders");
  });
});

describe("order full audit — contrato OP na 360º", () => {
  it("inclui aba Ordens de Produção entre Itens e Documentos", () => {
    const ids = ORDER_FULL_AUDIT_TABS.map((tab) => tab.id);
    const itemsIdx = ids.indexOf("items");
    const productionIdx = ids.indexOf("productionOrders");
    const documentsIdx = ids.indexOf("documents");
    assert.ok(productionIdx > itemsIdx);
    assert.ok(documentsIdx > productionIdx);
  });

  it("dialog e service consomem productionOrders do evidence pack", () => {
    const dialog = read(
      "src/components/finance/portfolio-reconciliation/OrderFullAuditDialog.tsx"
    );
    const service = read("src/lib/finance/orderFullAuditService.ts");
    assert.match(dialog, /ProductionOrdersTab/);
    assert.match(dialog, /order-full-audit-production-tab/);
    assert.match(service, /loadSalesOrderFlowEvidence/);
    assert.match(service, /mapOrderFullAuditProduction/);
    assert.match(service, /productionOrderExternalIds/);
  });
});
