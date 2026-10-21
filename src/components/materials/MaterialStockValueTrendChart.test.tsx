import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MaterialStockValueTrendChart } from "./MaterialStockValueTrendChart.js";

describe("MaterialStockValueTrendChart", () => {
  it("título e regra descrevem conferência física, não fechamento semanal", () => {
    const html = renderToStaticMarkup(<MaterialStockValueTrendChart />);
    assert.match(html, /material-stock-value-trend/);
    assert.match(html, /por conferência física/);
    assert.match(html, /Cada ponto é o valor total de MP logo após uma contagem física/);
    assert.match(html, /Várias conferências na mesma semana aparecem todas/);
    assert.doesNotMatch(html, /flutuação semanal/);
    assert.doesNotMatch(html, /semana fechou/);
  });
});
