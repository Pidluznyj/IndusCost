import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  authorizeResourceAccess,
  requirePermission,
} from "./permissionGuards.ts";
import { PermissionResourceKeys } from "./permissionsCatalog.ts";
import type { AppAuthContext } from "@/src/lib/appAuth.js";

function auth(partial: {
  id?: string;
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  return {
    id: partial.id ?? "user-1",
    name: "Test",
    email: "test@example.com",
    role: partial.role,
    permissions: partial.permissions ?? [],
    effectivePermissions: partial.permissions ?? [],
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
  };
}

async function runGuard(
  resourceKey: string,
  action: "view" | "execute" | "manage" | "admin",
  appAuth: AppAuthContext | null
): Promise<{ status: number; body: Record<string, unknown> }> {
  const prevStrict = process.env.PERMISSION_GUARD_STRICT;
  process.env.PERMISSION_GUARD_STRICT = "1";
  try {
    const guard = requirePermission(resourceKey, action);
    let status = 200;
    let body: Record<string, unknown> = { ok: true };
    const req = {
      appAuth: appAuth ?? undefined,
      originalUrl: "/api/test",
      path: "/api/test",
    } as Parameters<typeof guard>[0];
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        body = payload;
        return this;
      },
    } as unknown as Parameters<typeof guard>[1];
    await new Promise<void>((resolve, reject) => {
      guard(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return { status, body };
  } finally {
    if (prevStrict === undefined) delete process.env.PERMISSION_GUARD_STRICT;
    else process.env.PERMISSION_GUARD_STRICT = prevStrict;
  }
}

describe("permissionGuards API protection", () => {
  it("usuário sem auth recebe 401", () => {
    const result = authorizeResourceAccess(
      null,
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
      "view"
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  });

  it("usuário autenticado sem permissão recebe 403", () => {
    const result = authorizeResourceAccess(
      auth({ role: "SELLER", permissions: ["crm.view"] }),
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
      "view"
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(
        result.body.resourceKey,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA
      );
      assert.match(String(result.body.message), /não tem permissão/i);
      assert.equal(result.body.error, "FORBIDDEN");
    }
  });

  it("SUPER_ADMIN recebe autorização (200 no guard)", async () => {
    const result = authorizeResourceAccess(
      auth({ role: "SUPER_ADMIN", permissions: [] }),
      PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
      "admin"
    );
    assert.equal(result.ok, true);

    const http = await runGuard(
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
      "view",
      auth({ role: "SUPER_ADMIN" })
    );
    assert.equal(http.status, 200);
  });

  it("usuário com tab.conciliacao não acessa tab.auditoria", () => {
    const user = auth({
      role: "VIEWER",
      permissions: [
        "finance.view",
        "finance.portfolioReconciliation.view",
        "finance.portfolioReconciliation.conciliation.view",
      ],
    });
    assert.equal(
      authorizeResourceAccess(
        user,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        "view"
      ).ok,
      true
    );
    assert.equal(
      authorizeResourceAccess(
        user,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
        "view"
      ).ok,
      false
    );
  });

  it("usuário com menu financeiro mas sem aba não acessa API da aba", () => {
    const user = auth({
      role: "VIEWER",
      permissions: ["finance.view"],
    });
    assert.equal(
      authorizeResourceAccess(user, PermissionResourceKeys.FINANCEIRO, "view").ok,
      true
    );
    assert.equal(
      authorizeResourceAccess(
        user,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        "view"
      ).ok,
      false
    );
    assert.equal(
      authorizeResourceAccess(
        user,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
        "view"
      ).ok,
      false
    );
  });

  it("admin.permissoes protegido (manage ACL)", () => {
    const seller = auth({ role: "SELLER", permissions: ["crm.view"] });
    const denied = authorizeResourceAccess(
      seller,
      PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
      "admin"
    );
    assert.equal(denied.ok, false);

    const manager = auth({
      role: "VIEWER",
      permissions: ["accessProfiles.view", "accessProfiles.manage", "settings.view"],
    });
    assert.equal(
      authorizeResourceAccess(
        manager,
        PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
        "admin"
      ).ok,
      true
    );
  });

  it("ADMIN role seed acessa conciliação; SELLER não", () => {
    assert.equal(
      authorizeResourceAccess(
        auth({ role: "ADMIN", permissions: [] }),
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
        "view"
      ).ok,
      true
    );
    assert.equal(
      authorizeResourceAccess(
        auth({ role: "SELLER", permissions: [] }),
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
        "view"
      ).ok,
      false
    );
  });

  it("rotas de conciliação usam requirePermission do motor relacional", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financePortfolioReconciliationRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /requirePermission/);
    assert.match(
      routes,
      /FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO/
    );
    assert.match(
      routes,
      /FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA/
    );
    assert.match(
      routes,
      /FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA/
    );
    assert.doesNotMatch(routes, /requireAnyPermission/);
  });
});
