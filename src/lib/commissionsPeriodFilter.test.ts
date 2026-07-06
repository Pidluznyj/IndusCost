import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionsYearOptions,
  COMMISSIONS_MONTH_SELECT_OPTIONS,
} from "./commissionsPeriodFilter.js";

describe("commissionsPeriodFilter", () => {
  it("buildCommissionsYearOptions inclui ano de referência + 1 até minYear", () => {
    const years = buildCommissionsYearOptions(2026, 2023);
    assert.deepEqual(years, [2027, 2026, 2025, 2024, 2023]);
  });

  it("COMMISSIONS_MONTH_SELECT_OPTIONS começa com Todos os meses", () => {
    assert.equal(COMMISSIONS_MONTH_SELECT_OPTIONS[0]?.value, "");
    assert.equal(COMMISSIONS_MONTH_SELECT_OPTIONS[0]?.label, "Todos os meses");
    assert.equal(COMMISSIONS_MONTH_SELECT_OPTIONS.length, 13);
  });
});
