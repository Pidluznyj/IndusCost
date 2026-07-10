import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCostCenterDetailSummaryFromRows,
  buildCostCenterDetailViewFromRows,
  matchesCostCenterDetailFilters,
  paginateRows,
  parseCostCenterIdsParam,
  sortCostCenterDetailRows,
  type CostCenterDetailListFilters,
} from "./financeCostCenterDetail.js";
import type { CostCenterDetailAllocationRow } from "./financeCostCenterDetailShared.js";
import { isFinanceCostCenterDetailPath, buildFinanceCostCenterDetailPath } from "./financeNavigation.js";

function row(overrides: Partial<CostCenterDetailAllocationRow>): CostCenterDetailAllocationRow {
  return {
    allocationId: "a1",
    accountsPayableId: 100,
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: null,
    nomusClassification: "40.01",
    description: "Desc",
    comments: null,
    documentNumber: "NF-1",
    sourceInvoiceId: null,
    dueDate: "2026-06-10T00:00:00.000Z",
    competenceDate: "2026-05-01T00:00:00.000Z",
    paymentDate: null,
    settlementDate: null,
    statusKey: "overdue",
    statusLabel: "Vencido",
    amountPayable: 1000,
    balancePayable: 1000,
    allocatedAmount: 1000,
    allocatedPercentage: 100,
    allocationSource: "AUTO_RULE",
    lockedManual: false,
    costCenterId: "cc-1",
    costCenterCode: "ADM",
    costCenterName: "Administrativo",
    supplierId: "sup-1",
    supplierName: "Fornecedor X",
    allocationNotes: null,
    allocationCreatedAt: "2026-01-01T00:00:00.000Z",
    allocationUpdatedAt: "2026-01-02T00:00:00.000Z",
    isPartialTitle: false,
    ...overrides,
  };
}

describe("financeCostCenterDetail", () => {
  it("parseCostCenterIdsParam aceita lista separada por vírgula e rejeita UUID inválido", () => {
    const id1 = "11111111-1111-4111-8111-111111111111";
    const id2 = "22222222-2222-4222-8222-222222222222";
    const id3 = "33333333-3333-4333-8333-333333333333";
    const id4 = "44444444-4444-4444-8444-444444444444";
    const id5 = "55555555-5555-4555-8555-555555555555";
    assert.deepEqual(parseCostCenterIdsParam(`${id1}, ${id2} ,${id1}`), [id1, id2]);
    assert.deepEqual(parseCostCenterIdsParam([id3, `${id4},${id5}`]), [id3, id4, id5]);
    assert.deepEqual(parseCostCenterIdsParam(""), []);
    assert.throws(
      () => parseCostCenterIdsParam("allocations"),
      (err: unknown) =>
        err instanceof Error &&
        err.name === "FinanceCostCenterDetailError" &&
        /inválido/i.test(err.message)
    );
    assert.throws(
      () => parseCostCenterIdsParam("cc-1,cc-2"),
      (err: unknown) => err instanceof Error && /inválido/i.test(err.message)
    );
  });

  it("filtro por fonte manual e locked", () => {
    const filters: CostCenterDetailListFilters = { status: "all", manualOnly: true };
    assert.equal(matchesCostCenterDetailFilters(row({ allocationSource: "MANUAL" }), filters), true);
    assert.equal(matchesCostCenterDetailFilters(row({ allocationSource: "AUTO_RULE" }), filters), false);

    const locked: CostCenterDetailListFilters = { status: "all", lockedOnly: true };
    assert.equal(matchesCostCenterDetailFilters(row({ lockedManual: true }), locked), true);
    assert.equal(matchesCostCenterDetailFilters(row({ lockedManual: false }), locked), false);
  });

  it("filtro divergentOnly", () => {
    const filters: CostCenterDetailListFilters = { status: "all", divergentOnly: true };
    assert.equal(matchesCostCenterDetailFilters(row({ isPartialTitle: true }), filters), true);
    assert.equal(matchesCostCenterDetailFilters(row({ isPartialTitle: false }), filters), false);
  });

  it("busca livre encontra fornecedor e classificação", () => {
    const filters: CostCenterDetailListFilters = { status: "all", search: "fornecedor x" };
    assert.equal(matchesCostCenterDetailFilters(row({}), filters), true);
    const byClass: CostCenterDetailListFilters = { status: "all", search: "40.01" };
    assert.equal(matchesCostCenterDetailFilters(row({}), byClass), true);
  });

  it("ordenação por valor alocado e fornecedor", () => {
    const rows = [
      row({ allocationId: "a1", personName: "Zeta", allocatedAmount: 100 }),
      row({ allocationId: "a2", personName: "Alpha", allocatedAmount: 500 }),
    ];
    const byAmount = sortCostCenterDetailRows(rows, "allocatedAmount", "desc");
    assert.equal(byAmount[0]!.allocationId, "a2");
    const bySupplier = sortCostCenterDetailRows(rows, "supplier", "asc");
    assert.equal(bySupplier[0]!.personName, "Alpha");
  });

  it("paginação preserva totalizador de itens", () => {
    const items = Array.from({ length: 5 }, (_, i) => row({ allocationId: `a${i}` }));
    const page = paginateRows(items, 2, 2);
    assert.equal(page.totalItems, 5);
    assert.equal(page.items.length, 2);
    assert.equal(page.page, 2);
  });

  it("resumo agrega apenas linhas do centro", () => {
    const summary = buildCostCenterDetailSummaryFromRows(
      {
        id: "cc-1",
        code: "ADM",
        name: "Admin",
        parentId: null,
        parentCode: null,
        parentName: null,
        status: "ACTIVE",
      },
      [
        row({ allocatedAmount: 300, allocationSource: "AUTO_RULE" }),
        row({ allocationId: "a2", accountsPayableId: 101, allocatedAmount: 200, allocationSource: "MANUAL" }),
      ]
    );
    assert.equal(summary.totalAllocatedAmount, 500);
    assert.equal(summary.titlesCount, 2);
    assert.equal(summary.allocationSourceBreakdown.AUTO_RULE, 300);
    assert.equal(summary.allocationSourceBreakdown.MANUAL, 200);
  });

  it("view alinha summary.totalAllocatedAmount com totals.allocatedAmount", () => {
    const center = {
      id: "cc-1",
      code: "ADM",
      name: "Admin",
      parentId: null,
      parentCode: null,
      parentName: null,
      status: "ACTIVE" as const,
    };
    const rows = [
      row({ allocatedAmount: 300 }),
      row({ allocationId: "a2", accountsPayableId: 101, allocatedAmount: 200 }),
    ];
    const view = buildCostCenterDetailViewFromRows(center, rows);
    assert.equal(view.summary.totalAllocatedAmount, 500);
    assert.equal(view.totals.allocatedAmount, 500);
    assert.equal(view.summary.totalAllocatedAmount, view.totals.allocatedAmount);
  });

  it("rotas e navegação de detalhe", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const path = buildFinanceCostCenterDetailPath(id);
    assert.equal(path, `/finance/cost-centers/${id}`);
    assert.equal(isFinanceCostCenterDetailPath(path), true);
    assert.equal(isFinanceCostCenterDetailPath("/finance/cost-centers"), false);
  });

  it("endpoints registrados e frontend não importa prisma", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeCostCenterDetailRoutes.ts"), "utf8");
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterDetailPage.tsx"),
      "utf8"
    );
    assert.match(routes, /\/api\/finance\/cost-centers\/:id\/summary/);
    assert.match(routes, /\/api\/finance\/cost-centers\/:id\/allocations/);
    assert.match(routes, /\/api\/finance\/cost-centers\/allocations/);
    assert.match(routes, /\/api\/finance\/cost-centers\/detail\/export\.xlsx/);
    assert.match(routes, /\/api\/finance\/cost-centers\/reallocation\/preview/);
    assert.match(routes, /\/api\/finance\/cost-centers\/reallocation\/apply/);
    assert.match(server, /registerFinanceCostCenterDetailRoutes\(app/);
    // Rotas estáticas de consolidação devem ser registradas antes de /:id
    // (senão "allocations" vira id e estoura findUnique com UUID inválido).
    const detailRegister = server.indexOf("registerFinanceCostCenterDetailRoutes(app");
    const centersRegister = server.indexOf("registerFinanceCostCentersRoutes(app");
    assert.ok(detailRegister >= 0 && centersRegister >= 0);
    assert.ok(
      detailRegister < centersRegister,
      "registerFinanceCostCenterDetailRoutes deve vir antes de registerFinanceCostCentersRoutes"
    );
    assert.match(routes, /assertFinanceCostCenterUuid/);
    assert.match(page, /finance-cost-center-detail-page/);
    assert.match(page, /reallocation\/preview/);
    assert.doesNotMatch(page, /\/summary\?/);
    assert.doesNotMatch(page, /@prisma\/client/);
  });

  it("crud tab linka para detalhe", () => {
    const crud = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx"),
      "utf8"
    );
    assert.match(crud, /finance-cost-centers-view-allocations-button/);
    assert.match(crud, /buildFinanceCostCenterDetailPath/);
  });

  it("apply não referencia Nomus update", () => {
    const lib = readFileSync(join(process.cwd(), "src/lib/financeCostCenterDetail.ts"), "utf8");
    assert.match(lib, /accountsPayableCostCenterAllocation\.update/);
    assert.match(lib, /financialCostCenterAuditLog\.create/);
    assert.doesNotMatch(lib, /nomusAccountsPayable\.(update|create|delete)/);
  });
});
