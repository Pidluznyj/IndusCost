import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterPedidosByEmissaoWindow,
  formatNomusPedidoDateBr,
  parseNomusPedidoDataEmissao,
  parseNomusSalesOrdersSyncStrategy,
  resolveNomusSalesOrdersEmissaoWindow,
  subtractCalendarMonths,
} from "./nomusSalesOrdersSyncWindow.js";

describe("nomusSalesOrdersSyncWindow", () => {
  it("estratégia padrão é recent-window", () => {
    const prev = process.env.NOMUS_SALES_ORDERS_SYNC_STRATEGY;
    delete process.env.NOMUS_SALES_ORDERS_SYNC_STRATEGY;
    assert.equal(parseNomusSalesOrdersSyncStrategy(), "recent-window");
    process.env.NOMUS_SALES_ORDERS_SYNC_STRATEGY = prev;
  });

  it("resolve janela de 7 meses por env NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS", () => {
    const ref = new Date(2026, 5, 15, 12, 0, 0);
    const prevMonths = process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS;
    const prevDays = process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS;
    delete process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS;
    process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS = "7";

    const window = resolveNomusSalesOrdersEmissaoWindow(ref);
    assert.equal(window.windowMonths, 7);
    assert.equal(window.startDate.getFullYear(), 2025);
    assert.equal(window.startDate.getMonth(), 10);
    assert.equal(window.startDate.getDate(), 15);
    assert.equal(formatNomusPedidoDateBr(window.startDate), "15/11/2025");

    process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS = prevMonths;
    if (prevDays === undefined) delete process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS;
    else process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS = prevDays;
  });

  it("fallback NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS=210 quando meses ausente", () => {
    const ref = new Date(2026, 5, 15, 12, 0, 0);
    const prevMonths = process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS;
    const prevDays = process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS;
    delete process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS;
    process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS = "210";

    const window = resolveNomusSalesOrdersEmissaoWindow(ref);
    assert.equal(window.windowDays, 210);
    assert.equal(window.startDate.getFullYear(), 2025);
    assert.equal(window.startDate.getMonth(), 10);
    assert.equal(window.startDate.getDate(), 17);

    process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_MONTHS = prevMonths;
    process.env.NOMUS_SALES_ORDERS_RECENT_WINDOW_DAYS = prevDays;
  });

  it("subtractCalendarMonths ajusta fim de mês", () => {
    const ref = new Date(2026, 2, 31);
    const start = subtractCalendarMonths(ref, 1);
    assert.equal(start.getMonth(), 1);
    assert.equal(start.getDate(), 28);
  });

  it("parseNomusPedidoDataEmissao interpreta DD/MM/YYYY", () => {
    const d = parseNomusPedidoDataEmissao("06/03/2026");
    assert.ok(d);
    assert.equal(d!.getDate(), 6);
    assert.equal(d!.getMonth(), 2);
    assert.equal(d!.getFullYear(), 2026);
  });

  it("filterPedidosByEmissaoWindow exclui pedidos mais antigos que a janela", () => {
    const start = new Date(2025, 11, 1);
    const { kept, excludedOlder } = filterPedidosByEmissaoWindow(
      [
        { dataEmissao: "15/12/2025" },
        { dataEmissao: "20/11/2025" },
        { dataEmissao: "02/01/2026" },
      ],
      start
    );
    assert.equal(kept.length, 2);
    assert.equal(excludedOlder, 1);
  });
});
