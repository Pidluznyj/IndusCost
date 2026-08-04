/**
 * `resolveTreasuryCaixaMonthlyEstimateRanges` particiona `[dueDateFrom, dueDateTo]`
 * em meses de calendário inteiros — a base da estimativa mensal por vencimento
 * que complementa meses fora da cobertura da agenda/projeção materializada.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTreasuryCaixaMonthlyEstimateRanges } from "./treasuryCaixaService.server.js";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("resolveTreasuryCaixaMonthlyEstimateRanges", () => {
  it("ano inteiro → 12 meses, cada um com o calendário completo", () => {
    const ranges = resolveTreasuryCaixaMonthlyEstimateRanges(
      new Date(2026, 0, 1),
      new Date(2026, 11, 31)
    );
    assert.equal(ranges.length, 12);
    assert.equal(ranges[0]!.monthKey, "2026-01");
    assert.equal(iso(ranges[0]!.monthStart), "2026-01-01");
    assert.equal(iso(ranges[0]!.monthEnd), "2026-01-31");
    assert.equal(ranges[11]!.monthKey, "2026-12");
    assert.equal(iso(ranges[11]!.monthEnd), "2026-12-31");
    // Fevereiro em ano não bissexto termina em 28.
    const feb = ranges.find((r) => r.monthKey === "2026-02")!;
    assert.equal(iso(feb.monthEnd), "2026-02-28");
  });

  it("bissexto: fevereiro termina em 29", () => {
    const ranges = resolveTreasuryCaixaMonthlyEstimateRanges(
      new Date(2028, 0, 1),
      new Date(2028, 11, 31)
    );
    const feb = ranges.find((r) => r.monthKey === "2028-02")!;
    assert.equal(iso(feb.monthEnd), "2028-02-29");
  });

  it("um único mês selecionado → 1 range", () => {
    const ranges = resolveTreasuryCaixaMonthlyEstimateRanges(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31)
    );
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0]!.monthKey, "2026-08");
  });

  it("um único dia selecionado → 1 range (o mês daquele dia)", () => {
    const ranges = resolveTreasuryCaixaMonthlyEstimateRanges(
      new Date(2026, 7, 15),
      new Date(2026, 7, 15)
    );
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0]!.monthKey, "2026-08");
    assert.equal(iso(ranges[0]!.monthStart), "2026-08-01");
    assert.equal(iso(ranges[0]!.monthEnd), "2026-08-31");
  });

  it("cruza a virada do ano corretamente", () => {
    const ranges = resolveTreasuryCaixaMonthlyEstimateRanges(
      new Date(2026, 10, 1),
      new Date(2027, 1, 28)
    );
    assert.deepEqual(
      ranges.map((r) => r.monthKey),
      ["2026-11", "2026-12", "2027-01", "2027-02"]
    );
  });
});
