import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Regressão — Recuperação do Dinheiro Investido deve excluir empresas do
 * grupo econômico (Lazarios/Koppetel/SM) da população ANTES de qualquer
 * cálculo, reutilizando a autoridade canônica já existente em
 * `financeInternalGroupExclusions.ts` (mesma regra de AR/AP/DRE) — nunca uma
 * lista paralela por nome/CNPJ dentro deste serviço.
 */
describe("Recuperação do Dinheiro Investido — exclusão intercompany", () => {
  it("serviço pede exclusão de grupo econômico ao motor de população (population, não drill-down)", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /excludeEconomicGroupCustomers:\s*true/);
    assert.doesNotMatch(service, /const\s+GROUP_COMPANIES\s*=/);
    assert.doesNotMatch(service, /EXCLUDED_CNPJS/);
    assert.doesNotMatch(service, /EXCLUDED_CUSTOMERS/);
    assert.doesNotMatch(service, /["']Lazarios["']/i);
    assert.doesNotMatch(service, /["']Koppetel["']/i);
  });

  it("motor de população (Resultado Industrial) aceita e repassa a opção ao where canônico", () => {
    const engine = read("src/lib/sales/salesOrderIndustrialResultReportService.server.ts");
    assert.match(engine, /excludeEconomicGroupCustomers\?:\s*boolean/);
    assert.match(
      engine,
      /resolveSalesOrderListWhere\(prisma, parsed, sellerWhere, \{\s*excludeEconomicGroupCustomers: input\.excludeEconomicGroupCustomers === true,?\s*\}\)/
    );
  });

  it("where canônico reutiliza buildEconomicGroupCustomerPrismaExclusion (autoridade única)", () => {
    const listWhere = read("src/lib/salesOrdersListSummary.ts");
    assert.match(listWhere, /buildEconomicGroupCustomerPrismaExclusion/);
    assert.match(listWhere, /from ["']@\/src\/lib\/financeInternalGroupExclusions\.js["']/);
  });

  it("diagnóstico de população não é obrigatório na UI e não derruba a rota se falhar", () => {
    const service = read("src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.ts");
    assert.match(service, /logInvestedCapitalRecoveryPopulationDiagnostics/);
    assert.match(service, /catch\s*\{/);
  });

  it("nota informativa discreta na UI (sem modal, sem poluir a tela)", () => {
    const ui = read("src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryPage.tsx");
    assert.match(ui, /empresas do grupo não são consideradas nesta análise/i);
    assert.doesNotMatch(ui, /<Modal|<Dialog/);
  });
});
