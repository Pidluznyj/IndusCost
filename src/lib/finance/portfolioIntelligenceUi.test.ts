import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("portfolio intelligence UI", () => {
  it("seção e cards não importam Prisma / server", () => {
    const files = [
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrdersGrid.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrderDrawer.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioOrderFulfillmentMap.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioOrderDataFreshnessPanel.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioOperationalDeviationAlertsPanel.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentStatusCards.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentItemsGrid.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentDocumentsGrid.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentReceivablesGrid.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceFiltersBar.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSellerKpis.tsx",
      "src/components/finance/portfolio-reconciliation/PortfolioO2cBusinessBoard.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'].*prisma/);
      assert.doesNotMatch(src, /portfolioMaturityAnalytics\.server/);
    }
  });

  it("cards consomem explanation da API e têm fallback", () => {
    const cards = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx"
    );
    const help = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover.tsx"
    );
    assert.match(cards, /MetricHelpTooltip|PortfolioIntelligenceHelpPopover/);
    assert.match(cards, /CARD_ORDER/);
    assert.match(cards, /formatFinanceCurrencyCompact|formatFinancePercent/);
    assert.match(cards, /onCardClick/);
    assert.match(help, /O que significa/);
    assert.match(help, /Como calculamos/);
    assert.match(help, /O que entra/);
    assert.match(help, /O que não entra/);
    assert.match(help, /Como interpretar/);
    assert.match(help, /operacional|OPERATIONAL_NOTICE|métrica operacional/);
    assert.match(help, /FALLBACK|Informação não disponível|texto de apoio/);
    assert.match(help, /export function MetricHelpTooltip/);
  });

  it("sanfonas e KPIs por vendedor sempre expõem ajuda", () => {
    const accordions = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx"
    );
    const sellers = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSellerKpis.tsx"
    );
    const filters = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceFiltersBar.tsx"
    );
    assert.match(accordions, /MetricHelpTooltip/);
    assert.match(sellers, /MetricHelpTooltip/);
    assert.match(sellers, /SELLER_KPI_EXPLANATIONS/);
    assert.match(filters, /MetricHelpTooltip|DATE_AXIS_HELP/);
    assert.match(
      read("src/lib/finance/portfolioIntelligenceFilters.ts"),
      /Pedidos por emissão são diferentes de CR por vencimento/
    );
  });

  it("seção chama endpoint intelligence e trata loading/erro", () => {
    const section = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
    );
    assert.match(section, /\/api\/finance\/portfolio-reconciliation\/intelligence/);
    assert.match(section, /buildPortfolioIntelligenceListQuery/);
    assert.match(section, /pageSize:\s*200/);
    assert.match(section, /FinanceModuleLoadingBlock/);
    assert.match(section, /FinanceModuleErrorBanner/);
    assert.match(section, /FinanceModuleEmptyState/);
    assert.match(section, /PortfolioIntelligenceAccordions/);
    assert.match(section, /PortfolioIntelligenceOrderDrawer/);
    assert.match(section, /PortfolioIntelligenceFiltersBar/);
    assert.match(section, /PortfolioO2cBusinessBoard/);
    assert.match(section, /o2cBusinessKpis|handleO2cFilterHint|applyPortfolioO2cFilterHint/);
    assert.match(section, /portfolio-intelligence-maturity-cards-secondary/);
    assert.match(section, /portfolioIntelligenceUiFiltersToQueryArgs/);
    assert.match(section, /handleCardClick|onCardClick/);
    assert.match(section, /portfolio-intelligence-pagination-notice|rowsTruncated/);
    assert.match(section, /status >= 500/);
    assert.doesNotMatch(section, /openReceivableValue\s*\+/);
  });

  it("board O2C tem 6 cards, funil, buckets e clique → filtro", () => {
    const board = read(
      "src/components/finance/portfolio-reconciliation/PortfolioO2cBusinessBoard.tsx"
    );
    assert.match(board, /portfolio-o2c-business-board/);
    assert.match(board, /VALOR_EM_PEDIDOS|ENTREGA_FUTURA|VIROU_CR|SO_PEDIDO/);
    assert.match(board, /evidenceFunnel|portfolio-o2c-evidence-funnel/);
    assert.match(board, /agingBuckets|portfolio-o2c-aging/);
    assert.match(board, /onFilterHint/);
    assert.match(board, /soPedidoComCondicao|SO_PEDIDO_COM_CONDICAO/);
    assert.match(board, /MetricHelpTooltip/);
    assert.doesNotMatch(board, /@prisma\/client/);
  });

  it("barra de filtros cobre eixo de data, atalhos, chips e limpar", () => {
    const bar = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceFiltersBar.tsx"
    );
    const filtersLib = read("src/lib/finance/portfolioIntelligenceFilters.ts");
    assert.match(bar, /FinanceBiFilterPanel/);
    assert.match(bar, /dateAxis|Eixo de data/);
    assert.match(bar, /PORTFOLIO_INTELLIGENCE_PERIOD_PRESETS/);
    assert.match(bar, /onlyWithoutNfe/);
    assert.match(bar, /Limpar|onClear/);
    assert.match(bar, /PORTFOLIO_INTELLIGENCE_DATE_AXIS_HELP/);
    assert.match(bar, /Pedidos por emissão|vencimento/);
    assert.match(bar, /financialStatus|Status financeiro/);
    assert.match(bar, /operationalStatus|Status operacional/);
    assert.match(bar, /operationalAlert|Alerta operacional/);
    assert.match(bar, /PORTFOLIO_INTELLIGENCE_TECHNICAL_ALERT_OPTIONS|Alerta técnico/);
    assert.match(bar, /buildPortfolioIntelligenceFilterChips|chips/);
    assert.match(bar, /customerNameByExternalId|Cliente:/);
    assert.match(filtersLib, /Status operacional:/);
    assert.match(filtersLib, /Alerta:/);
    assert.match(filtersLib, /Período:/);
    assert.match(filtersLib, /financialStatus/);
    assert.match(filtersLib, /operationalAlert/);
  });

  it("sanfonas e grid de drilldown estão ligados", () => {
    const accordions = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx"
    );
    const grid = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrdersGrid.tsx"
    );
    const section = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
    );
    assert.match(accordions, /INTELLIGENCE_ACCORDION_KEYS/);
    assert.match(accordions, /INTELLIGENCE_ACCORDION_GROUPS/);
    assert.match(accordions, /PortfolioIntelligenceOrdersGrid/);
    assert.match(accordions, /DIVERGENCIA_TECNICA/);
    assert.match(accordions, /QUANTIDADE_EXCEDENTE_DOCUMENTO|PRODUTO_FORA_DO_PEDIDO/);
    assert.match(accordions, /Nenhum pedido|portfolio-intelligence-grid-empty|rowsForIntelligenceAccordion/);
    assert.match(accordions, /único status|não trocam o status/);
    assert.match(accordions, /portfolio-intelligence-accordion-group-\$\{group\.id\}/);
    assert.match(accordions, /ICON_BY_KEY|GroupIcon/);
    assert.match(grid, /Nenhum pedido neste status/);
    assert.match(grid, /confidenceDisplay|Alta confiança|Confiança média|Confiança baixa|muito baixa/i);
    assert.match(grid, /onOpenOrder/);
    assert.match(grid, /Status financeiro/);
    assert.match(grid, /Status operacional/);
    assert.match(grid, /% atendimento/);
    assert.match(grid, /Excedente/);
    assert.match(grid, /Ação recomendada|recommendedAction/);
    assert.match(grid, /tagsAlerta|Alertas/);
    assert.match(grid, /border-l-\[4px\]|rowBorderClass/);
    assert.match(grid, /portfolio-intelligence-tags-legend/);
    assert.match(grid, /CR aberto|Recebido|Data prevista recebimento|Última evidência/);
    assert.match(section, /onOpenOrder|handleOpenOrder|PortfolioIntelligenceOrderDrawer/);
  });

  it("drawer de detalhe tem mapa de atendimento e estados vazios sem inventar dados", () => {
    const drawer = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrderDrawer.tsx"
    );
    const map = read(
      "src/components/finance/portfolio-reconciliation/PortfolioOrderFulfillmentMap.tsx"
    );
    const statusCards = read(
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentStatusCards.tsx"
    );
    const items = read(
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentItemsGrid.tsx"
    );
    const docs = read(
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentDocumentsGrid.tsx"
    );
    const crs = read(
      "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentReceivablesGrid.tsx"
    );
    const freshness = read(
      "src/components/finance/portfolio-reconciliation/PortfolioOrderDataFreshnessPanel.tsx"
    );
    const alertsPanel = read(
      "src/components/finance/portfolio-reconciliation/PortfolioOperationalDeviationAlertsPanel.tsx"
    );
    const ui = [
      drawer,
      map,
      statusCards,
      items,
      docs,
      crs,
      freshness,
      alertsPanel,
    ].join("\n");

    assert.match(
      drawer,
      /\/api\/finance\/portfolio-reconciliation\/intelligence\/orders\//
    );
    assert.match(drawer, /Mapa de Atendimento/);
    assert.match(drawer, /itens do pedido ↔ NF|portfolio-intelligence-drawer-mapa-hint/);
    assert.match(drawer, /useState<TabId>\("mapa"\)|setTab\("mapa"\)/);
    assert.ok(
      drawer.indexOf("Mapa de Atendimento") < drawer.indexOf('label: "Resumo"') ||
        drawer.indexOf('{ id: "mapa"') < drawer.indexOf('{ id: "resumo"')
    );
    assert.match(drawer, /PortfolioOrderFulfillmentMap/);
    assert.match(drawer, /PortfolioFulfillmentStatusCards/);
    assert.match(drawer, /PortfolioOperationalDeviationAlertsPanel/);
    assert.match(drawer, /w-\[75vw\]|min-w-\[720px\]|max-w-\[1200px\]/);

    assert.match(ui, /Status financeiro|financialStatus/);
    assert.match(ui, /Status operacional|operationalStatus/);
    assert.match(ui, /Valor atribuído ao pedido|attributedOrderValue/);
    assert.match(ui, /Valor cabeçalho|nfeHeaderTotal|Cabeçalho NF/);
    assert.match(ui, /Excedente|totalExcessQuantity|excessQuantity/);
    assert.match(ui, /Produto fora|itemsOutsideOrder|PRODUTO_FORA_DO_PEDIDO/);
    assert.match(crs, /portfolio-fulfillment-receivables-grid|Contas a Receber/);
    assert.match(map, /executiveConclusion|Conclusão executiva|drawer-executive/);
    assert.match(
      map,
      /Mapa de atendimento indisponível com os dados atuais/
    );
    assert.match(map, /PortfolioOperationalDeviationAlertsPanel/);
    assert.match(map, /PortfolioOrderDataFreshnessPanel/);
    assert.match(map, /Alertas operacionais|PortfolioOperationalDeviationAlertsPanel/);
    assert.match(map, /Frescor dos dados|PortfolioOrderDataFreshnessPanel/);
    // Ordem na aba: Resumo → Alertas → Frescor → Itens → Docs → CR → Conclusão
    const resumoIdx = map.indexOf("Resumo do atendimento");
    const alertasIdx = map.lastIndexOf("<PortfolioOperationalDeviationAlertsPanel");
    const frescorIdx = map.lastIndexOf("<PortfolioOrderDataFreshnessPanel");
    const itensIdx = map.indexOf("Itens do pedido");
    const docsIdx = map.indexOf("Documentos de saída");
    const crIdx = map.indexOf("Contas a Receber");
    const conclIdx = map.indexOf("Conclusão executiva");
    assert.ok(resumoIdx > 0 && alertasIdx > resumoIdx);
    assert.ok(frescorIdx > alertasIdx);
    assert.ok(itensIdx > frescorIdx);
    assert.ok(docsIdx > itensIdx);
    assert.ok(crIdx > docsIdx);
    assert.ok(conclIdx > crIdx);
    assert.match(freshness, /Frescor dos dados/);
    assert.match(
      freshness,
      /Se o cliente pagou hoje ou ontem, o valor só aparecerá aqui após sincronizar o Contas a Receber e reconstruir a conciliação/
    );
    assert.match(
      freshness,
      /Nenhuma baixa encontrada até a última sincronização/
    );
    assert.match(alertsPanel, /Alertas operacionais/);
    assert.match(
      alertsPanel,
      /Nenhum alerta operacional encontrado com os dados atuais/
    );
    assert.match(alertsPanel, /#EFF8FF|#FFFAEB|#FEF3F2/);
    assert.match(alertsPanel, /INFO|WARNING|CRITICAL|data-severity/);
    assert.match(items, /Atendido com excedente/);
    assert.match(items, /Pendente/);
    assert.match(items, /Parcial/);
    assert.match(items, /Math\.min\(100/);
    assert.match(
      docs,
      /Nenhum documento de saída encontrado para este pedido/
    );
    assert.match(
      crs,
      /Nenhum Contas a Receber encontrado para este pedido/
    );
    assert.doesNotMatch(ui, /JSON\.stringify\(/);
    assert.doesNotMatch(ui, /<pre[^>]*>[\s\S]*fulfillmentMap/);
    assert.doesNotMatch(ui, /<pre[^>]*>[\s\S]*operationalDeviation/);

    assert.match(drawer, /label: "Resumo"/);
    assert.match(drawer, /label: "Pedido"/);
    assert.match(drawer, /label: "Itens"/);
    assert.match(drawer, /label: "NF \/ saída"/);
    assert.match(drawer, /label: "Contas a Receber"/);
    assert.match(drawer, /label: "Pagamento"/);
    assert.match(drawer, /label: "Histórico"/);
    assert.match(
      drawer,
      /Condição de pagamento não disponível na importação atual|Informação não disponível na importação atual/
    );
    assert.match(freshness, /portfolio-intelligence-drawer-freshness/);
    assert.match(
      freshness,
      /sincronizar o Contas a Receber e reconstruir a conciliação|DRAWER_FRESHNESS_SYNC_MESSAGE|syncRebuildNotice/
    );
    assert.match(drawer, /formatFinanceCurrency/);
    assert.match(drawer, /formatFinanceDate/);
    assert.match(drawer, /buildFinanceTabLoadError/);
    assert.match(drawer, /status >= 500|Tente novamente em instantes/);
    assert.doesNotMatch(drawer, /stack|e\.stack|JSON\.stringify\(e/);
    assert.doesNotMatch(drawer, /JSON\.stringify\(detail|JSON\.stringify\(map/);
    assert.doesNotMatch(drawer, /@prisma\/client/);
  });

  it("KPIs por vendedor usam sellerKpis e não importam comissões", () => {
    const section = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
    );
    const table = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSellerKpis.tsx"
    );
    assert.match(section, /PortfolioIntelligenceSellerKpis/);
    assert.ok(
      section.lastIndexOf("<PortfolioO2cBusinessBoard") <
        section.lastIndexOf("<PortfolioIntelligenceSellerKpis")
    );
    assert.ok(
      section.lastIndexOf("<PortfolioIntelligenceAccordions") <
        section.lastIndexOf("<PortfolioIntelligenceSellerKpis")
    );
    assert.match(section, /handleSelectSeller|onSelectSeller/);
    assert.match(table, /Qualidade da Carteira por Vendedor/);
    assert.match(table, /SELLER_KPI_EXPLANATIONS/);
    assert.match(table, /openReceivableValue|CR aberto/);
    assert.match(table, /futureProbableValue|Futuro/);
    assert.match(table, /presentAttentionValue|Presente/);
    assert.match(table, /overdueWithoutDocumentCount|Venc\. s\/ doc/);
    assert.match(table, /partiallyAttendedCount|Parciais/);
    assert.match(table, /ordersWithExcessCount|Excedente/);
    assert.match(table, /mainBottleneck|Gargalo/);
    assert.match(table, /MetricHelpTooltip/);
    assert.match(table, /Maior valor em risco|Maior valor de carteira/);
    assert.doesNotMatch(table, /from ["']@\/src\/lib\/commissions/);
    assert.doesNotMatch(section, /from ["']@\/src\/lib\/commissions/);
    assert.doesNotMatch(table, /commissionReceipt|commissionMaterialization|comissionável/i);
    assert.doesNotMatch(table, /vendedor comission/i);
  });

  it("página registra aba Inteligência da Carteira", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(page, /portfolio-tab-intelligence/);
    assert.match(page, /PortfolioIntelligenceSection/);
    assert.match(page, /activeView/);
  });

  it("contrato Britânia: cards, sanfonas, drawer PD 02159 e tooltip", () => {
    const cards = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx"
    );
    const copy = read("src/lib/finance/portfolioIntelligenceUiCopy.ts");
    const accordions = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx"
    );
    const drawer = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceOrderDrawer.tsx"
    );
    const help = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceHelpPopover.tsx"
    );
    const analytics = read("src/lib/finance/portfolioMaturityAnalytics.ts");

    assert.match(analytics, /1dc2ead7-533d-4ad4-bc4c-621061fa5623/);
    assert.match(analytics, /valorFuturoPresentePlausivel:\s*495_460/);
    assert.match(analytics, /valorVencidoBloqueado:\s*884_836/);
    assert.match(analytics, /PD 02607/);
    assert.match(analytics, /PD 02159/);
    assert.match(analytics, /320_070/);

    assert.match(cards, /summaryCards|card\.value|card\.count/);
    assert.match(cards, /MetricHelpTooltip/);
    assert.match(
      cards + copy,
      /Financeiro confirmado|INTELLIGENCE_BLOCK_FINANCIAL_TITLE/
    );
    assert.match(
      cards + copy,
      /Carteira operacional|INTELLIGENCE_BLOCK_OPERATIONAL_TITLE/
    );
    assert.match(
      cards + copy,
      /Atendimento e alertas|INTELLIGENCE_BLOCK_ALERTS_TITLE/
    );
    assert.match(cards, /não soma carteira|alerts-notice|Alertas técnicos|INTELLIGENCE_ALERTS/);
    assert.match(accordions, /accordion-group-financial|INTELLIGENCE_ACCORDION_GROUPS/);
    assert.match(accordions, /CARTEIRA_VENCIDA_BLOQUEADA/);
    assert.match(accordions, /CARTEIRA_FUTURA_PROVAVEL|CARTEIRA_PRESENTE_ATENCAO/);
    assert.match(accordions, /SEM_EVIDENCIA/);
    assert.match(accordions, /DIVERGENCIA_TECNICA|NF_CABECALHO_MAIOR_PEDIDO/);
    assert.match(accordions, /ordersCount|orderCodes|rowsForIntelligenceAccordion/);
    assert.match(drawer, /Mapa de Atendimento|PortfolioOrderFulfillmentMap/);
    assert.match(
      read(
        "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentDocumentsGrid.tsx"
      ),
      /Nenhum documento de saída encontrado para este pedido/
    );
    assert.match(
      read(
        "src/components/finance/portfolio-reconciliation/PortfolioFulfillmentReceivablesGrid.tsx"
      ),
      /Nenhum Contas a Receber encontrado para este pedido/
    );
    assert.match(help, /O que significa/);
    assert.match(help, /Como calculamos/);
  });

  it("cabeçalho executivo, três blocos e avisos de carteira vs alerta", () => {
    const section = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceSection.tsx"
    );
    const cards = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceCards.tsx"
    );
    const accordions = read(
      "src/components/finance/portfolio-reconciliation/PortfolioIntelligenceAccordions.tsx"
    );
    const copy = read("src/lib/finance/portfolioIntelligenceUiCopy.ts");
    assert.match(section, /portfolio-intelligence-freshness-banner|dataFreshness/);
    assert.match(section, /INTELLIGENCE_READING_GUIDE|portfolio-intelligence-header/);
    assert.match(section, /portfolio-intelligence-pd-warning/);
    assert.match(section, /Central de Auditoria da Carteira|INTELLIGENCE_SCREEN_TITLE/);
    assert.match(copy, /Central de Auditoria da Carteira/);
    assert.match(copy, /Pedido de venda não é caixa confirmado/);
    assert.match(copy, /CR confirma financeiro/);
    assert.match(copy, /Baixa confirma caixa/);
    assert.match(copy, /OrderToCashAudit/);
    assert.match(copy, /Entenda o caminho de cada pedido/);
    assert.match(
      copy,
      /Alertas técnicos podem coexistir|não somam carteira|Não soma carteira|INTELLIGENCE_ALERTS_SHORT/
    );
    assert.match(copy, /Financeiro confirmado|INTELLIGENCE_BLOCK_FINANCIAL/);
    assert.match(copy, /Carteira operacional|INTELLIGENCE_BLOCK_OPERATIONAL/);
    assert.match(copy, /Atendimento e alertas técnicos|INTELLIGENCE_BLOCK_ALERTS/);
    assert.match(copy, /Não tratar como caixa confiável/);
    assert.match(cards, /portfolio-intelligence-cards-financial/);
    assert.match(cards, /portfolio-intelligence-cards-operational/);
    assert.match(cards, /portfolio-intelligence-cards-alerts/);
    assert.match(cards, /INTELLIGENCE_BLOCK_FINANCIAL_TITLE|Financeiro confirmado/);
    assert.match(cards, /INTELLIGENCE_BLOCK_OPERATIONAL_TITLE|Carteira operacional/);
    assert.match(cards, /INTELLIGENCE_BLOCK_ALERTS_TITLE|Atendimento e alertas/);
    assert.match(cards, /Alertas técnicos não somam carteira|INTELLIGENCE_ALERTS_SHORT|INTELLIGENCE_ALERTS_NOTICE/);
    assert.match(cards, /data-alert-card|não soma carteira/);
    assert.match(cards, /MetricHelpTooltip/);
    assert.match(cards, /minmax\(220px/);
    assert.match(cards, /min-h-\[112px\]|min-h-\[112px\]/);
    assert.ok(
      cards.indexOf("portfolio-intelligence-cards-financial") <
        cards.indexOf("portfolio-intelligence-cards-operational")
    );
    assert.ok(
      cards.indexOf("portfolio-intelligence-cards-operational") <
        cards.indexOf("portfolio-intelligence-cards-alerts")
    );
    assert.match(accordions, /INTELLIGENCE_ACCORDION_GROUPS/);
    assert.match(accordions, /portfolio-intelligence-accordion-group-\$\{group\.id\}/);
    const drilldown = read("src/lib/finance/portfolioIntelligenceDrilldown.ts");
    assert.match(drilldown, /id:\s*"financial"/);
    assert.match(drilldown, /id:\s*"operational"/);
    assert.match(drilldown, /id:\s*"alerts"/);
  });
});
