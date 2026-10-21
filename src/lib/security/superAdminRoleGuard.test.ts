import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateSuperAdminRoleChange,
  roleChangeTouchesSuperAdmin,
  superAdminAuditAction,
} from "@/src/lib/security/superAdminRoleGuard";

const superAdminElevated = { id: "sa", role: "SUPER_ADMIN", elevated: true };
const superAdminPlain = { id: "sa", role: "SUPER_ADMIN", elevated: false };
const admin = { id: "adm", role: "ADMIN", elevated: false };
const viewerWithSecurity = { id: "v1", role: "VIEWER", elevated: false };

describe("guarda de privilégio SUPER_ADMIN (E2)", () => {
  it("ADMIN não se promove a SUPER_ADMIN", () => {
    const r = evaluateSuperAdminRoleChange({ actor: admin, target: { id: "adm", role: "ADMIN" }, nextRole: "SUPER_ADMIN" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "CANNOT_PROMOTE_SELF");
  });

  it("ADMIN não promove terceiro a SUPER_ADMIN", () => {
    const r = evaluateSuperAdminRoleChange({ actor: admin, target: { id: "u2", role: "VIEWER" }, nextRole: "SUPER_ADMIN" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "SUPER_ADMIN_REQUIRED");
      assert.equal(r.status, 403);
    }
  });

  it("VIEWER com permissão administrativa não promove terceiro", () => {
    const r = evaluateSuperAdminRoleChange({ actor: viewerWithSecurity, target: { id: "u2", role: "ADMIN" }, nextRole: "SUPER_ADMIN" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "SUPER_ADMIN_REQUIRED");
  });

  it("ADMIN não rebaixa um SUPER_ADMIN", () => {
    const r = evaluateSuperAdminRoleChange({ actor: admin, target: { id: "sa2", role: "SUPER_ADMIN" }, nextRole: "ADMIN" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "SUPER_ADMIN_REQUIRED");
  });

  it("SUPER_ADMIN sem step-up é recusado", () => {
    const r = evaluateSuperAdminRoleChange({ actor: superAdminPlain, target: { id: "u2", role: "ADMIN" }, nextRole: "SUPER_ADMIN" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "ADMIN_ELEVATION_REQUIRED");
      assert.equal(r.status, 403);
    }
  });

  it("SUPER_ADMIN elevado concede e retira o papel", () => {
    const grant = evaluateSuperAdminRoleChange({ actor: superAdminElevated, target: { id: "u2", role: "ADMIN" }, nextRole: "SUPER_ADMIN" });
    assert.deepEqual(grant, { ok: true, touchesSuperAdmin: true });
    const revoke = evaluateSuperAdminRoleChange({ actor: superAdminElevated, target: { id: "sa2", role: "SUPER_ADMIN" }, nextRole: "VIEWER" });
    assert.deepEqual(revoke, { ok: true, touchesSuperAdmin: true });
  });

  it("mesmo SUPER_ADMIN elevado não se promove (já é; mudança sem efeito não toca o papel)", () => {
    const r = evaluateSuperAdminRoleChange({ actor: superAdminElevated, target: { id: "sa", role: "SUPER_ADMIN" }, nextRole: "SUPER_ADMIN" });
    assert.deepEqual(r, { ok: true, touchesSuperAdmin: false });
  });

  it("mudanças entre papéis comuns não exigem SUPER_ADMIN", () => {
    const r = evaluateSuperAdminRoleChange({ actor: admin, target: { id: "u2", role: "VIEWER" }, nextRole: "SELLER" });
    assert.deepEqual(r, { ok: true, touchesSuperAdmin: false });
    assert.equal(roleChangeTouchesSuperAdmin("VIEWER", "SELLER"), false);
    assert.equal(roleChangeTouchesSuperAdmin("SELLER", "SUPER_ADMIN"), true);
    assert.equal(roleChangeTouchesSuperAdmin("SUPER_ADMIN", "SUPER_ADMIN"), false);
  });

  it("ação de auditoria distingue concessão de retirada", () => {
    assert.equal(superAdminAuditAction("ADMIN", "SUPER_ADMIN"), "SUPER_ADMIN_ROLE_GRANTED");
    assert.equal(superAdminAuditAction("SUPER_ADMIN", "ADMIN"), "SUPER_ADMIN_ROLE_REVOKED");
  });
});
