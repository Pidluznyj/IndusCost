import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const PANEL = "src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelPanel.tsx";
const DRAWER = "src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelDrawer.tsx";
const CLIENT = "src/lib/sales/salesOrderToCashFunnelClient.ts";
const COPY = "src/lib/sales/salesOrderToCashFunnelUiCopy.ts";
const DASH = "src/components/DashboardModule.tsx";

describe("salesOrderToCashFunnelUi", () => {
  it("1. aba mostra título Funil Pedido → Caixa", () => {
    const panel = read(PANEL);
    const copy = read(COPY);
    assert.match(copy, /Funil Pedido → Caixa/);
    assert.match(panel, /ORDER_TO_CASH_FUNNEL_TITLE|otc-title/);
    assert.match(read(DASH), /OrderToCashFunnelPanel/);
    assert.match(read(DASH), /Funil de Vendas/);
  });

  it("2. aviso sobre proposta como histórico aparece", () => {
    const panel = read(PANEL);
    const copy = read(COPY);
    assert.match(copy, /Propostas aparecem apenas como histórico/);
    assert.match(panel, /otc-proposal-notice|ORDER_TO_CASH_FUNNEL_PROPOSAL_NOTICE/);
  });

  it("3. blocos Comercial/Pedido, Execução e Financeiro aparecem", () => {
    const panel = read(PANEL);
    assert.match(panel, /Comercial \/ Pedido/);
    assert.match(panel, /Execução/);
    assert.match(panel, /Financeiro/);
    assert.match(panel, /otc-executive-blocks/);
  });

  it("4. funil horizontal aparece", () => {
    const panel = read(PANEL);
    assert.match(panel, /otc-visual-funnel/);
    assert.match(panel, /ORDER_TO_CASH_VISUAL_FUNNEL|overflow-x-auto/);
    assert.match(panel, /otc-risk-lane|Raia de risco/);
  });

  it("5. grid mostra estágio e temperatura", () => {
    const panel = read(PANEL);
    assert.match(panel, /otc-orders-grid/);
    assert.match(panel, /funnelStageLabel/);
    assert.match(panel, /temperature|Temperatura/);
  });

  it("6. cards têm help", () => {
    const panel = read(PANEL);
    assert.match(panel, /MetricHelpTooltip/);
    assert.match(panel, /ORDER_TO_CASH_CARD_HELP/);
    const copy = read(COPY);
    assert.match(copy, /whatItMeans/);
    assert.match(copy, /howWeCalculate/);
    assert.match(copy, /whatIsIncluded/);
    assert.match(copy, /whatIsExcluded/);
    assert.match(copy, /howToInterpret/);
  });

  it("7. loading/erro/empty state existem", () => {
    const panel = read(PANEL);
    assert.match(panel, /otc-loading|ORDER_TO_CASH_FUNNEL_LOADING/);
    assert.match(panel, /otc-error|ORDER_TO_CASH_FUNNEL_ERROR_FALLBACK/);
    assert.match(panel, /otc-empty|ORDER_TO_CASH_FUNNEL_EMPTY/);
  });

  it("8. não há import de Prisma no frontend", () => {
    for (const f of [PANEL, DRAWER, CLIENT, COPY]) {
      const src = read(f);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'].*prisma/);
      assert.doesNotMatch(src, /salesOrderToCashFunnelApi\.server/);
    }
  });

  it("9. não há import de comissão", () => {
    for (const f of [PANEL, DRAWER, CLIENT, COPY]) {
      const src = read(f);
      assert.doesNotMatch(src, /from\s+["'][^"']*comiss/i);
      assert.doesNotMatch(src, /from\s+["'][^"']*commission/i);
      assert.doesNotMatch(src, /CommissionOrderSnapshot|estimatedCommission/);
    }
  });

  it("client consome endpoint read-only", () => {
    const client = read(CLIENT);
    assert.match(client, /\/api\/sales\/order-to-cash-funnel/);
    assert.match(client, /fetchJsonOk/);
    assert.doesNotMatch(client, /from\s+["'][^"']*proposal/i);
  });

  it("drawer abre com largura e scroll internos", () => {
    const drawer = read(DRAWER);
    const panel = read(PANEL);
    assert.match(panel, /OrderToCashFunnelDrawer/);
    assert.match(drawer, /data-testid=\"otc-drawer\"/);
    assert.match(drawer, /75vw|min-w-\[720px\]|max-w-\[1200px\]/);
    assert.match(drawer, /overflow-y-auto/);
  });

  it("drawer mostra estágio, temperatura e ação recomendada", () => {
    const drawer = read(DRAWER);
    assert.match(drawer, /otc-drawer-stage|funnelStageLabel/);
    assert.match(drawer, /otc-drawer-temperature|temperature/);
    assert.match(drawer, /otc-drawer-action|actionRecommendation/);
  });

  it("drawer mostra abas oficiais", () => {
    const drawer = read(DRAWER);
    assert.match(drawer, /otc-drawer-tabs/);
    assert.match(drawer, /Resumo do funil/);
    assert.match(drawer, /Mapa de atendimento/);
    assert.match(drawer, /Pedido e itens/);
    assert.match(drawer, /Documento de saída \/ NF/);
    assert.match(drawer, /Contas a Receber/);
    assert.match(drawer, /Timeline/);
    assert.match(drawer, /Dados indisponíveis \/ observações/);
  });

  it("drawer mostra OP indisponível e mapa quando disponível", () => {
    const drawer = read(DRAWER);
    assert.match(drawer, /Ordem de produção não disponível na integração atual/);
    assert.match(drawer, /otc-drawer-fulfillment-map|FulfillmentMapView/);
    assert.match(drawer, /Mapa de atendimento indisponível/);
  });

  it("drawer não exibe JSON cru", () => {
    const drawer = read(DRAWER);
    assert.doesNotMatch(drawer, /JSON\.stringify/);
    assert.doesNotMatch(drawer, /<pre[\s>]/);
    assert.doesNotMatch(drawer, /nomusRawResponse|rawPayload/);
    assert.match(drawer, /Nenhum documento encontrado/);
    assert.match(drawer, /Nenhuma NF encontrada/);
    assert.match(drawer, /Nenhum CR encontrado/);
  });
});
