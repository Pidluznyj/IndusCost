/**
 * OP-28 — Runner da matriz E2E SC + regressões dos módulos protegidos próximos.
 *
 * Uso: npm run test:supply-chain:e2e
 *
 * Não exige DATABASE_URL. Não faz deploy. Não muta motores oficiais.
 */

import { spawnSync } from "node:child_process";

const E2E_MATRIX = {
  name: "matriz-e2e-fluxo-paralelo",
  args: ["tsx", "--test", "src/lib/purchasing/supplyChainParallelWorkflow.e2e.test.ts"],
};

type SuiteRun =
  | { name: string; kind: "npm"; npmScript: string }
  | { name: string; kind: "tsx"; files: string[] };

/**
 * Regressões próximas dos módulos protegidos (leitura / não-regressão SC).
 * Precificação e pedidos usam subset estável: suites npm completas têm asserts
 * estáticos pré-existentes fora do escopo SC (não corrigidos aqui).
 */
const PROTECTED_REGRESSIONS: SuiteRun[] = [
  { name: "supply-chain-boundary", kind: "npm", npmScript: "test:supply-chain" },
  { name: "purchasing", kind: "npm", npmScript: "test:purchasing" },
  { name: "inventory", kind: "npm", npmScript: "test:inventory" },
  { name: "materias-primas-custos", kind: "npm", npmScript: "test:material-cost-tables" },
  { name: "produtos-custo-oficial", kind: "npm", npmScript: "test:products:official-final-cost" },
  { name: "bom-quantidade-efetiva", kind: "npm", npmScript: "test:nomus:bom-effective-quantity-unit" },
  { name: "custos-producao", kind: "npm", npmScript: "test:production-cost-tables" },
  {
    name: "precificacao",
    kind: "tsx",
    files: [
      "src/lib/priceTablePublication.test.ts",
      "src/lib/priceTableProductionCostResolver.test.ts",
      "src/lib/priceTablePublication.server.test.ts",
      "src/lib/pricing/publishedPriceFormationView.test.ts",
      "src/lib/pricing/publishedPriceSourceTrace.test.ts",
    ],
  },
  {
    name: "pedidos",
    kind: "tsx",
    files: [
      "src/lib/salesOrderMetricsEngine.test.ts",
      "src/lib/salesOrderManagementFulfillment.test.ts",
    ],
  },
  { name: "financeiro-billing", kind: "npm", npmScript: "test:finance:billing" },
  { name: "fornecedores-ap-sync", kind: "npm", npmScript: "test:nomus:accounts-payable" },
  { name: "sync-produtos-nomus", kind: "npm", npmScript: "test:nomus:products-sync" },
];

function runNpm(script: string): { ok: boolean; ms: number } {
  const started = Date.now();
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  return { ok: result.status === 0, ms: Date.now() - started };
}

function runCmd(command: string, args: string[]): { ok: boolean; ms: number } {
  const started = Date.now();
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  return { ok: result.status === 0, ms: Date.now() - started };
}

function runSuite(suite: SuiteRun): { ok: boolean; ms: number } {
  if (suite.kind === "npm") return runNpm(suite.npmScript);
  return runCmd("npx", ["tsx", "--test", ...suite.files]);
}

function main(): void {
  const results: Array<{ name: string; ok: boolean; ms: number }> = [];

  console.log("\n=== OP-28 E2E matrix (motores puros) ===\n");
  const e2e = runCmd("npx", E2E_MATRIX.args);
  results.push({ name: E2E_MATRIX.name, ...e2e });
  if (!e2e.ok) {
    console.error("\n[OP-28] Matriz E2E falhou — abortando regressões.");
    process.exit(1);
  }

  console.log("\n=== OP-28 Regressões módulos protegidos próximos ===\n");
  for (const suite of PROTECTED_REGRESSIONS) {
    const label = suite.kind === "npm" ? suite.npmScript : suite.files.join(" ");
    console.log(`\n--- ${suite.name} (${label}) ---\n`);
    const r = runSuite(suite);
    results.push({ name: suite.name, ...r });
    if (!r.ok) {
      console.error(`\n[OP-28] Regressão falhou: ${suite.name}`);
    }
  }

  console.log("\n=== OP-28 Resumo ===\n");
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`${status.padEnd(4)}  ${r.name}  (${(r.ms / 1000).toFixed(1)}s)`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n[OP-28] ${failed.length} suite(s) falharam.`);
    process.exit(1);
  }
  console.log("\n[OP-28] Matriz E2E + regressões protegidas OK.\n");
}

main();
