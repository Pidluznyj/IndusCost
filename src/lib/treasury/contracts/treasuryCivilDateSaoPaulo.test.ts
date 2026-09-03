import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  civilDateFromInstantInSaoPaulo,
  civilDateRangeForDbDate,
  civilDateRangeInSaoPaulo,
} from "./treasuryCivilDate.js";

describe("civilDateFromInstantInSaoPaulo", () => {
  it("mantém o dia civil para um instante ainda dentro do fim de tarde em SP", () => {
    assert.equal(
      civilDateFromInstantInSaoPaulo(new Date("2026-09-01T20:59:00-03:00")),
      "2026-09-01"
    );
  });

  it("21h em SP (= 00:00Z do dia seguinte) continua sendo o mesmo dia civil — caso que UTC puro erraria", () => {
    const instant = new Date("2026-09-01T21:00:00-03:00");
    assert.equal(instant.toISOString(), "2026-09-02T00:00:00.000Z");
    assert.equal(civilDateFromInstantInSaoPaulo(instant), "2026-09-01");
  });

  it("mantém o dia civil até 23:59 em SP", () => {
    assert.equal(
      civilDateFromInstantInSaoPaulo(new Date("2026-09-01T23:59:00-03:00")),
      "2026-09-01"
    );
  });

  it("2:59:59 UTC ainda é 23:59:59 do dia anterior em SP", () => {
    assert.equal(
      civilDateFromInstantInSaoPaulo(new Date("2026-09-02T02:59:59-00:00")),
      "2026-09-01"
    );
  });

  it("3:00:00 UTC é exatamente meia-noite em SP — vira o dia civil seguinte", () => {
    assert.equal(
      civilDateFromInstantInSaoPaulo(new Date("2026-09-02T03:00:00Z")),
      "2026-09-02"
    );
  });

  it("lança para um Date inválido, em vez de retornar string malformada", () => {
    assert.throws(() => civilDateFromInstantInSaoPaulo(new Date(NaN)));
  });
});

describe("civilDateRangeInSaoPaulo", () => {
  it("cobre um único dia civil como [00:00 SP, 00:00 SP do dia seguinte)", () => {
    const range = civilDateRangeInSaoPaulo("2026-09-01", "2026-09-01");
    assert.equal(range.gte.getTime(), new Date("2026-09-01T03:00:00.000Z").getTime());
    assert.equal(range.lt.getTime(), new Date("2026-09-02T03:00:00.000Z").getTime());
  });

  it("cobre um intervalo de dias civis com o mesmo gte e lt exclusivo no dia seguinte ao 'to'", () => {
    const range = civilDateRangeInSaoPaulo("2026-09-01", "2026-09-03");
    assert.equal(range.gte.getTime(), new Date("2026-09-01T03:00:00.000Z").getTime());
    assert.equal(range.lt.getTime(), new Date("2026-09-04T03:00:00.000Z").getTime());
  });

  it("round-trip: qualquer instante dentro de [gte, lt) do dia mapeia de volta ao mesmo dia civil", () => {
    const day = "2026-09-01";
    const range = civilDateRangeInSaoPaulo(day, day);

    const gte = range.gte;
    assert.equal(civilDateFromInstantInSaoPaulo(gte), day);

    const middle = new Date(gte.getTime() + 12 * 60 * 60 * 1000);
    assert.equal(civilDateFromInstantInSaoPaulo(middle), day);

    const justBeforeLt = new Date(range.lt.getTime() - 1);
    assert.equal(civilDateFromInstantInSaoPaulo(justBeforeLt), day);
  });
});

describe("civilDateRangeForDbDate", () => {
  it("usa Date.UTC puro, sem ajuste de fuso, para colunas @db.Date", () => {
    const range = civilDateRangeForDbDate("2026-09-01", "2026-09-03");
    assert.equal(range.gte.getTime(), Date.UTC(2026, 8, 1));
    assert.equal(range.lt.getTime(), Date.UTC(2026, 8, 4));
  });
});
