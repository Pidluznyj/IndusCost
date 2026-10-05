/**
 * Guarda-corpos de fronteira: SIMULAÇÃO ESTIMA · PROJETO COMBINA · FORMAÇÃO DE PREÇO OFICIAL
 * PRECIFICA PRODUTO REAL. Os três mundos compartilham funções puras, nunca persistência
 * nem workflow.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Código de produção do domínio Simulações (rotas, cálculo, tela, relatório). */
const SIMULATION_SOURCES = [
  "src/lib/simulationsRoutes.ts",
  "src/lib/simulationsValidation.ts",
  "src/lib/simulationScenario.ts",
  "src/lib/simulationFormula.ts",
  "src/lib/newProductSandbox.ts",
  "src/lib/newProductSimulation.server.ts",
  "src/lib/newProductSimulationInputs.ts",
  "src/lib/newProductSimulationSnapshot.ts",
  "src/lib/productCostBaseline.ts",
  "src/lib/productCostBaseline.server.ts",
  "src/components/SimulationModule.tsx",
  "src/components/NewProductSimulationReport.tsx",
  "src/components/simulations/ScenarioBaselinePanel.tsx",
  "src/components/simulations/ScenarioComparisonSummary.tsx",
  "src/components/simulations/SimulationProductSelect.tsx",
];

const SERVER_SOURCES = SIMULATION_SOURCES.filter((f) => f.startsWith("src/lib/"));

/** Remove comentários para não confundir documentação com chamada. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("fronteira Simulações → universo oficial", () => {
  it("TESTE 1 — nenhum arquivo de Simulações chama publishProductionCostVersionFromDraft", () => {
    for (const file of SIMULATION_SOURCES) {
      assert.doesNotMatch(code(file), /publishProductionCostVersionFromDraft/, file);
      assert.doesNotMatch(code(file), /productionCostPublication|productionCostBulkPublish|unitaryFormationProductionCost/, file);
    }
  });

  it("TESTE 2 — nenhuma rota de Simulações escreve ProductionCostTableVersion/Item", () => {
    for (const file of SERVER_SOURCES) {
      const src = code(file);
      assert.doesNotMatch(
        src,
        /productionCostTable(Version|Item)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)/,
        file
      );
      assert.doesNotMatch(src, /status:\s*["']PUBLISHED["']/, file);
    }
  });

  it("TESTE 3 — nenhuma rota de Simulações escreve ProductPricing", () => {
    for (const file of SERVER_SOURCES) {
      assert.doesNotMatch(
        code(file),
        /productPricing\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)/,
        file
      );
    }
    // Leitura das premissas como referência do cenário é permitida — e é a única operação.
    const routes = code("src/lib/simulationsRoutes.ts");
    assert.deepEqual([...new Set(routes.match(/productPricing\s*\.\s*\w+/g) ?? [])], ["productPricing.findUnique"]);
  });

  it("TESTE 4 — nenhuma rota de Simulações publica ou altera tabela de preço", () => {
    for (const file of SIMULATION_SOURCES) {
      const src = code(file);
      assert.doesNotMatch(src, /priceTable(Version|Item)?\s*\.\s*\w+\(/, file);
      assert.doesNotMatch(src, /priceTablePublication\.server|generatePriceTableVersionDraft|publishPriceTable/, file);
    }
  });

  it("as rotas de Simulações só mutam Simulation e NewProductSimulation", () => {
    const routes = code("src/lib/simulationsRoutes.ts");
    const writes = [
      ...routes.matchAll(/prisma\s*\.\s*(\w+)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g),
    ].map((m) => m[1]);
    assert.deepEqual([...new Set(writes)].sort(), ["newProductSimulation", "simulation"]);
    for (const file of ["src/lib/newProductSimulation.server.ts", "src/lib/productCostBaseline.server.ts"]) {
      assert.doesNotMatch(
        code(file),
        // chamadas Prisma recebem objeto literal; `createHash(...).update(str)` não é escrita em banco
        /\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(\s*\{/,
        `${file} é somente leitura`
      );
    }
  });

  it("tela de Simulações não chama rotas oficiais de preço nem de publicação de custo", () => {
    for (const file of SIMULATION_SOURCES.filter((f) => f.startsWith("src/components/"))) {
      const src = code(file);
      assert.doesNotMatch(src, /\/api\/pricing/, file);
      assert.doesNotMatch(src, /\/api\/price-tables/, file);
      assert.doesNotMatch(src, /\/api\/production-cost/, file);
      assert.doesNotMatch(src, /production-cost-snapshot|pricing-snapshot/, file);
    }
  });

  it("LIVE nunca é rotulado como oficial na tela", () => {
    const module = read("src/components/SimulationModule.tsx");
    assert.doesNotMatch(module, /Base Oficial/);
    // única menção permitida: o aviso de que a simulação NÃO altera a Formação de Preço oficial
    assert.doesNotMatch(
      module.replace(/não leem nem alteram a Formação de Preço oficial/g, ""),
      /Preço oficial/i
    );
    assert.doesNotMatch(module, /Novo Preço Sugerido|Preço Sugerido Base/);
    assert.match(module, /Base da simulação/);
    assert.match(module, /Preço simulado/);
  });

  it("tela não recalcula custo de todos os produtos nem usa fallback 'tudo em MP'", () => {
    const module = read("src/components/SimulationModule.tsx");
    assert.doesNotMatch(module, /\/api\/products\?cost=1/);
    assert.doesNotMatch(module, /\/cost-analysis/);
    assert.doesNotMatch(module, /costSummary\?\.totalIndustrialCost/);
    assert.match(module, /\/api\/simulations\/product-baseline/);
  });

  it("server.ts registra o módulo e não mantém rotas de simulação inline", () => {
    const server = read("server.ts");
    assert.match(server, /registerSimulationsRoutes\(/);
    assert.doesNotMatch(server, /app\.(get|post|delete)\(\s*"\/api\/(new-product-)?simulations/);
    assert.doesNotMatch(server, /prisma\.simulation\.create\(\{ data \}\)/);
  });

  it("bibliotecas compartilhadas são puras (sem persistência nem workflow)", () => {
    for (const file of ["src/lib/pricing/commercialPriceFormula.ts", "src/lib/materialEffectiveCost.ts"]) {
      const src = code(file);
      assert.doesNotMatch(src, /^import /m, file);
      assert.doesNotMatch(src, /prisma|fetch\(|process\.env/, file);
    }
  });

  it("todos os handlers de rota passam pelo wrapper async (sem rejeição não tratada)", () => {
    const routes = code("src/lib/simulationsRoutes.ts");
    const registrations = routes.match(/\bapp\.(get|post|delete|put|patch)\(/g) ?? [];
    const wrapped = routes.match(/asyncRoute\("/g) ?? [];
    assert.ok(registrations.length >= 14);
    assert.equal(wrapped.length, registrations.length);
  });

  it("migrations da feature só tocam Simulation, NewProductSimulation e ProjectSimulatedItem", () => {
    for (const dir of [
      "prisma/migrations/20261005120000_new_product_simulation_status_archived",
      "prisma/migrations/20261006120000_simulations_cost_governance",
    ]) {
      const sql = read(`${dir}/migration.sql`).replace(/^--.*$/gm, "");
      assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i, dir);
      assert.doesNotMatch(sql, /ProductPricing|PriceTable|ProductionCostTable/, dir);
      const tables = [...sql.matchAll(/ALTER TABLE (?:IF EXISTS )?"(\w+)"/g)].map((m) => m[1]);
      for (const table of tables) {
        assert.ok(["Simulation", "NewProductSimulation", "ProjectSimulatedItem"].includes(table), table);
      }
    }
  });
});
