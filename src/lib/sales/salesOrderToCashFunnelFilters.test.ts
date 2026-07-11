import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrderToCashFunnelListUrl } from "./salesOrderToCashFunnelClient.js";
import {
  applyOrderToCashFunnelPeriodPreset,
  buildOrderToCashFunnelFilterChips,
  buildOrderToCashFunnelQueryParams,
  createDefaultOrderToCashFunnelUiFilters,
  resolveOrderToCashFunnelPeriodPreset,
  type OrderToCashFunnelUiFilters,
} from "./salesOrderToCashFunnelFilters.js";

const fixedToday = new Date(2026, 6, 11); // 2026-07-11 local

describe("salesOrderToCashFunnelFilters", () => {
  it("1. filtros montam query correta", () => {
    const filters: OrderToCashFunnelUiFilters = {
      ...createDefaultOrderToCashFunnelUiFilters(fixedToday),
      customerName: "Britânia",
      sellerName: "Ana",
      companyName: "Lazarios",
      orderCode: "PD02339",
      productSku: "SKU-9",
      funnelStage: "BLOQUEADO_REVISAO",
      stageGroup: "RISCO",
      temperature: "CONGELADO",
      confidenceLabel: "BAIXA",
      alert: "CR_VENCIDO",
      responsibleArea: "COMERCIAL",
      minValue: "1000",
      maxValue: "500000",
      dateAxis: "FORECAST_DATE",
      periodPreset: "next_30",
      dateFrom: "2026-07-11",
      dateTo: "2026-08-10",
      page: 2,
      pageSize: 25,
    };

    const params = buildOrderToCashFunnelQueryParams(filters);
    assert.equal(params.cliente, "Britânia");
    assert.equal(params.vendedor, "Ana");
    assert.equal(params.empresa, "Lazarios");
    assert.equal(params.pedido, "PD02339");
    assert.equal(params.produto, "SKU-9");
    assert.equal(params.estagio, "BLOQUEADO_REVISAO");
    assert.equal(params.grupo, "RISCO");
    assert.equal(params.temperatura, "CONGELADO");
    assert.equal(params.confianca, "BAIXA");
    assert.equal(params.alerta, "CR_VENCIDO");
    assert.equal(params.responsavel, "COMERCIAL");
    assert.equal(params.valorMinimo, "1000");
    assert.equal(params.valorMaximo, "500000");
    assert.equal(params.dateAxis, "FORECAST_DATE");
    assert.equal(params.dateFrom, "2026-07-11");
    assert.equal(params.dateTo, "2026-08-10");
    assert.equal(params.page, "2");
    assert.equal(params.pageSize, "25");

    const url = buildOrderToCashFunnelListUrl(filters);
    assert.match(url, /^\/api\/sales\/order-to-cash-funnel\?/);
    assert.match(url, /cliente=Brit/);
    assert.match(url, /estagio=BLOQUEADO_REVISAO/);
    assert.match(url, /temperatura=CONGELADO/);
    assert.match(url, /alerta=CR_VENCIDO/);
    assert.match(url, /responsavel=COMERCIAL/);
  });

  it("2. chips aparecem para filtros aplicados", () => {
    const filters: OrderToCashFunnelUiFilters = {
      ...createDefaultOrderToCashFunnelUiFilters(fixedToday),
      customerName: "X",
      sellerName: "Y",
      funnelStage: "BLOQUEADO_REVISAO",
      temperature: "CONGELADO",
      periodPreset: "next_30",
      dateFrom: "2026-07-11",
      dateTo: "2026-08-10",
      dateAxis: "FORECAST_DATE",
    };
    const chips = buildOrderToCashFunnelFilterChips(filters);
    const labels = chips.map((c) => c.label);
    assert.ok(labels.some((l) => l === "Cliente: X"));
    assert.ok(labels.some((l) => l === "Vendedor: Y"));
    assert.ok(labels.some((l) => /Estágio:.*Bloqueado/.test(l)));
    assert.ok(labels.some((l) => l === "Temperatura: Congelado"));
    assert.ok(labels.some((l) => l === "Período: Próximos 30 dias"));
  });

  it("3. limpar filtros limpa estado e query", () => {
    const dirty: OrderToCashFunnelUiFilters = {
      ...createDefaultOrderToCashFunnelUiFilters(fixedToday),
      customerName: "X",
      sellerName: "Y",
      funnelStage: "CR_ABERTO",
      temperature: "FRIO",
      alert: "NF_SEM_CR",
      companyName: "Emp",
      orderCode: "PD1",
      productSku: "SKU",
      stageGroup: "FINANCEIRO",
      confidenceLabel: "ALTA",
      responsibleArea: "FINANCEIRO",
      minValue: "10",
      maxValue: "99",
    };
    const cleared = createDefaultOrderToCashFunnelUiFilters(fixedToday);
    assert.equal(cleared.customerName, "");
    assert.equal(cleared.sellerName, "");
    assert.equal(cleared.funnelStage, "");
    assert.equal(cleared.temperature, "");
    assert.equal(cleared.alert, "");
    assert.equal(cleared.periodPreset, "current_year");
    assert.equal(cleared.dateFrom, "2026-01-01");
    assert.equal(cleared.dateTo, "2026-12-31");

    const dirtyParams = buildOrderToCashFunnelQueryParams(dirty);
    const clearParams = buildOrderToCashFunnelQueryParams(cleared);
    assert.ok(dirtyParams.cliente);
    assert.equal(clearParams.cliente, undefined);
    assert.equal(clearParams.estagio, undefined);
    assert.equal(clearParams.temperatura, undefined);
    assert.equal(clearParams.alerta, undefined);
    assert.equal(clearParams.dateAxis, "ORDER_ISSUE_DATE");
  });

  it("4. atalhos de data funcionam", () => {
    const base = createDefaultOrderToCashFunnelUiFilters(fixedToday);
    const next30 = applyOrderToCashFunnelPeriodPreset(base, "next_30", fixedToday);
    assert.equal(next30.periodPreset, "next_30");
    assert.equal(next30.dateFrom, "2026-07-11");
    assert.equal(next30.dateTo, "2026-08-10");
    assert.equal(next30.dateAxis, "FORECAST_DATE");

    const overdue = applyOrderToCashFunnelPeriodPreset(base, "overdue", fixedToday);
    assert.equal(overdue.periodPreset, "overdue");
    assert.equal(overdue.dateTo, "2026-07-10");
    assert.equal(overdue.dateFrom, "");

    const thisMonth = resolveOrderToCashFunnelPeriodPreset("this_month", fixedToday);
    assert.deepEqual(thisMonth, { from: "2026-07-01", to: "2026-07-31" });

    const lastMonth = resolveOrderToCashFunnelPeriodPreset("last_month", fixedToday);
    assert.deepEqual(lastMonth, { from: "2026-06-01", to: "2026-06-30" });

    const custom = applyOrderToCashFunnelPeriodPreset(base, "custom", fixedToday);
    assert.equal(custom.periodPreset, "custom");
  });

  it("5. filtro de estágio funciona na query", () => {
    const filters = {
      ...createDefaultOrderToCashFunnelUiFilters(fixedToday),
      funnelStage: "BLOQUEADO_REVISAO",
    };
    assert.equal(buildOrderToCashFunnelQueryParams(filters).estagio, "BLOQUEADO_REVISAO");
  });

  it("6. filtro de temperatura funciona na query", () => {
    const filters = {
      ...createDefaultOrderToCashFunnelUiFilters(fixedToday),
      temperature: "CONGELADO",
    };
    assert.equal(buildOrderToCashFunnelQueryParams(filters).temperatura, "CONGELADO");
  });

  it("7. filtro de alerta funciona na query", () => {
    const filters = {
      ...createDefaultOrderToCashFunnelUiFilters(fixedToday),
      alert: "ENTREGA_VENCIDA_SEM_DOCUMENTO",
    };
    assert.equal(
      buildOrderToCashFunnelQueryParams(filters).alerta,
      "ENTREGA_VENCIDA_SEM_DOCUMENTO"
    );
  });
});
