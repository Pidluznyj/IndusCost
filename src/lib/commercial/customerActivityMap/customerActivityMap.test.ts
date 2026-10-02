/**
 * Mapa de Atuação — normalização, resolução de localização e agregações.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCustomerMap,
  buildBrazilGeoIndex,
  isWithinBounds,
  normalizeCityKey,
  parseCustomerMapBounds,
  parseCustomerMapFilters,
  resolveCustomerMapLocation,
  resolveOrderPeriodStart,
  type CustomerMapFactRow,
} from "./customerActivityMap.js";
import { getBrazilGeoIndex } from "./customerActivityMapService.server.js";

const index = getBrazilGeoIndex();
const NOW = new Date("2026-10-02T12:00:00Z");
const OLD = new Date("2025-01-10T12:00:00Z");

function row(overrides: Partial<CustomerMapFactRow> & { id: string }): CustomerMapFactRow {
  return {
    city: "Curitiba",
    state: "PR",
    status: "ACTIVE",
    createdAt: OLD,
    orderCount: 0,
    ...overrides,
  };
}

describe("dataset de municípios", () => {
  it("cobre as 27 UFs e os municípios do IBGE sem chave ambígua", () => {
    assert.equal(index.states.size, 27);
    assert.ok(index.municipalities.size >= 5565);
    const curitiba = index.municipalities.get("PR|CURITIBA");
    assert.equal(curitiba?.ibgeCode, 4106902);
    assert.ok(Math.abs(curitiba!.lat - -25.43) < 0.1);
    assert.ok(Math.abs(curitiba!.lng - -49.27) < 0.1);
  });

  it("chave duplicada na mesma UF fica de fora (na dúvida, não mapeia)", () => {
    const small = buildBrazilGeoIndex({
      states: [["PR", "Paraná", -24.89, -51.55, "Sul"]],
      municipalities: [
        [1, "Bom Jesus", "PR", -25, -50],
        [2, "Bom Jesús", "PR", -24, -51],
        [3, "Curitiba", "PR", -25.4, -49.2],
      ],
    });
    assert.equal(small.municipalities.has("PR|BOM JESUS"), false);
    assert.equal(small.municipalities.has("PR|CURITIBA"), true);
  });
});

describe("normalização de cidade", () => {
  it("iguala caixa, acento e pontuação — e só isso", () => {
    for (const value of ["Curitiba", "CURITIBA", "curitiba", "Curitíba", "  curitiba  "]) {
      assert.equal(normalizeCityKey(value), "CURITIBA");
    }
    assert.equal(normalizeCityKey("São José dos Pinhais"), "SAO JOSE DOS PINHAIS");
    assert.equal(normalizeCityKey("Santa Bárbara d'Oeste"), "SANTA BARBARA D OESTE");
    assert.equal(normalizeCityKey("Ji-Paraná"), "JI PARANA");
    assert.equal(normalizeCityKey(null), "");
  });
});

describe("resolução de localização", () => {
  it("cidade + UF → centróide do município (precisão CITY)", () => {
    const location = resolveCustomerMapLocation({ city: "SAO PAULO", state: "sp" }, index);
    assert.equal(location.precision, "CITY");
    assert.equal(location.cityName, "São Paulo");
    assert.equal(location.uf, "SP");
  });

  it("aceita UF por extenso e sufixo redundante na cidade", () => {
    const byName = resolveCustomerMapLocation({ city: "Joinville", state: "Santa Catarina" }, index);
    assert.equal(byName.precision, "CITY");
    assert.equal(byName.uf, "SC");
    const suffixed = resolveCustomerMapLocation({ city: "Curitiba - PR", state: "PR" }, index);
    assert.equal(suffixed.precision, "CITY");
    assert.equal(suffixed.cityName, "Curitiba");
    const fromCity = resolveCustomerMapLocation({ city: "Araucária/PR", state: null }, index);
    assert.equal(fromCity.precision, "CITY");
    assert.equal(fromCity.cityName, "Araucária");
  });

  it("não faz fuzzy: grafia errada cai para a UF, nunca para outra cidade", () => {
    const typo = resolveCustomerMapLocation({ city: "Curitba", state: "PR" }, index);
    assert.equal(typo.precision, "STATE");
    assert.equal(typo.reason, "CITY_NOT_RECOGNIZED");
    assert.equal(typo.uf, "PR");
  });

  it("cidade de outra UF não é reaproveitada", () => {
    const wrongState = resolveCustomerMapLocation({ city: "Curitiba", state: "SP" }, index);
    assert.equal(wrongState.precision, "STATE");
    assert.equal(wrongState.uf, "SP");
  });

  it("classifica os casos sem localização suficiente", () => {
    const cases: Array<[{ city: string | null; state: string | null; country?: string }, string, string]> = [
      [{ city: null, state: null }, "UNKNOWN", "MISSING_STATE_AND_CITY"],
      [{ city: "Curitiba", state: "" }, "UNKNOWN", "MISSING_STATE"],
      [{ city: "Curitiba", state: "XX" }, "UNKNOWN", "INVALID_STATE"],
      [{ city: "", state: "PR" }, "STATE", "MISSING_CITY"],
      [{ city: "Miami", state: "FL", country: "Estados Unidos" }, "UNKNOWN", "FOREIGN_COUNTRY"],
    ];
    for (const [input, precision, reason] of cases) {
      const location = resolveCustomerMapLocation(input, index);
      assert.equal(location.precision, precision, JSON.stringify(input));
      assert.equal(location.reason, reason, JSON.stringify(input));
    }
  });
});

describe("agregação", () => {
  const rows: CustomerMapFactRow[] = [
    row({ id: "a", orderCount: 5 }),
    row({ id: "b", city: "CURITÍBA", status: "INACTIVE", orderCount: 2 }),
    row({ id: "c", city: "Araucária", createdAt: new Date("2026-09-20T12:00:00Z") }),
    row({ id: "d", city: "Joinville", state: "SC", orderCount: 7 }),
    row({ id: "e", city: "Cidade Inventada", state: "SC" }),
    row({ id: "f", city: null, state: null }),
    // mesmo cliente repetido (ex.: join que multiplica linhas) não conta duas vezes
    row({ id: "a", orderCount: 5 }),
  ];
  const result = aggregateCustomerMap(rows, index, NOW);

  it("conta cada cliente uma vez e separa mapeados / só UF / sem localização", () => {
    assert.equal(result.summary.customers, 6);
    assert.equal(result.summary.mappedCustomers, 4);
    assert.equal(result.summary.stateOnlyCustomers, 1);
    assert.equal(result.summary.unmappedCustomers, 1);
    assert.equal(
      result.summary.mappedCustomers +
        result.summary.stateOnlyCustomers +
        result.summary.unmappedCustomers,
      result.summary.customers
    );
    assert.equal(result.summary.states, 2);
    assert.equal(result.summary.cities, 3);
  });

  it("agrega por município juntando grafias da mesma cidade", () => {
    const curitiba = result.cities.find((city) => city.city === "Curitiba");
    assert.deepEqual(
      { customers: curitiba?.customers, active: curitiba?.activeCustomers, orders: curitiba?.orders },
      { customers: 2, active: 1, orders: 7 }
    );
    assert.equal(result.cities[0]?.city, "Curitiba");
  });

  it("agrega por UF incluindo quem só tem UF", () => {
    const sc = result.states.find((state) => state.uf === "SC");
    assert.equal(sc?.customers, 2);
    assert.equal(sc?.cities, 1);
    assert.equal(sc?.stateOnlyCustomers, 1);
    assert.equal(sc?.orders, 7);
    const pr = result.states.find((state) => state.uf === "PR");
    assert.equal(pr?.customers, 3);
    assert.equal(pr?.newCustomers, 1);
  });

  it("métricas: ativos pela situação do cadastro, pedidos somados, novos por cadastro em 30 dias", () => {
    assert.equal(result.summary.activeCustomers, 5);
    assert.equal(result.summary.orders, 14);
    assert.equal(result.summary.newCustomers, 1);
  });

  it("explica por motivo os registros sem localização precisa", () => {
    assert.deepEqual(
      result.summary.unresolvedByReason.map((entry) => [entry.reason, entry.count]).sort(),
      [
        ["CITY_NOT_RECOGNIZED", 1],
        ["MISSING_STATE_AND_CITY", 1],
      ]
    );
  });

  it("população vazia não quebra", () => {
    const empty = aggregateCustomerMap([], index, NOW);
    assert.equal(empty.summary.customers, 0);
    assert.deepEqual(empty.cities, []);
    assert.deepEqual(empty.states, []);
  });
});

describe("filtros", () => {
  it("normaliza filtros e ignora valores desconhecidos", () => {
    assert.deepEqual(parseCustomerMapFilters({}), {
      status: null,
      ownerKey: null,
      orderPeriod: "all",
    });
    assert.deepEqual(
      parseCustomerMapFilters({ status: "active", ownerKey: " k1 ", orderPeriod: "90d" }),
      { status: "ACTIVE", ownerKey: "k1", orderPeriod: "90d" }
    );
    assert.equal(parseCustomerMapFilters({ status: "x", orderPeriod: "1y" }).status, null);
    assert.equal(parseCustomerMapFilters({ orderPeriod: "1y" }).orderPeriod, "all");
  });

  it("período de pedidos: todo o histórico não tem corte", () => {
    assert.equal(resolveOrderPeriodStart("all", NOW), null);
    assert.equal(
      resolveOrderPeriodStart("30d", NOW)?.toISOString(),
      "2026-09-02T12:00:00.000Z"
    );
  });

  it("bbox: valida formato e limites", () => {
    assert.deepEqual(parseCustomerMapBounds("-50,-26,-49,-25"), {
      west: -50,
      south: -26,
      east: -49,
      north: -25,
    });
    assert.equal(parseCustomerMapBounds("-49,-26,-50,-25"), null);
    assert.equal(parseCustomerMapBounds("a,b,c,d"), null);
    assert.equal(parseCustomerMapBounds("-50,-26,-49"), null);
    assert.equal(parseCustomerMapBounds("-50,-126,-49,-25"), null);
    const bounds = parseCustomerMapBounds("-50,-26,-49,-25")!;
    assert.equal(isWithinBounds({ lat: -25.43, lng: -49.27 }, bounds), true);
    assert.equal(isWithinBounds({ lat: -23.55, lng: -46.63 }, bounds), false);
  });
});
