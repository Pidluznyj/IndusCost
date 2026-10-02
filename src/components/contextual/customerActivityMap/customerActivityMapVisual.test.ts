import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bubbleRadius,
  clusterByScreenDistance,
  formatBounds,
  formatMetricValue,
  MAP_EMPTY_FILL,
  MAP_METRIC_OPTIONS,
  maxMetric,
  rankByMetric,
  resolveMapStage,
  resolveTileConfig,
  sequentialColor,
  visualIntensity,
} from "./customerActivityMapVisual.js";

const counts = (customers: number, orders = 0) => ({
  customers,
  activeCustomers: customers,
  orders,
  newCustomers: 0,
});

describe("mapa de atuação — apresentação", () => {
  it("métrica padrão é Clientes e todas têm legenda", () => {
    assert.equal(MAP_METRIC_OPTIONS[0]!.id, "customers");
    for (const option of MAP_METRIC_OPTIONS) assert.ok(option.legend.length > 0);
    assert.equal(formatMetricValue("customers", 1), "1 cliente");
    assert.equal(formatMetricValue("orders", 1284), "1.284 pedidos");
  });

  it("estágios do zoom: concentração → municípios → clientes", () => {
    assert.equal(resolveMapStage(4), "overview");
    assert.equal(resolveMapStage(5), "overview");
    assert.equal(resolveMapStage(6), "cities");
    assert.equal(resolveMapStage(8), "cities");
    assert.equal(resolveMapStage(9), "customers");
    assert.equal(resolveMapStage(15), "customers");
  });

  it("intensidade em raiz: cidade pequena não some, ordem é preservada", () => {
    assert.equal(visualIntensity(0, 200), 0);
    assert.equal(visualIntensity(200, 200), 1);
    const small = visualIntensity(5, 200);
    const medium = visualIntensity(50, 200);
    assert.ok(small >= 0.12 && small < medium && medium < 1);
    // linear daria 0,025 — a raiz mantém a cidade pequena visível
    assert.ok(small > 5 / 200);
    assert.equal(visualIntensity(1, 100000), 0.12);
    assert.equal(visualIntensity(10, 0), 0);
  });

  it("bolha e cor seguem a intensidade", () => {
    assert.equal(bubbleRadius(0, 100), 0);
    assert.ok(bubbleRadius(100, 100) > bubbleRadius(10, 100));
    assert.equal(sequentialColor(0, 100), MAP_EMPTY_FILL);
    assert.notEqual(sequentialColor(1, 100), sequentialColor(100, 100));
  });

  it("ranking usa a métrica selecionada e ignora zerados", () => {
    const rows = [
      { name: "A", ...counts(10, 1) },
      { name: "B", ...counts(3, 40) },
      { name: "C", ...counts(7, 0) },
    ];
    assert.deepEqual(rankByMetric(rows, "customers", 2).map((r) => r.name), ["A", "C"]);
    assert.deepEqual(rankByMetric(rows, "orders", 5).map((r) => r.name), ["B", "A"]);
    assert.equal(maxMetric(rows, "orders"), 40);
  });

  it("bolhas sobrepostas na tela viram um grupo ancorado no maior", () => {
    const clusters = clusterByScreenDistance(
      [
        { item: "pequena-perto", x: 110, y: 100, weight: 1 },
        { item: "capital", x: 100, y: 100, weight: 180 },
        { item: "longe", x: 400, y: 300, weight: 5 },
      ],
      40
    );
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0]!.anchor, "capital");
    assert.deepEqual(clusters[0]!.members, ["capital", "pequena-perto"]);
    assert.deepEqual(clusters[1]!.members, ["longe"]);
    // nada some: todo item pertence a exatamente um grupo
    assert.equal(clusters.reduce((sum, c) => sum + c.members.length, 0), 3);
  });

  it("bbox no formato da API", () => {
    assert.equal(
      formatBounds({ west: -50.123456, south: -26, east: -49, north: -25.5 }),
      "-50.1235,-26.0000,-49.0000,-25.5000"
    );
  });

  it("tiles configuráveis por ambiente, sem chave no código", () => {
    assert.match(resolveTileConfig(undefined).url ?? "", /openstreetmap/);
    assert.equal(resolveTileConfig({ VITE_ACTIVITY_MAP_TILE_URL: "none" }).url, null);
    const custom = resolveTileConfig({
      VITE_ACTIVITY_MAP_TILE_URL: "https://tiles.exemplo/{z}/{x}/{y}.png",
      VITE_ACTIVITY_MAP_TILE_ATTRIBUTION: "© Exemplo",
    });
    assert.equal(custom.url, "https://tiles.exemplo/{z}/{x}/{y}.png");
    assert.equal(custom.attribution, "© Exemplo");
  });
});
