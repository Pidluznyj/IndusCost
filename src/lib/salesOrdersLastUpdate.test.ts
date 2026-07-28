import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatSalesOrdersLastUpdatedAtLabel,
  isSalesOrdersLastUpdatePath,
  resolveSalesOrdersLastUpdatedAt,
  SALES_ORDERS_LAST_UPDATE_PATH,
} from "@/src/lib/salesOrdersLastUpdate.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Pedidos de venda — última atualização", () => {
  it("path canônico e detector", () => {
    assert.equal(SALES_ORDERS_LAST_UPDATE_PATH, "/api/sales-orders/last-update");
    assert.equal(isSalesOrdersLastUpdatePath(SALES_ORDERS_LAST_UPDATE_PATH), true);
    assert.equal(isSalesOrdersLastUpdatePath("/api/sales-orders/xyz"), false);
  });

  it("resolve o timestamp mais recente entre candidatos", () => {
    assert.equal(
      resolveSalesOrdersLastUpdatedAt([
        "2026-07-20T10:00:00.000Z",
        new Date("2026-07-22T15:30:00.000Z"),
        null,
        "invalid",
      ]),
      "2026-07-22T15:30:00.000Z"
    );
    assert.equal(resolveSalesOrdersLastUpdatedAt([null, undefined]), null);
  });

  it("formata rótulo discreto em pt-BR (America/Sao_Paulo)", () => {
    const label = formatSalesOrdersLastUpdatedAtLabel("2026-07-22T18:05:09.000Z");
    assert.ok(label);
    assert.match(label!, /^Última atualização: /);
    assert.match(label!, /\d{2}\/\d{2}\/\d{4}/);
    assert.match(label!, /\d{2}:\d{2}:\d{2}/);
    assert.equal(formatSalesOrdersLastUpdatedAtLabel(null), null);
  });

  it("registra rota estática com guard de pedidos e loader server", () => {
    const routes = read("src/lib/salesOrderListReportExportRoutes.ts");
    const server = read("src/lib/salesOrdersLastUpdate.server.ts");
    assert.match(routes, /SALES_ORDERS_LAST_UPDATE_PATH/);
    assert.match(routes, /loadSalesOrdersLastUpdatedAt/);
    assert.match(routes, /COMMERCIAL_RESOURCE_KEYS\.salesOrders/);
    assert.match(server, /salesOrder\.aggregate/);
    assert.match(server, /lastSeenAt/);
    assert.match(server, /nomusSourceSyncRun\.findFirst/);
    assert.match(server, /entityType:\s*"SALES_ORDER"/);
  });

  it("exibe subtítulo sob o título Pedidos de venda", () => {
    const app = read("src/App.tsx");
    const subtitle = read(
      "src/components/sales-orders/SalesOrdersPageLastUpdateSubtitle.tsx"
    );
    assert.match(app, /SalesOrdersPageLastUpdateSubtitle/);
    assert.match(app, /path="sales-orders"/);
    assert.match(app, /description=\{<SalesOrdersPageLastUpdateSubtitle\s*\/>\}/);
    assert.match(subtitle, /data-testid="sales-orders-last-update"/);
    assert.match(subtitle, /SALES_ORDERS_LAST_UPDATE_PATH/);
    assert.match(subtitle, /text-muted-foreground/);
  });
});
