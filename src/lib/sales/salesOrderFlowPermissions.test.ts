import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import {
  resolveSalesOrderFlowCapabilities,
  resolveSalesOrderFlowManagementRequirements,
  SALES_ORDER_FLOW_RESOURCE_MATRIX,
} from "./salesOrderFlowPermissions.js";

function persona(
  role: AppAuthContext["role"],
  permissions: string[]
): AppAuthContext {
  return {
    id: `persona-${role}`,
    name: role,
    email: `${role.toLowerCase()}@test.local`,
    role,
    permissions,
    effectivePermissions: permissions,
    isActive: true,
  } as AppAuthContext;
}

describe("salesOrderFlowPermissions (OP-63)", () => {
  it("matriz usa recursos oficiais para produção e fiscal", () => {
    assert.deepEqual(SALES_ORDER_FLOW_RESOURCE_MATRIX.production, {
      resourceKey: "operations.production_orders",
      action: "view",
    });
    assert.deepEqual(SALES_ORDER_FLOW_RESOURCE_MATRIX.fiscal, {
      resourceKey: "commercial.sales_orders.invoice",
      action: "view",
    });
  });

  it("SUPER_ADMIN mantém bypass para toda a matriz", () => {
    const capabilities = resolveSalesOrderFlowCapabilities(
      persona("SUPER_ADMIN", [])
    );
    assert.ok(Object.values(capabilities).every(Boolean));
  });

  it("vendedor pode ver operação sem receber financeiro ou produção", () => {
    const capabilities = resolveSalesOrderFlowCapabilities(
      persona("SELLER", [
        "sales_orders.view",
        "sales_orders.flow.view",
        "sales_orders.flow.values.view",
        "sales_orders.flow.inconsistencies.view",
        "sales_orders.flow.timeline.view",
      ])
    );
    assert.equal(capabilities.canViewKanban, true);
    assert.equal(capabilities.canViewValues, true);
    assert.equal(capabilities.canViewInconsistencies, true);
    assert.equal(capabilities.canViewTimeline, true);
    assert.equal(capabilities.canViewProduction, false);
    assert.equal(capabilities.canViewFiscal, false);
    assert.equal(capabilities.canViewFinancial, false);
    assert.equal(capabilities.canUpdateManually, false);
  });

  it("persona operacional só ganha produção quando recurso oficial é concedido", () => {
    const capabilities = resolveSalesOrderFlowCapabilities(
      persona("VIEWER", ["operations.production-orders.view"])
    );
    assert.equal(capabilities.canViewProduction, true);
    assert.equal(capabilities.canViewKanban, false);
    assert.equal(capabilities.canViewValues, false);
  });

  it("gestor granular não herda ações irmãs", () => {
    const capabilities = resolveSalesOrderFlowCapabilities(
      persona("COMMERCIAL_MANAGER", [
        "sales_orders.view",
        "sales_orders.flow.view",
        "sales_orders.flow_management.manage",
        "sales_orders.flow_management.priority.manage",
      ])
    );
    assert.equal(capabilities.canUpdateManually, true);
    assert.equal(capabilities.canChangePriority, true);
    assert.equal(capabilities.canAssignResponsible, false);
    assert.equal(capabilities.canManageBlocking, false);
  });

  it("PATCH exige recurso adicional conforme os campos", () => {
    assert.deepEqual(
      resolveSalesOrderFlowManagementRequirements({
        priority: "HIGH",
        internalNote: "nota",
      }),
      [SALES_ORDER_FLOW_RESOURCE_MATRIX.priority]
    );
    assert.deepEqual(
      resolveSalesOrderFlowManagementRequirements({
        responsibleUserId: null,
        responsibleArea: "PCP",
        isBlocked: true,
        blockReason: "Crédito",
      }),
      [
        SALES_ORDER_FLOW_RESOURCE_MATRIX.responsibility,
        SALES_ORDER_FLOW_RESOURCE_MATRIX.blocking,
      ]
    );
    assert.deepEqual(
      resolveSalesOrderFlowManagementRequirements({
        internalNote: "nota",
      }),
      []
    );
  });

  it("recurso desconhecido permanece DENY", () => {
    const decision = authorizeRequireResource(
      persona("ADMIN", ["sales_orders.flow.view"]),
      "commercial.sales_orders.flow.unknown",
      "view",
      { legacyCompatMode: true }
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.body.code, "UNKNOWN_RESOURCE");
  });
});
