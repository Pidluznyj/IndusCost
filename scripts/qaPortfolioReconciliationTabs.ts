/**
 * QA estático — Simplificação das abas do Financeiro > Conciliação de Carteira.
 *
 * Objetivo: garantir que a UI mostra somente as abas Status Pedidos e
 * Auditoria Pedido → Caixa, com Status Pedidos como default e com fallback
 * para qualquer estado antigo (`conciliation`, `intelligence`, `portfolio`,
 * `carteira`, `reconciliation` ou qualquer outro id fora da whitelist).
 *
 * Uso:  npx tsx scripts/qaPortfolioReconciliationTabs.ts
 *
 * Exit code: 0 se tudo OK, 1 se algum check falhou.
 *
 * Cobertura (9 asserções obrigatórias):
 *   1. Tela mostra somente Status Pedidos + Auditoria Pedido → Caixa.
 *   2. Aba padrão é Status Pedidos.
 *   3. Estado antigo `conciliation` cai no fallback → Status Pedidos.
 *   4. Estado antigo `intelligence` cai no fallback → Status Pedidos.
 *   5. Página monta OrderStatusTab (Status Pedidos).
 *   6. Página monta OrderToCashAuditTab (Auditoria Pedido → Caixa).
 *   7. Painel superior de filtros continua sendo renderizado.
 *   8. Nenhum <ProtectedTab active={activeView === "conciliation"}> permanece
 *      no JSX da página (não renderiza aba oculta = não dispara fetch dela).
 *   9. Frontend NÃO importa @prisma/client.
 */
import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

type Check = { id: string; ok: boolean; detail: string };
const checks: Check[] = [];

function ok(id: string, detail: string): void {
  checks.push({ id, ok: true, detail });
  // eslint-disable-next-line no-console
  console.log(`PASS  ${id} — ${detail}`);
}

function fail(id: string, detail: string): void {
  checks.push({ id, ok: false, detail });
  // eslint-disable-next-line no-console
  console.error(`FAIL  ${id} — ${detail}`);
}

function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// 1) Whitelist canônica de abas visíveis
// ---------------------------------------------------------------------------
function checkVisibleWhitelist(): void {
  const client = read("src/lib/permissionsClient.ts");
  if (!/PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS\s*=\s*\[/.test(client)) {
    fail(
      "check-1-visible-whitelist-declared",
      "PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS não encontrado em permissionsClient.ts"
    );
    return;
  }
  const match = client.match(
    /PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS[\s\S]*?=\s*\[([^\]]+)\]/
  );
  const body = match?.[1] ?? "";
  const hasStatus = /"order-status-pedidos"/.test(body);
  const hasAudit = /"order-to-cash-audit"/.test(body);
  const hasConciliation = /"conciliation"/.test(body);
  const hasIntelligence = /"intelligence"/.test(body);
  if (hasStatus && hasAudit && !hasConciliation && !hasIntelligence) {
    ok(
      "check-1-visible-whitelist-declared",
      "Whitelist contém somente order-status-pedidos + order-to-cash-audit (nessa ordem)."
    );
  } else {
    fail(
      "check-1-visible-whitelist-declared",
      `Whitelist inconsistente. Encontrado: status=${hasStatus} audit=${hasAudit} conciliation=${hasConciliation} intelligence=${hasIntelligence}`
    );
  }
  // Ordem canônica: Status Pedidos primeiro, Auditoria Pedido → Caixa depois.
  const idxStatus = body.indexOf('"order-status-pedidos"');
  const idxAudit = body.indexOf('"order-to-cash-audit"');
  if (idxStatus >= 0 && idxAudit >= 0 && idxStatus < idxAudit) {
    ok(
      "check-1b-visible-whitelist-order",
      "Ordem: Status Pedidos → Auditoria Pedido → Caixa."
    );
  } else {
    fail(
      "check-1b-visible-whitelist-order",
      "Ordem canônica não é Status Pedidos → Auditoria Pedido → Caixa."
    );
  }
}

// ---------------------------------------------------------------------------
// 2) Aba padrão é Status Pedidos
// ---------------------------------------------------------------------------
function checkDefaultTab(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  // Default do useState — cai em `visibleTabs[0] ?? "order-status-pedidos"`.
  const hasStaticDefault =
    /useState<PortfolioReconciliationVisibleTabId>\s*\(\s*\(\)\s*=>\s*visibleTabs\[0\]\s*\?\?\s*"order-status-pedidos"\s*\)/.test(
      page
    );
  if (hasStaticDefault) {
    ok(
      "check-2-default-tab",
      "Default do activeView cai em 'order-status-pedidos' quando visibleTabs vazio."
    );
  } else {
    fail(
      "check-2-default-tab",
      "Default do activeView não aponta explicitamente para 'order-status-pedidos'."
    );
  }
}

// ---------------------------------------------------------------------------
// 3, 4) Fallback: estado antigo cai em Status Pedidos
// ---------------------------------------------------------------------------
function checkFallbackForOldState(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const hasGuard =
    /isPortfolioReconciliationVisibleTabId\s*\(\s*activeView\s*\)/.test(page);
  const hasResetToFirstVisible =
    /setActiveView\s*\(\s*visibleTabs\[0\]!/.test(page);
  if (hasGuard && hasResetToFirstVisible) {
    ok(
      "check-3-fallback-old-conciliation",
      "Guard isPortfolioReconciliationVisibleTabId + reset para visibleTabs[0] presente (redireciona 'conciliation' antigo)."
    );
    ok(
      "check-4-fallback-old-intelligence",
      "Mesmo guard cobre 'intelligence' antigo (redireciona para primeira aba visível permitida)."
    );
  } else {
    fail(
      "check-3-fallback-old-conciliation",
      `Fallback ausente. guard=${hasGuard} reset=${hasResetToFirstVisible}`
    );
    fail(
      "check-4-fallback-old-intelligence",
      "Fallback ausente (mesma causa do check anterior)."
    );
  }

  // Verifica também na fonte pura do helper.
  const client = read("src/lib/permissionsClient.ts");
  const helperRejects =
    /export function isPortfolioReconciliationVisibleTabId[\s\S]*?PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS/.test(
      client
    );
  if (helperRejects) {
    ok(
      "check-3b-helper-guard",
      "isPortfolioReconciliationVisibleTabId consulta a whitelist canônica."
    );
  } else {
    fail(
      "check-3b-helper-guard",
      "helper isPortfolioReconciliationVisibleTabId não usa a whitelist canônica."
    );
  }
}

// ---------------------------------------------------------------------------
// 5, 6) Status Pedidos + Auditoria Pedido → Caixa continuam sendo montados
// ---------------------------------------------------------------------------
function checkTabsMounted(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  if (
    /<OrderStatusTab\s*\/>/.test(page) &&
    /active=\{activeView === "order-status-pedidos"\}/.test(page)
  ) {
    ok(
      "check-5-order-status-tab-mounted",
      "OrderStatusTab é renderizado dentro de ProtectedTab com active='order-status-pedidos'."
    );
  } else {
    fail(
      "check-5-order-status-tab-mounted",
      "OrderStatusTab não está montado corretamente."
    );
  }
  if (
    /<OrderToCashAuditTab\s*\/>/.test(page) &&
    /active=\{activeView === "order-to-cash-audit"\}/.test(page)
  ) {
    ok(
      "check-6-order-to-cash-audit-tab-mounted",
      "OrderToCashAuditTab é renderizado dentro de ProtectedTab com active='order-to-cash-audit'."
    );
  } else {
    fail(
      "check-6-order-to-cash-audit-tab-mounted",
      "OrderToCashAuditTab não está montado corretamente."
    );
  }
}

// ---------------------------------------------------------------------------
// 7) Filtro global legado removido; filtros ficam nas abas
// ---------------------------------------------------------------------------
function checkFiltersPanel(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const hasPanel = /<FinanceBiFilterPanel\b/.test(page);
  const hasGlobalFonte = /Fonte da previsão/.test(page);
  const hasGlobalRunFilter = /Run de conciliação/.test(page);
  const hasGlobalOnlyIssues = /Apenas divergências \/ alertas/.test(page);
  const hasApply = /function applyFilters|const applyFilters/.test(page);
  const hasClear = /function clearFilters|const clearFilters/.test(page);
  const orderStatus = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusTab.tsx"
  );
  const orderStatusFilters = read(
    "src/components/finance/portfolio-reconciliation/OrderStatusFilters.tsx"
  );
  const o2c = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditTab.tsx"
  );
  const o2cFilters = read(
    "src/components/finance/portfolio-reconciliation/OrderToCashAuditFilters.tsx"
  );

  if (
    !hasPanel &&
    !hasGlobalFonte &&
    !hasGlobalRunFilter &&
    !hasGlobalOnlyIssues &&
    !hasApply &&
    !hasClear
  ) {
    ok(
      "check-7-global-filters-removed",
      "Card global FinanceBiFilterPanel / Fonte da previsão / Run de conciliação removidos da página."
    );
  } else {
    fail(
      "check-7-global-filters-removed",
      `Resíduo do filtro global. panel=${hasPanel} fonte=${hasGlobalFonte} run=${hasGlobalRunFilter} issues=${hasGlobalOnlyIssues}`
    );
  }

  if (
    /OrderStatusFilters/.test(orderStatus) &&
    /onApply/.test(orderStatusFilters)
  ) {
    ok(
      "check-7b-order-status-own-filters",
      "Aba Status Pedidos mantém filtros próprios (OrderStatusFilters)."
    );
  } else {
    fail(
      "check-7b-order-status-own-filters",
      "OrderStatusFilters ausente da aba Status Pedidos."
    );
  }

  if (
    /OrderToCashAuditFilters/.test(o2c) &&
    /onApply|Pesquisar|Aplicar/.test(o2cFilters)
  ) {
    ok(
      "check-7c-o2c-own-filters",
      "Aba Auditoria Pedido → Caixa mantém filtros próprios."
    );
  } else {
    fail(
      "check-7c-o2c-own-filters",
      "OrderToCashAuditFilters ausente da aba Auditoria."
    );
  }

  if (
    /portfolio-reconciliation-run-meta/.test(page) &&
    /FINANCE_HEADER_ACTION_REFRESH/.test(page)
  ) {
    ok(
      "check-7d-run-meta-and-refresh",
      "Meta da run + botão Atualizar continuam na página."
    );
  } else {
    fail(
      "check-7d-run-meta-and-refresh",
      "Run meta ou botão Atualizar ausentes."
    );
  }
}

// ---------------------------------------------------------------------------
// 8) JSX não renderiza abas ocultas (não dispara fetch de aba oculta)
// ---------------------------------------------------------------------------
function checkNoHiddenTabRender(): void {
  const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
  const hasIntelligenceActive =
    /active=\{activeView === "intelligence"\}/.test(page);
  const hasConciliationActive =
    /active=\{activeView === "conciliation"\}/.test(page);
  const hasConciliationConditional =
    /activeView === "conciliation"/.test(page);
  const hasIntelligenceComponent = /<PortfolioIntelligenceSection\b/.test(page);
  const hasConciliationTable = /<PortfolioReconciliationOrdersTable\b/.test(page);
  if (
    !hasIntelligenceActive &&
    !hasConciliationActive &&
    !hasConciliationConditional &&
    !hasIntelligenceComponent &&
    !hasConciliationTable
  ) {
    ok(
      "check-8-no-hidden-tab-render",
      "JSX não referencia nenhuma aba oculta — 0 chance de renderização/fetch acidental."
    );
  } else {
    fail(
      "check-8-no-hidden-tab-render",
      `Resíduos do JSX antigo. intelligence-active=${hasIntelligenceActive} conciliation-active=${hasConciliationActive} conciliation-conditional=${hasConciliationConditional} PortfolioIntelligenceSection=${hasIntelligenceComponent} PortfolioReconciliationOrdersTable=${hasConciliationTable}`
    );
  }
}

// ---------------------------------------------------------------------------
// 9) Frontend não importa @prisma/client
// ---------------------------------------------------------------------------
function checkFrontendNoPrisma(): void {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const source = readFileSync(full, "utf8");
      if (/from\s+["']@prisma\/client["']/.test(source)) offenders.push(full);
    }
  };
  walk(join(ROOT, "src/components/finance/portfolio-reconciliation"));
  const page = join(ROOT, "src/components/finance/FinancePortfolioReconciliationPage.tsx");
  if (/from\s+["']@prisma\/client["']/.test(readFileSync(page, "utf8"))) {
    offenders.push(page);
  }
  if (offenders.length === 0) {
    ok(
      "check-9-frontend-no-prisma",
      "Nenhum arquivo do módulo Conciliação de Carteira (frontend) importa @prisma/client."
    );
  } else {
    fail(
      "check-9-frontend-no-prisma",
      `Frontend importa Prisma em: ${offenders.join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  section("Static — asserções sobre o código-fonte");
  checkVisibleWhitelist();
  checkDefaultTab();
  checkFallbackForOldState();
  checkTabsMounted();
  checkFiltersPanel();
  checkNoHiddenTabRender();
  checkFrontendNoPrisma();

  section("Resumo");
  const total = checks.length;
  const failed = checks.filter((c) => !c.ok);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        total,
        passed: total - failed.length,
        failed: failed.length,
        failedIds: failed.map((c) => c.id),
        verdict: failed.length === 0 ? "OK" : "FALHA",
      },
      null,
      2
    )
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
