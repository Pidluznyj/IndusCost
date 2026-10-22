import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProposalConversionYtdSeries,
  currentMonthProposalListRange,
  isProposalConvertedToSalesOrder,
  proposalCalendarYearWindow,
  saoPauloCivilYearMonth,
} from "./proposalConversionYtd.js";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("proposalConversionYtd — período e taxa", () => {
  it("mês corrente em America/Sao_Paulo, inclusive virada de dia UTC", () => {
    const october = currentMonthProposalListRange(new Date("2026-10-22T15:00:00.000Z"));
    assert.deepEqual(october, { startDate: "2026-10-01", endDate: "2026-10-31" });

    const stillOctober = currentMonthProposalListRange(new Date("2026-11-01T02:30:00.000Z"));
    assert.deepEqual(stillOctober, { startDate: "2026-10-01", endDate: "2026-10-31" });

    const february = currentMonthProposalListRange(new Date("2026-02-10T15:00:00.000Z"));
    assert.deepEqual(february, { startDate: "2026-02-01", endDate: "2026-02-28" });

    const leap = currentMonthProposalListRange(new Date("2024-02-10T15:00:00.000Z"));
    assert.deepEqual(leap, { startDate: "2024-02-01", endDate: "2024-02-29" });
  });

  it("janela do ano civil começa e termina à meia-noite de São Paulo", () => {
    const window = proposalCalendarYearWindow(2026);
    assert.equal(window.gte.toISOString(), "2026-01-01T03:00:00.000Z");
    assert.equal(window.lt.toISOString(), "2027-01-01T03:00:00.000Z");
  });

  it("convertida é pedido de venda ou aprovada", () => {
    assert.equal(isProposalConvertedToSalesOrder({ status: "SENT", hasSalesOrder: true }), true);
    assert.equal(isProposalConvertedToSalesOrder({ status: "APPROVED", hasSalesOrder: false }), true);
    assert.equal(isProposalConvertedToSalesOrder({ status: "SENT", hasSalesOrder: false }), false);
    assert.equal(isProposalConvertedToSalesOrder({ status: "DRAFT", hasSalesOrder: false }), false);
  });

  it("série YTD: taxa, quantidade e valor por mês; futuro fica vazio", () => {
    const rows = [
      {
        commercialDate: "2026-01-15T15:00:00.000Z",
        status: "SENT",
        totalNetValue: 100,
        hasSalesOrder: true,
      },
      {
        commercialDate: "2026-01-20T15:00:00.000Z",
        status: "SENT",
        totalNetValue: 50,
        hasSalesOrder: false,
      },
      {
        commercialDate: "2026-10-31T23:30:00.000Z",
        status: "APPROVED",
        totalNetValue: 40,
        hasSalesOrder: false,
      },
      {
        commercialDate: "2026-11-01T02:00:00.000Z",
        status: "SENT",
        totalNetValue: 999,
        hasSalesOrder: true,
      },
      {
        commercialDate: "2026-11-01T15:00:00.000Z",
        status: "SENT",
        totalNetValue: 70,
        hasSalesOrder: true,
      },
      {
        commercialDate: "2025-12-31T15:00:00.000Z",
        status: "APPROVED",
        totalNetValue: 10,
        hasSalesOrder: true,
      },
    ];

    assert.deepEqual(saoPauloCivilYearMonth(new Date("2026-11-01T02:00:00.000Z")), {
      year: 2026,
      month: 10,
    });

    const months = buildProposalConversionYtdSeries(rows, { year: 2026, throughMonth: 10 });
    assert.equal(months.length, 12);

    const january = months[0]!;
    assert.equal(january.totalCount, 2);
    assert.equal(january.convertedCount, 1);
    assert.equal(january.convertedAmount, 100);
    assert.equal(january.conversionRate, 50);
    assert.equal(january.isFuture, false);

    const february = months[1]!;
    assert.equal(february.totalCount, 0);
    assert.equal(february.conversionRate, null);

    const october = months[9]!;
    assert.equal(october.totalCount, 2);
    assert.equal(october.convertedCount, 2);
    assert.equal(october.convertedAmount, 40 + 999);
    assert.equal(october.conversionRate, 100);

    const november = months[10]!;
    assert.equal(november.isFuture, true);
    assert.equal(november.totalCount, 0);
    assert.equal(november.convertedAmount, 0);
    assert.equal(november.conversionRate, null);
  });

  it("mês com propostas e zero conversões é 0%, não ausência de base", () => {
    const months = buildProposalConversionYtdSeries(
      [
        {
          commercialDate: "2026-03-10T15:00:00.000Z",
          status: "SENT",
          totalNetValue: "12.5",
          hasSalesOrder: false,
        },
      ],
      { year: 2026, throughMonth: 3 }
    );
    assert.equal(months[2]!.conversionRate, 0);
    assert.equal(months[2]!.convertedAmount, 0);
    assert.equal(months[3]!.isFuture, true);
  });
});

describe("propostas — tela abre no mês corrente e o gráfico ignora filtros", () => {
  it("listagem inicial e limpar filtros usam o mês corrente", () => {
    const page = read("src/components/ProposalModule.tsx");
    assert.match(page, /useState\(\(\) => currentMonthProposalListRange\(\)\.startDate\)/);
    assert.match(page, /useState\(\(\) => currentMonthProposalListRange\(\)\.endDate\)/);
    assert.match(page, /const period = currentMonthProposalListRange\(\)/);
    assert.match(page, /setListStartDate\(period\.startDate\)/);
    assert.match(page, /setListEndDate\(period\.endDate\)/);
    assert.match(page, /<ProposalConversionYtdChart \/>/);
  });

  it("o gráfico não recebe filtro e a rota não lê a query da lista", () => {
    const chart = read("src/components/proposal/ProposalConversionYtdChart.tsx");
    const server = read("server.ts");
    const loader = read("src/lib/proposalConversionYtd.server.ts");

    assert.match(chart, /\/api\/proposals\/conversion-ytd/);
    assert.doesNotMatch(chart, /startDate|endDate|customerId|listStatus|searchTerm/);
    assert.match(server, /app\.get\("\/api\/proposals\/conversion-ytd"/);
    const routeStart = server.indexOf('app.get("/api/proposals/conversion-ytd"');
    const routeEnd = server.indexOf('app.get("/api/proposals/responsibles"');
    assert.ok(routeStart > 0 && routeEnd > routeStart);
    const route = server.slice(routeStart, routeEnd);
    assert.doesNotMatch(route, /req\.query/);
    assert.match(route, /loadProposalConversionYtd\(prisma\)/);
    assert.doesNotMatch(loader, /req\.query|customerId|startDate|endDate/);
  });
});
