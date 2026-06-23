import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildManagementRowsFromOrders,
  buildSalesOrderManagementWhere,
  parseSalesOrderManagementFilters,
} from "./salesOrderManagement.js";

const NOW_2026 = new Date(2026, 5, 15);

function issueDateWindow(where: ReturnType<typeof buildSalesOrderManagementWhere>) {
  return where.issueDate as { gte?: Date; lte?: Date } | undefined;
}

function orderFixture(id: string, issueDate: Date) {
  return {
    id,
    orderCode: `PD ${id}`,
    status: "SENT_TO_NOMUS",
    issueDate,
    expectedDeliveryDate: new Date(issueDate.getFullYear(), issueDate.getMonth() + 1, 1),
    totalNetValue: 10000,
    responsible: "Vendedor",
    companyIssuer: "Empresa",
    nomusRawResponse: { itensPedido: [], nfes: [] },
    Customer: { companyName: `Cliente ${id}`, tradeName: null, taxId: null },
    items: [
      {
        id: `item-${id}`,
        externalProductId: 1,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto",
        quantity: 10,
      },
    ],
  };
}

describe("salesOrderManagement — filtro de ano (ano vigente padrão)", () => {
  it("1. sem parâmetro year usa o ano vigente (dinâmico, não hardcoded)", () => {
    const f2026 = parseSalesOrderManagementFilters({}, NOW_2026);
    assert.equal(f2026.year, 2026);
    assert.equal(f2026.allYears, undefined);

    // Prova de cálculo dinâmico: outro "now" muda o ano padrão.
    const f2027 = parseSalesOrderManagementFilters({}, new Date(2027, 0, 1));
    assert.equal(f2027.year, 2027);

    // Valor inválido também cai no ano vigente.
    assert.equal(parseSalesOrderManagementFilters({ year: "abc" }, NOW_2026).year, 2026);
    assert.equal(parseSalesOrderManagementFilters({ year: "" }, NOW_2026).year, 2026);
  });

  it("2. com year=2025 a janela usa somente 2025 (issueDate)", () => {
    const filters = parseSalesOrderManagementFilters({ year: "2025" }, NOW_2026);
    assert.equal(filters.year, 2025);
    const window = issueDateWindow(buildSalesOrderManagementWhere(filters));
    assert.ok(window);
    assert.equal(window!.gte?.getFullYear(), 2025);
    assert.equal(window!.gte?.getMonth(), 0);
    assert.equal(window!.lte?.getFullYear(), 2025);
    assert.equal(window!.lte?.getMonth(), 11);
  });

  it("3. filtro de mês é aplicado dentro do ano selecionado", () => {
    const filters = parseSalesOrderManagementFilters({ year: "2025", month: "3" }, NOW_2026);
    const window = issueDateWindow(buildSalesOrderManagementWhere(filters));
    assert.equal(window!.gte?.getFullYear(), 2025);
    assert.equal(window!.gte?.getMonth(), 2); // março
    assert.equal(window!.lte?.getFullYear(), 2025);
    assert.equal(window!.lte?.getMonth(), 2); // fim de março
  });

  it("4. cards/totalizadores são calculados sobre os pedidos do ano filtrado", () => {
    // Os pedidos já chegam filtrados por issueDate (where). Os cards/summary resumem o que veio.
    const orders = [
      orderFixture("a", new Date(2025, 2, 10)),
      orderFixture("b", new Date(2025, 7, 20)),
    ];
    const { rows, summary, cards } = buildManagementRowsFromOrders(
      orders,
      { year: 2025 },
      NOW_2026
    );
    assert.equal(rows.length, 2);
    assert.equal(summary.totalOrdersCount, 2);
    assert.equal(summary.reconciliation.countMatches, true);
    for (const value of Object.values(cards)) assert.ok(Number.isFinite(value));
  });

  it("5. a lista respeita o ano (mesma janela issueDate da query)", () => {
    const w2025 = issueDateWindow(
      buildSalesOrderManagementWhere(parseSalesOrderManagementFilters({ year: "2025" }, NOW_2026))
    );
    const w2024 = issueDateWindow(
      buildSalesOrderManagementWhere(parseSalesOrderManagementFilters({ year: "2024" }, NOW_2026))
    );
    assert.equal(w2025!.gte?.getFullYear(), 2025);
    assert.equal(w2024!.gte?.getFullYear(), 2024);
  });

  it("6. busca/filtros textuais compõem com o ano (AND), sem perder o ano", () => {
    const where = buildSalesOrderManagementWhere(
      parseSalesOrderManagementFilters(
        { year: "2025", companyIssuer: "Lazarios", customerId: "uuid-cli" },
        NOW_2026
      )
    );
    assert.equal((where.customerId as string | undefined), "uuid-cli");
    assert.ok((where.companyIssuer as { contains?: string }).contains === "Lazarios");
    assert.equal(issueDateWindow(where)!.gte?.getFullYear(), 2025);
  });

  it("7. trocar o ano não remove o escopo do vendedor (responsible permanece)", () => {
    const w2025 = buildSalesOrderManagementWhere(
      parseSalesOrderManagementFilters({ year: "2025", responsible: "GISLENE LIMA" }, NOW_2026)
    );
    const w2024 = buildSalesOrderManagementWhere(
      parseSalesOrderManagementFilters({ year: "2024", responsible: "GISLENE LIMA" }, NOW_2026)
    );
    assert.equal(w2025.responsible, "GISLENE LIMA");
    assert.equal(w2024.responsible, "GISLENE LIMA");
    assert.equal(issueDateWindow(w2025)!.gte?.getFullYear(), 2025);
    assert.equal(issueDateWindow(w2024)!.gte?.getFullYear(), 2024);
  });

  it("8. filtro de ano usa issueDate, nunca data de NF-e", () => {
    const where = buildSalesOrderManagementWhere(
      parseSalesOrderManagementFilters({ year: "2025" }, NOW_2026)
    );
    assert.ok(where.issueDate, "deve filtrar por issueDate");
    const src = readFileSync(join(process.cwd(), "src/lib/salesOrderManagement.ts"), "utf8");
    const fnStart = src.indexOf("export function buildSalesOrderManagementWhere");
    const fnBody = src.slice(fnStart, fnStart + 900);
    assert.doesNotMatch(fnBody, /nfe|dataProcessamento|invoice/i);
  });

  it("9. year=all (todos os anos) é explícito e não aplica janela de ano", () => {
    const filters = parseSalesOrderManagementFilters({ year: "all" }, NOW_2026);
    assert.equal(filters.allYears, true);
    assert.equal(filters.year, undefined);
    const where = buildSalesOrderManagementWhere(filters);
    assert.equal(where.issueDate, undefined);
  });

  it("frontend inicia com ano vigente e oferece 'Todos os anos' explícito", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderManagementPage.tsx"),
      "utf8"
    );
    assert.match(page, /new Date\(\)\.getFullYear\(\)/);
    assert.match(page, /useState\(String\(currentYear\)\)/);
    assert.match(page, /value="all">Todos os anos/);
    assert.match(page, /Nenhum pedido encontrado para o ano selecionado\./);
  });
});
