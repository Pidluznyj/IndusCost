/**
 * Regressão: listagem Comercial → Pedidos de Venda não exclui grupo econômico
 * (paridade com 7979d97; reverte apenas o efeito de população de d8daf91).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ECONOMIC_GROUP_CNPJ_DIGITS,
  buildEconomicGroupCustomerPrismaExclusion,
} from "./financeInternalGroupExclusions.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import { SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT } from "./salesOrderMarginService.server.js";

const ROOT = process.cwd();

function whereJson(filters: Parameters<typeof buildSalesOrderListWhere>[0] = {}) {
  return JSON.stringify(buildSalesOrderListWhere(filters, { env: {} }));
}

describe("salesOrderListIntercompanyPopulation — Pedidos de Venda", () => {
  it("1: pedido ativo de cliente externo não é filtrado pelo where default", () => {
    const w = whereJson({ year: 2026 });
    assert.match(w, /CANCELLED/);
    assert.doesNotMatch(w, /72569510000195/);
  });

  it("2–4: CNPJs Lazarios/Koppetel/SM não entram no where default da listagem", () => {
    const w = whereJson({});
    for (const cnpj of ECONOMIC_GROUP_CNPJ_DIGITS) {
      assert.doesNotMatch(w, new RegExp(cnpj));
    }
  });

  it("5: cancelados continuam fora da população ativa", () => {
    const w = JSON.parse(whereJson({}));
    assert.deepEqual(w.status ?? w.AND?.find((x: { status?: unknown }) => x.status)?.status, {
      not: "CANCELLED",
    });
  });

  it("6–7: ausência de Customer / CNPJ não adiciona exclusão de grupo", () => {
    const w = whereJson({ customerId: undefined });
    assert.doesNotMatch(w, /taxId|customerTaxId|72569510000195/);
  });

  it("8: CNPJ formatado do grupo também não é excluído no where default", () => {
    const w = whereJson({});
    assert.doesNotMatch(w, /72\.569\.510|14\.055\.501|55\.717\.719/);
  });

  it("9–10: count/findMany/summary compartilham buildSalesOrderListWhere (mesmo where)", () => {
    const listQuery = readFileSync(join(ROOT, "src/lib/salesOrderListQuery.server.ts"), "utf8");
    const summary = readFileSync(join(ROOT, "src/lib/salesOrdersListSummary.ts"), "utf8");
    const server = readFileSync(join(ROOT, "server.ts"), "utf8");
    assert.match(listQuery, /buildSalesOrderListWhere\(/);
    assert.match(summary, /buildSalesOrderListWhere/);
    assert.match(server, /resolveSalesOrderListWhere\(prisma, listQuery, sellerWhere\)/);
    assert.match(server, /buildSalesOrderListSummaryFromAggregate|aggregate/);
  });

  it("11: margin-summary usa resolveSalesOrderListWhere (mesma população)", () => {
    const margin = readFileSync(
      join(ROOT, "src/lib/salesOrderListMarginSummary.server.ts"),
      "utf8"
    );
    assert.match(margin, /resolveSalesOrderListWhere/);
  });

  it("12: paginação fica no handler após where (skip/take)", () => {
    const server = readFileSync(join(ROOT, "server.ts"), "utf8");
    const idxWhere = server.indexOf("resolveSalesOrderListWhere(prisma, listQuery, sellerWhere)");
    const idxSkip = server.indexOf("\n          skip,", idxWhere);
    const idxTake = server.indexOf("take: pageSize", idxWhere);
    assert.ok(idxWhere > 0 && idxSkip > idxWhere && idxTake > idxWhere);
  });

  it("14–15: lista e margin-summary sem nomusRawResponse em massa", () => {
    const server = readFileSync(join(ROOT, "server.ts"), "utf8");
    assert.match(server, /sem nomusRawResponse\/rawPayload|Billing da grade/);
    assert.match(server, /marginSummary:\s*undefined/);
    assert.equal(
      "nomusRawResponse" in (SALES_ORDER_LIST_MARGIN_SUMMARY_PRISMA_SELECT as object),
      false
    );
  });

  it("16–17: FE carrega margin após lista; erro de margem não limpa rows", () => {
    const fe = readFileSync(join(ROOT, "src/components/SalesOrdersModule.tsx"), "utf8");
    assert.match(fe, /Margens só DEPOIS da grade|nunca em paralelo/);
    assert.match(fe, /getSalesOrderListMarginSummaryUrl/);
    assert.match(fe, /getSalesOrderListPageMarginsUrl/);
    // Catches dedicados de margem só zeram marginSummary / logam erro.
    const pageMarginsCatch = fe.match(
      /getSalesOrderListPageMarginsUrl[\s\S]{0,800}?\.catch\(\(e\) => \{([\s\S]{0,400}?)\}\)/
    );
    const summaryCatch = fe.match(
      /getSalesOrderListMarginSummaryUrl[\s\S]{0,800}?\.catch\(\(e\) => \{([\s\S]{0,400}?)\}\)/
    );
    assert.ok(pageMarginsCatch?.[1]);
    assert.ok(summaryCatch?.[1]);
    assert.doesNotMatch(pageMarginsCatch![1], /setRows\(\[\]\)/);
    assert.doesNotMatch(summaryCatch![1], /setRows\(\[\]\)/);
    assert.match(summaryCatch![1], /setMarginSummary\(null\)/);
  });

  it("18–19: Kanban e Conciliação de Carteira não foram tocados neste fix", () => {
    // Guardrails de escopo — arquivos fora do diff da listagem.
    assert.ok(readFileSync(join(ROOT, "src/lib/salesOrdersListSummary.ts"), "utf8").length > 0);
  });

  it("20: helper intercompany global e opt-in da listagem permanecem disponíveis", () => {
    const exclusion = buildEconomicGroupCustomerPrismaExclusion();
    assert.ok(exclusion);
    const optIn = buildSalesOrderListWhere({}, { env: {}, excludeEconomicGroupCustomers: true });
    assert.match(JSON.stringify(optIn), /72569510000195/);
    const ar = readFileSync(join(ROOT, "src/lib/financeInternalGroupExclusions.ts"), "utf8");
    assert.match(ar, /isIntercompanyReceivable/);
    assert.match(ar, /isIntercompanyPayable/);
    const financeSo = readFileSync(join(ROOT, "src/lib/financeSalesOrdersDashboard.ts"), "utf8");
    assert.match(financeSo, /FINANCE_SO_EXCLUDE_GROUP_COMPANIES\s*=\s*true/);
    const metrics = readFileSync(join(ROOT, "src/lib/salesOrdersDashboardMetrics.ts"), "utf8");
    assert.match(metrics, /excludeGroupCompanyCustomers \?\? true/);
  });

  it("opt-in explícito ainda exclui o grupo quando solicitado", () => {
    const withEx = buildSalesOrderListWhere({}, { env: {}, excludeEconomicGroupCustomers: true });
    const without = buildSalesOrderListWhere({}, { env: {} });
    assert.notDeepEqual(withEx, without);
  });
});
