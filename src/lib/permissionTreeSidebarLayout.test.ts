import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listPermissionSeedsForAdminUi } from "@/src/lib/permissionAdminUiSeeds.js";
import {
  buildSidebarPermissionTreeLayout,
  SIDEBAR_SECTION_NODE_PREFIX,
} from "@/src/lib/permissionTreeSidebarLayout.js";
import { isStructuralPermissionTreeNode } from "@/src/lib/security/permissionsTreeUi/index.ts";
import type { PermissionTreeNode } from "@/src/lib/security/permissionsTreeUi/index.ts";

function kindOf(type: string): PermissionTreeNode["kind"] {
  if (type === "MENU") return "module";
  if (type === "TAB") return "tab";
  if (type === "ACTION") return "action";
  return "page";
}

/** Mesma montagem do payload admin: seeds visíveis ordenados por sortOrder. */
function buildCatalogTree(): PermissionTreeNode[] {
  const seeds = [...listPermissionSeedsForAdminUi()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)
  );
  const byKey = new Map<string, PermissionTreeNode>();
  for (const seed of seeds) {
    byKey.set(seed.key, {
      id: seed.key,
      resourceKey: seed.key,
      label: seed.label,
      kind: kindOf(seed.type),
      originLabel: "Permitido no perfil",
      baselineEffective: "allowed",
      children: [],
    });
  }
  const roots: PermissionTreeNode[] = [];
  for (const seed of seeds) {
    const node = byKey.get(seed.key)!;
    const parent = seed.parentKey ? byKey.get(seed.parentKey) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function collectResourceKeys(
  nodes: readonly PermissionTreeNode[],
  out: string[] = []
): string[] {
  for (const node of nodes) {
    if (node.resourceKey) out.push(node.resourceKey);
    collectResourceKeys(node.children, out);
  }
  return out;
}

function childKeys(node: PermissionTreeNode | undefined): string[] {
  return (node?.children ?? []).map((child) => child.resourceKey);
}

function findByLabel(
  nodes: readonly PermissionTreeNode[],
  label: string
): PermissionTreeNode | undefined {
  return nodes.find((node) => node.label === label);
}

describe("permissionTreeSidebarLayout", () => {
  const catalog = buildCatalogTree();
  const layout = buildSidebarPermissionTreeLayout(catalog);

  it("raízes seguem a ordem e os rótulos do menu lateral", () => {
    assert.deepEqual(
      layout.nodes.map((node) => node.label),
      [
        "Dashboard",
        "Objetivos e Metas",
        "Engenharia",
        "Cadeia de Suprimentos",
        "Comercial",
        "Financeiro",
        "Operações",
        "Gestão de pessoas",
        "Administração",
      ]
    );
  });

  it("não perde, não duplica e não inventa recurso", () => {
    const before = collectResourceKeys(catalog).sort();
    const after = collectResourceKeys(layout.nodes).sort();
    assert.deepEqual(after, before);
    assert.equal(new Set(after).size, after.length);
    assert.deepEqual(layout.unresolvedModuleIds, []);
    assert.deepEqual(layout.orphanResourceKeys, []);
  });

  it("Cadeia de Suprimentos reúne as telas que o catálogo espalha", () => {
    const group = findByLabel(layout.nodes, "Cadeia de Suprimentos");
    assert.ok(group);
    assert.ok(isStructuralPermissionTreeNode(group!));
    assert.ok(group!.id.startsWith(SIDEBAR_SECTION_NODE_PREFIX));
    assert.deepEqual(childKeys(group), [
      "engineering.materials",
      "operations.purchases",
      "operations.supply_chain.purchases",
      "operations.inventory",
      "operations.supply_chain.inventory",
      "operations.supply_chain.receiving",
    ]);

    // As mesmas telas saem de Engenharia / Operações — sem cópia.
    assert.ok(!childKeys(findByLabel(layout.nodes, "Engenharia")).includes(
      "engineering.materials"
    ));
    assert.deepEqual(childKeys(findByLabel(layout.nodes, "Operações")), [
      "operations.machines",
      "operations.performance",
      "operations.production_orders",
      "operations.maintenance",
      "operations.fleet",
    ]);
  });

  it("Gestão de pessoas sobe o Dashboard de Pessoas para irmão de Pessoas / RH", () => {
    const group = findByLabel(layout.nodes, "Gestão de pessoas");
    assert.deepEqual(childKeys(group), [
      "admin.employees.dashboard",
      "admin.employees",
    ]);
    const employees = group!.children.find(
      (child) => child.resourceKey === "admin.employees"
    );
    assert.ok(
      !childKeys(employees).includes("admin.employees.dashboard"),
      "Dashboard de Pessoas não pode aparecer duas vezes"
    );
  });

  it("Fluxo de Pedidos vira irmão de Pedidos de venda, como na sidebar", () => {
    const commercial = findByLabel(layout.nodes, "Comercial");
    assert.deepEqual(childKeys(commercial), [
      "commercial.crm",
      "commercial.customers",
      "commercial.proposals",
      "commercial.price_table",
      "commercial.sales_orders",
      "commercial.sales_orders.flow",
      "commercial.output_documents",
      "commercial.pricing",
      "commercial.commissions",
      "commercial.satisfaction",
    ]);
  });

  it("Financeiro é seção e mantém as abas sob a própria tela /finance", () => {
    const group = findByLabel(layout.nodes, "Financeiro");
    assert.ok(isStructuralPermissionTreeNode(group!));
    assert.deepEqual(childKeys(group), [
      "finance",
      "finance.treasury",
      "finance.invested_capital_recovery",
      "finance.suppliers",
      "finance.portfolio_reconciliation",
      "finance.opex",
      "finance.tax_apuration",
    ]);
    const financePage = group!.children.find((c) => c.resourceKey === "finance");
    assert.ok(childKeys(financePage).includes("finance.cash_flow"));
    // Tela sem item de menu não some: fica sob a própria página.
    assert.ok(childKeys(financePage).includes("finance.reports"));
  });

  it("rótulo do item usa o texto do menu, mantendo id e resourceKey", () => {
    const group = findByLabel(layout.nodes, "Financeiro");
    const treasury = group!.children.find(
      (child) => child.resourceKey === "finance.treasury"
    );
    assert.equal(treasury?.label, "Tesouraria");
    assert.equal(treasury?.id, "finance.treasury");
  });

  it("árvore vazia devolve layout vazio", () => {
    assert.deepEqual(buildSidebarPermissionTreeLayout([]), {
      nodes: [],
      unresolvedModuleIds: [],
      orphanResourceKeys: [],
    });
  });
});
