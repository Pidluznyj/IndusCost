/**
 * Receitas prontas do assistente — trava de integridade.
 *
 * Uma receita quebrada (chave renomeada no dicionário, filtro com valor fora
 * do vocabulário) só apareceria como erro na cara do usuário no meio do
 * cadastro. Aqui cada receita passa pela MESMA validação do backend
 * (resolveGoalRule): se não resolver, o teste quebra antes do deploy.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GOAL_RECIPES, findGoalRecipe } from "./goalRecipes.js";
import { resolveGoalRule } from "./goalRuleEngine.server.js";
import { GOAL_TRACKING_TYPES } from "./goalContracts.js";

describe("goalRecipes — receitas de 1 clique", () => {
  it("toda receita resolve contra o dicionário (chaves reais, filtros válidos)", () => {
    for (const recipe of GOAL_RECIPES) {
      const resolved = resolveGoalRule({
        entityKey: recipe.entityKey,
        metricKey: recipe.metricKey,
        filters: recipe.filters,
      });
      assert.equal(resolved.entity.key, recipe.entityKey);
      assert.equal(resolved.metric.key, recipe.metricKey);
      assert.equal(resolved.filters.length, recipe.filters.length);
    }
  });

  it("chaves únicas e direção sugerida sempre válida", () => {
    const keys = GOAL_RECIPES.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, "chave de receita duplicada");
    for (const recipe of GOAL_RECIPES) {
      assert.ok(
        (GOAL_TRACKING_TYPES as readonly string[]).includes(recipe.suggestedTrackingType),
        `direção inválida em ${recipe.key}`
      );
      assert.ok(recipe.title.trim().length > 0);
      assert.ok(recipe.description.trim().length > 0);
    }
  });

  it("linguagem leiga: receita nunca cita tabela/coluna do banco", () => {
    const json = JSON.stringify(GOAL_RECIPES.map((r) => [r.title, r.description]));
    for (const forbidden of ["SalesOrder", "totalNetValue", "dbTable", "SELECT", "SUM("]) {
      assert.ok(!json.includes(forbidden), `vazou termo técnico: ${forbidden}`);
    }
  });

  it("findGoalRecipe devolve a receita pela chave e null para desconhecida", () => {
    assert.equal(findGoalRecipe("FISCAL_BILLING_TOTAL")?.entityKey, "FISCAL_BILLING");
    assert.equal(findGoalRecipe("NAO_EXISTE"), null);
  });

  it("medições OFICIAIS vêm primeiro; faturamento passa pelo provider NF-e; sem receita ambígua", () => {
    const officialKeys = GOAL_RECIPES.filter((r) => r.official).map((r) => r.key);
    const firstCustomIdx = GOAL_RECIPES.findIndex((r) => !r.official);
    const lastOfficialIdx = GOAL_RECIPES.map((r) => Boolean(r.official)).lastIndexOf(true);
    assert.ok(officialKeys.length >= 2, "faturamento NF-e + pedidos oficiais");
    assert.ok(
      lastOfficialIdx < firstCustomIdx,
      "todas as oficiais antes das personalizadas"
    );
    // Faturamento é NF-e (provider oficial) — nunca SalesOrder.
    const billing = findGoalRecipe("FISCAL_BILLING_TOTAL")!;
    assert.equal(billing.entityKey, "FISCAL_BILLING");
    // Pedidos continuam PEDIDOS (fonte oficial própria).
    const orders = findGoalRecipe("OFFICIAL_SALES_ORDERS")!;
    assert.equal(orders.entityKey, "SALES_OFFICIAL");
    assert.match(orders.title, /Pedidos de Venda/);
    // Receitas ambíguas removidas (duplicavam as oficiais com outra regra).
    assert.equal(findGoalRecipe("REVENUE_SALES_ORDERS"), null);
    assert.equal(findGoalRecipe("INVOICED_REVENUE"), null);
  });

  it("semântica: receita que soma VALOR DE PEDIDO nunca se chama 'faturamento'", () => {
    // Faturamento é NF-e. Enquanto não existir provider canônico de NF-e no
    // módulo de Metas, nenhuma receita cuja fonte numérica é SalesOrder pode
    // usar 'faturamento'/'faturado' no título ou descrição — o filtro "já tem
    // nota" restringe QUAIS pedidos contam, mas o valor somado continua sendo
    // o do pedido.
    for (const recipe of GOAL_RECIPES) {
      if (recipe.entityKey !== "SALES_ORDERS") continue;
      const text = `${recipe.title} ${recipe.description}`;
      assert.ok(
        !/faturament|faturad/i.test(text),
        `receita ${recipe.key} baseada em pedidos usa linguagem de faturamento: "${text}"`
      );
    }
  });

  it("receita de pedidos com filtro de NF-e deixa explícito que soma o valor do PEDIDO", () => {
    const recipe = findGoalRecipe("REVENUE_NEW_CUSTOMERS")!;
    const hasInvoicedFilter = recipe.filters.some(
      (f) => f.fieldKey === "SALES_INVOICED" && f.value === "INVOICED"
    );
    assert.ok(hasInvoicedFilter, "deveria filtrar por NF-e vinculada");
    assert.match(
      recipe.description,
      /valor do pedido/i,
      "precisa dizer que soma o valor do pedido, não o da nota"
    );
  });
});
