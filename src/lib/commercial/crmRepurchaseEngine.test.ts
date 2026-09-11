import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPURCHASE_MAX_OCCASIONS,
  addBusinessDays,
  addBusinessMonths,
  businessDaysBetween,
  buildDistinctPurchaseOccasions,
  classifyRepurchaseDelta,
  computeRepurchaseCadence,
  isBusinessDateWithin,
  isValidBusinessDate,
  resolveCadenceConfidence,
  resolveRollingDaysWindow,
  resolveRollingMonthsWindow,
  toBusinessDate,
} from "./crmRepurchaseEngine.js";
import { CRM_REPURCHASE_ENGINE_VERSION } from "./crmReportsTypes.js";

/** Ocasiões a partir de dias civis (atalho de teste). */
const days = (...list: string[]) => list.map((businessDate) => ({ businessDate }));

describe("crmRepurchaseEngine — ocasiões de compra", () => {
  it("3 pedidos no mesmo dia (08h, 12h, 16h) = 3 pedidos e 1 ocasião", () => {
    const occasions = buildDistinctPurchaseOccasions([
      { issueDate: new Date(2026, 8, 3, 8, 0), totalNetValue: 100 },
      { issueDate: new Date(2026, 8, 3, 12, 0), totalNetValue: 200.5 },
      { issueDate: new Date(2026, 8, 3, 16, 0), totalNetValue: 0.25 },
    ]);
    assert.deepEqual(occasions, [{ businessDate: "2026-09-03", orderCount: 3, totalNetValue: 300.75 }]);
    const cadence = computeRepurchaseCadence(occasions, "2026-09-11");
    assert.equal(cadence.totalOccasions, 1);
    assert.equal(cadence.status, "INSUFFICIENT_HISTORY");
  });

  it("ordena cronologicamente e soma valor sem erro de ponto flutuante", () => {
    const occasions = buildDistinctPurchaseOccasions([
      { issueDate: new Date(2026, 5, 10, 9), totalNetValue: 0.1 },
      { issueDate: new Date(2026, 0, 5, 9), totalNetValue: 10 },
      { issueDate: new Date(2026, 5, 10, 15), totalNetValue: 0.2 },
    ]);
    assert.deepEqual(
      occasions.map((o) => o.businessDate),
      ["2026-01-05", "2026-06-10"]
    );
    // 0.1 + 0.2 em micro-unidades inteiras = 0.3 exato.
    assert.equal(occasions[1]!.totalNetValue, 0.3);
    assert.equal(occasions[1]!.orderCount, 2);
  });

  it("dia de compra é o calendário LOCAL (23h30 continua no mesmo dia)", () => {
    assert.equal(toBusinessDate(new Date(2026, 8, 3, 23, 30)), "2026-09-03");
    assert.equal(toBusinessDate(new Date(2026, 8, 3, 0, 0)), "2026-09-03");
    assert.equal(toBusinessDate("2026-09-03"), "2026-09-03");
    assert.equal(toBusinessDate("2026-02-30"), null);
    assert.equal(toBusinessDate(new Date(Number.NaN)), null);
    assert.equal(toBusinessDate(null), null);
  });

  it("valida chave civil de verdade", () => {
    assert.ok(isValidBusinessDate("2028-02-29"));
    assert.ok(!isValidBusinessDate("2026-02-29"));
    assert.ok(!isValidBusinessDate("2026-13-01"));
    assert.ok(!isValidBusinessDate("2026-9-1"));
  });
});

describe("crmRepurchaseEngine — cadência", () => {
  it("zero compras → NO_HISTORY, confiança NONE, sem previsão", () => {
    const c = computeRepurchaseCadence([], "2026-09-11");
    assert.equal(c.version, CRM_REPURCHASE_ENGINE_VERSION);
    assert.equal(c.status, "NO_HISTORY");
    assert.equal(c.cadenceConfidence, "NONE");
    assert.equal(c.totalOccasions, 0);
    assert.equal(c.occasionsUsed, 0);
    assert.equal(c.intervalsUsed, 0);
    assert.equal(c.lastPurchaseDate, null);
    assert.equal(c.averageRepurchaseDays, null);
    assert.equal(c.expectedRepurchaseDate, null);
    assert.equal(c.deltaDays, null);
  });

  it("uma compra → INSUFFICIENT_HISTORY, sem intervalo, sem data esperada", () => {
    const c = computeRepurchaseCadence(days("2026-08-01"), "2026-09-11");
    assert.equal(c.status, "INSUFFICIENT_HISTORY");
    assert.equal(c.cadenceConfidence, "NONE");
    assert.equal(c.totalOccasions, 1);
    assert.equal(c.occasionsUsed, 1);
    assert.equal(c.intervalsUsed, 0);
    assert.equal(c.lastPurchaseDate, "2026-08-01");
    assert.equal(c.averageRepurchaseDays, null);
    assert.equal(c.expectedRepurchaseDate, null);
    assert.equal(c.deltaDays, null);
  });

  it("duas compras → 1 intervalo, confiança LOW", () => {
    const c = computeRepurchaseCadence(days("2026-07-01", "2026-07-31"), "2026-08-10");
    assert.deepEqual(c.intervalDays, [30]);
    assert.equal(c.intervalsUsed, 1);
    assert.equal(c.averageRepurchaseDays, 30);
    assert.equal(c.expectedRepurchaseDate, "2026-08-30");
    assert.equal(c.deltaDays, -20);
    assert.equal(c.status, "ON_TIME");
    assert.equal(c.cadenceConfidence, "LOW");
  });

  it("três compras → 2 intervalos, confiança MEDIUM", () => {
    const c = computeRepurchaseCadence(days("2026-06-01", "2026-06-21", "2026-07-21"), "2026-08-01");
    assert.deepEqual(c.intervalDays, [20, 30]);
    assert.equal(c.averageRepurchaseDays, 25);
    assert.equal(c.expectedRepurchaseDate, "2026-08-15");
    assert.equal(c.cadenceConfidence, "MEDIUM");
    assert.equal(c.deltaDays, -14);
    assert.equal(c.status, "DUE_SOON");
  });

  it("seis compras → 5 intervalos, usa todas, confiança HIGH", () => {
    const c = computeRepurchaseCadence(
      days("2026-01-10", "2026-02-09", "2026-03-11", "2026-04-10", "2026-05-10", "2026-06-09"),
      "2026-07-09"
    );
    assert.equal(c.totalOccasions, 6);
    assert.equal(c.occasionsUsed, 6);
    assert.equal(c.intervalsUsed, 5);
    assert.deepEqual(c.intervalDays, [30, 30, 30, 30, 30]);
    assert.equal(c.expectedRepurchaseDate, "2026-07-09");
    assert.equal(c.deltaDays, 0);
    assert.equal(c.cadenceConfidence, "HIGH");
  });

  it("mais de seis compras → só as ÚLTIMAS 6 ocasiões entram (no máximo 5 intervalos)", () => {
    // Um gap antigo de 400 dias NÃO pode contaminar a média.
    const c = computeRepurchaseCadence(
      days(
        "2023-01-01",
        "2024-02-05",
        "2026-01-10",
        "2026-02-09",
        "2026-03-11",
        "2026-04-10",
        "2026-05-10",
        "2026-06-09"
      ),
      "2026-07-01"
    );
    assert.equal(REPURCHASE_MAX_OCCASIONS, 6);
    assert.equal(c.totalOccasions, 8);
    assert.equal(c.occasionsUsed, 6);
    assert.equal(c.intervalsUsed, 5);
    assert.equal(c.firstOccasionUsedDate, "2026-01-10");
    assert.equal(c.averageRepurchaseDays, 30);
    assert.equal(c.cadenceConfidence, "HIGH");
  });

  it("vários pedidos no mesmo dia contam 1 ocasião na cadência", () => {
    const occasions = buildDistinctPurchaseOccasions([
      { issueDate: new Date(2026, 6, 1, 8), totalNetValue: 1 },
      { issueDate: new Date(2026, 6, 1, 17), totalNetValue: 1 },
      { issueDate: new Date(2026, 6, 31, 9), totalNetValue: 1 },
      { issueDate: new Date(2026, 6, 31, 10), totalNetValue: 1 },
      { issueDate: new Date(2026, 6, 31, 11), totalNetValue: 1 },
    ]);
    const c = computeRepurchaseCadence(occasions, "2026-08-10");
    assert.equal(c.totalOccasions, 2);
    assert.deepEqual(c.intervalDays, [30]);
    assert.equal(c.cadenceConfidence, "LOW");
  });

  it("média com decimal: mantém precisão e arredonda só para a data esperada", () => {
    const half = computeRepurchaseCadence(days("2026-01-01", "2026-01-31", "2026-03-03"), "2026-03-10");
    assert.deepEqual(half.intervalDays, [30, 31]);
    assert.equal(half.averageRepurchaseDays, 30.5);
    assert.equal(half.averageRepurchaseDaysRounded, 31); // meio para cima
    assert.equal(half.expectedRepurchaseDate, "2026-04-03");

    const third = computeRepurchaseCadence(
      days("2026-01-01", "2026-01-11", "2026-01-21", "2026-02-01"),
      "2026-02-05"
    );
    assert.deepEqual(third.intervalDays, [10, 10, 11]);
    assert.equal(third.averageRepurchaseDays, 31 / 3);
    assert.equal(third.averageRepurchaseDaysRounded, 10);
    assert.equal(third.expectedRepurchaseDate, "2026-02-11");
  });

  it("data esperada = hoje → deltaDays 0 → DUE_SOON", () => {
    const c = computeRepurchaseCadence(days("2026-08-12", "2026-09-11"), "2026-10-11");
    assert.equal(c.expectedRepurchaseDate, "2026-10-11");
    assert.equal(c.deltaDays, 0);
    assert.equal(c.status, "DUE_SOON");
  });

  it("+1 dia de atraso → OVERDUE", () => {
    const c = computeRepurchaseCadence(days("2026-08-12", "2026-09-11"), "2026-10-12");
    assert.equal(c.deltaDays, 1);
    assert.equal(c.status, "OVERDUE");
  });

  it("+30 ainda é OVERDUE; +31 é SEVERELY_OVERDUE", () => {
    const at30 = computeRepurchaseCadence(days("2026-08-12", "2026-09-11"), "2026-11-10");
    assert.equal(at30.deltaDays, 30);
    assert.equal(at30.status, "OVERDUE");
    const at31 = computeRepurchaseCadence(days("2026-08-12", "2026-09-11"), "2026-11-11");
    assert.equal(at31.deltaDays, 31);
    assert.equal(at31.status, "SEVERELY_OVERDUE");
  });

  it("−15 é DUE_SOON; −16 é ON_TIME", () => {
    assert.equal(classifyRepurchaseDelta(-16), "ON_TIME");
    assert.equal(classifyRepurchaseDelta(-15), "DUE_SOON");
    assert.equal(classifyRepurchaseDelta(0), "DUE_SOON");
    assert.equal(classifyRepurchaseDelta(1), "OVERDUE");
    assert.equal(classifyRepurchaseDelta(30), "OVERDUE");
    assert.equal(classifyRepurchaseDelta(31), "SEVERELY_OVERDUE");
  });

  it("virada de mês: intervalos e data esperada em dias de calendário", () => {
    const c = computeRepurchaseCadence(days("2026-01-20", "2026-02-19"), "2026-03-01");
    assert.deepEqual(c.intervalDays, [30]);
    // 19/02/2026 + 30 = 21/03/2026 (fevereiro de 2026 tem 28 dias).
    assert.equal(c.expectedRepurchaseDate, "2026-03-21");
    const endOfMonth = computeRepurchaseCadence(days("2026-01-01", "2026-01-31"), "2026-02-01");
    assert.equal(endOfMonth.expectedRepurchaseDate, "2026-03-02");
  });

  it("virada de ano: intervalos e data esperada atravessam 31/12", () => {
    const c = computeRepurchaseCadence(days("2025-11-20", "2025-12-20"), "2026-01-05");
    assert.deepEqual(c.intervalDays, [30]);
    assert.equal(c.expectedRepurchaseDate, "2026-01-19");
    assert.equal(c.deltaDays, -14);
    assert.equal(c.status, "DUE_SOON");
    assert.equal(businessDaysBetween("2025-12-15", "2026-01-14"), 30);
  });

  it("ano bissexto conta 29/02", () => {
    assert.equal(businessDaysBetween("2028-02-28", "2028-03-01"), 2);
    assert.equal(businessDaysBetween("2026-02-28", "2026-03-01"), 1);
  });

  it("aceita ocasiões fora de ordem e duplicadas", () => {
    const c = computeRepurchaseCadence(days("2026-07-31", "2026-07-01", "2026-07-31"), "2026-08-10");
    assert.equal(c.totalOccasions, 2);
    assert.deepEqual(c.intervalDays, [30]);
  });

  it("não usa ms/24h: soma de dias atravessando horário de verão continua inteira", () => {
    // Datas civis puras — independem do fuso da máquina de teste.
    assert.equal(addBusinessDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addBusinessDays("2026-03-08", 1), "2026-03-09");
    assert.equal(businessDaysBetween("2026-03-01", "2026-04-01"), 31);
  });

  it("confiança: 0–1 NONE · 2 LOW · 3–4 MEDIUM · 5+ HIGH", () => {
    assert.equal(resolveCadenceConfidence(0), "NONE");
    assert.equal(resolveCadenceConfidence(1), "NONE");
    assert.equal(resolveCadenceConfidence(2), "LOW");
    assert.equal(resolveCadenceConfidence(3), "MEDIUM");
    assert.equal(resolveCadenceConfidence(4), "MEDIUM");
    assert.equal(resolveCadenceConfidence(5), "HIGH");
    assert.equal(resolveCadenceConfidence(6), "HIGH");
  });

  it("recusa 'hoje' inválido (erro de programação, não dado)", () => {
    assert.throws(() => computeRepurchaseCadence(days("2026-01-01"), "2026-02-30"), RangeError);
  });
});

describe("crmRepurchaseEngine — janelas móveis", () => {
  it("60 dias = hoje + 59 dias anteriores", () => {
    const w = resolveRollingDaysWindow("2026-09-11", 60);
    assert.deepEqual(w, { from: "2026-07-14", to: "2026-09-11", days: 60 });
    assert.equal(businessDaysBetween(w.from, w.to) + 1, 60);
    assert.ok(isBusinessDateWithin("2026-07-14", w));
    assert.ok(isBusinessDateWithin("2026-09-11", w));
    assert.ok(!isBusinessDateWithin("2026-07-13", w));
    assert.ok(!isBusinessDateWithin("2026-09-12", w));
  });

  it("12 meses = (hoje − 12 meses) + 1 dia … hoje", () => {
    assert.deepEqual(resolveRollingMonthsWindow("2026-09-11", 12), {
      from: "2025-09-12",
      to: "2026-09-11",
      months: 12,
    });
    // Fim de mês ajustado: 29/02/2028 − 12 meses = 28/02/2027.
    assert.equal(resolveRollingMonthsWindow("2028-02-29", 12).from, "2027-03-01");
    assert.equal(resolveRollingMonthsWindow("2026-01-15", 12).from, "2025-01-16");
  });

  it("soma de meses ajusta fim de mês e vira ano", () => {
    assert.equal(addBusinessMonths("2026-03-31", -1), "2026-02-28");
    assert.equal(addBusinessMonths("2026-01-31", -2), "2025-11-30");
    assert.equal(addBusinessMonths("2026-12-15", 1), "2027-01-15");
    assert.equal(addBusinessMonths("2026-09-11", -12), "2025-09-11");
  });
});
