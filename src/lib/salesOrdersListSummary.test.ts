import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderListSummary,
  buildSalesOrderListTotalsFromPrismaOrders,
  buildSalesOrderListWhere,
  summarizeSalesOrderListRows,
} from "./salesOrdersListSummary.js";
import {
  buildSalesOrderNomusSellerWhereFromSellerKey,
} from "./salesOrderNomusSellerDisplay.js";

describe("salesOrdersListSummary", () => {
  /** Isola testes estruturais da flag de presença (HOTFIX-05). */
  const noPresence = { env: {} as Record<string, string | undefined> };

  const allRows = [
    { id: "1", totalNetValue: 1000, totalItems: 3, customerId: "c1", status: "SENT_TO_NOMUS" },
    { id: "2", totalNetValue: 2500, totalItems: 5, customerId: "c1", status: "READY_TO_SEND" },
    { id: "3", totalNetValue: 500, totalItems: 1, customerId: "c2", status: "DRAFT" },
    { id: "4", totalNetValue: 8000, totalItems: 12, customerId: "c2", status: "SENT_TO_NOMUS" },
  ];

  function filterRows(filters: {
    status?: string;
    customerId?: string;
    responsible?: string;
  }) {
    return allRows.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (filters.customerId && row.customerId !== filters.customerId) return false;
      return true;
    });
  }

  it("total de pedidos considera todos os filtrados, não só a página", () => {
    const filtered = filterRows({ customerId: "c1" });
    const page = filtered.slice(0, 1);
    const fullSummary = summarizeSalesOrderListRows(filtered);
    const pageSummary = summarizeSalesOrderListRows(page);
    assert.equal(fullSummary.totalOrders, 2);
    assert.equal(pageSummary.totalOrders, 1);
    assert.equal(fullSummary.totalNetAmount, 3500);
  });

  it("valor líquido total soma todos os pedidos filtrados", () => {
    const summary = summarizeSalesOrderListRows(filterRows({ customerId: "c2" }));
    assert.equal(summary.totalNetAmount, 8500);
  });

  it("total de itens soma coluna Itens de todos os filtrados", () => {
    const summary = summarizeSalesOrderListRows(allRows);
    assert.equal(summary.totalItems, 21);
  });

  it("ticket médio = valor líquido / quantidade de pedidos", () => {
    const summary = summarizeSalesOrderListRows(filterRows({ customerId: "c1" }));
    assert.equal(summary.averageTicket, 1750);
  });

  it("dataset vazio não gera NaN/Infinity", () => {
    const summary = buildSalesOrderListSummary({
      totalOrders: 0,
      totalNetAmount: 0,
      totalItems: 0,
    });
    assert.equal(summary.totalOrders, 0);
    assert.equal(summary.totalNetAmount, 0);
    assert.equal(summary.totalItems, 0);
    assert.equal(summary.averageTicket, 0);
    assert.ok(Number.isFinite(summary.averageTicket));
  });

  it("filtro por cliente altera os totais", () => {
    const all = summarizeSalesOrderListRows(allRows);
    const c1 = summarizeSalesOrderListRows(filterRows({ customerId: "c1" }));
    assert.equal(all.totalOrders, 4);
    assert.equal(c1.totalOrders, 2);
    assert.notEqual(all.totalNetAmount, c1.totalNetAmount);
  });

  it("filtro por status altera os totais", () => {
    const sent = summarizeSalesOrderListRows(filterRows({ status: "SENT_TO_NOMUS" }));
    assert.equal(sent.totalOrders, 2);
    assert.equal(sent.totalNetAmount, 9000);
  });

  it("buildSalesOrderListWhere aplica status, cliente e período", () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31, 23, 59, 59, 999);
    const where = buildSalesOrderListWhere(
      {
        status: "SENT_TO_NOMUS",
        customerId: "uuid-client",
        seller: "464",
        startDate: start,
        endDate: end,
      },
      noPresence
    );
    assert.ok(where.AND);
    const and = where.AND as Array<Record<string, unknown>>;
    assert.ok(and.some((c) => c.status === "SENT_TO_NOMUS"));
    assert.ok(and.some((c) => c.customerId === "uuid-client"));
    assert.ok(and.some((c) => c.externalSellerId === 464));
    assert.ok(and.some((c) => JSON.stringify(c).includes("issueDate")));
    assert.ok(!JSON.stringify(where).includes('"responsible"'));
  });

  it("buildSalesOrderListWhere com sellerWhere não usa responsible legado", () => {
    const where = buildSalesOrderListWhere(
      {
        seller: "João",
        sellerWhere: { externalSellerId: { in: [464] } },
      },
      noPresence
    );
    const and = (where as { AND?: Array<Record<string, unknown>> }).AND;
    assert.ok(Array.isArray(and));
    assert.ok(and!.some((c) => c.status && JSON.stringify(c.status).includes("CANCELLED")));
    assert.ok(and!.some((c) => JSON.stringify(c).includes("464")));
    assert.ok(!JSON.stringify(where).includes('"responsible"'));
  });

  it("buildSalesOrderListWhere filtra issueDate por ano", () => {
    const where = buildSalesOrderListWhere({ year: 2026 }, noPresence);
    const and = (where as { AND?: Array<Record<string, unknown>> }).AND;
    assert.ok(Array.isArray(and));
    const issue = and!.find((c) => c.issueDate) as { issueDate: unknown };
    assert.deepEqual(issue.issueDate, {
      gte: new Date(2026, 0, 1, 0, 0, 0, 0),
      lt: new Date(2027, 0, 1, 0, 0, 0, 0),
    });
  });

  it("buildSalesOrderListWhere filtra issueDate por ano e mês", () => {
    const where = buildSalesOrderListWhere({ year: 2026, month: 6 }, noPresence);
    const and = (where as { AND?: Array<Record<string, unknown>> }).AND;
    assert.ok(Array.isArray(and));
    const issue = and!.find((c) => c.issueDate) as { issueDate: unknown };
    assert.deepEqual(issue.issueDate, {
      gte: new Date(2026, 5, 1, 0, 0, 0, 0),
      lt: new Date(2026, 6, 1, 0, 0, 0, 0),
    });
  });

  it("buildSalesOrderListWhere calcula corretamente o fim de dezembro", () => {
    const where = buildSalesOrderListWhere({ year: 2026, month: 12 }, noPresence);
    const and = (where as { AND?: Array<Record<string, unknown>> }).AND;
    assert.ok(Array.isArray(and));
    const issue = and!.find((c) => c.issueDate) as { issueDate: unknown };
    assert.deepEqual(issue.issueDate, {
      gte: new Date(2026, 11, 1, 0, 0, 0, 0),
      lt: new Date(2027, 0, 1, 0, 0, 0, 0),
    });
  });

  it("buildSalesOrderListWhere ignora ano inválido (filtros antigos seguem)", () => {
    const where = buildSalesOrderListWhere(
      {
        status: "DRAFT",
        year: Number.NaN as unknown as number,
        month: 6,
      },
      noPresence
    );
    assert.equal(where.status, "DRAFT");
    assert.equal(where.issueDate, undefined);
  });

  it("buildSalesOrderListWhere com sellerKey via sellerWhere filtra externalSellerId", () => {
    const where = buildSalesOrderListWhere(
      {
        sellerWhere: buildSalesOrderNomusSellerWhereFromSellerKey("464"),
      },
      noPresence
    );
    const and = (where as { AND?: Array<Record<string, unknown>> }).AND;
    assert.ok(Array.isArray(and));
    assert.ok(and!.some((c) => c.externalSellerId === 464));
  });

  it("buildSalesOrderListWhere com sellerKey sem vendedor", () => {
    const where = buildSalesOrderListWhere(
      {
        sellerWhere: buildSalesOrderNomusSellerWhereFromSellerKey("__NO_SELLER__"),
      },
      noPresence
    );
    const and = (where as { AND?: Array<Record<string, unknown>> }).AND;
    assert.ok(Array.isArray(and));
    assert.ok(and!.some((c) => c.externalSellerId === null));
  });

  it("buildSalesOrderListWhere exclui CANCELLED por padrão na população operacional", () => {
    const where = buildSalesOrderListWhere({}, noPresence);
    assert.match(JSON.stringify(where), /"not":"CANCELLED"/);
  });

  it("buildSalesOrderListWhere filtra Com NF via nfeLinks válidos", () => {
    const where = buildSalesOrderListWhere({ hasInvoice: true }, noPresence);
    const json = JSON.stringify(where);
    assert.match(json, /"nfeLinks"/);
    assert.match(json, /"some"/);
    assert.match(json, /"dataProcessamento"/);
    assert.match(json, /"not":7/);
  });

  it("buildSalesOrderListWhere filtra Sem NF via none de vínculo válido", () => {
    const where = buildSalesOrderListWhere({ hasInvoice: false }, noPresence);
    const json = JSON.stringify(where);
    assert.match(json, /"nfeLinks"/);
    assert.match(json, /"none"/);
    assert.match(json, /"dataProcessamento"/);
  });

  it("UI da lista usa select de vendedor com sellerKey", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/SalesOrdersModule.tsx"),
      "utf8"
    );
    assert.ok(page.includes('params.set("sellerKey", sellerKey)'));
    assert.ok(page.includes("Todos os vendedores"));
    assert.ok(page.includes("seller-filter-options"));
  });

  it("UI da lista renderiza filtros Ano e Mês ligados à API e ao reset de página", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/SalesOrdersModule.tsx"),
      "utf8"
    );
    // Filtro Ano (label + opção "Todos os anos")
    assert.ok(page.includes(">Ano<"));
    assert.ok(page.includes("Todos os anos"));
    // Filtro Mês (label + opção "Todos os meses")
    assert.ok(page.includes(">Mês<"));
    assert.ok(page.includes("Todos os meses"));
    // Alterar Ano/Mês chama API com year/month
    assert.ok(page.includes('params.set("year", year)'));
    assert.ok(page.includes('params.set("month", month)'));
    // Ano/Mês entram na chave de filtros que dispara reset para página 1
    assert.ok(/listFiltersKey[\s\S]*year[\s\S]*month/.test(page));
    assert.ok(page.includes("setCurrentPage(1)"));
  });

  function orContains(where: ReturnType<typeof buildSalesOrderListWhere>): string[] {
    const found: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.contains === "string") found.push(obj.contains);
      for (const value of Object.values(obj)) walk(value);
    };
    walk(where);
    return found;
  }

  function searchOrClauses(
    where: ReturnType<typeof buildSalesOrderListWhere>
  ): Array<Record<string, unknown>> {
    if (Array.isArray(where.OR)) return where.OR as Array<Record<string, unknown>>;
    if (Array.isArray(where.AND)) {
      for (const clause of where.AND as Array<Record<string, unknown>>) {
        if (Array.isArray(clause.OR)) return clause.OR as Array<Record<string, unknown>>;
      }
    }
    return [];
  }

  it("busca por número puro 02682 monta OR com tokens 02682 e 2682", () => {
    const where = buildSalesOrderListWhere({ q: "02682" }, noPresence);
    assert.ok(searchOrClauses(where).length > 0);
    const contains = orContains(where);
    assert.ok(contains.includes("02682"));
    assert.ok(contains.includes("2682"));
  });

  it("busca PD 02682 encontra mesmo pedido salvo como 02682 (token 02682 presente)", () => {
    const where = buildSalesOrderListWhere({ q: "PD 02682" }, noPresence);
    const contains = orContains(where);
    // Token numérico permite casar 'PD 02682' do banco quando usuário digita variações.
    assert.ok(contains.includes("02682"));
    assert.ok(contains.includes("pd02682"));
  });

  it("OR cobre pedido, NF, cliente, vendedor, empresa e itens", () => {
    const where = buildSalesOrderListWhere({ q: "maria" }, noPresence);
    const or = searchOrClauses(where);
    const json = JSON.stringify(or);
    assert.ok(json.includes("orderCode"));
    assert.ok(json.includes("nfeLinks"));
    assert.ok(json.includes("nfeNumber"));
    assert.ok(json.includes("nomusSellerName"));
    assert.ok(!json.includes('"responsible"'));
    assert.ok(json.includes("companyIssuer"));
    assert.ok(json.includes("Customer"));
    assert.ok(json.includes("companyName"));
    assert.ok(json.includes("items"));
    assert.ok(json.includes("productNameSnapshot"));
  });

  it("busca combina com year/month (issueDate + OR juntos)", () => {
    const where = buildSalesOrderListWhere({ q: "02682", year: 2026, month: 6 }, noPresence);
    const json = JSON.stringify(where);
    assert.ok(json.includes("issueDate"), "mantém filtro de período");
    assert.ok(json.includes("OR") || json.includes("orderCode"), "mantém busca inteligente");
  });

  it("busca combina com status e cliente existentes", () => {
    const where = buildSalesOrderListWhere(
      {
        q: "02682",
        status: "SENT_TO_NOMUS",
        customerId: "cust-1",
      },
      noPresence
    );
    const json = JSON.stringify(where);
    assert.ok(json.includes("SENT_TO_NOMUS"));
    assert.ok(json.includes("cust-1"));
    assert.ok(json.includes("OR") || json.includes("orderCode"));
  });

  it("sem q → nenhum OR (filtros antigos intactos)", () => {
    const where = buildSalesOrderListWhere({ status: "DRAFT" }, noPresence);
    assert.equal(where.OR, undefined);
    assert.equal(where.status, "DRAFT");
  });

  it("UI da lista renderiza Busca inteligente ligada à API com debounce e reset", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/SalesOrdersModule.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Busca inteligente"));
    assert.ok(page.includes('params.set("q", search)'));
    // debounce ~300ms
    assert.ok(/setTimeout\(\(\) => setSearch\(searchDraft\.trim\(\)\), 300\)/.test(page));
    // entra na chave que dispara reset para página 1
    assert.ok(/listFiltersKey[\s\S]*search/.test(page));
    // Limpar filtros limpa a busca
    assert.ok(page.includes('setSearch("")'));
  });

  it("paginação não altera summary quando agregado no universo filtrado", () => {
    const filtered = allRows;
    const summaryFull = summarizeSalesOrderListRows(filtered);
    const page1 = summarizeSalesOrderListRows(filtered.slice(0, 2));
    const page2 = summarizeSalesOrderListRows(filtered.slice(2, 4));
    assert.equal(page1.totalOrders, 2);
    assert.equal(page2.totalOrders, 2);
    assert.equal(summaryFull.totalOrders, page1.totalOrders + page2.totalOrders);
    assert.equal(
      summaryFull.totalNetAmount,
      page1.totalNetAmount + page2.totalNetAmount
    );
  });

  it("UI da lista exibe cards de totalizadores acima da tabela", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/SalesOrdersModule.tsx"),
      "utf8"
    );
    const cards = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderListSummaryCards.tsx"),
      "utf8"
    );
    assert.ok(page.includes("SalesOrderListSummaryCards"));
    assert.ok(cards.includes("Pedidos filtrados"));
    assert.ok(cards.includes("Valor vendido"));
    assert.ok(cards.includes("Custo estimado"));
    assert.ok(cards.includes("totalCost"));
    assert.ok(cards.includes("costBreakdown"));
    assert.ok(cards.includes("buildSalesOrderListCostBreakdownTooltipText"));
    assert.ok(cards.includes("createPortal"));
    assert.ok(cards.includes("sales-order-list-cost-tooltip-panel"));
    assert.ok(cards.includes("Ticket médio"));
    assert.ok(cards.includes("Margem geral"));
    assert.doesNotMatch(cards, /label="Itens"/);
    assert.ok(page.includes("marginSummary"));
  });

  it("buildSalesOrderListTotalsFromPrismaOrders preserva paridade com length", () => {
    const orders = [{ totalNetValue: 100, totalItems: 1 }];
    const totals = buildSalesOrderListTotalsFromPrismaOrders(orders);
    assert.equal(totals.totalOrders, 1);
    assert.equal(totals.totalNetAmount, 100);
  });
});
