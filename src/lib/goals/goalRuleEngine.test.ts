import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accumulateGoalRuleMonths,
  buildGoalRuleMonthlyQuery,
  buildGoalRuleQuery,
  executeGoalRule,
  normalizeGoalRuleForPersist,
  resolveGoalRule,
} from "./goalRuleEngine.server.js";
import {
  GOAL_METADATA_ENTITIES,
  buildGoalMetadataPublicView,
} from "./goalMetadata.js";
import { GoalContractError } from "./goalContracts.js";
import type { PrismaClient } from "@prisma/client";

const WINDOW = { startCivilDate: "2026-01-01", endCivilDate: "2026-12-31" };

const VALID_RULE = {
  entityKey: "SALES_ORDERS",
  metricKey: "SALES_NET_TOTAL",
  filters: [
    {
      fieldKey: "SALES_STATUS",
      operator: "EQ",
      value: "SENT_TO_NOMUS",
      connector: "AND",
    },
  ],
};

describe("goalMetadata — governança do dicionário", () => {
  it("visão pública NUNCA expõe nomes reais de tabela/coluna", () => {
    const json = JSON.stringify(buildGoalMetadataPublicView());
    for (const forbidden of [
      "dbTable",
      "dbColumn",
      "SalesOrder",
      "NomusAccountsReceivable",
      "totalNetValue",
      "amountReceived",
      "externalSellerId",
    ]) {
      assert.ok(!json.includes(forbidden), `visão pública vazou: ${forbidden}`);
    }
  });

  it("chaves de entidade/métrica/campo são únicas", () => {
    const entityKeys = GOAL_METADATA_ENTITIES.map((e) => e.key);
    assert.equal(entityKeys.length, new Set(entityKeys).size);
    for (const entity of GOAL_METADATA_ENTITIES) {
      const metricKeys = entity.metrics.map((m) => m.key);
      assert.equal(metricKeys.length, new Set(metricKeys).size, entity.key);
      const fieldKeys = entity.filterFields.map((f) => f.key);
      assert.equal(fieldKeys.length, new Set(fieldKeys).size, entity.key);
    }
  });

  it("RN-003: SUM/AVG sempre têm coluna numérica; COUNT nunca tem", () => {
    for (const entity of GOAL_METADATA_ENTITIES) {
      for (const metric of entity.metrics) {
        if (metric.operation === "COUNT") assert.equal(metric.dbColumn, null);
        else assert.ok(metric.dbColumn, `${metric.key} sem coluna`);
      }
    }
  });
});

describe("resolveGoalRule — validação total contra o dicionário", () => {
  it("regra válida resolve entidade, métrica e filtros", () => {
    const resolved = resolveGoalRule(VALID_RULE);
    assert.equal(resolved.entity.dbTable, "SalesOrder");
    assert.equal(resolved.metric.dbColumn, "totalNetValue");
    assert.equal(resolved.filters.length, 1);
  });

  it("entidade/métrica/campo fora do dicionário são rejeitados", () => {
    assert.throws(
      () => resolveGoalRule({ ...VALID_RULE, entityKey: "USERS_TABLE" }),
      GoalContractError
    );
    assert.throws(
      () => resolveGoalRule({ ...VALID_RULE, metricKey: "DROP_TABLE" }),
      GoalContractError
    );
    assert.throws(
      () =>
        resolveGoalRule({
          ...VALID_RULE,
          filters: [{ fieldKey: "passwordHash", operator: "EQ", value: "x", connector: "AND" }],
        }),
      GoalContractError
    );
  });

  it("valor de ENUM fora das opções e operador não permitido são rejeitados", () => {
    assert.throws(() =>
      resolveGoalRule({
        ...VALID_RULE,
        filters: [
          { fieldKey: "SALES_STATUS", operator: "EQ", value: "'; DROP TABLE --", connector: "AND" },
        ],
      })
    );
    assert.throws(() =>
      resolveGoalRule({
        ...VALID_RULE,
        filters: [
          { fieldKey: "SALES_STATUS", operator: "CONTAINS", value: "SENT", connector: "AND" },
        ],
      })
    );
  });

  it("normalização persiste apenas chaves canônicas", () => {
    const normalized = normalizeGoalRuleForPersist(VALID_RULE);
    assert.deepEqual(Object.keys(normalized).sort(), ["entityKey", "filters", "metricKey"]);
  });
});

describe("buildGoalRuleQuery — SQL seguro e determinístico", () => {
  it("identificadores vêm do dicionário; valores viram parâmetros", () => {
    const query = buildGoalRuleQuery(resolveGoalRule(VALID_RULE), WINDOW);
    const sql = query.sql;
    assert.ok(sql.includes('FROM "SalesOrder"'));
    assert.ok(sql.includes('COALESCE(SUM("SalesOrder"."totalNetValue"), 0)'));
    assert.ok(sql.includes('"SalesOrder"."issueDate" >='), "período sempre aplicado");
    assert.ok(!sql.includes("SENT_TO_NOMUS"), "valor do filtro parametrizado, não inline");
    assert.ok(query.values.includes("SENT_TO_NOMUS"));
  });

  it("período do Objetivo é inclusivo no último dia", () => {
    const query = buildGoalRuleQuery(resolveGoalRule(VALID_RULE), WINDOW);
    assert.ok(query.sql.includes("interval '1 day'"));
    assert.ok(query.values.includes("2026-01-01T00:00:00.000Z"));
    assert.ok(query.values.includes("2026-12-31T00:00:00.000Z"));
  });

  it("empilhamento AND/OR preserva os conectores na ordem (RN-004)", () => {
    const query = buildGoalRuleQuery(
      resolveGoalRule({
        entityKey: "SALES_ORDERS",
        metricKey: "SALES_ORDER_COUNT",
        filters: [
          { fieldKey: "SALES_COMPANY", operator: "CONTAINS", value: "Lazarios", connector: "AND" },
          { fieldKey: "SALES_COMPANY", operator: "CONTAINS", value: "Koppetel", connector: "OR" },
          { fieldKey: "SALES_STATUS", operator: "NEQ", value: "CANCELLED", connector: "AND" },
        ],
      }),
      WINDOW
    );
    const sql = query.sql;
    assert.ok(sql.includes("COUNT(*)"));
    const orIdx = sql.indexOf(" OR ");
    const andIdx = sql.lastIndexOf(" AND ");
    assert.ok(orIdx > 0 && andIdx > orIdx, "OR antes do AND final, empilhado");
    assert.ok(query.values.includes("%Lazarios%"), "CONTAINS vira ILIKE parametrizado");
  });

  it("IS_EMPTY não exige valor e gera IS NULL/vazio", () => {
    const query = buildGoalRuleQuery(
      resolveGoalRule({
        entityKey: "CUSTOMERS",
        metricKey: "NEW_CUSTOMER_COUNT",
        filters: [{ fieldKey: "CUSTOMER_SEGMENT", operator: "IS_EMPTY", value: null, connector: "AND" }],
      }),
      WINDOW
    );
    assert.ok(query.sql.includes("IS NULL"));
  });

  it("desdobramento injeta o recorte de pessoa invisivelmente (RN-006)", () => {
    const query = buildGoalRuleQuery(resolveGoalRule(VALID_RULE), WINDOW, {
      employeeColumnValue: 42,
    });
    assert.ok(query.sql.includes('"SalesOrder"."externalSellerId" ='));
    assert.ok(query.values.includes(42));
  });

  it("entidade sem coluna de pessoa rejeita desdobramento automático", () => {
    assert.throws(
      () =>
        buildGoalRuleQuery(
          resolveGoalRule({
            entityKey: "CUSTOMERS",
            metricKey: "NEW_CUSTOMER_COUNT",
            filters: [],
          }),
          WINDOW,
          { employeeColumnValue: 42 }
        ),
      GoalContractError
    );
  });
});

describe("executeGoalRule — execução parametrizada", () => {
  it("usa $queryRaw (nunca Unsafe) e devolve string decimal com fallback 0", async () => {
    const captured: unknown[] = [];
    const fakePrisma = {
      $queryRaw: async (query: unknown) => {
        captured.push(query);
        return [{ value: "12345.67" }];
      },
    } as unknown as PrismaClient;
    const value = await executeGoalRule(fakePrisma, VALID_RULE, WINDOW);
    assert.equal(value, "12345.67");
    assert.equal(captured.length, 1);

    const emptyPrisma = {
      $queryRaw: async () => [],
    } as unknown as PrismaClient;
    assert.equal(await executeGoalRule(emptyPrisma, VALID_RULE, WINDOW), "0");
  });
});

describe("série mensal — mesma regra, quebrada por mês", () => {
  it("mantém período, filtros e identificadores do dicionário, agrupando por mês", () => {
    const query = buildGoalRuleMonthlyQuery(resolveGoalRule(VALID_RULE), WINDOW);
    const sql = query.sql;
    assert.ok(sql.includes(`date_trunc('month', "SalesOrder"."issueDate")`));
    assert.ok(sql.includes('COALESCE(SUM("SalesOrder"."totalNetValue"), 0)'));
    assert.ok(sql.includes("GROUP BY 1"), "uma linha por mês");
    assert.ok(sql.includes('"SalesOrder"."issueDate" >='), "período sempre aplicado");
    assert.ok(!sql.includes("SENT_TO_NOMUS"), "filtro parametrizado, não inline");
    assert.ok(query.values.includes("SENT_TO_NOMUS"));
  });

  it("COUNT de linhas não referencia coluna agregada", () => {
    const query = buildGoalRuleMonthlyQuery(
      resolveGoalRule({
        entityKey: "SALES_ORDERS",
        metricKey: "SALES_ORDER_COUNT",
        filters: [],
      }),
      WINDOW
    );
    assert.ok(query.sql.includes(`'0'::text AS "sum"`));
    assert.ok(query.sql.includes('COUNT(*)::int AS "rowCount"'));
  });

  it("acumulado de SOMA soma; mês sem movimento herda o acumulado anterior", () => {
    const acc = accumulateGoalRuleMonths(
      ["2026-01", "2026-02", "2026-03"],
      [
        { month: "2026-01", sum: "100", rowCount: 2, valueCount: 2 },
        { month: "2026-03", sum: "50", rowCount: 1, valueCount: 1 },
      ],
      "SUM"
    );
    assert.deepEqual(
      acc.map((a) => a.accumulated),
      ["100", "100", "150"]
    );
  });

  it("acumulado de CONTAGEM conta linhas", () => {
    const acc = accumulateGoalRuleMonths(
      ["2026-01", "2026-02"],
      [
        { month: "2026-01", sum: "0", rowCount: 3, valueCount: 3 },
        { month: "2026-02", sum: "0", rowCount: 4, valueCount: 4 },
      ],
      "COUNT"
    );
    assert.deepEqual(
      acc.map((a) => a.accumulated),
      ["3", "7"]
    );
  });

  it("acumulado de MÉDIA é Σsoma/Σcontagem — não a média das médias", () => {
    // Jan: 2 linhas somando 100 (média 50). Fev: 8 linhas somando 100 (média
    // 12,5). Média do período = 200/10 = 20 — a média das médias daria 31,25.
    const acc = accumulateGoalRuleMonths(
      ["2026-01", "2026-02"],
      [
        { month: "2026-01", sum: "100", rowCount: 2, valueCount: 2 },
        { month: "2026-02", sum: "100", rowCount: 8, valueCount: 8 },
      ],
      "AVG"
    );
    assert.deepEqual(
      acc.map((a) => a.accumulated),
      ["50", "20"]
    );
  });
});
