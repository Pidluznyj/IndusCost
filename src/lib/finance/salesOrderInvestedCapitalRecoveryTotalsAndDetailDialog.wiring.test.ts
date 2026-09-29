import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Recuperação do Dinheiro Investido — cards totalizadores executivos
 * (Vendemos / Investimos / Falta Receber) e clique no Pedido abrindo os
 * recebíveis (mesmo modal de Pedidos de Venda / Comissões > Provisão por
 * pedido).
 */
describe("Recuperação do Dinheiro Investido — totais executivos + detalhe do Pedido", () => {
  it("serviço soma venda/custo/imposto — venda sobre toda a população, custo e imposto sobre withCapital (mesma base de investedCapitalAnalyzedTotal)", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(
      service,
      /const totalSaleValueAnalyzed = roundMoney\(sum\(rows, \(r\) => r\.saleValue\)\);/
    );
    assert.match(
      service,
      /const totalIndustrialCostAnalyzed = roundMoney\(sum\(withCapital, \(r\) => r\.industrialCost \?\? 0\)\);/
    );
    assert.match(
      service,
      /const totalTaxesAnalyzed = roundMoney\(sum\(withCapital, \(r\) => r\.totalTaxes \?\? 0\)\);/
    );
    assert.match(service, /totalSaleValueAnalyzed,\s*\n\s*totalIndustrialCostAnalyzed,\s*\n\s*totalTaxesAnalyzed,/);
  });

  it("custo e imposto exibidos saem de resolveInvestedCapitalComponents (imposto em centavos ANTES da subtração) — reconciliam exatamente com o capital", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(
      service,
      /const investedCapitalComponents = resolveInvestedCapitalComponents\(\s*investedCapitalValue,\s*marginTaxAmount\s*\);/
    );
    assert.match(service, /const industrialCostValue = investedCapitalComponents\.industrialCost;/);
    assert.match(service, /totalTaxes: investedCapitalComponents\.totalTaxes,/);
    // Nunca mais a subtração do imposto bruto (6 casas) nem o imposto bruto ecoado à parte.
    assert.doesNotMatch(service, /roundMoney\(investedCapitalValue - marginTaxAmount\)/);
    assert.doesNotMatch(service, /totalTaxes: marginTaxAmount,/);
  });

  it("KPIs comparáveis nascem do módulo puro de totais, sobre a mesma população dos KPIs de capital", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /const withCapital = rows\.filter\(\(r\) => isValidInvestedCapital\(r\.investedCapital\)\);/);
    assert.match(service, /const comparableTotals = buildInvestedCapitalRecoveryComparableTotals\(rows\);/);
    assert.match(service, /totalTaxesAnalyzed,\s*\n\s*\.\.\.comparableTotals,/);
    // Nenhuma conta econômica nova no serviço: só soma o que o snapshot decidiu.
    assert.doesNotMatch(service, /saleValue\s*-\s*|-\s*r\.investedCapital|outstandingReceivable\s*-/);
  });

  it("tela mostra os blocos 1–4 e os cards executivos vêm do DTO (Vendemos/Capital investido/Custo industrial/Imposto)", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    const economic = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryEconomicSection.tsx"
    );
    assert.match(page, /InvestedCapitalRecoveryEconomicSection kpis=\{data\.kpis\}/);
    assert.match(page, /InvestedCapitalRecoveryRealizedSection kpis=\{data\.kpis\}/);
    assert.match(page, /InvestedCapitalRecoveryReceivablesSection kpis=\{data\.kpis\}/);
    assert.match(page, /InvestedCapitalRecoveryExecutiveSection kpis=\{data\.kpis\}/);
    assert.match(economic, /kpis\.totalSaleValueAnalyzed/);
    assert.match(economic, /kpis\.investedCapitalAnalyzedTotal/);
    assert.match(economic, /kpis\.totalIndustrialCostAnalyzed/);
    assert.match(economic, /kpis\.totalTaxesAnalyzed/);
    assert.match(economic, /kpis\.economicMarginTotal/);
    assert.match(economic, /label="Vendemos"/);
    assert.match(economic, /label="Capital investido"/);
    assert.match(economic, /label="Margem econômica dos PVs"/);
    // Nomenclatura: nunca "Lucro" nesta tela.
    for (const file of [
      page,
      economic,
      read("src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRealizedSection.tsx"),
      read("src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryReceivablesSection.tsx"),
      read("src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryExecutiveSection.tsx"),
      read("src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx"),
      read("src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPanel.tsx"),
    ]) {
      assert.doesNotMatch(file, /\bLucro\b/i);
    }
  });

  it("nenhuma conta econômica na UI: seções, página e PDF só leem campos do DTO", () => {
    const files = [
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryEconomicSection.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRealizedSection.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryReceivablesSection.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryExecutiveSection.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryFormulaStrip.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRecoveryBar.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPrintDocument.tsx",
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryCustomerPanel.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      // Nada de kpis.x - kpis.y, row.a - row.b, summary.a + summary.b, reduce de valores.
      assert.doesNotMatch(src, /(kpis|row|summary|customer)\.\w+\s*[-+*/]\s*(kpis|row|summary|customer)\.\w+/, file);
      assert.doesNotMatch(src, /\.reduce\(\s*\(acc, r\)/, file);
      assert.doesNotMatch(src, /Math\.(min|max)\([^)]*(kpis|row|summary)\./, file);
    }
  });

  it("PDF reflete os mesmos blocos e totais do DTO (inclusive o rodapé da tabela)", () => {
    const doc = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx"
    );
    assert.match(doc, /kpis\.totalSaleValueAnalyzed/);
    assert.match(doc, /kpis\.totalIndustrialCostAnalyzed/);
    assert.match(doc, /kpis\.economicMarginTotal/);
    assert.match(doc, /kpis\.realizedGainTotal/);
    assert.match(doc, /kpis\.actualReceivedComparableTotal/);
    assert.match(doc, /kpis\.actualReceivedTotal/);
    assert.match(doc, /kpis\.capitalReceivableCoveredTotal/);
    assert.match(doc, /kpis\.gainReceivableTotal/);
    assert.match(doc, /kpis\.capitalWithoutOpenReceivableTotal/);
    assert.match(doc, /kpis\.outstandingReceivableUnclassifiedTotal/);
    assert.match(doc, /1\. Economia dos pedidos/);
    assert.match(doc, /2\. O que já aconteceu/);
    assert.match(doc, /3\. O que ainda tem para entrar/);
    assert.match(doc, /4\. Leitura gerencial/);
    // O total de recebido do rodapé vem do backend, não de um reduce no cliente.
    assert.doesNotMatch(doc, /totalActualReceived/);
  });

  it("clicar em QUALQUER PONTO da linha (drill-down) abre o mesmo SalesOrderDetailDialog usado em Pedidos de Venda/Comissões (recebíveis e status) — teclado também funciona", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/sales\/SalesOrderDetailDialog"\)/);
    // onClick está no <tr>, não num botão isolado na célula do PV — a linha inteira é o alvo.
    const rowBlock = page.slice(
      page.indexOf("{pageRows.map((row) => ("),
      page.indexOf("</tr>\n                  ))}")
    );
    assert.match(rowBlock, /onClick=\{\(\) => openOrderDetail\(row\.salesOrderId, row\.orderCode\)\}/);
    assert.match(rowBlock, /onKeyDown=\{/);
    assert.match(rowBlock, /event\.key === "Enter" \|\| event\.key === " "/);
    assert.match(rowBlock, /cursor-pointer/);
    assert.match(page, /<SalesOrderDetailDialog\s*\n\s*open\s*\n\s*salesOrderId=\{detailOrderId\}/);
    assert.match(page, /onClose=\{closeOrderDetail\}/);
  });

  it("o link 'Abrir PV' (nova aba, redundante com o drill-down da linha) foi removido", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.doesNotMatch(page, /Abrir PV/);
    assert.doesNotMatch(page, /\/sales-orders\/\$\{row\.salesOrderId\}/);
  });

  it("a coluna 'Situação' (status bruto do Nomus) foi removida — redundante com o badge Status Econômico", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.doesNotMatch(page, />Situação</);
    assert.doesNotMatch(page, /\{row\.orderStatusLabel\}/);
    // Status Econômico (badge computado) continua.
    assert.match(page, /title="Status Econômico"/);
    assert.match(page, /<StatusBadge status=\{row\.status\} \/>/);
  });
});
