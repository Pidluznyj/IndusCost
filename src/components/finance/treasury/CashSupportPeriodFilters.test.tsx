import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashSupportPeriodFilters } from "./CashSupportPeriodFilters.js";

describe("CashSupportPeriodFilters", () => {
  it("renderiza Ano, Mês e Até com os valores atuais", () => {
    const html = renderToStaticMarkup(
      <CashSupportPeriodFilters
        value={{ year: 2026, month: 7, until: "2026-07-20" }}
        yearOptions={[2023, 2024, 2025, 2026, 2027]}
        onChange={() => {}}
      />
    );
    assert.ok(html.includes('data-testid="cash-support-filter-year"'));
    assert.ok(html.includes('data-testid="cash-support-filter-month"'));
    assert.ok(html.includes('data-testid="cash-support-filter-until"'));
    assert.ok(html.includes('value="2026-07-20"'));
  });

  it("mês vazio mostra 'Todos os meses' selecionado", () => {
    const html = renderToStaticMarkup(
      <CashSupportPeriodFilters
        value={{ year: 2026, month: "", until: "2026-07-20" }}
        yearOptions={[2026]}
        onChange={() => {}}
      />
    );
    assert.ok(html.includes("Todos os meses"));
  });

  it("lista todos os 12 meses", () => {
    const html = renderToStaticMarkup(
      <CashSupportPeriodFilters
        value={{ year: 2026, month: "", until: "2026-07-20" }}
        yearOptions={[2026]}
        onChange={() => {}}
      />
    );
    for (const label of ["Janeiro", "Fevereiro", "Dezembro"]) {
      assert.ok(html.includes(label), `mês ausente: ${label}`);
    }
  });

  it("campo Até é um input de data", () => {
    const html = renderToStaticMarkup(
      <CashSupportPeriodFilters
        value={{ year: 2026, month: "", until: "2026-07-20" }}
        yearOptions={[2026]}
        onChange={() => {}}
      />
    );
    assert.match(html, /data-testid="cash-support-filter-until"[^>]*type="date"|type="date"[^>]*data-testid="cash-support-filter-until"/);
  });
});
