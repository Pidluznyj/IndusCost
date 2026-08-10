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

  it("industrialCost é derivado por SUBTRAÇÃO do capital já arredondado (nunca dois arredondamentos independentes) — reconcilia exatamente com totalTaxes", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(
      service,
      /const industrialCostValue =\s*\n\s*investedCapitalValue == null \? null : roundMoney\(investedCapitalValue - marginTaxAmount\);/
    );
  });

  it("tela mostra os 3 cards executivos (Vendemos/Investimos/Custo) além do Imposto e Falta Receber já existentes", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, /kpis\.totalSaleValueAnalyzed/);
    assert.match(page, /kpis\.totalIndustrialCostAnalyzed/);
    assert.match(page, /Vendemos \(Total Vendido\)/);
    assert.match(page, /Investimos \(Capital = Custo \+ Imposto\)/);
    assert.match(page, /Custo Industrial Total/);
  });

  it("PDF reflete os mesmos 3 cards executivos", () => {
    const doc = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx"
    );
    assert.match(doc, /kpis\.totalSaleValueAnalyzed/);
    assert.match(doc, /kpis\.totalIndustrialCostAnalyzed/);
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
    assert.match(page, />Status Econômico</);
    assert.match(page, /<StatusBadge status=\{row\.status\} \/>/);
  });
});
