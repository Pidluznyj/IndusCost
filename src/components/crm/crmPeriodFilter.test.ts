import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrmPeriodDateRange,
  buildCrmPeriodYearOptions,
  buildDefaultCrmPeriodFilter,
  crmPeriodFilterFromSearchParams,
  crmPeriodFilterToSearchParamsPatch,
  resolveCrmCurrentYearMonth,
} from "@/src/components/crm/crmPeriodFilter";

test("resolveCrmCurrentYearMonth deriva o ano/mês vigente em runtime (não hardcoded)", () => {
  const now = new Date("2027-05-15T12:00:00Z");
  assert.deepEqual(resolveCrmCurrentYearMonth(now), { year: 2027, month: 5 });
});

test("resolveCrmCurrentYearMonth cobre virada de ano — dezembro no fuso America/Sao_Paulo (UTC-3)", () => {
  // 23:30 UTC de 31/12 ainda é 31/12 20:30 em São Paulo — não virou o ano local.
  assert.deepEqual(resolveCrmCurrentYearMonth(new Date("2026-12-31T23:30:00Z")), {
    year: 2026,
    month: 12,
  });
  // 02:30 UTC de 01/01 já é 31/12 23:30 em São Paulo — ainda dezembro no fuso operacional.
  assert.deepEqual(resolveCrmCurrentYearMonth(new Date("2027-01-01T02:30:00Z")), {
    year: 2026,
    month: 12,
  });
  // 12:00 UTC de 01/01 é 09:00 em São Paulo — já é o novo ano no fuso operacional.
  assert.deepEqual(resolveCrmCurrentYearMonth(new Date("2027-01-01T12:00:00Z")), {
    year: 2027,
    month: 1,
  });
});

test("resolveCrmCurrentYearMonth cobre janeiro", () => {
  const now = new Date("2026-01-01T13:00:00Z");
  const result = resolveCrmCurrentYearMonth(now);
  assert.equal(result.year, 2026);
  assert.equal(result.month, 1);
});

test("buildDefaultCrmPeriodFilter('current') abre no mês vigente", () => {
  const now = new Date("2026-09-04T15:00:00Z");
  const period = buildDefaultCrmPeriodFilter("current", now);
  assert.equal(period.year, "2026");
  assert.equal(period.month, "9");
});

test("buildDefaultCrmPeriodFilter('all') abre com mês vazio (ano inteiro)", () => {
  const now = new Date("2026-09-04T15:00:00Z");
  const period = buildDefaultCrmPeriodFilter("all", now);
  assert.equal(period.year, "2026");
  assert.equal(period.month, "");
});

test("buildCrmPeriodDateRange: mês vazio = ano inteiro", () => {
  const range = buildCrmPeriodDateRange({ year: "2026", month: "" });
  assert.deepEqual(range, { dateFrom: "2026-01-01", dateTo: "2026-12-31" });
});

test("buildCrmPeriodDateRange: mês explícito usa o último dia real do mês", () => {
  assert.deepEqual(buildCrmPeriodDateRange({ year: "2026", month: "2" }), {
    dateFrom: "2026-02-01",
    dateTo: "2026-02-28",
  });
  // 2028 é bissexto.
  assert.deepEqual(buildCrmPeriodDateRange({ year: "2028", month: "2" }), {
    dateFrom: "2028-02-01",
    dateTo: "2028-02-29",
  });
});

test("buildCrmPeriodDateRange: janeiro e dezembro", () => {
  assert.deepEqual(buildCrmPeriodDateRange({ year: "2026", month: "1" }), {
    dateFrom: "2026-01-01",
    dateTo: "2026-01-31",
  });
  assert.deepEqual(buildCrmPeriodDateRange({ year: "2026", month: "12" }), {
    dateFrom: "2026-12-01",
    dateTo: "2026-12-31",
  });
});

test("buildCrmPeriodDateRange: entrada inválida retorna null (não inventa período)", () => {
  assert.equal(buildCrmPeriodDateRange({ year: "", month: "" }), null);
  assert.equal(buildCrmPeriodDateRange({ year: "abcd", month: "" }), null);
  assert.equal(buildCrmPeriodDateRange({ year: "2026", month: "13" }), null);
  assert.equal(buildCrmPeriodDateRange({ year: "2026", month: "0" }), null);
});

test("buildCrmPeriodYearOptions inclui o ano vigente e não é hardcoded", () => {
  const now = new Date("2031-06-01T12:00:00Z");
  const years = buildCrmPeriodYearOptions(4, now);
  assert.deepEqual(years, [2031, 2030, 2029, 2028, 2027]);
});

test("crmPeriodFilterFromSearchParams preserva deep-link explícito na URL", () => {
  const params = new URLSearchParams("sellerYear=2024&sellerMonth=3");
  const now = new Date("2026-09-04T12:00:00Z");
  const period = crmPeriodFilterFromSearchParams(params, "seller", "current", now);
  assert.deepEqual(period, { year: "2024", month: "3" });
});

test("crmPeriodFilterFromSearchParams: URL sem parâmetro cai no default oficial da tela", () => {
  const params = new URLSearchParams();
  const now = new Date("2026-09-04T12:00:00Z");
  assert.deepEqual(crmPeriodFilterFromSearchParams(params, "seller", "current", now), {
    year: "2026",
    month: "9",
  });
  assert.deepEqual(crmPeriodFilterFromSearchParams(params, "portfolio", "all", now), {
    year: "2026",
    month: "",
  });
});

test("crmPeriodFilterFromSearchParams: mês=Todos explícito na URL é respeitado mesmo em tela 'current'", () => {
  const params = new URLSearchParams("sellerYear=2026&sellerMonth=");
  const now = new Date("2026-09-04T12:00:00Z");
  assert.deepEqual(crmPeriodFilterFromSearchParams(params, "seller", "current", now), {
    year: "2026",
    month: "",
  });
});

test("crmPeriodFilterFromSearchParams ignora valor inválido na URL e cai no default (não quebra)", () => {
  const params = new URLSearchParams("sellerYear=abcd&sellerMonth=99");
  const now = new Date("2026-09-04T12:00:00Z");
  assert.deepEqual(crmPeriodFilterFromSearchParams(params, "seller", "current", now), {
    year: "2026",
    month: "9",
  });
});

test("crmPeriodFilterToSearchParamsPatch gera as chaves prefixadas para sincronizar a URL", () => {
  assert.deepEqual(
    crmPeriodFilterToSearchParamsPatch({ year: "2026", month: "9" }, "seller"),
    { sellerYear: "2026", sellerMonth: "9" }
  );
});

test("round-trip: 'Limpar filtros' restaura o default oficial, nunca período vazio", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const clearedSeller = buildDefaultCrmPeriodFilter("current", now);
  const clearedPortfolio = buildDefaultCrmPeriodFilter("all", now);
  assert.notEqual(clearedSeller.year, "");
  assert.notEqual(clearedPortfolio.year, "");
  assert.equal(clearedSeller.month, "9");
  assert.equal(clearedPortfolio.month, "");
});
