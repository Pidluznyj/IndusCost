import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PermissionResourceKeys,
  PORTFOLIO_RECONCILIATION_TAB_KEYS,
  getPermissionCatalog,
} from "./permissionsCatalog.ts";
import {
  assertCanAccessResource,
  canAccessResource,
  createInMemoryPermissionPort,
  createSeedPermissionSnapshot,
  getAllowedMenuTree,
  getAllowedTabs,
  getUserPermissions,
} from "./permissionService.ts";
import { PermissionAccessError } from "./permissionTypes.ts";

describe("permissionService motor relacional", () => {
  it("SUPER_ADMIN acessa tudo (incl. tabs de conciliação e admin)", () => {
    const subject = { id: "sa", role: "SUPER_ADMIN" as const };
    const snap = createSeedPermissionSnapshot({ role: "SUPER_ADMIN", userId: "sa" });

    for (const key of [
      PermissionResourceKeys.DASHBOARD,
      PermissionResourceKeys.FINANCEIRO,
      PermissionResourceKeys.ADMIN_PERMISSOES,
      PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
      ...PORTFOLIO_RECONCILIATION_TAB_KEYS,
    ]) {
      assert.equal(canAccessResource(subject, key, "view", snap), true, key);
      assert.equal(canAccessResource(subject, key, "execute", snap), true, key);
      assert.equal(canAccessResource(subject, key, "manage", snap), true, key);
    }
  });

  it("ADMIN acessa recursos padrão (financeiro + conciliação; sem manage ACL crítica)", () => {
    const subject = { id: "adm", role: "ADMIN" as const };
    const snap = createSeedPermissionSnapshot({ role: "ADMIN", userId: "adm" });

    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.FINANCEIRO, "view", snap),
      true
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
        "view",
        snap
      ),
      true
    );
    for (const tab of PORTFOLIO_RECONCILIATION_TAB_KEYS) {
      assert.equal(canAccessResource(subject, tab, "view", snap), true, tab);
    }
    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.ADMIN_USUARIOS, "manage", snap),
      true
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
        "manage",
        snap
      ),
      false
    );
  });

  it("SELLER não acessa admin.permissoes", () => {
    const subject = { id: "sel", role: "SELLER" as const };
    const snap = createSeedPermissionSnapshot({ role: "SELLER", userId: "sel" });
    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.ADMIN_PERMISSOES, "view", snap),
      false
    );
    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.COMERCIAL_CRM, "view", snap),
      true
    );
  });

  it("VIEWER não acessa ações execute/admin", () => {
    const subject = { id: "vw", role: "VIEWER" as const };
    const snap = createSeedPermissionSnapshot({ role: "VIEWER", userId: "vw" });

    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.COMERCIAL_PEDIDOS_VENDA, "view", snap),
      true
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.COMERCIAL_PEDIDOS_VENDA,
        "execute",
        snap
      ),
      false
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.COMERCIAL_PEDIDOS_VENDA,
        "admin",
        snap
      ),
      false
    );
    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.FINANCEIRO, "view", snap),
      false
    );
  });

  it("negar menu pai nega submenu/aba", () => {
    const subject = { id: "adm", role: "ADMIN" as const };
    const snap = createSeedPermissionSnapshot({
      role: "ADMIN",
      userId: "adm",
      overrides: [
        {
          userId: "adm",
          resourceKey: PermissionResourceKeys.FINANCEIRO,
          canView: false,
          canExecute: null,
          canManage: null,
          reason: "bloqueio teste",
        },
      ],
    });

    assert.equal(
      canAccessResource(subject, PermissionResourceKeys.FINANCEIRO, "view", snap),
      false
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
        "view",
        snap
      ),
      false
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
        "view",
        snap
      ),
      false
    );
  });

  it("override por usuário libera recurso específico (com pais intactos)", () => {
    const subject = { id: "sel", role: "SELLER" as const };
    const snap = createSeedPermissionSnapshot({
      role: "SELLER",
      userId: "sel",
      overrides: [
        {
          userId: "sel",
          resourceKey: PermissionResourceKeys.FINANCEIRO,
          canView: true,
          canExecute: null,
          canManage: null,
        },
        {
          userId: "sel",
          resourceKey: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
          canView: true,
          canExecute: null,
          canManage: null,
        },
        {
          userId: "sel",
          resourceKey: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
    });

    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA,
        "view",
        snap
      ),
      true
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        "view",
        snap
      ),
      false
    );
  });

  it("override por usuário bloqueia recurso específico", () => {
    const subject = { id: "adm", role: "ADMIN" as const };
    const snap = createSeedPermissionSnapshot({
      role: "ADMIN",
      userId: "adm",
      overrides: [
        {
          userId: "adm",
          resourceKey: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
          canView: false,
          canExecute: null,
          canManage: null,
        },
      ],
    });

    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        "view",
        snap
      ),
      true
    );
    assert.equal(
      canAccessResource(
        subject,
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA,
        "view",
        snap
      ),
      false
    );
  });

  it("recurso desconhecido nega (não-SUPER_ADMIN)", () => {
    const subject = { id: "adm", role: "ADMIN" as const };
    const snap = createSeedPermissionSnapshot({ role: "ADMIN", userId: "adm" });
    assert.equal(canAccessResource(subject, "recurso.inexistente.xyz", "view", snap), false);
    assert.throws(
      () => assertCanAccessResource(subject, "recurso.inexistente.xyz", "view", snap),
      (err: unknown) => err instanceof PermissionAccessError
    );
  });

  it("recurso inativo nega ADMIN; SUPER_ADMIN ainda acessa", () => {
    const patch = [
      {
        key: PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        isActive: false,
      },
    ];
    const adminSnap = createSeedPermissionSnapshot({
      role: "ADMIN",
      userId: "adm",
      resourcePatches: patch,
    });
    const saSnap = createSeedPermissionSnapshot({
      role: "SUPER_ADMIN",
      userId: "sa",
      resourcePatches: patch,
    });
    assert.equal(
      canAccessResource(
        { id: "adm", role: "ADMIN" },
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        "view",
        adminSnap
      ),
      false
    );
    assert.equal(
      canAccessResource(
        { id: "sa", role: "SUPER_ADMIN" },
        PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO,
        "view",
        saSnap
      ),
      true
    );
  });

  it("getAllowedTabs devolve as 4 abas de Conciliação para ADMIN", () => {
    const subject = { id: "adm", role: "ADMIN" as const };
    const snap = createSeedPermissionSnapshot({ role: "ADMIN", userId: "adm" });
    const tabs = getAllowedTabs(
      subject,
      PermissionResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA,
      snap
    );
    assert.deepEqual(
      tabs.map((t) => t.key).sort(),
      [...PORTFOLIO_RECONCILIATION_TAB_KEYS].sort()
    );
  });

  it("getAllowedMenuTree para SELLER não inclui financeiro/admin", () => {
    const subject = { id: "sel", role: "SELLER" as const };
    const snap = createSeedPermissionSnapshot({ role: "SELLER", userId: "sel" });
    const tree = getAllowedMenuTree(subject, snap);
    const keys = JSON.stringify(tree);
    assert.ok(keys.includes(PermissionResourceKeys.COMERCIAL));
    assert.ok(!keys.includes(`"${PermissionResourceKeys.FINANCEIRO}"`));
    assert.ok(!keys.includes(`"${PermissionResourceKeys.ADMIN}"`));
  });

  it("getUserPermissions via porta in-memory", async () => {
    const snap = createSeedPermissionSnapshot({
      role: "ADMIN",
      userId: "adm-1",
      overrides: [
        {
          userId: "adm-1",
          resourceKey: PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
          canView: true,
          canExecute: false,
          canManage: true,
        },
      ],
    });
    // Porta precisa das grants do role ADMIN no snapshot.
    const full = createSeedPermissionSnapshot({ role: "ADMIN" });
    const port = createInMemoryPermissionPort(
      [{ id: "adm-1", role: "ADMIN" }],
      {
        resources: full.resources,
        rolePermissions: full.rolePermissions,
        overrides: snap.overrides,
      }
    );
    const resolved = await getUserPermissions("adm-1", port);
    assert.ok(resolved);
    assert.equal(resolved!.role, "ADMIN");
    assert.equal(
      resolved!.byResource[PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE]?.canManage,
      true
    );
  });

  it("getPermissionCatalog expõe hierarquia mínima", () => {
    const catalog = getPermissionCatalog();
    assert.ok(catalog.some((r) => r.key === PermissionResourceKeys.FINANCEIRO));
    assert.ok(
      catalog.some(
        (r) => r.key === PermissionResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA
      )
    );
  });
});
