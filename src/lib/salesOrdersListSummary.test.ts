import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderListSummary,
  buildSalesOrderListWhere,
  summarizeSalesOrderListRows,
} from "./salesOrdersListSummary.js";

describe("salesOrdersListSummary", () => {
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
    const where = buildSalesOrderListWhere({
      status: "SENT_TO_NOMUS",
      customerId: "uuid-client",
      responsible: "João",
      startDate: start,
      endDate: end,
    });
    assert.equal(where.status, "SENT_TO_NOMUS");
    assert.equal(where.customerId, "uuid-client");
    assert.equal(where.responsible, "João");
    assert.deepEqual(where.issueDate, { gte: start, lte: end });
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
    assert.ok(page.includes("FinanceBiKpiCard"));
    assert.ok(page.includes("Pedidos filtrados"));
    assert.ok(page.includes("Valor líquido"));
    assert.ok(page.includes("Ticket médio"));
    assert.ok(page.includes("summary"));
  });
});
