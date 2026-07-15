import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAppUserDeleteGuard } from "@/src/lib/adminUserDelete";

describe("evaluateAppUserDeleteGuard", () => {
  it("bloqueia exclusão do próprio usuário", () => {
    const result = evaluateAppUserDeleteGuard({
      target: { id: "u1", role: "ADMIN", isActive: true },
      actorUserId: "u1",
      otherActiveSuperAdminCount: 1,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CANNOT_DELETE_SELF");
  });

  it("bloqueia exclusão do último SUPER_ADMIN ativo", () => {
    const result = evaluateAppUserDeleteGuard({
      target: { id: "sa", role: "SUPER_ADMIN", isActive: true },
      actorUserId: "admin",
      otherActiveSuperAdminCount: 0,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "LAST_SUPER_ADMIN_PROTECTED");
  });

  it("permite excluir SUPER_ADMIN quando há outro ativo", () => {
    const result = evaluateAppUserDeleteGuard({
      target: { id: "sa", role: "SUPER_ADMIN", isActive: true },
      actorUserId: "admin",
      otherActiveSuperAdminCount: 1,
    });
    assert.equal(result.ok, true);
  });

  it("permite excluir usuário comum", () => {
    const result = evaluateAppUserDeleteGuard({
      target: { id: "v1", role: "VIEWER", isActive: true },
      actorUserId: "admin",
      otherActiveSuperAdminCount: 0,
    });
    assert.equal(result.ok, true);
  });
});
