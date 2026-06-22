import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFinanceAccountsPayableDashboard } from "./financeAccountsPayableDashboard.js";
import {
  attachClassificationFieldsToTitleItem,
  buildFinanceApExportCsvWithClassification,
  computeApClassificationSummary,
  enrichApTitleClassification,
  enrichFinanceApTitlesPayload,
  filterApRowsByClassification,
  FINANCE_AP_CLASSIFICATION_EXPORT_HEADERS,
  FINANCE_AP_NO_CLASSIFICATION,
  FINANCE_AP_UNIDENTIFIED_SUPPLIER,
  mapApClassificationToExportCells,
  matchesApClassificationFilters,
  parseFinanceApClassificationStatusFilter,
  type ApCostCenterIntegrationContext,
  type ApIntegrationAllocationRow,
} from "./financeAccountsPayableCostCenterIntegration.js";
import { mapRowToTitleListItem } from "./financeAccountsPayableTitles.js";
import {
  buildFinanceApDashboardQuery,
  createDefaultFinanceApUiFilters,
} from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { SupplierWithAliases } from "./financeSupplierCostCenterRules.js";

const REF = new Date(2026, 5, 17, 12, 0, 0, 0);

function apRow(overrides: Partial<FinanceApDashboardRow> = {}): FinanceApDashboardRow {
  return {
    externalId: 1001,
    companyName: "Empresa A",
    personName: "Fornecedor Nomus",
    personCnpj: "12345678000199",
    description: "NF 1",
    dueDate: new Date(2026, 5, 10),
    scheduleDate: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Conta",
    sourceInvoiceId: null,
    documentNumber: "NF-1",
    suspendPayment: false,
    nomusStatus: false,
    type: null,
    syncedAt: REF,
    ...overrides,
  };
}

function supplier(id: string, name: string): SupplierWithAliases {
  return {
    id,
    displayName: name,
    status: "ACTIVE",
    normalizedDocument: "12345678000199",
    normalizedName: name.toLowerCase(),
    aliases: [],
  };
}

function allocation(
  overrides: Partial<ApIntegrationAllocationRow> = {}
): ApIntegrationAllocationRow {
  return {
    id: "alloc-1",
    accountsPayableId: 1001,
    supplierId: "sup-1",
    costCenterId: "cc-1",
    amount: null,
    percentage: { toNumber: () => 100 } as ApIntegrationAllocationRow["percentage"],
    source: "AUTO_RULE",
    lockedManual: false,
    ruleId: "rule-1",
    ...overrides,
  };
}

function buildCtx(
  allocations: ApIntegrationAllocationRow[] = [],
  suppliers: SupplierWithAliases[] = [supplier("sup-1", "Fornecedor Consolidado")]
): ApCostCenterIntegrationContext {
  const allocationsByPayable = new Map<number, ApIntegrationAllocationRow[]>();
  for (const row of allocations) {
    const list = allocationsByPayable.get(row.accountsPayableId) ?? [];
    list.push(row);
    allocationsByPayable.set(row.accountsPayableId, list);
  }
  return {
    allocationsByPayable,
    costCenterById: new Map([
      ["cc-1", { id: "cc-1", code: "CC01", name: "Administrativo", status: "ACTIVE" }],
      ["cc-2", { id: "cc-2", code: "CC02", name: "Produção", status: "ACTIVE" }],
    ]),
    suppliers,
    rulesById: new Map([
      ["rule-1", { id: "rule-1", supplierId: "sup-1", costCenterId: "cc-1" }],
    ]),
  };
}

describe("financeAccountsPayableCostCenterIntegration", () => {
  it("1. AP continua carregando sem classificação", () => {
    const row = apRow({ personCnpj: "99999999000199", personName: "Fornecedor sem vínculo" });
    const enrichment = enrichApTitleClassification(row, buildCtx([], []));
    assert.equal(enrichment.isClassified, false);
    assert.equal(enrichment.costCenterLabel, FINANCE_AP_NO_CLASSIFICATION);
    assert.equal(enrichment.classificationStatusLabel, FINANCE_AP_NO_CLASSIFICATION);
    assert.equal(enrichment.consolidatedSupplierName, FINANCE_AP_UNIDENTIFIED_SUPPLIER);
  });

  it("2. AP carrega com classificação", () => {
    const row = apRow();
    const enrichment = enrichApTitleClassification(row, buildCtx([allocation()]));
    assert.equal(enrichment.isClassified, true);
    assert.equal(enrichment.consolidatedSupplierName, "Fornecedor Consolidado");
    assert.equal(enrichment.costCenterLabel, "CC01 — Administrativo");
    assert.equal(enrichment.classificationOriginLabel, "Regra automática");
    assert.equal(enrichment.allocatedAmount, 1000);
  });

  it("3. cards antigos permanecem inalterados no motor oficial", () => {
    const rows = [apRow(), apRow({ externalId: 1002, balancePayable: 500, amountPayable: 500 })];
    const filters = { status: "all" as const };
    const before = buildFinanceAccountsPayableDashboard(rows, filters, REF);
    const integrationContext = buildCtx([allocation({ accountsPayableId: 1001 })]);
    const summary = computeApClassificationSummary(rows, integrationContext);
    const after = buildFinanceAccountsPayableDashboard(rows, filters, REF);
    assert.deepEqual(after.cards, before.cards);
    assert.ok(summary.classifiedAmount > 0);
  });

  it("4. filtros antigos permanecem no query builder", () => {
    const filters = createDefaultFinanceApUiFilters(REF);
    const qs = buildFinanceApDashboardQuery(filters);
    assert.ok(qs.includes("year=2026"));
    assert.ok(!qs.includes("classificationStatus"));
  });

  it("5. filtros novos opcionais não quebram quando vazios", () => {
    const filters = {
      ...createDefaultFinanceApUiFilters(REF),
      costCenterId: "",
      supplierId: "",
      classificationStatus: "all",
    };
    const qs = buildFinanceApDashboardQuery(filters);
    assert.ok(!qs.includes("costCenterId"));
    assert.ok(!qs.includes("supplierId"));
    assert.ok(!qs.includes("classificationStatus"));
    const rows = [apRow(), apRow({ externalId: 1002 })];
    const filtered = filterApRowsByClassification(rows, buildCtx(), {
      classificationStatus: parseFinanceApClassificationStatusFilter("all"),
    });
    assert.equal(filtered.length, 2);
  });

  it("6. tabela mostra centro de custo enriquecido", () => {
    const row = apRow();
    const item = attachClassificationFieldsToTitleItem(
      mapRowToTitleListItem(row, REF),
      enrichApTitleClassification(row, buildCtx([allocation()]), REF)
    );
    assert.equal(item.costCenterLabel, "CC01 — Administrativo");
    assert.equal(item.consolidatedSupplierName, "Fornecedor Consolidado");
  });

  it("7. drawer mostra classificação (componente presente)", () => {
    const sheet = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceApTitleClassificationSheet.tsx"),
      "utf8"
    );
    assert.match(sheet, /Classificação financeira/);
    assert.match(sheet, /finance-ap-title-classification-sheet/);
    assert.match(sheet, /titles\/\$\{externalId\}\/classification/);
  });

  it("8. export CSV inclui campos de classificação", () => {
    const row = apRow();
    const integrationContext = buildCtx([allocation()]);
    const csv = buildFinanceApExportCsvWithClassification(
      [row],
      { status: "all" },
      integrationContext,
      REF
    );
    const headerLine = csv.split("\n")[0] ?? "";
    for (const col of FINANCE_AP_CLASSIFICATION_EXPORT_HEADERS) {
      assert.ok(headerLine.includes(col), `missing column ${col}`);
    }
    const cells = mapApClassificationToExportCells(
      enrichApTitleClassification(row, integrationContext, REF)
    );
    assert.equal(cells[0], "Fornecedor Consolidado");
    assert.equal(cells[1], "CC01 — Administrativo");
  });

  it("9. sem classificação tem estado claro", () => {
    const enrichment = enrichApTitleClassification(apRow(), buildCtx());
    assert.equal(enrichment.classificationStatusLabel, FINANCE_AP_NO_CLASSIFICATION);
    assert.equal(enrichment.costCenterLabel, FINANCE_AP_NO_CLASSIFICATION);
    const exportCells = mapApClassificationToExportCells(enrichment);
    assert.equal(exportCells[2], "—");
    assert.equal(exportCells[3], "");
  });

  it("10. não altera cálculo principal de AP ao enriquecer payload de títulos", () => {
    const row = apRow({ balancePayable: 750, amountPayable: 1000 });
    const baseItem = mapRowToTitleListItem(row, REF);
    const payload = enrichFinanceApTitlesPayload(
      {
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
        sortBy: "dueDate",
        sortDirection: "asc",
        items: [baseItem],
      },
      new Map([[row.externalId, row]]),
      buildCtx([allocation()]),
      REF
    );
    assert.equal(payload.items[0]?.balancePayable, 750);
    assert.equal(payload.items[0]?.amountPayable, 1000);
    assert.equal(payload.total, 1);
  });

  it("11. frontend AP não importa Prisma nem integration server-side", () => {
    const files = [
      "src/components/finance/FinanceAccountsPayablePage.tsx",
      "src/components/finance/FinanceAccountsPayableTitlesTab.tsx",
      "src/components/finance/FinanceApTitleClassificationSheet.tsx",
      "src/lib/financeAccountsPayableDashboardTypes.ts",
      "src/lib/financeBiFilterChips.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.ok(!source.includes("@prisma/client"), `${file} must not import Prisma`);
      assert.ok(!source.includes('from "@/src/lib/prisma'), `${file} must not import prisma lib`);
      assert.ok(
        !source.includes("financeAccountsPayableCostCenterIntegration"),
        `${file} must not import financeAccountsPayableCostCenterIntegration`
      );
    }
  });

  it("filtro por status manual e rateio", () => {
    const manualRow = apRow({ externalId: 2001 });
    const splitRow = apRow({ externalId: 2002 });
    const manualCtx = buildCtx(
      [allocation({ accountsPayableId: 2001, source: "MANUAL", lockedManual: true })],
      [supplier("sup-1", "Fornecedor Consolidado")]
    );
    const splitCtx = buildCtx(
      [
        allocation({
          id: "a1",
          accountsPayableId: 2002,
          costCenterId: "cc-1",
          percentage: { toNumber: () => 60 } as ApIntegrationAllocationRow["percentage"],
        }),
        allocation({
          id: "a2",
          accountsPayableId: 2002,
          costCenterId: "cc-2",
          percentage: { toNumber: () => 40 } as ApIntegrationAllocationRow["percentage"],
        }),
      ],
      [supplier("sup-1", "Fornecedor Consolidado")]
    );
    assert.equal(
      matchesApClassificationFilters(manualRow, manualCtx, { classificationStatus: "manual" }),
      true
    );
    assert.equal(
      matchesApClassificationFilters(splitRow, splitCtx, { classificationStatus: "split" }),
      true
    );
    assert.equal(
      matchesApClassificationFilters(manualRow, manualCtx, { classificationStatus: "automatic" }),
      false
    );
  });
});
