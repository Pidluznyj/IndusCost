import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  authorizeRequireResource,
  listRequireResourceLegacyBacklog,
  normalizeRequireResourceAction,
  requireResource,
  REQUIRE_RESOURCE_ADMIN_KEYS,
  resolveRequireResourceContractKey,
} from "./requireResource.ts";

function auth(partial: {
  id?: string;
  role: AppAuthContext["role"];
  permissions?: string[];
  isActive?: boolean;
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
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: partial.isActive ?? true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
  };
}

async function runGuard(
  resourceKey: string,
  action: string,
  appAuth: AppAuthContext | null
): Promise<{ status: number; body: Record<string, unknown> }> {
  const prevStrict = process.env.REQUIRE_RESOURCE_STRICT;
  process.env.REQUIRE_RESOURCE_STRICT = "1";
  try {
    const guard = requireResource(resourceKey, action);
    let status = 200;
    let body: Record<string, unknown> = { ok: true };
    let settled = false;
    const req = {
      appAuth: appAuth ?? undefined,
      originalUrl: "/api/admin/users",
      path: "/api/admin/users",
    } as Parameters<typeof guard>[0];
    await new Promise<void>((resolve, reject) => {
      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json(payload: Record<string, unknown>) {
          body = payload;
          if (!settled) {
            settled = true;
            resolve();
          }
          return this;
        },
      } as unknown as Parameters<typeof guard>[1];
      guard(req, res, (err?: unknown) => {
        if (err) {
          if (!settled) {
            settled = true;
            reject(err);
          }
          return;
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
    return { status, body };
  } finally {
    if (prevStrict === undefined) delete process.env.REQUIRE_RESOURCE_STRICT;
    else process.env.REQUIRE_RESOURCE_STRICT = prevStrict;
  }
}

describe("requireResource — resolução", () => {
  it("aliases FE/seed → contrato admin.settings.security", () => {
    assert.equal(
      resolveRequireResourceContractKey("admin.usuarios"),
      REQUIRE_RESOURCE_ADMIN_KEYS.security
    );
    assert.equal(
      resolveRequireResourceContractKey("admin.permissoes.action.manage"),
      REQUIRE_RESOURCE_ADMIN_KEYS.security
    );
    assert.equal(normalizeRequireResourceAction("admin"), "manage");
    assert.equal(normalizeRequireResourceAction("synchronize"), "execute");
  });

  it("recurso/action desconhecidos → 403", () => {
    const unknown = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["users.manage"] }),
      "totally.unknown.resource",
      "view"
    );
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.equal(unknown.status, 403);
      assert.equal(unknown.body.code, "UNKNOWN_RESOURCE");
    }

    const unsupported = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["users.manage"] }),
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "export"
    );
    assert.equal(unsupported.ok, false);
    if (!unsupported.ok) {
      assert.equal(unsupported.body.code, "UNSUPPORTED_ACTION");
    }
  });
});

describe("requireResource — auth / personas", () => {
  it("chamada direta sem sessão → 401", async () => {
    const decision = authorizeRequireResource(null, REQUIRE_RESOURCE_ADMIN_KEYS.security, "manage");
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 401);

    const http = await runGuard(REQUIRE_RESOURCE_ADMIN_KEYS.security, "manage", null);
    assert.equal(http.status, 401);
    assert.equal(http.body.error, "UNAUTHORIZED");
  });

  it("sessão antiga (bag users.manage) autoriza manage via legacyCompat", () => {
    const decision = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["users.manage"] }),
      "admin.usuarios",
      "admin",
      { legacyCompatMode: true }
    );
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.resourceKey, REQUIRE_RESOURCE_ADMIN_KEYS.security);
      assert.equal(decision.action, "manage");
    }
  });

  it("VIEWER sem bag → deny manage", () => {
    const decision = authorizeRequireResource(
      auth({ role: "VIEWER", permissions: [] }),
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage",
      { legacyCompatMode: true }
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      assert.equal(decision.body.error, "FORBIDDEN");
    }
  });

  it("deny explícito vence bag allow", () => {
    const decision = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["users.manage"] }),
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage",
      {
        legacyCompatMode: true,
        overrides: [
          {
            resourceKey: REQUIRE_RESOURCE_ADMIN_KEYS.security,
            canManage: false,
          },
        ],
      }
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.source, "OVERRIDE_DENY");
    }
  });

  it("SUPER_ADMIN bypass", async () => {
    const decision = authorizeRequireResource(
      auth({ role: "SUPER_ADMIN", permissions: [] }),
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage"
    );
    assert.equal(decision.ok, true);

    const http = await runGuard(
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage",
      auth({ role: "SUPER_ADMIN" })
    );
    assert.equal(http.status, 200);
  });

  it("usuário inativo (não SA) → 403", () => {
    const decision = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["users.manage"], isActive: false }),
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage"
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.body.code, "USER_INACTIVE");
    }
  });
});

describe("requireResource — backlog P15+", () => {
  it("lista backlog de módulos ainda legados", () => {
    const list = listRequireResourceLegacyBacklog();
    assert.ok(list.some((e) => e.prompt === "P19 residual" || e.prompt === "P20+"));
    assert.ok(list.length >= 3);
  });
});
