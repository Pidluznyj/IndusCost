import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MODULE_SHORT_LABELS,
  NAVIGATION_GROUP_SHORT_LABELS,
  resolveAppHeaderBreadcrumb,
  resolveModuleShortLabel,
  resolveNavigationGroupShortLabel,
} from "./sidebarLabels.js";
import { MODULE_LABELS } from "./modulePermissions.js";

describe("sidebarLabels — rótulos curtos visíveis", () => {
  it("grupos principais têm abreviação touch-friendly", () => {
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.engenharia, "Eng.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.cadeia_suprimentos, "Cad.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.comercial, "Com.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.financeiro, "Fin.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.operacoes, "Ops.");
  });

  it("módulos têm rótulo curto distinto do tooltip", () => {
    assert.equal(resolveModuleShortLabel("materials"), "Supr.");
    assert.equal(resolveModuleShortLabel("products"), "Prod.");
    assert.equal(resolveModuleShortLabel("commissions"), "Comiss.");
    assert.equal(MODULE_SHORT_LABELS.dashboard, "Home");
  });

  it("fallback usa MODULE_LABELS quando módulo não mapeado", () => {
    const fakeId = "dashboard" as const;
    assert.equal(resolveModuleShortLabel(fakeId), MODULE_SHORT_LABELS[fakeId]);
  });

  it("resolveNavigationGroupShortLabel cobre todos os grupos", () => {
    for (const groupId of Object.keys(NAVIGATION_GROUP_SHORT_LABELS)) {
      assert.ok(resolveNavigationGroupShortLabel(groupId as keyof typeof NAVIGATION_GROUP_SHORT_LABELS));
    }
  });
});

describe("sidebarLabels — breadcrumb do header", () => {
  it("dashboard retorna apenas o módulo", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/dashboard"), [
      { label: MODULE_LABELS.dashboard },
    ]);
  });

  it("módulo em grupo retorna grupo › módulo (módulo sem link na página raiz)", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/materials"), [
      { label: "Cadeia de Suprimentos" },
      { label: MODULE_LABELS.materials },
    ]);
  });

  it("comercial › comissões", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/commissions"), [
      { label: "Comercial" },
      { label: MODULE_LABELS.commissions },
    ]);
  });

  it("financeiro › fornecedores", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/finance/suppliers"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.suppliers },
    ]);
  });

  it("financeiro › relatórios", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/reports"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.reports },
    ]);
  });

  it("rota desconhecida cai em Dashboard", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/"), [{ label: MODULE_LABELS.dashboard }]);
  });

  it("pedidos › resultado: grupo sem path, módulo clicável, aba atual", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/sales-orders/result"), [
      { label: "Comercial" },
      { label: MODULE_LABELS["sales-orders"], path: "/sales-orders" },
      { label: "Resultado" },
    ]);
  });

  it("pedidos › recebíveis / gestão / produtos / MP", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/sales-orders/monthly-receivables"), [
      { label: "Comercial" },
      { label: MODULE_LABELS["sales-orders"], path: "/sales-orders" },
      { label: "Recebíveis mensais" },
    ]);
    assert.deepEqual(resolveAppHeaderBreadcrumb("/sales-orders/commercial-discounts"), [
      { label: "Comercial" },
      { label: MODULE_LABELS["sales-orders"], path: "/sales-orders" },
      { label: "Descontos comerciais" },
    ]);
    assert.equal(
      resolveAppHeaderBreadcrumb("/sales-orders/management").at(-1)?.label,
      "Gestão de Pedidos"
    );
    assert.equal(
      resolveAppHeaderBreadcrumb("/sales-orders/sold-products").at(-1)?.label,
      "Produtos Vendidos"
    );
    assert.equal(
      resolveAppHeaderBreadcrumb("/sales-orders/material-demand").at(-1)?.label,
      "Inteligência de Matéria-Prima"
    );
  });

  it("produtos vendidos › clientes compradores mantém nível intermediário clicável", () => {
    assert.deepEqual(
      resolveAppHeaderBreadcrumb("/sales-orders/sold-products/abc/customers"),
      [
        { label: "Comercial" },
        { label: MODULE_LABELS["sales-orders"], path: "/sales-orders" },
        { label: "Produtos Vendidos", path: "/sales-orders/sold-products" },
        { label: "Clientes compradores" },
      ]
    );
  });

  it("rastreabilidade fica sob Relatórios", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/reports/cost-to-cash-trace"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.reports, path: "/reports" },
      { label: "Rastreabilidade" },
    ]);
  });

  it("financeiro › contas a receber (aba do módulo)", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/finance/accounts-receivable"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.finance, path: "/finance" },
      { label: "Contas a Receber" },
    ]);
  });

  it("grupo do menu nunca recebe path (não é link)", () => {
    const crumbs = resolveAppHeaderBreadcrumb("/sales-orders/result");
    assert.equal(crumbs[0]?.path, undefined);
  });
});
