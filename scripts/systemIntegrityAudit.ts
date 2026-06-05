/**
 * Diagnóstico read-only de integridade do IndusCost.
 * Não altera banco, schema ou dados.
 *
 * Uso: npx tsx scripts/systemIntegrityAudit.ts
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type CheckResult = { id: string; severity: string; ok: boolean; detail: string };

const checks: CheckResult[] = [];

function add(id: string, severity: string, ok: boolean, detail: string) {
  checks.push({ id, severity, ok, detail });
}

function read(rel: string): string {
  const p = path.join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

function countMigrations(): number {
  const dir = path.join(root, "prisma", "migrations");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
}

function main() {
  console.log("=== IndusCost — System Integrity Audit (read-only) ===\n");

  const schema = read("prisma/schema.prisma");
  add(
    "SYS-001",
    "info",
    schema.length > 0,
    schema.length > 0 ? "schema.prisma encontrado" : "schema.prisma ausente"
  );

  const migrationCount = countMigrations();
  add("SYS-002", "info", migrationCount > 0, `${migrationCount} migrations em prisma/migrations`);

  const server = read("server.ts");
  const serverLines = server.split("\n").length;
  add(
    "SYS-003",
    "medium",
    serverLines < 12000,
    `server.ts com ${serverLines} linhas (monolito HTTP)`
  );

  add(
    "SYS-004",
    "high",
    !server.includes('app.get("/api/test-db"'),
    server.includes('app.get("/api/test-db"')
      ? "GET /api/test-db presente (verificar auth em produção)"
      : "GET /api/test-db não encontrado"
  );

  const applyPreview = read("src/lib/nomusBomControlledApply.ts");
  add(
    "SYS-005",
    "high",
    false,
    /buildNomusEffectiveBomCostImpact\([\s\S]*?,\s*null\s*\)/.test(applyPreview)
      ? "apply-preview passa snapshot null para cost-impact (risco vs painel REST)"
      : "apply-preview: padrão null não detectado — revisar manualmente"
  );

  const fleetUsage = read("src/lib/fleetUsageOps.ts");
  add(
    "SYS-006",
    "high",
    false,
    fleetUsage.includes("recalculateVehicleOperationalStatus")
      ? "fleetUsageOps: checkin define status direto; recalc existe mas pode não ser chamado no checkin"
      : "fleetUsageOps: recalc ausente"
  );

  const modulePerms = read("src/lib/modulePermissions.ts");
  add(
    "SYS-007",
    "critical",
    false,
    modulePerms.includes("costs.view") && modulePerms.includes("dashboard.view")
      ? "modulePermissions usa aliases legados costs.view / dashboard.view"
      : "aliases legados não encontrados"
  );

  const customerList = read("src/lib/customerListQuery.ts");
  add(
    "SYS-008",
    "info",
    customerList.includes("CUSTOMER_LIST_DEFAULT_LIMIT = 20"),
    customerList.includes("CUSTOMER_LIST_DEFAULT_LIMIT = 20")
      ? "CustomerModule paginação 20 via customerListQuery"
      : "customerListQuery padrão 20 não encontrado"
  );

  const proposalModule = read("src/components/ProposalModule.tsx");
  add(
    "SYS-009",
    "medium",
    !proposalModule.includes('fetchJsonOk<Customer[]>("/api/customers")'),
    proposalModule.includes('fetchJsonOk<Customer[]>("/api/customers")')
      ? "ProposalModule ainda carrega /api/customers sem paginação"
      : "ProposalModule não usa lista legada full"
  );

  const reportPath = "docs/generated/system-integrity-audit.md";
  add(
    "SYS-010",
    "info",
    existsSync(path.join(root, reportPath)),
    existsSync(path.join(root, reportPath))
      ? "Relatório docs/generated/system-integrity-audit.md presente"
      : "Relatório ausente — executar auditoria documental"
  );

  const bySeverity = (s: string) => checks.filter((c) => c.severity === s);
  for (const c of checks) {
    const mark = c.ok ? "OK" : "ATENÇÃO";
    console.log(`[${mark}] ${c.id} (${c.severity}): ${c.detail}`);
  }

  console.log("\n--- Resumo ---");
  console.log(`Total checks: ${checks.length}`);
  console.log(`OK: ${checks.filter((c) => c.ok).length}`);
  console.log(`Atenção: ${checks.filter((c) => !c.ok).length}`);
  console.log(`Críticos/alta: ${bySeverity("critical").length + bySeverity("high").length} itens marcados`);
  console.log(`\nRelatório completo: ${reportPath}`);
}

main();
