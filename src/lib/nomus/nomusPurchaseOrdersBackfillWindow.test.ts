import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDateWithinNomusPurchaseOrdersWindow,
  resolveNomusPurchaseOrdersBackfillWindow,
} from "./nomusPurchaseOrdersBackfillWindow.js";

test("resolveNomusPurchaseOrdersBackfillWindow — 12 meses-calendário retroativos, não 365 dias corridos", () => {
  // Referência: 15/09/2026 (ano não bissexto — 2026 tem 365 dias, mas o
  // teste de bissexto é feito separadamente abaixo).
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  assert.equal(window.fromDateSp, "2025-09-15");
  assert.equal(window.toDateSp, "2026-09-15");
  assert.equal(window.months, 12);
});

test("resolveNomusPurchaseOrdersBackfillWindow — atravessa fevereiro bissexto sem virar 366/365 dias corridos", () => {
  // Referência 01/03/2024 (2024 é bissexto) — 12 meses atrás = 01/03/2023.
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2024-03-01T12:00:00.000Z"),
    12
  );
  assert.equal(window.fromDateSp, "2023-03-01");
  assert.equal(window.toDateSp, "2024-03-01");
});

test("resolveNomusPurchaseOrdersBackfillWindow — from é 00:00:00 SP (03:00:00 UTC) do primeiro dia", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  assert.equal(window.from.toISOString(), "2025-09-15T03:00:00.000Z");
});

test("resolveNomusPurchaseOrdersBackfillWindow — to é 23:59:59.999 SP (02:59:59.999 UTC do dia seguinte)", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  assert.equal(window.to.toISOString(), "2026-09-16T02:59:59.999Z");
});

test("resolveNomusPurchaseOrdersBackfillWindow — months inválido lança erro explícito (nunca janela silenciosa errada)", () => {
  assert.throws(() => resolveNomusPurchaseOrdersBackfillWindow(new Date(), 0));
  assert.throws(() => resolveNomusPurchaseOrdersBackfillWindow(new Date(), -1));
  assert.throws(() => resolveNomusPurchaseOrdersBackfillWindow(new Date(), NaN));
});

test("isDateWithinNomusPurchaseOrdersWindow — limite inicial (from) é inclusive", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  assert.equal(isDateWithinNomusPurchaseOrdersWindow(window.from, window), true);
});

test("isDateWithinNomusPurchaseOrdersWindow — 1ms antes do from fica fora", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  const beforeFrom = new Date(window.from.getTime() - 1);
  assert.equal(isDateWithinNomusPurchaseOrdersWindow(beforeFrom, window), false);
});

test("isDateWithinNomusPurchaseOrdersWindow — limite final (to) é inclusive", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  assert.equal(isDateWithinNomusPurchaseOrdersWindow(window.to, window), true);
});

test("isDateWithinNomusPurchaseOrdersWindow — 1ms depois do to fica fora", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    12
  );
  const afterTo = new Date(window.to.getTime() + 1);
  assert.equal(isDateWithinNomusPurchaseOrdersWindow(afterTo, window), false);
});

test("isDateWithinNomusPurchaseOrdersWindow — data nula/ausente é sempre fora (não é assumida presente)", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(new Date(), 12);
  assert.equal(isDateWithinNomusPurchaseOrdersWindow(null, window), false);
  assert.equal(isDateWithinNomusPurchaseOrdersWindow(undefined, window), false);
});

test("resolveNomusPurchaseOrdersBackfillWindow — janela de --months=1 cobre exatamente 1 mês-calendário", () => {
  const window = resolveNomusPurchaseOrdersBackfillWindow(
    new Date("2026-09-15T12:00:00.000Z"),
    1
  );
  assert.equal(window.fromDateSp, "2026-08-15");
  assert.equal(window.toDateSp, "2026-09-15");
});
