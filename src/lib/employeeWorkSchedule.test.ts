import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_WORK_SCHEDULE_LEN, normalizeEmployeeWorkSchedule } from "./employeeAdminHr.ts";

describe("normalizeEmployeeWorkSchedule — jornada descritiva do cadastro", () => {
  it("vazio vira null e texto é aparado", () => {
    assert.equal(normalizeEmployeeWorkSchedule(""), null);
    assert.equal(normalizeEmployeeWorkSchedule("  Seg–Sex 07:30–17:18  "), "Seg–Sex 07:30–17:18");
  });

  it("valor novo acima do limite é cortado no limite", () => {
    const long = "x".repeat(MAX_WORK_SCHEDULE_LEN + 20);
    assert.equal(normalizeEmployeeWorkSchedule(long)?.length, MAX_WORK_SCHEDULE_LEN);
  });

  it("valor legado intocado (acima do limite) não é cortado — evita WORK_SCHEDULE_CHANGE falso", () => {
    const legacy = "y".repeat(MAX_WORK_SCHEDULE_LEN + 20);
    assert.equal(normalizeEmployeeWorkSchedule(legacy, { previous: legacy }), legacy);
    assert.equal(normalizeEmployeeWorkSchedule(`  ${legacy} `, { previous: legacy }), legacy);
    // alterado de verdade: volta a valer o limite
    assert.equal(
      normalizeEmployeeWorkSchedule(`${legacy}z`, { previous: legacy })?.length,
      MAX_WORK_SCHEDULE_LEN
    );
  });
});
