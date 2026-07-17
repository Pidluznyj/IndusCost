import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandOverridesToAliases,
  getBridgedOfficialRolePermissionFlags,
  listEquivalentPermissionKeys,
  resolveBridgedOverride,
} from "./permissionAliasBridge.ts";
import {
  buildEffectiveFlagsMap,
  buildPermissionAccessSummary,
} from "./permissionRolePresets.ts";
import { buildEditablePermissionTree } from "./userPermissionAdminService.ts";

describe("permissionAliasBridge — PT ↔ canônico", () => {
  it("commercial e comercial são equivalentes (1:1)", () => {
    const keys = listEquivalentPermissionKeys("commercial");
    assert.ok(keys.includes("commercial"));
    assert.ok(keys.includes("comercial"));
    const fromLegacy = listEquivalentPermissionKeys("comercial");
    assert.ok(fromLegacy.includes("commercial"));
    assert.ok(!fromLegacy.includes("comercial.pedidos_venda"));
  });

  it("aliases irmãos de admin.settings.security NÃO são clique", () => {
    const acl = listEquivalentPermissionKeys("admin.permissoes.action.manage");
    assert.ok(acl.includes("admin.settings.security"));
    assert.ok(!acl.includes("admin.usuarios"));
    const users = listEquivalentPermissionKeys("admin.usuarios");
    assert.ok(users.includes("admin.settings.security"));
    assert.ok(!users.includes("admin.permissoes.action.manage"));
  });

  it("VIEWER baseline bridged libera commercial* (matriz PT)", () => {
    const commercial = getBridgedOfficialRolePermissionFlags("VIEWER", "commercial");
    const sales = getBridgedOfficialRolePermissionFlags(
      "VIEWER",
      "commercial.sales_orders"
    );
    const docs = getBridgedOfficialRolePermissionFlags(
      "VIEWER",
      "commercial.output_documents"
    );
    assert.equal(commercial.canView, true);
    assert.equal(sales.canView, true);
    assert.equal(docs.canView, true);
  });

  it("deny em commercial aplica no alias comercial (deny wins)", () => {
    const ov = resolveBridgedOverride(
      [
        { resourceKey: "comercial", canView: true, canExecute: null, canManage: null },
        { resourceKey: "commercial", canView: false, canExecute: null, canManage: null },
      ],
      "comercial"
    );
    assert.ok(ov);
    assert.equal(ov!.canView, false);
  });

  it("expandOverridesToAliases dual-write commercial → comercial", () => {
    const expanded = expandOverridesToAliases([
      {
        resourceKey: "commercial",
        canView: false,
        canExecute: null,
        canManage: null,
      },
    ]);
    const keys = expanded.map((o) => o.resourceKey);
    assert.ok(keys.includes("commercial"));
    assert.ok(keys.includes("comercial"));
    assert.ok(expanded.every((o) => o.canView === false));
  });

  it("VIEWER sem override: resumo mostra Comercial / Pedidos / Documentos", () => {
    const effective = buildEffectiveFlagsMap("VIEWER", []);
    const summary = buildPermissionAccessSummary({ role: "VIEWER", effective });
    assert.ok(summary.menusAllowed.includes("Comercial"));
    assert.ok(
      summary.submenusAllowed.some((l) => /pedidos/i.test(l)),
      `submenus: ${summary.submenusAllowed.join(",")}`
    );
    assert.ok(
      summary.submenusAllowed.some((l) => /documentos/i.test(l)),
      `submenus: ${summary.submenusAllowed.join(",")}`
    );
  });

  it("VIEWER + deny commercial*: resumo não lista Comercial liberado", () => {
    const overrides = [
      {
        userId: "u",
        resourceKey: "commercial",
        canView: false,
        canExecute: null,
        canManage: null,
      },
      {
        userId: "u",
        resourceKey: "commercial.sales_orders",
        canView: false,
        canExecute: null,
        canManage: null,
      },
      {
        userId: "u",
        resourceKey: "commercial.output_documents",
        canView: false,
        canExecute: null,
        canManage: null,
      },
    ];
    const effective = buildEffectiveFlagsMap("VIEWER", overrides);
    assert.equal(effective.commercial?.canView, false);
    assert.equal(effective.comercial?.canView, false);
    assert.equal(effective["commercial.sales_orders"]?.canView, false);
    assert.equal(effective["comercial.pedidos_venda"]?.canView, false);

    const summary = buildPermissionAccessSummary({ role: "VIEWER", effective });
    assert.ok(!summary.menusAllowed.includes("Comercial"));
    assert.ok(!summary.submenusAllowed.some((l) => /pedidos/i.test(l)));
    assert.ok(!summary.submenusAllowed.some((l) => /documentos/i.test(l)));
  });

  it("árvore VIEWER mostra Comercial liberado até deny explícito", () => {
    const open = buildEditablePermissionTree("VIEWER", []);
    const comercial = open.find((n) => n.key === "commercial");
    assert.ok(comercial);
    assert.equal(comercial!.roleFlags.canView, true);
    assert.equal(comercial!.effectiveFlags.canView, true);

    const denied = buildEditablePermissionTree("VIEWER", [
      {
        userId: "u",
        resourceKey: "comercial",
        canView: false,
        canExecute: null,
        canManage: null,
      },
    ]);
    const node = denied.find((n) => n.key === "commercial");
    assert.ok(node);
    assert.equal(node!.effectiveFlags.canView, false);
  });
});
