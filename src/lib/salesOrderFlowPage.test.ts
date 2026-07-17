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
import {
  buildSalesOrderFlowQueryString,
  SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH,
  SALES_ORDER_FLOW_LIST_API_PATH,
  SALES_ORDER_FLOW_SUMMARY_API_PATH,
} from "@/src/lib/salesOrderFlowClient.js";
import {
  canAccessSalesOrderFlowModule,
  canViewSalesOrderFlow,
  classifySalesOrderFlowListError,
  SALES_ORDER_FLOW_BREADCRUMB,
  SALES_ORDER_FLOW_PAGE_SUBTITLE,
  SALES_ORDER_FLOW_PAGE_TITLE,
  SALES_ORDER_FLOW_ROUTE_PATH,
} from "@/src/lib/salesOrderFlowUi.js";
import { filterSalesOrderFlowMenuNavigation } from "@/src/lib/salesOrderFlowNavigation.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import { buildAccessibleSidebarNavigation } from "@/src/lib/sidebarNavigation.js";

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

describe("sales order flow navigation (OP-64)", () => {
  it("registra a rota e o ModulePageShell", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="commercial\/sales-order-flow"/);
    assert.match(app, /SalesOrderFlowModule/);
    assert.match(app, new RegExp(SALES_ORDER_FLOW_PAGE_TITLE));
    assert.match(app, new RegExp(SALES_ORDER_FLOW_PAGE_SUBTITLE));
  });

  it("inclui Fluxo de Pedidos no grupo Comercial", () => {
    const comercial = buildGroupedNavigationStructure().groups.find(
      (group) => group.id === "comercial"
    );
    const item = comercial?.items.find(
      (entry) => entry.itemId === "sales-order-flow"
    );
    assert.ok(item);
    assert.equal(item?.path, SALES_ORDER_FLOW_ROUTE_PATH);
    assert.equal(item?.label, SALES_ORDER_FLOW_PAGE_TITLE);
    assert.deepEqual(MODULE_MENU_PERMISSION_KEYS["sales-order-flow"], [
      "sales_orders.flow.view",
    ]);
  });

  it("alinha rota, módulo e recursos de proteção", () => {
    assert.equal(getModulePath("sales-order-flow"), SALES_ORDER_FLOW_ROUTE_PATH);
    assert.equal(
      resolveModuleIdFromPath(SALES_ORDER_FLOW_ROUTE_PATH),
      "sales-order-flow"
    );
    assert.equal(
      resolveSidebarModuleResourceKey("sales-order-flow"),
      ResourceKeys.COMERCIAL_FLUXO_PEDIDOS
    );
    assert.deepEqual(SIDEBAR_MODULE_CONTRACT_KEYS["sales-order-flow"], [
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
    ]);
  });

  it("oculta o módulo sem permissão e libera com flow.view", () => {
    assert.equal(canAccessModule("sales-order-flow", checker([])), false);
    assert.equal(
      canAccessModule("sales-order-flow", checker(["sales_orders.flow.view"])),
      true
    );
    assert.equal(canAccessSalesOrderFlowModule(checker([])), false);
    assert.equal(
      canAccessSalesOrderFlowModule(checker(["sales_orders.flow.view"])),
      true
    );
  });

  it("filtra o menu pela feature flag", () => {
    const nav = buildAccessibleSidebarNavigation({
      hasPermission: () => true,
      hasAnyPermission: () => true,
    });
    const hidden = filterSalesOrderFlowMenuNavigation(nav, {
      featureEnabled: false,
      hasFlowViewAccess: true,
    });
    assert.ok(
      !hidden.flatItems.some((item) => item.itemId === "sales-order-flow")
    );
    const shown = filterSalesOrderFlowMenuNavigation(nav, {
      featureEnabled: true,
      hasFlowViewAccess: true,
    });
    assert.ok(
      shown.flatItems.some((item) => item.itemId === "sales-order-flow")
    );
  });
});

describe("salesOrderFlowUi", () => {
  it("protege pelo recurso canônico ou fallback legado", () => {
    assert.equal(
      canViewSalesOrderFlow({
        canPerformAction: (resource, action) =>
          resource === COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow &&
          action === "view",
      }),
      true
    );
    assert.equal(
      canViewSalesOrderFlow({
        hasPermission: (permission) =>
          permission === "sales_orders.flow.view",
      }),
      true
    );
    assert.equal(canViewSalesOrderFlow({}), false);
  });

  it("classifica erros de lista/resumo", () => {
    assert.equal(
      classifySalesOrderFlowListError(new HttpError(403, "negado")).kind,
      "access_denied"
    );
    assert.equal(
      classifySalesOrderFlowListError(new HttpError(404, "missing")).kind,
      "feature_disabled"
    );
    assert.equal(
      classifySalesOrderFlowListError(new HttpError(503, "down")).kind,
      "api_unavailable"
    );
    assert.equal(SALES_ORDER_FLOW_BREADCRUMB, "Comercial / Fluxo de Pedidos");
  });
});

describe("salesOrderFlowClient", () => {
  it("expõe paths tipados e monta query string", () => {
    assert.equal(
      SALES_ORDER_FLOW_SUMMARY_API_PATH,
      "/api/commercial/sales-order-flow/summary"
    );
    assert.equal(
      SALES_ORDER_FLOW_LIST_API_PATH,
      "/api/commercial/sales-order-flow"
    );
    assert.equal(
      SALES_ORDER_FLOW_FEATURE_STATUS_API_PATH,
      "/api/commercial/sales-order-flow/feature-status"
    );
    assert.equal(
      buildSalesOrderFlowQueryString({
        q: "  ABC  ",
        overdue: true,
        stages: ["WAITING_RELEASE", "CANCELED"],
        limit: 20,
      }),
      "?q=ABC&overdue=true&stages=WAITING_RELEASE%2CCANCELED&limit=20"
    );
  });

  it("módulo shell cobre estados básicos", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    assert.match(mod, /sales-order-flow-module/);
    assert.match(mod, /sales-order-flow-breadcrumb/);
    assert.match(mod, /sales-order-flow-denied/);
    assert.match(mod, /sales-order-flow-loading/);
    assert.match(mod, /sales-order-flow-empty/);
    assert.match(mod, /sales-order-flow-feature-disabled/);
    assert.doesNotMatch(mod, /drawer|Drawer|KanbanColumn/);
  });
});
