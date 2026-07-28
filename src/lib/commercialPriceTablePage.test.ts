import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGroupedNavigationStructure,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
} from "@/src/lib/navigationGroups.js";
import {
  canAccessModule,
  resolveModuleIdFromPath,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import { SIDEBAR_MODULE_CONTRACT_KEYS } from "@/src/lib/sidebarEffectiveAccess.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import {
  COMMERCIAL_PRICE_TABLE_PAGE_SUBTITLE,
  COMMERCIAL_PRICE_TABLE_PAGE_TITLE,
  COMMERCIAL_PRICE_TABLE_ROUTE_PATH,
  COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS,
  canViewCommercialPriceTable,
} from "@/src/lib/commercialPriceTableAccess.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (permission) => set.has(permission),
    hasAnyPermission: (permissions) =>
      permissions.some((permission) => set.has(permission)),
  };
}

describe("commercial price table page", () => {
  it("registra rota ModulePageShell e módulo", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="commercial\/price-table"/);
    assert.match(app, /CommercialPriceTableModule/);
    assert.match(app, /COMMERCIAL_PRICE_TABLE_PAGE_TITLE/);
    assert.equal(COMMERCIAL_PRICE_TABLE_PAGE_TITLE, "Tabela comercial");
    assert.ok(COMMERCIAL_PRICE_TABLE_PAGE_SUBTITLE.length > 10);
  });

  it("inclui Tabela comercial no grupo Comercial", () => {
    const comercial = buildGroupedNavigationStructure().groups.find(
      (group) => group.id === "comercial"
    );
    const item = comercial?.items.find(
      (entry) => entry.itemId === "commercial-price-table"
    );
    assert.ok(item);
    assert.equal(item?.path, COMMERCIAL_PRICE_TABLE_ROUTE_PATH);
    assert.equal(item?.label, COMMERCIAL_PRICE_TABLE_PAGE_TITLE);
    assert.deepEqual(
      MODULE_MENU_PERMISSION_KEYS["commercial-price-table"],
      [...COMMERCIAL_PRICE_TABLE_VIEW_PERMISSIONS]
    );
  });

  it("alinha rota, módulo e recursos de proteção", () => {
    assert.equal(getModulePath("commercial-price-table"), COMMERCIAL_PRICE_TABLE_ROUTE_PATH);
    assert.equal(
      resolveModuleIdFromPath(COMMERCIAL_PRICE_TABLE_ROUTE_PATH),
      "commercial-price-table"
    );
    assert.equal(
      resolveSidebarModuleResourceKey("commercial-price-table"),
      ResourceKeys.COMERCIAL_TABELA_COMERCIAL
    );
    assert.deepEqual(SIDEBAR_MODULE_CONTRACT_KEYS["commercial-price-table"], [
      COMMERCIAL_RESOURCE_KEYS.priceTable,
      COMMERCIAL_RESOURCE_KEYS.proposals,
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      COMMERCIAL_RESOURCE_KEYS.pricing,
    ]);
  });

  it("libera consulta para vendedor/proposta sem pricing.view", () => {
    assert.equal(canAccessModule("commercial-price-table", checker([])), false);
    assert.equal(
      canAccessModule("commercial-price-table", checker(["sales_orders.view"])),
      true
    );
    assert.equal(
      canAccessModule("commercial-price-table", checker(["proposals.view"])),
      true
    );
    assert.equal(
      canAccessModule("commercial-price-table", checker(["price_table.view"])),
      true
    );
    assert.equal(
      canAccessModule("commercial-price-table", checker(["pricing.view"])),
      true
    );
    assert.equal(canViewCommercialPriceTable(checker(["finance.view"])), false);
  });

  it("endpoint published-prices aceita consumidores comerciais", () => {
    const server = read("server.ts");
    const routeBlock = server.slice(
      server.indexOf('"/api/pricing/commercial-published-prices"'),
      server.indexOf(
        'app.post("/api/pricing"',
        server.indexOf('"/api/pricing/commercial-published-prices"')
      )
    );
    assert.match(routeBlock, /requireAnyPermission\(\[/);
    assert.match(routeBlock, /sales_orders\.view/);
    assert.doesNotMatch(routeBlock, /requireResource\("commercial\.pricing"/);
  });

  it("módulo é somente leitura (sem gerar/publicar)", () => {
    const mod = read("src/components/commercial/CommercialPriceTableModule.tsx");
    assert.match(mod, /useCommercialPublishedPrices/);
    assert.match(mod, /CommercialPublishedPricesGrid/);
    assert.doesNotMatch(mod, /generate-draft|Simular preço|Nova Premissa/);
    assert.doesNotMatch(mod, /publish_tables|generate_tables/);
  });

  it("consulta do vendedor remove tributos/status e usa layout de Pedidos", () => {
    const mod = read("src/components/commercial/CommercialPriceTableModule.tsx");
    const grid = read("src/components/pricing/CommercialPublishedPricesGrid.tsx");
    assert.match(mod, /variant="consult"/);
    assert.doesNotMatch(mod, /commercial-price-table-tax-rule/);
    assert.doesNotMatch(mod, /Regra fiscal/);
    assert.doesNotMatch(mod, /MARGIN_DESC/);
    assert.match(grid, /variant === "consult"|isConsult/);
    assert.match(grid, /sales-order-list-table/);
    assert.match(grid, /data-variant="consult"/);
    assert.match(grid, /Info Tributária/);
    // Colunas fiscais/status só na variante formation (Formação de Preço).
    const consultStart = grid.indexOf('data-variant="consult"');
    const formationStart = grid.indexOf('data-variant="formation"');
    assert.ok(consultStart > 0 && formationStart > consultStart);
    const consultBlock = grid.slice(consultStart, formationStart);
    assert.doesNotMatch(consultBlock, /Info Tributária/);
    assert.doesNotMatch(consultBlock, />Status</);
    assert.doesNotMatch(consultBlock, /Última publicação/);
    assert.match(consultBlock, />SKU</);
    assert.match(consultBlock, />Produto</);
    assert.match(consultBlock, /table\.tableName/);
  });
});
