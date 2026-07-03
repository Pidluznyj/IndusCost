import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
} from "./permissionCatalog.js";
import {
  auditPermissionAccessGroupCoverage,
  buildPermissionAccessGroupSections,
  clearAccessGroup,
  getUnmappedPermissionKeys,
  PERMISSION_ACCESS_GROUP_DEFINITIONS,
  resolveAccessGroupForCatalogEntry,
  resolveAccessGroupForPermissionKey,
  selectAllInAccessGroup,
} from "./permissionGroups.js";
import { enablePermission } from "./permissionCatalogUtils.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("permissionGroups — cobertura do catálogo", () => {
  it("todas as permissões do catálogo aparecem em algum grupo", () => {
    const audit = auditPermissionAccessGroupCoverage();
    assert.equal(audit.groupedKeys.length, audit.catalogKeys.length);
    assert.deepEqual([...audit.groupedKeys].sort(), [...audit.catalogKeys].sort());
  });

  it("nenhuma permission key foi alterada", () => {
    const fromCatalog = PERMISSION_CATALOG.map((entry) => entry.key).sort();
    assert.deepEqual(fromCatalog, [...ALL_PERMISSION_KEYS].sort());
  });

  it("permite identificar permissões no fallback Sistema/Outros", () => {
    const unmapped = getUnmappedPermissionKeys();
    for (const key of unmapped) {
      assert.equal(resolveAccessGroupForPermissionKey(key), "outros");
    }
  });
});

describe("permissionGroups — agrupamento por área", () => {
  it("Comercial contém CRM, Clientes, Pedidos, Propostas, Formação de Preço e Comissões", () => {
    const comercial = buildPermissionAccessGroupSections([]).find((g) => g.id === "comercial");
    assert.ok(comercial);
    const keys = comercial!.permissionKeys;
    assert.ok(keys.some((k) => k.startsWith("crm.")));
    assert.ok(keys.some((k) => k.startsWith("customers.")));
    assert.ok(keys.some((k) => k.startsWith("proposals.")));
    assert.ok(keys.some((k) => k.startsWith("sales_orders.")));
    assert.ok(keys.some((k) => k.startsWith("pricing.")));
    assert.ok(keys.some((k) => k.startsWith("commissions.")));
  });

  it("Financeiro contém permissões financeiras, tributos, OPEX e relatórios", () => {
    const financeiro = buildPermissionAccessGroupSections([]).find((g) => g.id === "financeiro");
    assert.ok(financeiro);
    const keys = financeiro!.permissionKeys;
    assert.ok(keys.some((k) => k.startsWith("finance.")));
    assert.ok(keys.includes("taxes.view"));
    assert.ok(keys.includes("opex.view"));
    assert.ok(keys.includes("reports.view"));
  });

  it("Engenharia contém produtos, suprimentos, simulações e projetos", () => {
    const engenharia = buildPermissionAccessGroupSections([]).find((g) => g.id === "engenharia");
    assert.ok(engenharia);
    const keys = engenharia!.permissionKeys;
    assert.ok(keys.some((k) => k.startsWith("products.")));
    assert.ok(keys.some((k) => k.startsWith("materials.")));
    assert.ok(keys.some((k) => k.startsWith("simulations.")));
    assert.ok(keys.some((k) => k.startsWith("projects.")));
  });

  it("Operações contém estoque, compras, máquinas, performance, manutenção e frota", () => {
    const operacoes = buildPermissionAccessGroupSections([]).find((g) => g.id === "operacoes");
    assert.ok(operacoes);
    const keys = operacoes!.permissionKeys;
    assert.ok(keys.some((k) => k.startsWith("inventory.")));
    assert.ok(keys.some((k) => k.startsWith("purchases.")));
    assert.ok(keys.some((k) => k.startsWith("machines.")));
    assert.ok(keys.some((k) => k.startsWith("operations.component-performance.")));
    assert.ok(keys.some((k) => k.startsWith("maintenance.")));
    assert.ok(keys.some((k) => k.startsWith("fleet.")));
  });

  it("Administração contém Pessoas/RH, usuários, perfis e configurações", () => {
    const admin = buildPermissionAccessGroupSections([]).find((g) => g.id === "administracao");
    assert.ok(admin);
    const keys = admin!.permissionKeys;
    assert.ok(keys.some((k) => k.startsWith("employees.")));
    assert.ok(keys.some((k) => k.startsWith("settings.")));
    assert.ok(keys.includes("users.manage"));
    assert.ok(keys.includes("accessProfiles.view"));
    assert.ok(keys.includes("guide.view"));
  });
});

describe("permissionGroups — seleção preserva keys originais", () => {
  it("selectAllInAccessGroup usa as mesmas keys do catálogo", () => {
    const next = selectAllInAccessGroup("comercial", []);
    for (const key of next) {
      assert.ok(ALL_PERMISSION_KEYS.includes(key));
    }
    assert.ok(next.includes("crm.view"));
    assert.ok(next.includes("customers.view"));
  });

  it("clearAccessGroup remove apenas keys do grupo", () => {
    const selected = selectAllInAccessGroup("comercial", ["dashboard.view"]);
    const cleared = clearAccessGroup("comercial", selected);
    assert.deepEqual(cleared, ["dashboard.view"]);
  });

  it("enablePermission continua adicionando requires/pais", () => {
    const enabled = enablePermission([], "proposals.edit");
    assert.ok(enabled.includes("proposals.view"));
    assert.ok(enabled.includes("proposals.edit"));
  });
});

describe("permissionGroups — mapeamento por módulo", () => {
  it("reports.view vai para Financeiro (menu lateral)", () => {
    const entry = PERMISSION_CATALOG.find((e) => e.key === "reports.view");
    assert.ok(entry);
    assert.equal(resolveAccessGroupForCatalogEntry(entry!), "financeiro");
  });

  it("taxes.view vai para Financeiro apesar do grupo Precificação / Impostos", () => {
    const entry = PERMISSION_CATALOG.find((e) => e.key === "taxes.view");
    assert.ok(entry);
    assert.equal(resolveAccessGroupForCatalogEntry(entry!), "financeiro");
  });

  it("pricing.view permanece em Comercial", () => {
    const entry = PERMISSION_CATALOG.find((e) => e.key === "pricing.view");
    assert.ok(entry);
    assert.equal(resolveAccessGroupForCatalogEntry(entry!), "comercial");
  });
});

describe("PermissionEditor — agrupamento visual", () => {
  it("usa permissionGroups para exibir áreas da sidebar", () => {
    const editor = read("src/components/admin/PermissionEditor.tsx");
    assert.ok(editor.includes("buildPermissionAccessGroupSections"));
    assert.ok(editor.includes("selectAllInAccessGroup"));
    assert.ok(editor.includes("clearAccessGroup"));
    assert.ok(editor.includes("relatedMenuLabels"));
  });

  it("mantém togglePermissionSelected para salvar keys individuais", () => {
    const editor = read("src/components/admin/PermissionEditor.tsx");
    assert.ok(editor.includes("togglePermissionSelected"));
    assert.doesNotMatch(editor, /onChange\(\[accessGroup/);
  });
});

describe("permissionGroups — definições oficiais", () => {
  it("expõe seis áreas principais + fallback", () => {
    const ids = PERMISSION_ACCESS_GROUP_DEFINITIONS.map((g) => g.id);
    assert.deepEqual(ids, [
      "dashboard-sistema",
      "engenharia",
      "comercial",
      "financeiro",
      "operacoes",
      "administracao",
      "outros",
    ]);
  });
});
