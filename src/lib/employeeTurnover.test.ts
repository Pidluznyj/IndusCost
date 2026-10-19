import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TERMINATION_REASONS, TERMINATION_RULES, terminationTurnoverClass } from "./employeeLifecycle";
import { computeTurnoverYtd, turnoverSnapshotDates } from "./employeeTurnover";

describe("classificação voluntário × involuntário", () => {
  it("é automática pelo motivo", () => {
    const voluntary = TERMINATION_REASONS.filter((r) => terminationTurnoverClass(r) === "VOLUNTARY");
    const involuntary = TERMINATION_REASONS.filter((r) => terminationTurnoverClass(r) === "INVOLUNTARY");
    assert.deepEqual(voluntary.sort(), ["EARLY_END_BY_EMPLOYEE", "INDIRECT_TERMINATION", "MUTUAL_AGREEMENT", "RESIGNATION"]);
    assert.deepEqual(involuntary.sort(), ["CONTRACT_END", "DEATH", "DISMISSAL_WITHOUT_CAUSE", "DISMISSAL_WITH_CAUSE", "EARLY_END_BY_EMPLOYER"]);
    assert.equal(terminationTurnoverClass("OTHER"), null);
    assert.equal(terminationTurnoverClass(null), null);
    assert.equal(terminationTurnoverClass("FIRED"), null);
    assert.equal(TERMINATION_RULES.RESIGNATION.turnover, "VOLUNTARY");
  });
});

describe("turnover YTD", () => {
  it("fotografias: fim de cada mês fechado + hoje", () => {
    assert.deepEqual(turnoverSnapshotDates("2026-03-05"), ["2026-01-31", "2026-02-28", "2026-03-05"]);
    assert.deepEqual(turnoverSnapshotDates("2026-01-10"), ["2026-01-10"]);
  });

  it("desligamentos do ano ÷ headcount médio, separado por classe", () => {
    const today = "2026-03-05";
    const active = (admission: string) => ({ status: "ACTIVE", admissionDate: admission, terminationDate: null });
    const rows = [
      active("2020-01-01"),
      active("2020-01-01"),
      active("2020-01-01"),
      active("2026-02-15"), // admitido em fev: conta em 28/02 e hoje
      { status: "INACTIVE", admissionDate: "2019-01-01", terminationDate: "2026-01-20", terminationReason: "RESIGNATION" },
      { status: "INACTIVE", admissionDate: "2019-01-01", terminationDate: "2026-02-28", terminationReason: "DISMISSAL_WITH_CAUSE" },
      { status: "INACTIVE", admissionDate: "2019-01-01", terminationDate: "2026-03-01", terminationReason: "OTHER" },
      { status: "INACTIVE", admissionDate: "2019-01-01", terminationDate: "2026-03-02", terminationReason: null }, // legado sem motivo
      { status: "INACTIVE", admissionDate: "2010-01-01", terminationDate: "2025-12-31", terminationReason: "RESIGNATION" }, // ano anterior
      { status: "INACTIVE", admissionDate: "2010-01-01", terminationDate: null }, // sem data: fora
    ];
    const t = computeTurnoverYtd(rows, today);
    // 31/01: 3 + (fev, mar×2 ainda empregados) = 6; 28/02: 3 + 1 + (mar×2) = 6 (quem saiu em 28/02 não conta); 05/03: 4.
    assert.equal(t.averageHeadcount, 5.3);
    assert.deepEqual([t.terminations, t.voluntary, t.involuntary, t.unclassified], [4, 1, 1, 2]);
    assert.equal(t.excludedWithoutTerminationDate, 1);
    assert.equal(t.rate?.toFixed(4), (4 / (16 / 3)).toFixed(4));
    assert.equal(t.voluntaryRate?.toFixed(4), (1 / (16 / 3)).toFixed(4));
    assert.equal(t.involuntaryRate?.toFixed(4), (1 / (16 / 3)).toFixed(4));
  });

  it("sem headcount no período a taxa é nula", () => {
    const t = computeTurnoverYtd([], "2026-10-16");
    assert.equal(t.rate, null);
    assert.equal(t.terminations, 0);
  });
});
