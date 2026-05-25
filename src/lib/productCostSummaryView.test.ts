import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProductCostSummaryView,
  COST_SUMMARY_LABELS,
  pickCostSummaryFromAnalysis,
} from "./productCostSummaryView";

describe("productCostSummaryView", () => {
  it("idle quando não há produto selecionado", () => {
    const vm = buildProductCostSummaryView({
      productId: null,
      loading: false,
      errorMessage: null,
      cost: null,
    });
    assert.equal(vm.kind, "idle");
    assert.equal(vm.totalIndustrialCost, null);
    assert.equal(vm.message, COST_SUMMARY_LABELS.idle);
    assert.equal(vm.showRetry, false);
  });

  it("loading sem valor anterior mostra 'Calculando custo…' e não vira R$ 0,00", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: true,
      errorMessage: null,
      cost: null,
    });
    assert.equal(vm.kind, "loading");
    assert.equal(vm.totalIndustrialCost, null);
    assert.equal(vm.message, COST_SUMMARY_LABELS.loading);
  });

  it("erro sem valor anterior mostra mensagem de erro e botão Atualizar", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: false,
      errorMessage: "Falha 500",
      cost: null,
    });
    assert.equal(vm.kind, "error");
    assert.equal(vm.totalIndustrialCost, null);
    assert.equal(vm.message, COST_SUMMARY_LABELS.error);
    assert.equal(vm.showRetry, true);
  });

  it("loaded com valor real preserva zero", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: false,
      errorMessage: null,
      cost: { totalIndustrialCost: 0, partial: false },
    });
    assert.equal(vm.kind, "loaded");
    assert.equal(vm.totalIndustrialCost, 0);
    assert.equal(vm.partial, false);
  });

  it("loaded com valor real positivo", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: false,
      errorMessage: null,
      cost: { totalIndustrialCost: 12.34, partial: true },
    });
    assert.equal(vm.kind, "loaded");
    assert.equal(vm.totalIndustrialCost, 12.34);
    assert.equal(vm.partial, true);
  });

  it("stale: loading com valor anterior mantém o valor", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: true,
      errorMessage: null,
      cost: { totalIndustrialCost: 100, partial: false },
    });
    assert.equal(vm.kind, "stale");
    assert.equal(vm.totalIndustrialCost, 100);
    assert.equal(vm.message, COST_SUMMARY_LABELS.loading);
  });

  it("erro pós-loaded mantém valor antigo (não apaga)", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: false,
      errorMessage: "Network",
      cost: { totalIndustrialCost: 50, partial: false },
    });
    assert.equal(vm.kind, "stale");
    assert.equal(vm.totalIndustrialCost, 50);
    assert.equal(vm.message, COST_SUMMARY_LABELS.error);
    assert.equal(vm.showRetry, true);
  });

  it("NaN/undefined no totalIndustrialCost são tratados como não-carregado", () => {
    const vm = buildProductCostSummaryView({
      productId: "p1",
      loading: false,
      errorMessage: null,
      cost: { totalIndustrialCost: NaN as unknown as number },
    });
    assert.equal(vm.kind, "idle");
    assert.equal(vm.totalIndustrialCost, null);
  });

  it("pickCostSummaryFromAnalysis lê summary.totalIndustrialCost", () => {
    const cost = pickCostSummaryFromAnalysis({
      summary: { totalIndustrialCost: "12.5" },
      costAnalysisPartial: true,
    });
    assert.equal(cost?.totalIndustrialCost, 12.5);
    assert.equal(cost?.partial, true);
  });

  it("pickCostSummaryFromAnalysis aceita totalIndustrialCost na raiz", () => {
    const cost = pickCostSummaryFromAnalysis({ totalIndustrialCost: 7 });
    assert.equal(cost?.totalIndustrialCost, 7);
    assert.equal(cost?.partial, false);
  });

  it("pickCostSummaryFromAnalysis devolve null se vier `error`", () => {
    const cost = pickCostSummaryFromAnalysis({ error: "X", totalIndustrialCost: 1 });
    assert.equal(cost, null);
  });

  it("pickCostSummaryFromAnalysis devolve null se total inválido", () => {
    assert.equal(pickCostSummaryFromAnalysis({ summary: {} }), null);
    assert.equal(pickCostSummaryFromAnalysis(null), null);
    assert.equal(pickCostSummaryFromAnalysis({ totalIndustrialCost: "abc" }), null);
  });
});
