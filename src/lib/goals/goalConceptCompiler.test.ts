/**
 * Variáveis calculadas — SQL determinístico e seguro.
 *
 * A trava mais importante deste arquivo: o HISTÓRICO do cliente não pode ser
 * recortado pela janela da meta. Se um dia alguém "otimizar" o CTE colocando
 * o período dentro dele, todo pedido do início da janela vira "primeira
 * compra" — o número fica lindo e errado. O teste abaixo quebra nesse caso.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGoalRuleQuery, resolveGoalRule } from "./goalRuleEngine.server.js";
import { GOAL_CONCEPTS, findGoalConcept, goalConceptsForEntity } from "./goalConcepts.js";
import { findGoalMetadataEntity, findGoalMetadataField } from "./goalMetadata.js";
import { GoalContractError } from "./goalContracts.js";

const WINDOW = { startCivilDate: "2026-07-01", endCivilDate: "2026-09-30" };

function ruleWithMoment(momentKey: string, operator: "EQ" | "NEQ" = "EQ") {
  return {
    entityKey: "SALES_ORDERS",
    metricKey: "SALES_NET_TOTAL",
    filters: [
      {
        fieldKey: "SALES_CUSTOMER_MOMENT",
        operator,
        value: momentKey,
        connector: "AND",
      },
    ],
  };
}

describe("goalConcepts — catálogo curado", () => {
  it("as três situações existem, são exclusivas e falam a língua do usuário", () => {
    const keys = GOAL_CONCEPTS.map((c) => c.key);
    assert.deepEqual([...keys].sort(), ["NEW_CUSTOMER", "REACTIVATION", "REPEAT"]);
    assert.equal(new Set(keys).size, keys.length);
    for (const concept of GOAL_CONCEPTS) {
      assert.equal(concept.subjectEntityKey, "SALES_ORDERS");
      assert.equal(concept.partitionLinkKey, "ORDER_CUSTOMER");
      assert.ok(concept.summary.length > 20, `${concept.key} sem frase explicativa`);
      // Decisão do negócio: histórico só conta pedido faturado.
      assert.ok(
        concept.historyFilters.some(
          (f) => f.fieldKey === "SALES_INVOICED" && f.value === "INVOICED"
        ),
        `${concept.key} não restringe o histórico a pedidos faturados`
      );
    }
  });

  it("as opções do dicionário batem com o catálogo (frase nunca oferece variável inexistente)", () => {
    const entity = findGoalMetadataEntity("SALES_ORDERS")!;
    const field = findGoalMetadataField(entity, "SALES_CUSTOMER_MOMENT")!;
    const optionValues = (field.options ?? []).map((o) => o.value).sort();
    assert.deepEqual(optionValues, GOAL_CONCEPTS.map((c) => c.key).sort());
    for (const option of field.options ?? []) {
      assert.ok(findGoalConcept(option.value), `opção órfã: ${option.value}`);
    }
    assert.equal(goalConceptsForEntity("CUSTOMERS").length, 0);
  });
});

describe("compilação — histórico por window function", () => {
  it("classifica pela contagem ANTES da linha, com moldura explícita", () => {
    const sql = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("NEW_CUSTOMER")),
      WINDOW
    ).sql;
    assert.ok(sql.includes("WITH goal_scope AS"), "usa CTE de histórico");
    assert.ok(
      sql.includes("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING"),
      "moldura = tudo ANTES desta linha"
    );
    assert.ok(sql.includes('PARTITION BY goal_evt."customerId"'), "histórico por cliente");
    assert.ok(
      sql.includes('ORDER BY goal_evt."issueDate", goal_evt."id"'),
      "desempate determinístico entre pedidos do mesmo dia"
    );
    assert.ok(sql.includes('FROM goal_scope AS "SalesOrder"'), "CTE aliasado como a tabela");
    assert.ok(
      sql.includes('"SalesOrder"."__goal_hist_count" = '),
      "primeira compra"
    );
  });

  it("TRAVA: o histórico NUNCA é recortado pela janela da meta", () => {
    const query = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("NEW_CUSTOMER")),
      WINDOW
    );
    const cte = query.sql.slice(0, query.sql.indexOf("SELECT COALESCE"));
    // Dentro do CTE, o período só pode aparecer na PODA por cliente
    // (subquery "escopo"), nunca filtrando as linhas do próprio histórico.
    assert.ok(cte.includes("SELECT DISTINCT"), "poda por clientes da janela presente");
    assert.ok(
      !cte.includes('goal_evt."issueDate" >='),
      "o histórico do cliente não pode ser filtrado pelo período da meta"
    );
    // E o período segue aplicado no filtro externo.
    const outer = query.sql.slice(query.sql.indexOf("SELECT COALESCE"));
    assert.ok(outer.includes('"SalesOrder"."issueDate" >='));
    assert.ok(outer.includes("interval '1 day'"));
  });

  it("reativação compara a última compra com uma data relativa ao pedido", () => {
    const query = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("REACTIVATION")),
      WINDOW
    );
    assert.ok(query.sql.includes('"SalesOrder"."__goal_hist_count" > '));
    assert.ok(
      query.sql.includes("make_interval(months =>"),
      "intervalo parametrizado, nunca concatenado"
    );
    assert.ok(query.values.includes(3), "os 3 meses são DADO, não SQL");
    assert.ok(
      query.sql.includes('"SalesOrder"."__goal_hist_last" IS NOT NULL'),
      "cliente sem histórico não pode passar por reativação via NULL"
    );
  });

  it("recompra é o complemento exato da reativação", () => {
    const reativacao = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("REACTIVATION")),
      WINDOW
    ).sql;
    const recompra = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("REPEAT")),
      WINDOW
    ).sql;
    assert.ok(reativacao.includes('"__goal_hist_last" < '));
    assert.ok(recompra.includes('"__goal_hist_last" > '));
  });

  it("'não é' (NEQ) nega o predicado inteiro", () => {
    const sql = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("NEW_CUSTOMER", "NEQ")),
      WINDOW
    ).sql;
    assert.ok(sql.includes("NOT ("), "negação envolve o predicado completo");
  });

  it("sem variável calculada, a query continua sem CTE (caminho antigo intacto)", () => {
    const sql = buildGoalRuleQuery(
      resolveGoalRule({
        entityKey: "SALES_ORDERS",
        metricKey: "SALES_NET_TOTAL",
        filters: [
          { fieldKey: "SALES_STATUS", operator: "EQ", value: "SENT_TO_NOMUS", connector: "AND" },
        ],
      }),
      WINDOW
    ).sql;
    assert.ok(!sql.includes("goal_scope"));
    assert.ok(sql.includes('FROM "SalesOrder"'));
  });
});

describe("faturamento — predicado curado", () => {
  it("'faturado' é NF-e autorizada de saída (mesma regra das Comissões)", () => {
    const query = buildGoalRuleQuery(
      resolveGoalRule({
        entityKey: "SALES_ORDERS",
        metricKey: "SALES_NET_TOTAL",
        filters: [
          { fieldKey: "SALES_INVOICED", operator: "EQ", value: "INVOICED", connector: "AND" },
        ],
      }),
      WINDOW
    );
    assert.ok(query.sql.includes('EXISTS'));
    assert.ok(query.sql.includes('"SalesOrderNfeLink"'));
    assert.ok(query.values.includes(4), "status 4 = autorizada");
    assert.ok(query.values.includes(1), "tipoOperacao 1 = saída");
  });

  it("'ainda não faturado' nega o EXISTS", () => {
    const sql = buildGoalRuleQuery(
      resolveGoalRule({
        entityKey: "SALES_ORDERS",
        metricKey: "SALES_NET_TOTAL",
        filters: [
          {
            fieldKey: "SALES_INVOICED",
            operator: "EQ",
            value: "NOT_INVOICED",
            connector: "AND",
          },
        ],
      }),
      WINDOW
    ).sql;
    assert.ok(sql.includes("NOT EXISTS"));
  });
});

describe("segurança e limites", () => {
  it("valor fora do catálogo de situações é rejeitado", () => {
    assert.throws(
      () => resolveGoalRule(ruleWithMoment("CLIENTE_VIP")),
      GoalContractError
    );
  });

  it("no máximo duas situações por medição", () => {
    assert.throws(
      () =>
        resolveGoalRule({
          entityKey: "SALES_ORDERS",
          metricKey: "SALES_NET_TOTAL",
          filters: ["NEW_CUSTOMER", "REACTIVATION", "REPEAT"].map((value) => ({
            fieldKey: "SALES_CUSTOMER_MOMENT",
            operator: "EQ",
            value,
            connector: "OR",
          })),
        }),
      GoalContractError
    );
  });

  it("nada do usuário vira identificador: valores continuam parametrizados", () => {
    const query = buildGoalRuleQuery(
      resolveGoalRule(ruleWithMoment("NEW_CUSTOMER")),
      WINDOW
    );
    assert.ok(!query.sql.includes("NEW_CUSTOMER"), "a chave não vaza para o SQL");
    assert.ok(query.values.includes("2026-07-01T00:00:00.000Z"));
  });
});
