/**
 * Metas (OKR) — P2: providers de métrica canônicos.
 *
 * Prova central: para a MESMA janela, o valor de Goals É o valor da função
 * oficial do domínio (paridade por construção + por execução com deps fake),
 * e Faturamento fiscal (NF-e) NUNCA se confunde com Pedidos de Venda.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createGoalMetricProviderRegistry,
  findGoalMetricProvider,
  GOAL_METRIC_PROVIDER_REGISTRY,
} from "./goalMetricProviders.server.js";
import { executeGoalRule, executeGoalRuleMonthly, resolveGoalRule } from "./goalRuleEngine.server.js";
import { findGoalMetadataEntity, findGoalMetadataMetric, buildGoalMetadataPublicView } from "./goalMetadata.js";
import { GoalContractError } from "./goalContracts.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const NFE_RULE = { entityKey: "FISCAL_BILLING", metricKey: "NFE_NET_TOTAL", filters: [] };
const SALES_OFFICIAL_RULE = {
  entityKey: "SALES_OFFICIAL",
  metricKey: "SALES_OFFICIAL_NET_TOTAL",
  filters: [],
};
const WINDOW = { startCivilDate: "2026-01-01", endCivilDate: "2026-12-31" };

/**
 * Cenário clássico compartilhado: pedido de R$ 100.000 com UMA NF-e
 * autorizada parcial de R$ 20.000. A "fonte oficial" fake responde como os
 * motores reais responderiam para esses dados.
 */
function classicCaseHarness() {
  const nfeCalls: Array<{ from: Date; to: Date }> = [];
  const registry = createGoalMetricProviderRegistry({
    queryFiscalNfeInPeriod: async (from: Date, to: Date) => {
      nfeCalls.push({ from, to });
      // NF-e autorizada parcial dentro da janela.
      return { count: 1, net: 20000 };
    },
  });
  const aggregateCalls: Array<Record<string, unknown>> = [];
  const fakePrisma = {
    salesOrder: {
      aggregate: async (args: Record<string, unknown>) => {
        aggregateCalls.push(args);
        // População oficial da listagem: o pedido inteiro vale 100k.
        return { _sum: { totalNetValue: 100000 }, _count: { _all: 1 } };
      },
    },
  } as unknown as PrismaClient;
  return { registry, fakePrisma, nfeCalls, aggregateCalls };
}

describe("registry — providers explícitos e tipados", () => {
  it("registra NF-e fiscal e Pedidos oficiais com fonte leiga e capacidades", () => {
    for (const key of ["NFE_FISCAL_BILLING", "SALES_ORDERS_OFFICIAL"] as const) {
      const provider = GOAL_METRIC_PROVIDER_REGISTRY.get(key);
      assert.ok(provider, key);
      assert.ok(provider!.sourceLabel.includes(">"), "fonte em formato Módulo > Tela");
      assert.equal(provider!.capabilities.customFilters, false);
      assert.equal(provider!.capabilities.employeeSlice, false);
      assert.equal(provider!.capabilities.monthlySeries, true);
      // Fonte leiga nunca expõe nome físico.
      assert.ok(!/NomusNfe|SalesOrder|SELECT/i.test(provider!.sourceLabel));
    }
    assert.equal(findGoalMetricProvider("NAO_EXISTE"), null);
    assert.equal(findGoalMetricProvider(null), null);
  });

  it("métricas oficiais do dicionário apontam para providers registrados", () => {
    const billing = findGoalMetadataEntity("FISCAL_BILLING")!;
    const billingMetric = findGoalMetadataMetric(billing, "NFE_NET_TOTAL")!;
    assert.equal(billingMetric.providerKey, "NFE_FISCAL_BILLING");
    const sales = findGoalMetadataEntity("SALES_OFFICIAL")!;
    const salesMetric = findGoalMetadataMetric(sales, "SALES_OFFICIAL_NET_TOTAL")!;
    assert.equal(salesMetric.providerKey, "SALES_ORDERS_OFFICIAL");
    // Toda métrica com providerKey resolve no registry (contrato fechado).
    for (const entity of [billing, sales]) {
      for (const metric of entity.metrics) {
        if (metric.providerKey) {
          assert.ok(
            GOAL_METRIC_PROVIDER_REGISTRY.has(metric.providerKey as never),
            `provider ausente para ${metric.key}`
          );
          assert.ok(metric.sourceLabel, `sourceLabel obrigatório em ${metric.key}`);
        }
      }
    }
  });

  it("visão pública expõe fonte leiga (isOfficial/sourceLabel) sem nomes físicos", () => {
    const view = buildGoalMetadataPublicView();
    const billing = view.find((e) => e.key === "FISCAL_BILLING")!;
    const metric = billing.metrics.find((m) => m.key === "NFE_NET_TOTAL")!;
    assert.equal(metric.isOfficial, true);
    assert.equal(metric.sourceLabel, "Financeiro > Faturamento (NF-e)");
    assert.ok(!JSON.stringify(view).includes("dbColumn"));
  });
});

describe("caso clássico — Pedido R$100.000, NF-e parcial R$20.000", () => {
  it("Pedidos de Venda oficiais medem 100.000; Faturamento fiscal mede 20.000 — nunca o mesmo número por acidente", async () => {
    const { registry, fakePrisma } = classicCaseHarness();
    const options = { providerRegistry: registry };

    const pedidos = await executeGoalRule(fakePrisma, SALES_OFFICIAL_RULE, WINDOW, options);
    const faturamento = await executeGoalRule(fakePrisma, NFE_RULE, WINDOW, options);

    assert.equal(pedidos, "100000", "regra oficial do pedido: valor integral do pedido");
    assert.equal(faturamento, "20000", "regra oficial NF-e: só o que virou nota autorizada");
    assert.notEqual(pedidos, faturamento);
  });

  it("paridade: o valor de Goals é EXATAMENTE o retorno da função oficial (sem refórmula)", async () => {
    const registry = createGoalMetricProviderRegistry({
      queryFiscalNfeInPeriod: async () => ({ count: 3, net: 123456.78 }),
    });
    const value = await executeGoalRule(
      {} as PrismaClient,
      NFE_RULE,
      WINDOW,
      { providerRegistry: registry }
    );
    assert.equal(value, "123456.78");
  });

  it("zero/sem movimento: provider devolve 0, nunca null/NaN", async () => {
    const registry = createGoalMetricProviderRegistry({
      queryFiscalNfeInPeriod: async () => ({ count: 0, net: null }),
    });
    const value = await executeGoalRule({} as PrismaClient, NFE_RULE, WINDOW, {
      providerRegistry: registry,
    });
    assert.equal(value, "0");
  });
});

describe("consistência preview/refresh/job/série — MESMA autoridade", () => {
  it("executeGoalRuleMonthly delega ao provider (série nunca sai de outra fórmula)", async () => {
    const { registry, fakePrisma, nfeCalls } = classicCaseHarness();
    const buckets = await executeGoalRuleMonthly(
      fakePrisma,
      NFE_RULE,
      { startCivilDate: "2026-03-15", endCivilDate: "2026-04-20" },
      { providerRegistry: registry }
    );
    assert.deepEqual(
      buckets.map((b) => b.month),
      ["2026-03", "2026-04"]
    );
    // Meses de borda APARADOS pela janela do indicador — mês parcial conta
    // só os dias dentro da janela (15/03–31/03 e 01/04–20/04).
    assert.equal(nfeCalls.length, 2);
    assert.equal(nfeCalls[0]!.from.getDate(), 15);
    assert.equal(nfeCalls[0]!.to.getDate(), 31);
    assert.equal(nfeCalls[1]!.from.getDate(), 1);
    assert.equal(nfeCalls[1]!.to.getDate(), 20);
  });

  it("preview, refresh, job diário e série passam todos por executeGoalRule/executeGoalRuleMonthly", () => {
    const service = readFileSync(join(HERE, "goalService.server.ts"), "utf8");
    // O service não conhece provider nenhum: toda execução entra pelo motor,
    // que decide delegar — impossível preview usar provider e série não.
    assert.ok(!service.includes("goalMetricProviders"), "service não fala com provider direto");
    for (const entry of ["executeGoalRule(", "executeGoalRuleMonthly("]) {
      assert.ok(service.includes(entry), `service usa ${entry} do motor`);
    }
  });

  it("Goals não tem SQL próprio de NF-e — a autoridade é importada do Financeiro", () => {
    const providers = readFileSync(join(HERE, "goalMetricProviders.server.ts"), "utf8");
    assert.ok(providers.includes('from "@/src/lib/financeBillingNfeDashboard.js"'));
    assert.ok(providers.includes('from "@/src/lib/salesOrdersListSummary.js"'));
    assert.ok(
      !/Prisma\.sql|queryRaw/i.test(providers),
      "provider nunca monta SQL próprio"
    );
  });
});

describe("regras oficiais são fechadas", () => {
  it("métrica oficial com filtro personalizado é rejeitada na validação", () => {
    assert.throws(
      () =>
        resolveGoalRule({
          entityKey: "FISCAL_BILLING",
          metricKey: "NFE_NET_TOTAL",
          filters: [
            { fieldKey: "X", operator: "EQ", value: "1", connector: "AND" },
          ],
        }),
      (e: unknown) => e instanceof GoalContractError && /medição oficial/i.test(e.message)
    );
  });

  it("desdobramento por pessoa em métrica oficial é rejeitado com mensagem clara", async () => {
    await assert.rejects(
      () =>
        executeGoalRule({} as PrismaClient, NFE_RULE, WINDOW, {
          employeeColumnValue: 123,
          providerRegistry: createGoalMetricProviderRegistry({
            queryFiscalNfeInPeriod: async () => ({ count: 0, net: 0 }),
          }),
        }),
      (e: unknown) =>
        e instanceof GoalContractError && /desdobramento por pessoa/.test(e.message)
    );
  });

  it("regras personalizadas antigas continuam no motor SQL curado (compatibilidade)", async () => {
    // Rule legada de SALES_ORDERS: nada de provider — o motor monta SQL.
    let sawSql = false;
    const fakePrisma = {
      $queryRaw: async () => {
        sawSql = true;
        return [{ value: "777" }];
      },
    } as unknown as PrismaClient;
    const value = await executeGoalRule(
      fakePrisma,
      { entityKey: "SALES_ORDERS", metricKey: "SALES_NET_TOTAL", filters: [] },
      WINDOW
    );
    assert.equal(value, "777");
    assert.equal(sawSql, true);
  });
});
