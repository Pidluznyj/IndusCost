/**
 * Compras → Performance — UI (render estático, sem browser):
 * aba na navegação, abas antigas preservadas, estados loading/error/empty/
 * success/partial, KPIs, rankings, métrica indisponível ≠ zero, V1/V2 separados,
 * scorecard e detalhe de MP com dados prontos do backend.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { before, describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PurchaseChainViewNav } from "@/src/components/supply-chain/PurchaseChainViewNav";
import {
  buildSupplierPerformanceDashboard,
  buildSupplierPerformanceMaterialDetail,
  buildSupplierPerformanceSupplierDetail,
  type SupplierPerformanceDashboardFilters,
} from "@/src/lib/purchasing/supplierPerformanceDashboard";
import { periodSelectionFromPreset } from "@/src/lib/purchasing/supplierPerformanceDashboardUi";
import {
  FIXTURE_FILTERS_2026,
  S1,
  S2,
  S3,
  buildFixtureInput,
} from "@/src/lib/purchasing/supplierPerformanceDashboardFixture.test-helper";
import type { SupplierPerformanceDashboardViewState } from "./SupplierPerformanceDashboardPage";
import { buildSupplierMaterialMatrix, parseSupplierMaterialMatrixQuery } from "@/src/lib/purchasing/supplierPerformanceDashboard";

/**
 * Os componentes importam CSS do design system (metric-card.css etc.). O runner
 * `tsx --test` não carrega CSS: registramos um hook que devolve módulo vazio para
 * `.css` e importamos os componentes dinamicamente depois do registro.
 */
register(
  `data:text/javascript,${encodeURIComponent(
    'export async function load(url, context, next) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }'
  )}`,
  import.meta.url
);

type PageModule = typeof import("./SupplierPerformanceDashboardPage");
type ScorecardModule = typeof import("./SupplierScorecardOverlay");
type MaterialModule = typeof import("./MaterialDetailOverlay");
type MatrixModule = typeof import("./SupplierMaterialMatrixSection");

let SupplierPerformanceDashboardView: PageModule["SupplierPerformanceDashboardView"];
let SupplierScorecardContent: ScorecardModule["SupplierScorecardContent"];
let MaterialDetailContent: MaterialModule["MaterialDetailContent"];
let SupplierMaterialMatrixTable: MatrixModule["SupplierMaterialMatrixTable"];

before(async () => {
  SupplierPerformanceDashboardView = (await import("./SupplierPerformanceDashboardPage")).SupplierPerformanceDashboardView;
  SupplierScorecardContent = (await import("./SupplierScorecardOverlay")).SupplierScorecardContent;
  MaterialDetailContent = (await import("./MaterialDetailOverlay")).MaterialDetailContent;
  SupplierMaterialMatrixTable = (await import("./SupplierMaterialMatrixSection")).SupplierMaterialMatrixTable;
});

const noop = () => undefined;
const filters: SupplierPerformanceDashboardFilters = FIXTURE_FILTERS_2026;
const selection = periodSelectionFromPreset("last12m", new Date(2026, 8, 7));

function renderView(state: SupplierPerformanceDashboardViewState): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SupplierPerformanceDashboardView
        state={state}
        filters={filters}
        selection={selection}
        materialOption={null}
        onSelectionChange={noop}
        onFiltersChange={noop}
        onMaterialOptionChange={noop}
        onRefresh={noop}
        onSelectSupplier={noop}
        onSelectMaterial={noop}
      />
    </MemoryRouter>
  );
}

const model = buildSupplierPerformanceDashboard(buildFixtureInput(), filters);

describe("navegação Compras", () => {
  it("aba Performance aparece ao lado de Pedidos Nomus e Avaliação Fornecedor, nessa ordem", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PurchaseChainViewNav current="performance" variant="nomus" />
      </MemoryRouter>
    );
    const nomus = html.indexOf("Pedidos Nomus");
    const evaluation = html.indexOf("Avaliação Fornecedor");
    const performance = html.indexOf(">Performance<");
    assert.ok(nomus >= 0 && evaluation > nomus && performance > evaluation);
    assert.ok(html.includes('href="/purchases/nomus-orders"'));
    assert.ok(html.includes('href="/purchases/supplier-evaluation"'));
    assert.ok(html.includes('aria-current="page"'));
    assert.equal(html.includes("Solicitações"), false);
  });

  it("nas abas antigas, Performance é um link e a aba atual continua a mesma", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PurchaseChainViewNav current="nomus-orders" variant="nomus" />
      </MemoryRouter>
    );
    assert.ok(html.includes('href="/purchases/performance"'));
    assert.match(html, /aria-current="page"[^>]*>Pedidos Nomus</);
  });
});

describe("estados da tela", () => {
  it("loading sem dados", () => {
    const html = renderView({ status: "loading", data: null });
    assert.ok(html.includes('data-testid="performance-loading"'));
    assert.ok(html.includes('data-testid="performance-filters"'));
    assert.equal(html.includes('data-testid="performance-executive-kpis"'), false);
  });

  it("erro não parece vazio e permite tentar novamente", () => {
    const html = renderView({ status: "error", message: "Falha X", data: null });
    assert.ok(html.includes('data-testid="performance-error"'));
    assert.ok(html.includes("Falha X"));
    assert.ok(html.includes("Tentar novamente"));
  });

  it("vazio não parece erro; catálogo de indicadores continua visível", () => {
    const empty = buildSupplierPerformanceDashboard(buildFixtureInput({ orders: [], lines: [], evaluations: [] }), filters);
    const html = renderView({ status: "success", data: empty });
    assert.ok(html.includes("Nenhuma compra encontrada para o período e filtros selecionados."));
    assert.equal(html.includes('data-testid="performance-error"'), false);
    assert.ok(html.includes('data-testid="performance-advanced-metrics"'));
  });

  it("sucesso renderiza KPIs, seções, rankings, gráficos e painel de regras", () => {
    const html = renderView({ status: "success", data: model });
    for (const id of [
      "performance-executive-kpis",
      "kpi-total-spend",
      "kpi-active-suppliers",
      "kpi-order-count",
      "kpi-average-ticket",
      "kpi-material-mix",
      "kpi-evaluation-score",
      "kpi-evaluation-coverage",
      "kpi-top5",
      "performance-concentration-section",
      "kpi-single-source",
      "kpi-dual-source",
      "performance-pareto",
      "performance-most-concentrated",
      "performance-dominant-supplier",
      "performance-rankings-section",
      "performance-ranking-bestEvaluated",
      "performance-trend-section",
      "performance-pricing-section",
      "performance-price-dispersion",
      "performance-price-increases",
      "performance-evaluation-section",
      "performance-evaluation-distribution",
      "performance-score-vs-spend",
      "performance-advanced-section",
      "performance-data-rules",
    ]) {
      assert.ok(html.includes(`data-testid="${id}"`), `falta ${id}`);
    }
    assert.ok(html.includes("R$&nbsp;4.470,00") || html.includes("4.470,00"));
    assert.ok(html.includes("Performance de Fornecedores"));
    assert.ok(html.includes(`data-testid="supplier-link-${S3}"`)); // clique abre o 360
    assert.ok(html.includes("Fornecedor único observado"));
  });

  it("estado parcial: avisos de multimoeda e dados não identificados", () => {
    const html = renderView({ status: "success", data: model });
    assert.ok(html.includes('data-testid="performance-notice-currency"'));
    assert.ok(html.includes("USD: 1"));
    assert.ok(html.includes('data-testid="performance-notice-partial"'));
  });
});

describe("integridade semântica", () => {
  it("métrica indisponível aparece como indisponível, nunca como 0", () => {
    const html = renderView({ status: "success", data: model });
    const otd = /data-testid="advanced-metric-OTD"[\s\S]*?<\/tr>/.exec(html)![0];
    assert.match(otd, /Indicador indisponível — fonte operacional ainda não identificada/);
    assert.doesNotMatch(otd, />0<|>0%<|>0,0/);
    const ppv = /data-testid="advanced-metric-PPV"[\s\S]*?<\/tr>/.exec(html)![0];
    assert.match(ppv, /referência/);
    assert.match(html, /data-testid="advanced-metric-FILL_RATE" data-status="partial"/);
  });

  it("avaliação desligada: cards de nota mostram 'Indisponível' com motivo, sem número", () => {
    const off = buildSupplierPerformanceDashboard(buildFixtureInput({ evaluationFeatureEnabled: false }), filters);
    const html = renderView({ status: "success", data: off });
    assert.ok(html.includes('data-testid="performance-notice-evaluation"'));
    assert.ok(html.includes('data-testid="performance-evaluation-unavailable"'));
    const card = /data-testid="kpi-evaluation-score"[\s\S]*?<\/article>/.exec(html)![0];
    assert.match(card, /Indisponível/);
    assert.doesNotMatch(card, /\d,\d\d \/ 5/);
  });

  it("V1 e V2 separados: ranking principal só V2, bloco legado à parte", () => {
    const html = renderView({ status: "success", data: model });
    const best = /data-testid="performance-ranking-bestEvaluated"[\s\S]*?<\/section>/.exec(html)![0];
    assert.ok(best.includes(`ranking-row-${S1}`));
    assert.ok(best.includes(`ranking-row-${S3}`));
    assert.equal(best.includes(`ranking-row-${S2}`), false);
    assert.ok(html.includes('data-testid="ranking-tab-legacyEvaluated"'));
    assert.ok(html.includes("Avaliações legadas (V1)"));
  });

  it("tooltip dos KPIs declara fórmula, escopo e fonte", () => {
    const html = renderView({ status: "success", data: model });
    assert.match(html, /Concentração Top 5: Percentual do valor comprado no período concentrado nos cinco fornecedores com maior spend\./);
    assert.match(html, /Fórmula: SUM\(spend top 5\) ÷ total/);
    assert.match(html, /Fonte: NomusPurchaseOrder\.totalAmount/);
  });
});

describe("scorecard 360 e detalhe de MP", () => {
  it("scorecard renderiza identificação, compras, nota atual e MPs exclusivas", () => {
    const detail = buildSupplierPerformanceSupplierDetail(buildFixtureInput(), filters, S3)!;
    const html = renderToStaticMarkup(<SupplierScorecardContent detail={detail} onSelectMaterial={noop} />);
    assert.ok(html.includes('data-testid="supplier-scorecard-tabs"'));
    assert.ok(html.includes("Beta Químicos"));
    assert.ok(html.includes("22.222.222/0001-22"));
    assert.ok(html.includes(`#${S3}`));
    assert.ok(html.includes("2.150,00"));
    assert.ok(html.includes("2,50 / 5"));
    assert.ok(html.includes("1 MPs exclusivas observadas"));
  });

  it("fornecedor só-V1 no scorecard mostra escala 0–10 e nunca converte", () => {
    const detail = buildSupplierPerformanceSupplierDetail(buildFixtureInput(), filters, S2)!;
    const html = renderToStaticMarkup(<SupplierScorecardContent detail={detail} onSelectMaterial={noop} />);
    assert.ok(html.includes("8,00 / 10"));
    assert.equal(html.includes("4,00 / 5"), false);
  });

  it("detalhe de MP lista fornecedores com share, preço médio e último preço", () => {
    const detail = buildSupplierPerformanceMaterialDetail(buildFixtureInput(), filters, "nomus:2")!;
    const html = renderToStaticMarkup(<MaterialDetailContent detail={detail} onSelectSupplier={noop} />);
    assert.ok(html.includes('data-testid="material-detail-suppliers"'));
    assert.ok(html.includes("70,6%")); // 1200/1700
    assert.ok(html.includes("R$&nbsp;120,00/KG") || html.includes("120,00/KG"));
    assert.ok(html.includes('data-testid="material-detail-dispersion"'));
  });

  it("matriz renderiza linhas, totais, single-source e paginação", () => {
    const result = buildSupplierMaterialMatrix(buildFixtureInput(), filters, parseSupplierMaterialMatrixQuery({ pageSize: "3" }));
    const html = renderToStaticMarkup(
      <SupplierMaterialMatrixTable result={result} loading={false} error={null} sort="spend" direction="desc" onSort={noop} onPage={noop} onSelectSupplier={noop} onSelectMaterial={noop} />
    );
    assert.equal((html.match(/data-testid="matrix-row"/g) ?? []).length, 3);
    assert.ok(html.includes("Página 1 de 2"));
    assert.ok(html.includes("6 combinações"));
    assert.ok(html.includes("2 un. distintas"));
  });
});
