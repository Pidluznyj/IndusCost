import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  officialEngineInputsMatch,
  reuseOfficialEngineResultIfSamePopulation,
} from "./financeOfficialEngineProjection.js";

const REF = new Date(2026, 5, 9);

describe("officialEngineInputsMatch", () => {
  it("reusa somente com a mesma referência de array e a mesma regra", () => {
    const rows = [{ externalId: 1 }];
    const base = {
      rows,
      filters: { status: "all" as const, year: 2026 },
      referenceDate: REF,
      syncCutoff: null,
    };
    assert.equal(officialEngineInputsMatch(base, { ...base }), true);
    assert.equal(
      reuseOfficialEngineResultIfSamePopulation({ input: base, result: 42 }, { ...base }),
      42
    );
  });

  it("não reusa array distinto mesmo com os mesmos IDs", () => {
    const inputA = {
      rows: [{ externalId: 1 }],
      filters: { status: "all" as const },
      referenceDate: REF,
    };
    const inputB = {
      rows: [{ externalId: 1 }],
      filters: { status: "all" as const },
      referenceDate: REF,
    };
    assert.equal(officialEngineInputsMatch(inputA, inputB), false);
    assert.equal(
      reuseOfficialEngineResultIfSamePopulation({ input: inputA, result: 1 }, inputB),
      null
    );
  });

  it("não reusa quando filtro, cutoff, período ou horizonte diferem", () => {
    const rows = [{ externalId: 1 }];
    const base = {
      rows,
      filters: { status: "all" as const, year: 2026 },
      referenceDate: REF,
      syncCutoff: null as { maxSyncedAt?: Date; minEligibleSyncedAt?: Date } | null,
      year: undefined as number | undefined,
      month: undefined as number | undefined,
      horizonSourceRows: undefined as unknown[] | undefined,
    };
    assert.equal(
      officialEngineInputsMatch(base, { ...base, filters: { status: "all", year: 2025 } }),
      false
    );
    assert.equal(
      officialEngineInputsMatch(base, { ...base, year: 2026 }),
      false
    );
    assert.equal(
      officialEngineInputsMatch(base, { ...base, month: 6 }),
      false
    );
    assert.equal(
      officialEngineInputsMatch(base, { ...base, referenceDate: new Date(2026, 5, 10) }),
      false
    );
    assert.equal(
      officialEngineInputsMatch(base, {
        ...base,
        syncCutoff: {
          maxSyncedAt: new Date(2026, 5, 8),
          minEligibleSyncedAt: new Date(2026, 5, 8),
        },
      }),
      false
    );
    assert.equal(
      officialEngineInputsMatch(base, { ...base, horizonSourceRows: rows }),
      false
    );
  });
});
