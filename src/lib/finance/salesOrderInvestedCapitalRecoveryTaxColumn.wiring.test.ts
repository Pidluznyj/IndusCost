import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Recuperação do Dinheiro Investido — coluna "Imposto" e `investedCapital`.
 * Decisão do usuário: o imposto usado no cálculo da margem comercial do
 * Pedido de Venda (mesmo motor da listagem de Pedidos de Venda — sempre
 * presente, cai no percentual fiscal padrão quando o produto não tem
 * TaxRule própria) também foi desembolsado antecipadamente, como o custo —
 * por isso agora SOMA em `investedCapital`, substituindo o `totalTaxes` do
 * Resultado Industrial (que pode ficar incompleto).
 */
describe("Recuperação do Dinheiro Investido — imposto incluído no Capital Investido", () => {
  it("serviço soma o imposto da margem comercial ao custo industrial em investedCapital", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /calculateOfficialSalesOrderMarginsForOrders/);
    assert.match(service, /marginByOrderId\.get\(orderRow\.salesOrderId\)\?\.marginSummary\.taxAmount/);
    assert.match(
      service,
      /roundMoney\(orderRow\.totalIndustrialCost \+ marginTaxAmount\)/
    );
    // Não mais o totalTaxes bruto do Resultado Industrial (pode ficar incompleto).
    assert.doesNotMatch(service, /totalTaxes: orderRow\.totalTaxes/);
    assert.doesNotMatch(service, /taxSourceLabel: orderRow\.taxSourceLabel/);
    // Não inventa nenhuma fórmula própria de imposto — reusa o motor oficial.
    assert.doesNotMatch(service, /computeSalesTaxAmount/);
  });

  it("totalTaxesAnalyzed é somado sobre withCapital — mesma população de investedCapitalAnalyzedTotal, para reconciliar exatamente", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(
      service,
      /const totalTaxesAnalyzed = roundMoney\(sum\(withCapital, \(r\) => r\.totalTaxes \?\? 0\)\);/
    );
  });

  it("investedCapital só soma o imposto quando o custo industrial está OK — nunca disfarça custo ausente", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /const costOk = orderRow\.costSourceStatus === "OK";/);
    const block = service.slice(
      service.indexOf("const investedCapitalValue = costOk"),
      service.indexOf("const industrialCostValue =")
    );
    assert.match(block, /: null;/);
  });

  it("snapshot puro (por Pedido) continua sem recalcular imposto — recebe investedCapital já pronto do serviço", () => {
    const snapshot = read("src/lib/finance/salesOrderInvestedCapitalRecoverySnapshot.ts");
    // O campo totalTaxes é só ecoado para exibição — a soma acontece no serviço, não aqui.
    const mathCallsBlock = snapshot.slice(
      snapshot.indexOf("const capitalRecovered = computeCapitalRecovered"),
      snapshot.indexOf("return {")
    );
    assert.doesNotMatch(mathCallsBlock, /totalTaxes/);
  });

  it("tela mostra Capital Investido e Imposto sem rótulo de 'informativo' — imposto agora compõe o capital", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, />\s*Imposto\s*</);
    assert.doesNotMatch(page, /informativo/);
    assert.match(page, /custo \+ imposto|incluído no capital/);
  });

  it("PDF reflete a mesma coluna Imposto e o mesmo total do KPI (kpis.totalTaxesAnalyzed), sem 'informativo'", () => {
    const doc = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx"
    );
    assert.match(doc, />Imposto</); // header <th>Imposto</th> tem uma linha só, sem quebra
    assert.match(doc, /kpis\.totalTaxesAnalyzed/);
    assert.doesNotMatch(doc, /informativo/);
  });
});
