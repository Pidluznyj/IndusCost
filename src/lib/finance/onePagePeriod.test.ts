import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lastDayOfMonth,
  parseOnePageMonth,
  resolveOnePagePeriod,
} from "./onePagePeriod.js";
import { resolveComparablePreviousYearReference } from "../executiveDashboardComparablePeriod.js";

const NOW = new Date(2026, 7, 27, 9, 15, 0, 0); // 27/08/2026 09:15 local

describe("One Page — regra temporal (sem hack do dia 28)", () => {
  it("parseOnePageMonth aceita 1–12 e rejeita o resto", () => {
    assert.equal(parseOnePageMonth("8"), 8);
    assert.equal(parseOnePageMonth(12), 12);
    assert.equal(parseOnePageMonth(""), null);
    assert.equal(parseOnePageMonth(null), null);
    assert.equal(parseOnePageMonth("ytd"), null);
    assert.equal(parseOnePageMonth("0"), null);
    assert.equal(parseOnePageMonth("13"), null);
    assert.equal(parseOnePageMonth("2.5"), null);
  });

  it("A — ano atual + mês atual → referência = agora", () => {
    const period = resolveOnePagePeriod("2026", "8", NOW);
    assert.equal(period.mode, "month");
    assert.equal(period.metricMonth, 8);
    assert.equal(period.referenceDate.getTime(), NOW.getTime());
    assert.equal(period.yearCtx.ytdMonthLimit, 8);
  });

  it("B — ano atual + mês passado → último dia REAL do mês (30/04, não 28)", () => {
    const period = resolveOnePagePeriod("2026", "4", NOW);
    assert.equal(period.referenceDate.getFullYear(), 2026);
    assert.equal(period.referenceDate.getMonth(), 3);
    assert.equal(period.referenceDate.getDate(), 30);
    assert.equal(period.referenceDate.getHours(), 23);
    assert.equal(period.referenceDate.getMinutes(), 59);
  });

  it("B — janeiro termina dia 31 (não 28)", () => {
    const period = resolveOnePagePeriod("2026", "1", NOW);
    assert.equal(period.referenceDate.getDate(), 31);
  });

  it("C — ano passado + fevereiro comum → 28/02; bissexto → 29/02", () => {
    const fev2025 = resolveOnePagePeriod("2025", "2", NOW);
    assert.equal(fev2025.referenceDate.getDate(), 28);
    assert.equal(fev2025.referenceDate.getMonth(), 1);

    const fev2024 = resolveOnePagePeriod("2024", "2", NOW);
    assert.equal(fev2024.referenceDate.getDate(), 29);
    assert.equal(fev2024.referenceDate.getFullYear(), 2024);
  });

  it("C — ano passado + agosto → 31/08 (não 28)", () => {
    const period = resolveOnePagePeriod("2025", "8", NOW);
    assert.equal(period.referenceDate.getDate(), 31);
    assert.equal(period.referenceDate.getMonth(), 7);
    assert.equal(period.referenceDate.getFullYear(), 2025);
  });

  it("G — nenhum mês de 31 dias é truncado no dia 28", () => {
    for (const month of [1, 3, 5, 7, 8, 10, 12]) {
      const period = resolveOnePagePeriod("2025", String(month), NOW);
      assert.equal(period.referenceDate.getDate(), 31, `mês ${month}`);
    }
    for (const month of [4, 6, 9, 11]) {
      const period = resolveOnePagePeriod("2025", String(month), NOW);
      assert.equal(period.referenceDate.getDate(), 30, `mês ${month}`);
    }
  });

  it("D — visão anual (sem mês), ano atual → agora; contexto oficial intacto", () => {
    const period = resolveOnePagePeriod("2026", undefined, NOW);
    assert.equal(period.mode, "ytd");
    assert.equal(period.metricMonth, 8);
    assert.equal(period.referenceDate.getTime(), NOW.getTime());
    assert.equal(period.yearCtx.ytdMonthLimit, 8);
    assert.equal(period.yearCtx.isSelectedYearCurrent, true);
  });

  it("E — visão anual passada → 31/12 do ano", () => {
    const period = resolveOnePagePeriod("2025", "", NOW);
    assert.equal(period.mode, "ytd");
    assert.equal(period.metricMonth, 12);
    assert.equal(period.referenceDate.getFullYear(), 2025);
    assert.equal(period.referenceDate.getMonth(), 11);
    assert.equal(period.referenceDate.getDate(), 31);
  });

  it("mês futuro no ano atual → clamp para o mês atual (referência = agora)", () => {
    const period = resolveOnePagePeriod("2026", "11", NOW);
    assert.equal(period.metricMonth, 8);
    assert.equal(period.referenceDate.getTime(), NOW.getTime());
  });

  it("lastDayOfMonth cobre 28/29/30/31", () => {
    assert.equal(lastDayOfMonth(2025, 2), 28);
    assert.equal(lastDayOfMonth(2024, 2), 29);
    assert.equal(lastDayOfMonth(2026, 4), 30);
    assert.equal(lastDayOfMonth(2026, 8), 31);
  });
});

describe("One Page — escopo temporal da margem comercial", () => {
  it("modo YTD ano atual → população 01/01 até a referência (agora)", () => {
    const period = resolveOnePagePeriod("2026", undefined, NOW);
    assert.equal(period.marginRange.start.getTime(), new Date(2026, 0, 1).getTime());
    assert.equal(period.marginRange.end.getTime(), NOW.getTime());
    assert.match(period.marginPeriodLabel, /YTD/);
  });

  it("modo YTD ano passado → população do ano completo", () => {
    const period = resolveOnePagePeriod("2025", undefined, NOW);
    assert.equal(period.marginRange.start.getTime(), new Date(2025, 0, 1).getTime());
    assert.equal(
      period.marginRange.end.getTime(),
      new Date(2025, 11, 31, 23, 59, 59, 999).getTime()
    );
  });

  it("modo mês → população do mês selecionado completo (31/08, não 28)", () => {
    const period = resolveOnePagePeriod("2025", "8", NOW);
    assert.equal(period.marginRange.start.getTime(), new Date(2025, 7, 1).getTime());
    assert.equal(
      period.marginRange.end.getTime(),
      new Date(2025, 7, 31, 23, 59, 59, 999).getTime()
    );
    assert.equal(period.marginPeriodLabel, "Ago/2025");
  });
});

describe("Referência comparável do ano anterior (YTD simétrico)", () => {
  it("I — 27/08/2026 → 27/08/2025 (mesmo corte temporal)", () => {
    const prev = resolveComparablePreviousYearReference(NOW, 2025, 8);
    assert.equal(prev.getFullYear(), 2025);
    assert.equal(prev.getMonth(), 7);
    assert.equal(prev.getDate(), 27);
  });

  it("dia 31 preservado quando o mês anterior comparável também tem 31", () => {
    const ref = new Date(2026, 2, 31, 23, 59, 59, 999); // 31/03/2026
    const prev = resolveComparablePreviousYearReference(ref, 2025, 3);
    assert.equal(prev.getDate(), 31);
    assert.equal(prev.getMonth(), 2);
  });

  it("29/02 bissexto → clamp para 28/02 no ano comum (não dia 28 fixo)", () => {
    const ref = new Date(2024, 1, 29, 23, 59, 59, 999); // 29/02/2024
    const prev = resolveComparablePreviousYearReference(ref, 2023, 2);
    assert.equal(prev.getFullYear(), 2023);
    assert.equal(prev.getMonth(), 1);
    assert.equal(prev.getDate(), 28);
  });

  it("meses de 30/31 dias nunca truncam em 28", () => {
    const ref31 = new Date(2026, 7, 31, 23, 59, 59, 999);
    assert.equal(resolveComparablePreviousYearReference(ref31, 2025, 8).getDate(), 31);
    const ref30 = new Date(2026, 3, 30, 23, 59, 59, 999);
    assert.equal(resolveComparablePreviousYearReference(ref30, 2025, 4).getDate(), 30);
  });
});
