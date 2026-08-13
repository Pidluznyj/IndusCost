import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
