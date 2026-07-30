import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryCrCpTitleDto } from "./treasuryPredictiveCrCpByAccountRules.js";
import {
  filterTreasuryCrCpTitles,
  listTreasuryCrCpTitleCounterparties,
  presentTreasuryCrCpTitles,
  sortTreasuryCrCpTitles,
  toggleTreasuryCrCpTitlesSort,
} from "./treasuryPredictiveCrCpTitlesPresentation.js";

function title(
  partial: Partial<TreasuryCrCpTitleDto> & Pick<TreasuryCrCpTitleDto, "id" | "side">
): TreasuryCrCpTitleDto {
  return {
    dueDate: "2026-07-10",
    effectiveDate: "2026-07-10",
    situation: "UPCOMING",
    counterpartyName: "Cliente A",
    documentNumber: "DOC-1",
    installmentLabel: "Parcela 1",
    originalAmount: "100.00",
    settledAmount: "0.00",
    openBalance: "100.00",
    nomusFinancialAccountId: "5",
    nomusFinancialAccountName: "Viacredi",
    destinationBucketId: "bucket",
    destinationBucketLabel: "Aberto",
    unlinkedReason: null,
    unlinkedReasonLabel: null,
    ...partial,
  };
}

describe("treasuryPredictiveCrCpTitlesPresentation", () => {
  const sample = [
    title({
      id: "r1",
      side: "RECEIVABLE",
      counterpartyName: "Britania",
      dueDate: "2026-07-20",
      openBalance: "200.00",
      situation: "OVERDUE",
    }),
    title({
      id: "r2",
      side: "RECEIVABLE",
      counterpartyName: "Alpha",
      dueDate: "2026-07-05",
      openBalance: "50.00",
      situation: "UPCOMING",
    }),
    title({
      id: "p1",
      side: "PAYABLE",
      counterpartyName: "Fornecedor Z",
      dueDate: "2026-07-15",
      openBalance: "80.00",
      documentNumber: "NF-99",
    }),
  ];

  it("lista counterparties únicos ordenados", () => {
    assert.deepEqual(listTreasuryCrCpTitleCounterparties(sample), [
      "Alpha",
      "Britania",
      "Fornecedor Z",
    ]);
  });

  it("filtra por cliente/fornecedor e situação", () => {
    const filtered = filterTreasuryCrCpTitles(sample, {
      situation: "OVERDUE",
      counterparty: "Britania",
      query: "",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.id, "r1");
  });

  it("filtra por busca em documento", () => {
    const filtered = filterTreasuryCrCpTitles(sample, {
      situation: "ALL",
      counterparty: "",
      query: "nf-99",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.id, "p1");
  });

  it("ordena por saldo e alterna direção", () => {
    const asc = sortTreasuryCrCpTitles(sample, "openBalance", "asc");
    assert.deepEqual(
      asc.map((t) => t.id),
      ["r2", "p1", "r1"]
    );
    const desc = sortTreasuryCrCpTitles(sample, "openBalance", "desc");
    assert.deepEqual(
      desc.map((t) => t.id),
      ["r1", "p1", "r2"]
    );
    assert.deepEqual(toggleTreasuryCrCpTitlesSort("dueDate", "asc", "dueDate"), {
      sortKey: "dueDate",
      sortDir: "desc",
    });
    assert.deepEqual(
      toggleTreasuryCrCpTitlesSort("dueDate", "asc", "counterpartyName"),
      { sortKey: "counterpartyName", sortDir: "asc" }
    );
  });

  it("apresenta filtro + sort juntos", () => {
    const presented = presentTreasuryCrCpTitles(
      sample,
      { situation: "ALL", counterparty: "", query: "" },
      "dueDate",
      "asc"
    );
    assert.deepEqual(
      presented.map((t) => t.id),
      ["r2", "p1", "r1"]
    );
  });
});
