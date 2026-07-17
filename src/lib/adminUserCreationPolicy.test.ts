import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AppUserRole } from "@prisma/client";
import { resolveNewUserInitialAccess } from "./adminUserCreationPolicy.ts";

describe("novo usuário — acesso somente após criação", () => {
  it("nasce VIEWER, sem perfil, permissões ou vínculo comercial", () => {
    assert.deepEqual(resolveNewUserInitialAccess(), {
      role: AppUserRole.VIEWER,
      permissions: [],
      accessProfileId: null,
      externalSellerId: null,
      externalSellerIds: [],
      sellerResponsibleName: null,
    });
  });

  it("modal não pede perfil nem role técnica", () => {
    const source = readFileSync("src/components/AdminUsersModule.tsx", "utf8");
    const start = source.indexOf('{createOpen ? (');
    const end = source.indexOf('{resetOpen ? (', start);
    assert.ok(start >= 0 && end > start);
    const modal = source.slice(start, end);

    assert.doesNotMatch(modal, /create-user-access-profile-select/);
    assert.doesNotMatch(modal, /create-user-role-select/);
    assert.match(modal, /será criado sem perfil e sem acesso/);
  });

  it("endpoint aplica política fixa em vez dos campos enviados", () => {
    const source = readFileSync("server.ts", "utf8");
    const start = source.indexOf('app.post("/api/admin/users"');
    const end = source.indexOf('app.patch("/api/admin/users/:id"', start);
    assert.ok(start >= 0 && end > start);
    const route = source.slice(start, end);

    assert.match(route, /resolveNewUserInitialAccess\(\)/);
    assert.doesNotMatch(route, /parseAppUserRole\(req\.body\?\.role\)/);
    assert.doesNotMatch(route, /req\.body\?\.accessProfileId/);
    assert.doesNotMatch(route, /filterKnownPermissions\(req\.body\?\.permissions\)/);
  });
});
