import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultPaidTitleListFilters,
  matchesPaidTitleClassificationStatusFilter,
  matchesPaidTitleCostCenterFilter,
  matchesPaidTitleListFilters,
  PAID_TITLE_UNCLASSIFIED_LABEL,
  resolvePaidTitleListDefaultFilters,
} from "./financePaidTitlesModalFilters.js";
import type { CostCenterSupplierPaymentTitleRow } from "./financeCostCenterSupplierPaymentDrilldown.shared.js";

function row(
  overrides: Partial<CostCenterSupplierPaymentTitleRow> = {}
): CostCenterSupplierPaymentTitleRow {
  return {
    accountsPayableId: 1,
    paymentDate: "2026-06-01",
    operationalPaymentDate: null,
    dueDate: "2026-06-10",
    issueDate: "2026-06-01",
    documentNumber: "DOC-1",
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    description: "Descrição",
    descriptiveText: "Descrição",
    costCenterName: PAID_TITLE_UNCLASSIFIED_LABEL,
    costCenterCode: null,
    amountPayable: 100,
    paidAmount: 100,
    statusLabel: "Pago",
    companyName: "Empresa",
    nomusClassification: null,
    classificationOriginLabel: "Sem classificação",
    isManualClassification: false,
    primaryCostCenterId: null,
    hasCostCenterClassification: false,
    costCenterIds: [],
    ...overrides,
  };
}

describe("financePaidTitlesModalFilters", () => {
  it("fornecedor sem regra abre priorizando pendências", () => {
    const defaults = resolvePaidTitleListDefaultFilters({ hasActiveRule: false });
    assert.equal(defaults.costCenterFilter, "unclassified");
    assert.equal(defaults.classificationStatus, "pending");
  });

  it("fornecedor com regra abre em Todos", () => {
    const defaults = resolvePaidTitleListDefaultFilters({ hasActiveRule: true });
    assert.equal(defaults.costCenterFilter, "all");
    assert.equal(defaults.classificationStatus, "all");
  });

  it("filtro Sem centro de custo classificado", () => {
    assert.equal(matchesPaidTitleCostCenterFilter(row(), "unclassified"), true);
    assert.equal(
      matchesPaidTitleCostCenterFilter(
        row({
          costCenterName: "BENS E CONSUMO",
          costCenterIds: ["cc-bens"],
          hasCostCenterClassification: true,
        }),
        "unclassified"
      ),
      false
    );
  });

  it("filtro por centro específico", () => {
    assert.equal(
      matchesPaidTitleCostCenterFilter(
        row({
          costCenterName: "BENS E CONSUMO",
          costCenterIds: ["cc-bens"],
          hasCostCenterClassification: true,
        }),
        "cc-bens"
      ),
      true
    );
  });

  it("título reclassificado manualmente sai do filtro pendente", () => {
    const reclassified = row({
      costCenterName: "FOLHA",
      costCenterIds: ["cc-folha"],
      primaryCostCenterId: "cc-folha",
      hasCostCenterClassification: true,
      isManualClassification: true,
    });
    assert.equal(matchesPaidTitleClassificationStatusFilter(reclassified, "pending"), false);
    assert.equal(matchesPaidTitleClassificationStatusFilter(reclassified, "manual"), true);
    assert.equal(
      matchesPaidTitleListFilters(reclassified, {
        costCenterFilter: "unclassified",
        classificationStatus: "pending",
      }),
      false
    );
  });

  it("título reclassificado continua visível em Todos", () => {
    const reclassified = row({
      costCenterName: "FOLHA",
      costCenterIds: ["cc-folha"],
      primaryCostCenterId: "cc-folha",
      hasCostCenterClassification: true,
      isManualClassification: true,
    });
    assert.equal(
      matchesPaidTitleListFilters(reclassified, createDefaultPaidTitleListFilters()),
      true
    );
  });
});
