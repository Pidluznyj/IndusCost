import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { startOfLocalDay } from "./financeHorizonBuckets.js";
import {
  buildFinanceArTitlesPayload,
  parseFinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";
import { listFinanceArHorizonBucketCustomers } from "./financeArHorizonBucketCustomers.js";
import {
  buildFinanceArHorizonAppliedFilterLines,
  buildFinanceArHorizonExportQueryString,
} from "./financeAccountsReceivableHorizonExport.js";

const REF = startOfLocalDay(new Date(2026, 5, 19));

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId" | "dueDate">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa",
    personId: partial.personId ?? partial.externalId,
    personName: partial.personName ?? "Cliente",
    personCnpj: partial.personCnpj ?? null,
    description: "Título",
    settlementDate: null,
    amountReceivable: partial.balanceReceivable ?? 100,
    amountReceived: 0,
    balanceReceivable: partial.balanceReceivable ?? 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: new Date("2026-06-18T10:00:00.000Z"),
    ...partial,
  };
}

describe("financeArHorizonBucketCustomers", () => {
  it("filtro de cliente aparece no detalhe do grid quando faixa selecionada", () => {
    const drilldown = read("src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx");
    assert.ok(drilldown.includes('data-testid="finance-ar-horizon-bucket-grid-filters"'));
    assert.ok(drilldown.includes("FinanceArHorizonBucketCustomerFilter"));
    assert.ok(drilldown.includes("selectedCard ?"));
  });

  it("filtro de cliente não aparece sem faixa selecionada", () => {
    const drilldown = read("src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx");
    assert.ok(drilldown.includes("{module === \"ar\" && horizonMode ? ("));
    assert.ok(drilldown.includes("{selectedCard ? ("));
  });

  it("lista clientes presentes na faixa selecionada", () => {
    const rows = [
      arRow({
        externalId: 1,
        personId: 10,
        personName: "Britânia",
        dueDate: addDays(REF, 10),
        balanceReceivable: 100,
      }),
      arRow({
        externalId: 2,
        personId: 20,
        personName: "Consul",
        dueDate: addDays(REF, 12),
        balanceReceivable: 200,
      }),
      arRow({
        externalId: 3,
        personId: 10,
        personName: "Britânia",
        dueDate: addDays(REF, 14),
        balanceReceivable: 300,
      }),
    ];
    const customers = listFinanceArHorizonBucketCustomers(rows, "8_15", REF);
    assert.equal(customers.length, 2);
    const britania = customers.find((c) => c.personName === "Britânia");
    assert.ok(britania);
    assert.equal(britania.titlesCount, 2);
    assert.equal(britania.openBalanceAmount, 400);
  });

  it("selecionar cliente filtra o grid via customerId", () => {
    const rows = [
      arRow({
        externalId: 1,
        personId: 10,
        personName: "Britânia",
        dueDate: addDays(REF, 10),
        balanceReceivable: 100,
      }),
      arRow({
        externalId: 2,
        personId: 20,
        personName: "Consul",
        dueDate: addDays(REF, 12),
        balanceReceivable: 200,
      }),
    ];
    const query = parseFinanceArTitlesQuery({
      agingBucket: "8_15",
      page: "1",
      limit: "25",
      customerId: "10",
    });
    const payload = buildFinanceArTitlesPayload(rows, query, REF);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.personName, "Britânia");
    assert.equal(payload.bucketTotals?.titlesCount, 1);
    assert.equal(payload.bucketTotals?.openBalanceAmount, 100);
  });

  it("limpar cliente volta a mostrar todos os títulos da faixa", () => {
    const rows = [
      arRow({ externalId: 1, personId: 10, personName: "A", dueDate: addDays(REF, 10), balanceReceivable: 100 }),
      arRow({ externalId: 2, personId: 20, personName: "B", dueDate: addDays(REF, 12), balanceReceivable: 200 }),
    ];
    const allQuery = parseFinanceArTitlesQuery({ agingBucket: "8_15", page: "1", limit: "25" });
    const allPayload = buildFinanceArTitlesPayload(rows, allQuery, REF);
    assert.equal(allPayload.items.length, 2);
  });

  it("totalizadores mudam conforme cliente selecionado", () => {
    const rows = [
      arRow({ externalId: 1, personId: 10, personName: "A", dueDate: addDays(REF, 10), balanceReceivable: 150 }),
      arRow({ externalId: 2, personId: 20, personName: "B", dueDate: addDays(REF, 11), balanceReceivable: 250 }),
    ];
    const filtered = buildFinanceArTitlesPayload(
      rows,
      parseFinanceArTitlesQuery({ agingBucket: "8_15", customerId: "20" }),
      REF
    );
    assert.equal(filtered.bucketTotals?.openBalanceAmount, 250);
    assert.equal(filtered.bucketTotals?.titlesCount, 1);
  });

  it("busca textual continua funcionando junto com cliente", () => {
    const rows = [
      arRow({
        externalId: 1,
        personId: 10,
        personName: "Britânia",
        sourceInvoiceNumber: "6845",
        dueDate: addDays(REF, 10),
        balanceReceivable: 100,
      }),
      arRow({
        externalId: 2,
        personId: 10,
        personName: "Britânia",
        sourceInvoiceNumber: "9999",
        dueDate: addDays(REF, 11),
        balanceReceivable: 200,
      }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      parseFinanceArTitlesQuery({
        agingBucket: "8_15",
        customerId: "10",
        search: "6845",
      }),
      REF
    );
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.sourceInvoiceNumber, "6845");
  });

  it("exportação Excel respeita cliente selecionado", () => {
    const qs = buildFinanceArHorizonExportQueryString({
      agingBucket: "8_15",
      customerId: 10,
      search: "6845",
    });
    assert.match(qs, /agingBucket=8_15/);
    assert.match(qs, /customerId=10/);
    assert.match(qs, /search=6845/);
    const buttons = read("src/components/finance/FinanceArHorizonExportButtons.tsx");
    assert.ok(buttons.includes("customerId"));
    assert.ok(buttons.includes("customerName"));
  });

  it("filtros aplicados do relatório mostram o cliente", () => {
    const lines = buildFinanceArHorizonAppliedFilterLines({
      scope: "bucket",
      bucket: { key: "8_15", label: "8–15 dias" },
      customerName: "Britânia Eletrodomésticos SA",
    });
    assert.ok(lines.some((line) => line.label === "Cliente" && line.value.includes("Britânia")));
  });

  it("rotas expõem bucket-customers do horizonte", () => {
    const routes = read("src/lib/financeAccountsReceivableRoutes.ts");
    assert.ok(routes.includes("/api/finance/accounts-receivable/horizon/bucket-customers"));
    assert.ok(routes.includes("listFinanceArHorizonBucketCustomers"));
  });

  it("frontend não importa Prisma nos componentes do filtro", () => {
    for (const file of [
      "src/components/finance/shared/FinanceAgingBucketDrilldownSection.tsx",
      "src/components/finance/FinanceArHorizonBucketCustomerFilter.tsx",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });
});
