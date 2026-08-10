import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Recuperação do Dinheiro Investido — coluna "Imposto" (informativa).
 * Reutiliza o mesmo motor de imposto do Resultado Industrial (real via NF
 * vinculada / estimado via TaxRule / combinado) — nenhuma regra de imposto
 * nova nesta tela. Nunca entra no cálculo de investedCapital/
 * capitalRecovered/moneyOnStreet (decisão de negócio já fechada: capital =
 * custo de FABRICAR o pedido, não inclui imposto).
 */
describe("Recuperação do Dinheiro Investido — coluna Imposto (informativa)", () => {
  it("serviço repassa totalTaxes/taxSourceLabel do motor de Resultado Industrial — não inventa imposto novo", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /totalTaxes: orderRow\.totalTaxes/);
    assert.match(service, /taxSourceLabel: orderRow\.taxSourceLabel/);
    // Não cria nenhuma lógica própria de imposto (sem TaxRule/NF-e aqui).
    assert.doesNotMatch(service, /TaxRule/);
    assert.doesNotMatch(service, /NomusNfeFiscalSummary/);
  });

  it("totalTaxesAnalyzed é somado sobre a MESMA população (rows) que a tabela mostra", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /const totalTaxesAnalyzed = roundMoney\(sum\(rows, \(r\) => r\.totalTaxes \?\? 0\)\);/);
  });

  it("snapshot mantém imposto como passthrough puro — não usado em nenhuma fórmula de recuperação", () => {
    const snapshot = read("src/lib/finance/salesOrderInvestedCapitalRecoverySnapshot.ts");
    // O campo só aparece na assinatura de entrada/saída e no retorno — nunca dentro de computeCapitalRecovered/computeMoneyOnStreet/computeRecoveryPercent.
    const mathCallsBlock = snapshot.slice(
      snapshot.indexOf("const capitalRecovered = computeCapitalRecovered"),
      snapshot.indexOf("return {")
    );
    assert.doesNotMatch(mathCallsBlock, /totalTaxes/);
  });

  it("tela mostra a coluna Imposto marcada como informativa (não afeta capital investido/recuperado)", () => {
    const page = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx"
    );
    assert.match(page, />\s*Imposto\s*</);
    assert.match(page, /informativo/);
  });

  it("PDF reflete a mesma coluna Imposto e o mesmo total do KPI (kpis.totalTaxesAnalyzed)", () => {
    const doc = read(
      "src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPrintDocument.tsx"
    );
    assert.match(doc, />Imposto</); // header <th>Imposto</th> tem uma linha só, sem quebra
    assert.match(doc, /kpis\.totalTaxesAnalyzed/);
  });
});
