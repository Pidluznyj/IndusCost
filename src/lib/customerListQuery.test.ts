import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_LIST_DEFAULT_LIMIT,
  CUSTOMER_LIST_MAX_LIMIT,
  CUSTOMER_LIST_OWNER_NONE,
  buildCustomerLinkWhere,
  buildCustomerListResponse,
  buildCustomerListWhere,
  buildCustomerOwnerWhere,
  buildCustomerStateWhere,
  customerListMeta,
  formatCustomerListRange,
  parseCustomerListQuery,
  resolveCustomerCityFilter,
  shouldUseCustomerPagination,
} from "./customerListQuery.js";

describe("customerListQuery", () => {
  it("uses limit=20 by default", () => {
    const q = parseCustomerListQuery({});
    assert.equal(q.limit, CUSTOMER_LIST_DEFAULT_LIMIT);
    assert.equal(q.page, 1);
    assert.equal(q.skip, 0);
  });

  it("search resets pagination math on page 1", () => {
    const q = parseCustomerListQuery({ page: "1", limit: "20", search: "acme" });
    assert.equal(q.search, "acme");
    assert.equal(q.skip, 0);
  });

  it("calculates totalPages correctly", () => {
    assert.equal(customerListMeta(45, 1, 20).totalPages, 3);
    assert.equal(customerListMeta(0, 1, 20).totalPages, 1);
  });

  it("respects limit maximum", () => {
    const q = parseCustomerListQuery({ limit: "999" });
    assert.equal(q.limit, CUSTOMER_LIST_MAX_LIMIT);
  });

  it("buildCustomerListResponse exposes items and legacy customers key", () => {
    const body = buildCustomerListResponse([{ id: "1" }], customerListMeta(1, 1, 20));
    assert.equal(body.total, 1);
    assert.equal(body.totalPages, 1);
    assert.deepEqual(body.items, [{ id: "1" }]);
    assert.deepEqual(body.customers, [{ id: "1" }]);
  });

  it("formatCustomerListRange avoids NaN", () => {
    assert.equal(formatCustomerListRange(customerListMeta(0, 1, 20)), "Nenhum cliente encontrado");
    assert.equal(formatCustomerListRange(customerListMeta(25, 2, 20)), "Mostrando 21–25 de 25 clientes");
  });

  it("shouldUseCustomerPagination detects paginated requests", () => {
    assert.equal(shouldUseCustomerPagination({}), false);
    assert.equal(shouldUseCustomerPagination({ page: "1" }), true);
    assert.equal(shouldUseCustomerPagination({ search: "x" }), true);
    assert.equal(shouldUseCustomerPagination({ commercialOwner: "none" }), true);
    assert.equal(shouldUseCustomerPagination({ state: "SP" }), true);
    assert.equal(shouldUseCustomerPagination({ city: "Campina Grande" }), true);
    assert.equal(shouldUseCustomerPagination({ creditStatus: "blocked" }), true);
    assert.equal(parseCustomerListQuery({ creditStatus: "blocked" }).creditStatus, "blocked");
    assert.equal(parseCustomerListQuery({ creditStatus: "qualquer" }).creditStatus, "");
    assert.equal(parseCustomerListQuery({ linkStatus: "pending" }).linkStatus, "pending");
    assert.equal(parseCustomerListQuery({ linkStatus: "grupo" }).linkStatus, "");
    assert.ok(buildCustomerLinkWhere("confirmed"));
    assert.equal(buildCustomerLinkWhere(""), undefined);
  });

  it("vazio não restringe e none marca cliente sem responsável ativo", () => {
    assert.equal(parseCustomerListQuery({}).commercialOwner, "");
    assert.equal(parseCustomerListQuery({ commercialOwner: " none " }).commercialOwner, "none");
    assert.equal(buildCustomerOwnerWhere(""), undefined);
    assert.equal(buildCustomerOwnerWhere("n:gislene lima"), undefined);
    assert.deepEqual(buildCustomerOwnerWhere(CUSTOMER_LIST_OWNER_NONE), {
      NOT: { CrmCustomerCommercialOwner: { is: { isActive: true } } },
    });
    const noneWhere = buildCustomerOwnerWhere(CUSTOMER_LIST_OWNER_NONE);
    const combined = buildCustomerListWhere("acme", noneWhere);
    assert.ok(combined && Array.isArray(combined.AND) && combined.AND.length === 2);
    assert.equal(buildCustomerListWhere("", undefined), undefined);
  });

  it("filtra pela mesma UF do indicador, inclusive nome com e sem acento", () => {
    assert.equal(parseCustomerListQuery({}).state, "");
    assert.equal(parseCustomerListQuery({ state: " sp " }).state, "SP");
    assert.equal(parseCustomerListQuery({ state: "São Paulo" }).state, "SP");
    assert.equal(parseCustomerListQuery({ state: "Marte" }).state, "");

    const where = buildCustomerStateWhere("SP");
    assert.ok(where && Array.isArray(where.OR));
    const equals = where.OR.map((item) => ("state" in item ? item.state : null));
    assert.deepEqual(equals, [
      { equals: "SP", mode: "insensitive" },
      { equals: "São Paulo", mode: "insensitive" },
      { equals: "sao paulo", mode: "insensitive" },
    ]);
    assert.equal(buildCustomerStateWhere("OUTROS"), undefined);

    const all = buildCustomerListWhere("acme", buildCustomerOwnerWhere(CUSTOMER_LIST_OWNER_NONE), where);
    assert.ok(all && Array.isArray(all.AND) && all.AND.length === 3);
  });

  it("junta grafias da mesma cidade e restringe à UF escolhida", () => {
    assert.equal(parseCustomerListQuery({ city: " campina grande " }).city, "CAMPINA GRANDE");
    assert.equal(parseCustomerListQuery({ city: "x" }).city, "");

    const rows = [
      { city: "CAMPINA GRANDE", state: "PB" },
      { city: "Campina Grande", state: "Paraíba" },
      { city: "Esperança", state: "PB" },
      { city: "ESPERANCA", state: "pb" },
      { city: "Curitiba - PR", state: "PR" },
      { city: "Curitiba", state: "Paraná" },
      { city: "Joinville", state: "SC" },
      { city: "  ", state: "PB" },
    ];

    const paraiba = resolveCustomerCityFilter(rows, "PB", "");
    assert.deepEqual(
      paraiba.options.map((option) => option.label),
      ["Campina Grande", "Esperança"]
    );
    assert.equal(paraiba.cityWhere, undefined);

    const campina = resolveCustomerCityFilter(rows, "PB", "Campina Grande");
    assert.equal(campina.options.length, 2);
    assert.ok(campina.cityWhere && "OR" in campina.cityWhere && Array.isArray(campina.cityWhere.OR));
    const cities = campina.cityWhere && "OR" in campina.cityWhere ? campina.cityWhere.OR : [];
    assert.deepEqual(cities, [
      { city: { equals: "CAMPINA GRANDE", mode: "insensitive" } },
      { city: { equals: "Campina Grande", mode: "insensitive" } },
    ]);

    const curitiba = resolveCustomerCityFilter(rows, "", "Curitiba - PR");
    assert.equal(curitiba.options.find((option) => option.key === "CURITIBA")?.label, "Curitiba");
    const curitibaOr = curitiba.cityWhere && "OR" in curitiba.cityWhere ? curitiba.cityWhere.OR : [];
    assert.equal(curitibaOr.length, 2);

    const missing = resolveCustomerCityFilter(rows, "PB", "Recife");
    assert.deepEqual(missing.cityWhere, { id: { in: [] } });

    const filtered = buildCustomerListWhere("", undefined, buildCustomerStateWhere("PB"), campina.cityWhere);
    assert.ok(filtered && Array.isArray(filtered.AND) && filtered.AND.length === 2);
  });
});
