import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRepurchaseCadence } from "./crmRepurchaseEngine.js";
import {
  auditRepurchaseManually,
  compareManualAudit,
  manualCivilDay,
  type ManualAuditOrder,
} from "./crmRepurchaseManualAudit.js";

const at = (ymd: string, hour = 10): Date => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hour, 0, 0);
};
let seq = 0;
const order = (ymd: string, value = 100, hour = 10): ManualAuditOrder => ({
  orderCode: `PD ${++seq}`,
  issueDate: at(ymd, hour),
  totalNetValue: value,
});

/** Mesmo dado pelo motor: ocasiões = dias distintos (o motor recebe a lista de dias). */
function engineFor(orders: ManualAuditOrder[], today: string) {
  const days = [...new Set(orders.map((o) => manualCivilDay(o.issueDate)).filter((d) => d <= today))];
  return computeRepurchaseCadence(days.map((businessDate) => ({ businessDate })), today);
}

function comparable(orders: ManualAuditOrder[], today: string) {
  const c = engineFor(orders, today);
  return {
    totalOccasions: c.totalOccasions,
    occasionsUsed: c.occasionsUsed,
    averageRepurchaseDays: c.averageRepurchaseDays,
    lastPurchaseDate: c.lastPurchaseDate,
    expectedRepurchaseDate: c.expectedRepurchaseDate,
    deltaDays: c.deltaDays,
    repurchaseStatus: c.status,
    cadenceConfidence: c.cadenceConfidence,
  };
}

describe("conta manual da recompra (independente do motor)", () => {
  it("exemplo da norma: 3 pedidos no mesmo dia = 1 ocasião; média, esperada, delta, status", () => {
    const orders = [
      order("2026-06-01"),
      order("2026-07-01"),
      order("2026-07-31", 100, 8),
      order("2026-07-31", 50, 12),
      order("2026-07-31", 25, 16),
    ];
    const manual = auditRepurchaseManually(orders, "2026-09-11");
    assert.equal(manual.totalOccasions, 3);
    assert.deepEqual(manual.occasionsUsed.map((o) => [o.day, o.orderCodes.length]), [
      ["2026-06-01", 1],
      ["2026-07-01", 1],
      ["2026-07-31", 3],
    ]);
    assert.equal(manual.occasionsUsed[2]!.totalNetValue, 175);
    assert.deepEqual(manual.intervals, [30, 30]);
    assert.equal(manual.mean, 30);
    assert.equal(manual.expected, "2026-08-30");
    assert.equal(manual.delta, 12);
    assert.equal(manual.status, "OVERDUE");
    assert.equal(manual.confidence, "MEDIUM");
    assert.deepEqual(compareManualAudit(manual, comparable(orders, "2026-09-11")), []);
  });

  it("usa só as últimas 6 ocasiões; 1 ocasião = sem previsão; futuro fora", () => {
    const eight = ["2026-01-05", "2026-02-02", "2026-03-02", "2026-03-30", "2026-04-27", "2026-05-25", "2026-06-22", "2026-07-20"].map((d) => order(d));
    const manual = auditRepurchaseManually(eight, "2026-09-11");
    assert.equal(manual.totalOccasions, 8);
    assert.equal(manual.occasionsUsed.length, 6);
    assert.equal(manual.occasionsUsed[0]!.day, "2026-03-02");
    assert.equal(manual.confidence, "HIGH");
    const single = auditRepurchaseManually([order("2026-09-01"), order("2026-09-20")], "2026-09-11");
    assert.equal(single.status, "INSUFFICIENT_HISTORY");
    assert.equal(single.expected, null);
    assert.equal(auditRepurchaseManually([], "2026-09-11").status, "NO_HISTORY");
  });

  it("propriedade: 2.000 históricos aleatórios — conta manual = motor, campo a campo", () => {
    let state = 20260911;
    const rand = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const days = (n: number) => {
      const d = new Date(2023, 0, 1, 12);
      d.setDate(d.getDate() + n);
      return manualCivilDay(d);
    };
    for (let i = 0; i < 2000; i += 1) {
      const today = days(900 + Math.floor(rand() * 400));
      const n = Math.floor(rand() * 12);
      const orders: ManualAuditOrder[] = [];
      for (let k = 0; k < n; k += 1) {
        const day = days(Math.floor(rand() * 1400)); // inclui datas futuras
        const repeat = rand() > 0.8 ? 2 : 1; // pedidos no mesmo dia
        for (let r = 0; r < repeat; r += 1) orders.push(order(day, 10, 8 + r * 5));
      }
      const diff = compareManualAudit(auditRepurchaseManually(orders, today), comparable(orders, today));
      assert.deepEqual(diff, [], `caso ${i} (hoje ${today}): ${JSON.stringify(diff)}`);
    }
  });

  it("fim de mês e ano bissexto na aritmética de calendário", () => {
    const manual = auditRepurchaseManually([order("2024-01-31"), order("2024-02-29"), order("2024-03-31")], "2024-04-10");
    assert.deepEqual(manual.intervals, [29, 31]);
    assert.equal(manual.expected, "2024-04-30"); // 31/03 + 30 dias
    assert.equal(manual.delta, -20);
    assert.equal(manual.status, "ON_TIME");
    assert.deepEqual(compareManualAudit(manual, comparable([order("2024-01-31"), order("2024-02-29"), order("2024-03-31")], "2024-04-10")), []);
  });

  it("diverge quando o endpoint diverge (a conferência pega)", () => {
    const orders = [order("2026-06-01"), order("2026-07-01")];
    const manual = auditRepurchaseManually(orders, "2026-09-11");
    const wrong = { ...comparable(orders, "2026-09-11"), deltaDays: 0, repurchaseStatus: "DUE_SOON" };
    assert.deepEqual(
      compareManualAudit(manual, wrong).map((d) => d.field),
      ["deltaDays", "repurchaseStatus"]
    );
  });
});
