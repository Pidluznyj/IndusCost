import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultMaterialDemandUiFilters,
  buildMaterialDemandSalesOrderWhere,
  materialDemandAggregationPeriodKey,
  materialDemandUiFiltersToQueryParams,
  parseMaterialDemandFilters,
  parseMaterialDemandUiFiltersFromSearchParams,
  resolveMaterialDemandPeriodPreset,
  SALES_ORDER_FIRM_STATUSES,
} from "./materialDemandFilters";

test("parseMaterialDemandFilters: statuses múltiplos via CSV", () => {
  const f = parseMaterialDemandFilters({
    statuses: "READY_TO_SEND,SENT_TO_NOMUS,DRAFT",
    dateBasis: "expectedDeliveryDate",
  });
  assert.deepEqual(f.statuses, ["READY_TO_SEND", "SENT_TO_NOMUS", "DRAFT"]);
});

test("buildMaterialDemandSalesOrderWhere: status in e entrega sem data", () => {
  const where = buildMaterialDemandSalesOrderWhere(
    {
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      dateBasis: "expectedDeliveryDate",
      status: null,
      statuses: [...SALES_ORDER_FIRM_STATUSES],
      customerId: null,
      productId: null,
      materialId: null,
      companyIssuer: null,
      unitKey: null,
      mode: "value",
      search: "",
      includeOrdersWithoutDeliveryDate: true,
      invoicingScope: "all",
      seller: null,
    },
    { env: {} }
  );
  // Sem flag de presença: estrutura comercial no root.
  assert.ok(where.OR);
  assert.equal((where.status as { in: string[] }).in.length, 2);
});

test("buildMaterialDemandSalesOrderWhere: OP-02 aplica presença com flag on", () => {
  const where = buildMaterialDemandSalesOrderWhere(
    {
      startDate: null,
      endDate: null,
      dateBasis: "issueDate",
      status: null,
      statuses: [...SALES_ORDER_FIRM_STATUSES],
      customerId: null,
      productId: null,
      materialId: null,
      companyIssuer: null,
      unitKey: null,
      mode: "value",
      search: "",
      includeOrdersWithoutDeliveryDate: true,
      invoicingScope: "all",
      seller: null,
    },
    { env: { NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED: "true" } }
  );
  assert.match(JSON.stringify(where), /MISSING_CONFIRMED/);
});

test("buildMaterialDemandSalesOrderWhere: seller usa eixo Nomus", () => {
  const byId = buildMaterialDemandSalesOrderWhere(
    {
      startDate: null,
      endDate: null,
      dateBasis: "issueDate",
      status: null,
      statuses: [],
      customerId: null,
      productId: null,
      materialId: null,
      companyIssuer: null,
      unitKey: null,
      mode: "value",
      search: "",
      includeOrdersWithoutDeliveryDate: true,
      invoicingScope: "all",
      seller: "42",
    },
    { env: {} }
  );
  assert.equal(byId.externalSellerId, 42);
  assert.equal(byId.responsible, undefined);
});

test("materialDemandAggregationPeriodKey alinha dateBasis", () => {
  const issue = new Date("2026-03-15T12:00:00.000Z");
  const delivery = new Date("2026-06-20T12:00:00.000Z");
  assert.equal(
    materialDemandAggregationPeriodKey("issueDate", issue, delivery),
    "2026-03"
  );
  assert.equal(
    materialDemandAggregationPeriodKey("expectedDeliveryDate", issue, delivery),
    "2026-06"
  );
});

test("defaults sales-orders incluem carteira firme e YTD por emissão", () => {
  const f = buildDefaultMaterialDemandUiFilters("sales-orders");
  assert.deepEqual(f.statuses, [...SALES_ORDER_FIRM_STATUSES]);
  assert.equal(f.includeOrdersWithoutDeliveryDate, true);
  assert.equal(f.dateBasis, "issueDate");
  const ytd = resolveMaterialDemandPeriodPreset("ytd", "issueDate");
  assert.equal(f.startDate, ytd.startDate);
  assert.equal(f.endDate, ytd.endDate);
});

test("URL round-trip de filtros UI", () => {
  const defaults = buildDefaultMaterialDemandUiFilters("sales-orders");
  const qs = materialDemandUiFiltersToQueryParams(defaults);
  qs.set("customerId", "cust-1");
  const parsed = parseMaterialDemandUiFiltersFromSearchParams(qs, "sales-orders");
  assert.equal(parsed.customerId, "cust-1");
  assert.equal(parsed.dateBasis, defaults.dateBasis);
});

test("preset lastMonth retorna mês anterior", () => {
  const { startDate, endDate } = resolveMaterialDemandPeriodPreset("lastMonth", "issueDate");
  assert.match(startDate, /^\d{4}-\d{2}-01$/);
  assert.match(endDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(startDate < endDate);
});
