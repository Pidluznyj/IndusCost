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
    assert.equal(findGoalRecipe("REVENUE_SALES_ORDERS")?.entityKey, "SALES_ORDERS");
    assert.equal(findGoalRecipe("NAO_EXISTE"), null);
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
    for (const key of ["REVENUE_NEW_CUSTOMERS", "INVOICED_REVENUE"]) {
      const recipe = findGoalRecipe(key)!;
      const hasInvoicedFilter = recipe.filters.some(
        (f) => f.fieldKey === "SALES_INVOICED" && f.value === "INVOICED"
      );
      assert.ok(hasInvoicedFilter, `${key} deveria filtrar por NF-e vinculada`);
      assert.match(
        recipe.description,
        /valor do pedido/i,
        `${key} precisa dizer que soma o valor do pedido, não o da nota`
      );
    }
  });
});
