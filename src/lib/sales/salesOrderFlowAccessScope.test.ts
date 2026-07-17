import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSalesOrderFlowAccessScope } from "./salesOrderFlowAccessScope.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";

function makeUser(
  partial: Partial<AppAuthContext> & {
    role: AppAuthContext["role"];
    permissions?: string[];
  }
): AppAuthContext {
  const permissions = new Set(partial.permissions ?? []);
  return {
    id: "user-1",
    email: "t@test.com",
    name: "Test",
    role: partial.role,
    permissions: [...permissions],
    hasPermission: (key: string) => permissions.has(key),
    hasAnyPermission: (keys: string[]) => keys.some((k) => permissions.has(k)),
    externalSellerId: partial.externalSellerId ?? null,
    sellerIdentityKey: partial.sellerIdentityKey ?? null,
    sellerResponsibleName: partial.sellerResponsibleName ?? null,
    ...partial,
  } as AppAuthContext;
}

describe("salesOrderFlowAccessScope (OP-59)", () => {
  it("SUPER_ADMIN fica unrestricted", async () => {
    const decision = await resolveSalesOrderFlowAccessScope(
      makeUser({ role: "SUPER_ADMIN" }),
      { salesOrder: {} as never }
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.mode, "unrestricted");
  });

  it("usuário sem acesso comercial recebe 403", async () => {
    const decision = await resolveSalesOrderFlowAccessScope(
      makeUser({ role: "VIEWER", permissions: [] }),
      { salesOrder: {} as never }
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      assert.equal(decision.body.code, "SALES_ORDER_FLOW_SCOPE_DENIED");
    }
  });
});
