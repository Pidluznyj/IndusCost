import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CRM_ACTIVITY_NOT_CLOSED_SQL, crmOrderWithoutFollowUpNotExistsSql } from "./crmOrderPortfolioSql.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/**
 * Trava arquitetural: o CRM não pode voltar a ter regra de PEDIDO em SQL.
 * Se alguém reintroduzir status/NF/intercompany/período aqui, este teste cai.
 */
describe("crmOrderPortfolioSql — só relacionamento, zero regra de pedido", () => {
  const src = read("src/lib/crmOrderPortfolioSql.ts");

  it("não decide status de pedido", () => {
    assert.ok(!src.includes("CANCELLED"), "status de pedido é regra do canônico");
    assert.ok(!src.includes("READY_TO_SEND"));
    assert.ok(!/status::text/.test(src));
  });

  it("não decide NF / faturamento", () => {
    assert.ok(!src.includes("SalesOrderNfeLink"));
    assert.ok(!src.includes("dataProcessamento"));
    assert.ok(!src.includes("nfeStatus"));
  });

  it("não decide intercompany nem escopo de cliente", () => {
    assert.ok(!src.includes("taxId"));
    assert.ok(!/ECONOMIC_GROUP|FINANCE_INTERNAL_GROUP/.test(src));
  });

  it("não decide período de emissão", () => {
    assert.ok(!src.includes("issueDate"));
  });

  it("mantém apenas os fragmentos de atividade/follow-up", () => {
    assert.match(CRM_ACTIVITY_NOT_CLOSED_SQL.sql, /CommercialActivity|a."status"/);
    assert.match(crmOrderWithoutFollowUpNotExistsSql("so").sql, /CommercialActivity/);
  });
});

/**
 * O serviço do cockpit também não pode reintroduzir a regra por outro caminho.
 */
describe("cockpit consome a população canônica de Pedidos de Venda", () => {
  const service = read("src/lib/crmManagementDashboardService.ts");
  const facts = read("src/lib/commercial/crmManagementOrderFacts.server.ts");
  const scope = read("src/lib/commercial/crmCanonicalSalesOrderScope.server.ts");

  it("serviço não monta where/SQL de pedido", () => {
    assert.ok(!service.includes('FROM "SalesOrder"'), "sem SQL de pedido no serviço");
    assert.ok(!service.includes("CANCELLED"));
    assert.match(service, /loadCrmManagementOrderFacts/);
    assert.match(service, /loadCrmSalesOrderMetrics/);
  });

  it("fatos de pedido vêm do where canônico, não de SQL próprio", () => {
    assert.match(facts, /crmCanonicalSalesOrderWhere/);
    assert.ok(!facts.includes("$queryRaw"), "fatos de pedido não usam SQL cru");
    assert.match(facts, /buildEconomicGroupCustomerMatchOr/);
  });

  it("o adapter canônico delega ao construtor oficial da tela Pedidos", () => {
    assert.match(scope, /buildSalesOrderListWhere/);
    assert.match(scope, /resolveSalesOrderIssueDateRange/);
    assert.ok(!scope.includes("Prisma.sql"), "adapter não escreve SQL");
  });
});
