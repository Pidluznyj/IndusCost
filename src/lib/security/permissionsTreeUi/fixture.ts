import type { PermissionTreeDecisions, PermissionTreeNode } from "./types.ts";

/**
 * Fixture demo PERM-33 — espelha hierarquia Módulo → Página → Aba → Ação
 * sem depender da API admin.
 */
export function buildPermissionsTreeFixture(): PermissionTreeNode[] {
  return [
    {
      id: "dashboard",
      resourceKey: "dashboard",
      label: "Dashboard",
      kind: "module",
      originLabel: "Perfil Visualizador",
      baselineEffective: "allowed",
      children: [
        {
          id: "dashboard.page",
          resourceKey: "dashboard",
          label: "Visão executiva",
          kind: "page",
          originLabel: "Perfil Visualizador",
          baselineEffective: "allowed",
          children: [
            {
              id: "dashboard.view",
              resourceKey: "dashboard",
              label: "Visualizar página",
              kind: "action",
              originLabel: "Perfil Visualizador",
              baselineEffective: "allowed",
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "engineering",
      resourceKey: "engineering",
      label: "Engenharia",
      kind: "module",
      originLabel: "Perfil Engenharia",
      baselineEffective: "inherited",
      children: [
        {
          id: "engineering.products",
          resourceKey: "engineering.products",
          label: "Produtos",
          kind: "page",
          originLabel: "Perfil Engenharia",
          baselineEffective: "allowed",
          children: [
            {
              id: "engineering.products.tab.info",
              resourceKey: "engineering.products.tab.info",
              label: "Produto — Info",
              kind: "tab",
              originLabel: "Perfil Engenharia",
              baselineEffective: "allowed",
              children: [
                {
                  id: "engineering.products.tab.info.view",
                  resourceKey: "engineering.products.tab.info",
                  label: "Visualizar",
                  kind: "action",
                  originLabel: "Perfil Engenharia",
                  baselineEffective: "allowed",
                  children: [],
                },
              ],
            },
            {
              id: "engineering.products.tab.bom",
              resourceKey: "engineering.products.tab.bom",
              label: "Produto — BOM",
              kind: "tab",
              originLabel: "Perfil Engenharia",
              baselineEffective: "allowed",
              children: [
                {
                  id: "engineering.products.tab.bom.view",
                  resourceKey: "engineering.products.tab.bom",
                  label: "Visualizar",
                  kind: "action",
                  originLabel: "Perfil Engenharia",
                  baselineEffective: "allowed",
                  children: [],
                },
                {
                  id: "engineering.products.tab.bom.update",
                  resourceKey: "engineering.products",
                  label: "Editar estrutura",
                  kind: "action",
                  originLabel: "—",
                  baselineEffective: "denied",
                  children: [],
                },
              ],
            },
            {
              id: "engineering.products.tab.routing",
              resourceKey: "engineering.products.tab.routing",
              label: "Produto — Roteiro",
              kind: "tab",
              originLabel: "Perfil Engenharia",
              baselineEffective: "inherited",
              children: [],
            },
          ],
        },
        {
          id: "engineering.simulations",
          resourceKey: "engineering.simulations",
          label: "Simulador de Custo de Injeção",
          kind: "page",
          originLabel: "Perfil Engenharia",
          baselineEffective: "inherited",
          children: [],
        },
      ],
    },
    {
      id: "commercial",
      resourceKey: "commercial",
      label: "Comercial",
      kind: "module",
      originLabel: "Perfil Comercial",
      baselineEffective: "allowed",
      children: [
        {
          id: "commercial.crm",
          resourceKey: "commercial.crm",
          label: "CRM Comercial",
          kind: "page",
          originLabel: "Perfil Comercial",
          baselineEffective: "allowed",
          children: [
            {
              id: "commercial.crm.general",
              resourceKey: "commercial.crm.general",
              label: "Gestão Geral",
              kind: "tab",
              originLabel: "Perfil Comercial",
              baselineEffective: "allowed",
              children: [
                {
                  id: "commercial.crm.general.view",
                  resourceKey: "commercial.crm.general",
                  label: "Visualizar",
                  kind: "action",
                  originLabel: "Perfil Comercial",
                  baselineEffective: "allowed",
                  children: [],
                },
              ],
            },
            {
              id: "commercial.crm.customer_360",
              resourceKey: "commercial.crm.customer_360",
              label: "Cliente 360",
              kind: "tab",
              originLabel: "Perfil Comercial",
              baselineEffective: "allowed",
              children: [
                {
                  id: "commercial.crm.customer_360.view",
                  resourceKey: "commercial.crm.customer_360",
                  label: "Visualizar",
                  kind: "action",
                  originLabel: "Perfil Comercial",
                  baselineEffective: "allowed",
                  children: [],
                },
              ],
            },
          ],
        },
        {
          id: "commercial.customers",
          resourceKey: "commercial.customers",
          label: "Clientes",
          kind: "page",
          originLabel: "Perfil Comercial",
          baselineEffective: "allowed",
          children: [
            {
              id: "commercial.customers.create",
              resourceKey: "commercial.customers",
              label: "Criar cliente",
              kind: "action",
              originLabel: "Override usuário",
              baselineEffective: "denied",
              children: [],
            },
            {
              id: "commercial.customers.export",
              resourceKey: "commercial.customers",
              label: "Exportar",
              kind: "action",
              originLabel: "Perfil Comercial",
              baselineEffective: "inherited",
              children: [],
            },
          ],
        },
      ],
    },
    {
      id: "finance",
      resourceKey: "finance",
      label: "Financeiro",
      kind: "module",
      originLabel: "Perfil Financeiro",
      baselineEffective: "denied",
      children: [
        {
          id: "finance.suppliers",
          resourceKey: "finance.suppliers",
          label: "Fornecedores",
          kind: "page",
          originLabel: "Perfil Financeiro",
          baselineEffective: "denied",
          children: [
            {
              id: "finance.suppliers.view",
              resourceKey: "finance.suppliers",
              label: "Visualizar fornecedor",
              kind: "action",
              originLabel: "Perfil Financeiro",
              baselineEffective: "denied",
              children: [],
            },
            {
              id: "finance.suppliers.create",
              resourceKey: "finance.suppliers",
              label: "Criar fornecedor",
              kind: "action",
              originLabel: "—",
              baselineEffective: "denied",
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

/** Decisões iniciais da demo (mistura herdar / permitir / negar). */
export function buildPermissionsTreeFixtureDecisions(): PermissionTreeDecisions {
  return {
    "engineering.products.tab.bom.update": "deny",
    "commercial.customers.create": "allow",
    "finance.suppliers.create": "inherit",
  };
}
