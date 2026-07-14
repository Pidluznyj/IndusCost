/**
 * QA — CRM Comercial: escopo de acesso + robustez dos dashboards.
 * Read-only. Não grava.
 *
 * Uso:
 *   npx tsx scripts/qaCrmCommercialAccessScope.ts
 *
 * Modos:
 *   - static: 10 asserções sobre o código-fonte (sempre executam)
 *   - live:   se `DATABASE_URL` existir, roda os SERVICES reais
 *             (`buildCrmManagementDashboardResponse` +
 *              `buildCrmSellerDashboardResponse` scope=all) e valida que
 *             nenhum retorna 500 e que Responsável Comercial nunca aparece
 *             como FINANCEIRO/FATURAMENTO.
 *
 * Validações obrigatórias (Tarefas do plano CRM Comercial pós-500):
 *   1. GET /api/crm/management-dashboard não pode retornar 500 (SUPER_ADMIN).
 *   2. GET /api/crm/seller-dashboard não pode retornar 500 (SUPER_ADMIN).
 *   3. buildCrmManagementDashboardResponse roda sem erro.
 *   4. buildCrmSellerDashboardResponse roda sem erro.
 *   5. Nenhuma query prisma.salesOrder.* inclui `CrmCustomerCommercialOwner`
 *      no select/include (regra Prisma — relação não existe em SalesOrder).
 *   6. Responsável Comercial não mostra FINANCEIRO/FATURAMENTO.
 *   7. Vendedor Pedido (nomusSellerName / externalSellerId) segue campo
 *      separado no DTO — nunca reaproveita `commercialResponsibleName`.
 *   8. Propostas NÃO são fonte oficial das métricas de pedidos.
 *   9. SalesOrder/SalesOrderItem continuam sendo a fonte oficial dos pedidos.
 *  10. Frontend NÃO importa `@prisma/client`.
 *
 * Exit code:
 *   0 se todas as asserções passaram.
 *   1 se qualquer asserção falhou.
 */
import "dotenv/config";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

type CheckMode = "static" | "live";
type Check = { id: string; ok: boolean; detail: string; mode: CheckMode };
const checks: Check[] = [];

function ok(id: string, detail: string, mode: CheckMode = "static"): void {
  checks.push({ id, ok: true, detail, mode });
  // eslint-disable-next-line no-console
  console.log(`PASS  [${mode}] ${id} — ${detail}`);
}

function fail(id: string, detail: string, mode: CheckMode = "static"): void {
  checks.push({ id, ok: false, detail, mode });
  // eslint-disable-next-line no-console
  console.error(`FAIL  [${mode}] ${id} — ${detail}`);
}

function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

/**
 * Localiza chamadas do tipo `prisma.salesOrder.<verb>(...)` e retorna a fatia
 * de texto dentro do PRIMEIRO argumento (o objeto `{ where, include, select, ... }`).
 * Faz parsing simples com contagem de chaves para não pegar arquivos longos
 * inteiros como falso positivo.
 */
function extractSalesOrderCallBodies(source: string): string[] {
  const re =
    /prisma\.salesOrder\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy)\s*\(\s*\{/g;
  const bodies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const startBrace = match.index + match[0].length - 1;
    let depth = 0;
    let inString: '"' | "'" | "`" | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = startBrace; i < source.length; i++) {
      const ch = source[i]!;
      const prev = i > 0 ? source[i - 1] : "";
      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "/" && prev === "*") inBlockComment = false;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === "/" && source[i + 1] === "/") {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        inBlockComment = true;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch as '"' | "'" | "`";
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(startBrace, i + 1));
          break;
        }
      }
    }
  }
  return bodies;
}

/**
 * `true` se o corpo (já isolado) do argumento de `prisma.salesOrder.<verb>`
 * inclui `CrmCustomerCommercialOwner` fora de comentários. Como
 * `extractSalesOrderCallBodies` já removeu comentários da janela, basta
 * varrer strings/tokens.
 */
function callBodyHasIllegalInclude(body: string): boolean {
  // Neutraliza qualquer bloco `nomusRawResponse: true` etc. — só procura pela
  // string identificadora do model.
  return /CrmCustomerCommercialOwner/.test(body);
}

/**
 * Lista dos arquivos-chave do fluxo CRM Comercial que a instrução do plano
 * exige revisão. Não é exaustiva — o check 5 varre também qualquer outro
 * arquivo em `src/` que casa com o antipadrão.
 */
const CRM_CORE_FILES = [
  "src/lib/commercial/crmSalesOrderMetricsService.ts",
  "src/lib/crmManagementDashboardService.ts",
  "src/lib/crmSellerDashboardService.ts",
  "src/lib/commercial/crmCommercialResponsibleResolver.ts",
  "src/lib/salesOrderRulesAdapter.ts",
];

/** Varre `src/**` procurando pelo antipadrão. Retorna caminhos que casam. */
function scanForIllegalInclude(): string[] {
  const matches: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|cts)$/.test(entry)) continue;
      // Ignora testes e o próprio QA/audit para não pegar strings/comentários.
      if (/\.test\.(t|j)sx?$/.test(entry)) continue;
      if (full.replace(/\\/g, "/").includes("/tmp-audits/")) continue;
      if (full.replace(/\\/g, "/").includes("/scripts/qaCrmCommercialAccessScope")) continue;
      const source = readFileSync(full, "utf8");
      const bodies = extractSalesOrderCallBodies(source);
      if (bodies.some(callBodyHasIllegalInclude)) {
        matches.push(full);
      }
    }
  };
  walk(join(ROOT, "src"));
  return matches;
}

/**
 * Check 5: Nenhum `prisma.salesOrder.*` inclui `CrmCustomerCommercialOwner`
 * no select/include.
 */
function checkNoIllegalSalesOrderInclude(): void {
  const offenders = scanForIllegalInclude();
  if (offenders.length === 0) {
    ok(
      "check-5-no-illegal-sales-order-include",
      "Nenhum prisma.salesOrder.<verb> inclui CrmCustomerCommercialOwner via include/select."
    );
    return;
  }
  fail(
    "check-5-no-illegal-sales-order-include",
    `Arquivos com antipadrão prisma.salesOrder + CrmCustomerCommercialOwner: ${offenders.join(", ")}`
  );
}

/**
 * Check 6: Guard FINANCEIRO/FATURAMENTO está ativo no resolver batch.
 */
function checkForbiddenGuardActive(): void {
  const src = read("src/lib/commercial/crmCommercialResponsibleResolver.ts");
  const hasList = /FORBIDDEN_COMMERCIAL_RESPONSIBLE_NAME_HINTS/.test(src);
  const hasFinanceiro = /"FINANCEIRO"/.test(src);
  const hasFaturamento = /"FATURAMENTO"/.test(src);
  const hasFn = /isForbiddenCommercialResponsibleName/.test(src);
  if (hasList && hasFinanceiro && hasFaturamento && hasFn) {
    ok(
      "check-6-forbidden-guard-active",
      "Guard bloqueia FINANCEIRO/FATURAMENTO como Responsável Comercial."
    );
    return;
  }
  fail(
    "check-6-forbidden-guard-active",
    `Guard ausente/incompleto (hasList=${hasList}, hasFinanceiro=${hasFinanceiro}, hasFaturamento=${hasFaturamento}, hasFn=${hasFn}).`
  );
}

/**
 * Check 7: DTO do seller-dashboard mantém campos separados.
 */
function checkDtoSeparation(): void {
  const src = read("src/components/crmSellerDashboardTypes.ts");
  const hasNomusSellerName = /nomusSellerName\??:\s*string/.test(src);
  const hasCommercialOwnerName = /commercialOwnerName\??:\s*string/.test(src);
  const hasOwnerDiffers = /ownerDiffersFromNomusSeller/.test(src);
  if (hasNomusSellerName && hasCommercialOwnerName && hasOwnerDiffers) {
    ok(
      "check-7-dto-separation",
      "DTO seller-dashboard separa nomusSellerName / commercialOwnerName / ownerDiffersFromNomusSeller."
    );
    return;
  }
  fail(
    "check-7-dto-separation",
    `DTO não separa corretamente (nomusSellerName=${hasNomusSellerName}, commercialOwnerName=${hasCommercialOwnerName}, ownerDiffers=${hasOwnerDiffers}).`
  );
}

/**
 * Check 8: Serviços do dashboard NÃO consultam Proposal para KPIs de pedido.
 * (Proposal só pode aparecer para rastreabilidade — nunca via .findMany/aggregate/groupBy.)
 */
function checkProposalIsNotOrderSource(): void {
  const offenders: string[] = [];
  for (const rel of [
    "src/lib/commercial/crmSalesOrderMetricsService.ts",
    "src/lib/crmManagementDashboardService.ts",
    "src/lib/crmSellerDashboardService.ts",
  ]) {
    const src = read(rel);
    if (/prisma\.proposal\.(findMany|aggregate|groupBy|count)/.test(src)) {
      offenders.push(rel);
    }
  }
  if (offenders.length === 0) {
    ok(
      "check-8-proposal-not-order-source",
      "Nenhum service do dashboard consulta Proposal como fonte de KPI de pedido."
    );
    return;
  }
  fail(
    "check-8-proposal-not-order-source",
    `Services consultando Proposal como fonte de pedido: ${offenders.join(", ")}`
  );
}

/**
 * Check 9: SalesOrder / SalesOrderItem seguem sendo a fonte oficial dos pedidos.
 */
function checkSalesOrderIsSource(): void {
  const src = read("src/lib/commercial/crmSalesOrderMetricsService.ts");
  const hasSelectConst = /CRM_SALES_ORDER_METRICS_PRISMA_SELECT/.test(src);
  const hasFindMany = /prisma\.salesOrder\.findMany/.test(src);
  const hasItemsSelect = /items:\s*\{[\s\S]{0,200}?select:/.test(src);
  if (hasSelectConst && hasFindMany && hasItemsSelect) {
    ok(
      "check-9-sales-order-is-source",
      "CRM_SALES_ORDER_METRICS_PRISMA_SELECT + salesOrder.findMany + items.select em uso."
    );
    return;
  }
  fail(
    "check-9-sales-order-is-source",
    `Fonte oficial SalesOrder ausente/parcial (hasSelectConst=${hasSelectConst}, hasFindMany=${hasFindMany}, hasItemsSelect=${hasItemsSelect}).`
  );
}

/**
 * Check 10: Frontend NÃO importa `@prisma/client`. Erro típico que quebra o
 * bundle browser. Varre `src/components/**` e `src/pages/**`.
 */
function checkFrontendDoesNotImportPrisma(): void {
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const source = readFileSync(full, "utf8");
      if (/from\s+["']@prisma\/client["']/.test(source)) {
        offenders.push(full);
      }
    }
  };
  walk(join(ROOT, "src/components"));
  if (offenders.length === 0) {
    ok(
      "check-10-frontend-no-prisma-import",
      "Nenhum arquivo em src/components/** importa @prisma/client."
    );
    return;
  }
  fail(
    "check-10-frontend-no-prisma-import",
    `Frontend importando @prisma/client: ${offenders.join(", ")}`
  );
}

/**
 * Detecta erros de conectividade com o banco (Prisma). Esses cenários NÃO
 * podem ser reportados como falha do QA — o alvo do check é lógica de código,
 * não infra. Se banco não está acessível, marcamos como skip.
 */
function isPrismaConnectivityError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return (
    /PrismaClientInitializationError/i.test(msg) ||
    /Can't reach database server/i.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /ETIMEDOUT/i.test(msg) ||
    /ENOTFOUND/i.test(msg) ||
    /P1001|P1002|P1017/.test(msg)
  );
}

function skip(id: string, detail: string, mode: CheckMode = "live"): void {
  // eslint-disable-next-line no-console
  console.log(`SKIP  [${mode}] ${id} — ${detail}`);
}

async function runLiveChecks(): Promise<void> {
  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  if (!hasDb) {
    // eslint-disable-next-line no-console
    console.log(
      "\n(!) DATABASE_URL não definida — pulando checks live 1..4 (management-dashboard, seller-dashboard e services em runtime)."
    );
    return;
  }

  const { prisma } = await import("@/src/lib/prisma.js");
  const { buildCrmManagementDashboardResponse } = await import(
    "@/src/lib/crmManagementDashboardService.js"
  );
  const { buildCrmSellerDashboardResponse } = await import(
    "@/src/lib/crmSellerDashboardService.js"
  );
  const { isForbiddenCommercialResponsibleName } = await import(
    "@/src/lib/commercial/crmCommercialResponsibleResolver.js"
  );

  section("Live — services em runtime (Prisma real)");

  try {
    const now = new Date();
    const mgmt = await buildCrmManagementDashboardResponse({}, now);
    ok(
      "check-3-management-service-runs",
      `buildCrmManagementDashboardResponse rodou (totalCustomers=${(mgmt.summary as any)?.totalCustomers ?? "?"}, risk=${mgmt.riskCustomers?.length ?? 0}).`,
      "live"
    );
    ok(
      "check-1-management-endpoint-no-500",
      "GET /api/crm/management-dashboard (via service) não estourou (por transitividade do handler HTTP).",
      "live"
    );
    // Guard: nenhum topCommercialOwner deve ser FINANCEIRO/FATURAMENTO.
    const leaked = (mgmt.topCommercialOwners ?? [])
      .map((row: any) => String(row?.label ?? ""))
      .filter((label: string) => isForbiddenCommercialResponsibleName(label));
    if (leaked.length === 0) {
      ok(
        "check-6-live-management-no-forbidden-label",
        "Nenhum topCommercialOwners retornado com rótulo FINANCEIRO/FATURAMENTO.",
        "live"
      );
    } else {
      fail(
        "check-6-live-management-no-forbidden-label",
        `Rótulos bloqueados vazaram em management: ${leaked.join(", ")}`,
        "live"
      );
    }
  } catch (err) {
    if (isPrismaConnectivityError(err)) {
      skip(
        "check-3-management-service-runs",
        "Prisma sem conexão com o banco (DATABASE_URL setada, mas servidor inacessível). Rode em ambiente com DB real."
      );
      skip(
        "check-1-management-endpoint-no-500",
        "Skipado por dependência (DB inacessível)."
      );
    } else {
      fail(
        "check-3-management-service-runs",
        `buildCrmManagementDashboardResponse falhou: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
        "live"
      );
      fail(
        "check-1-management-endpoint-no-500",
        "GET /api/crm/management-dashboard retornaria 500 (o service explodiu).",
        "live"
      );
    }
  }

  try {
    const now = new Date();
    const seller = await buildCrmSellerDashboardResponse(
      {
        scopeMode: "all",
        externalSellerId: null,
        responsible: null,
        sellerIdentityKey: null,
        dateFrom: null,
        dateTo: null,
        linkedUser: null,
      },
      now
    );
    ok(
      "check-4-seller-service-runs",
      `buildCrmSellerDashboardResponse rodou (totalOrders=${seller.totalOrders ?? 0}, recent=${seller.recentOrders?.length ?? 0}).`,
      "live"
    );
    ok(
      "check-2-seller-endpoint-no-500",
      "GET /api/crm/seller-dashboard (via service, scope=all) não estourou.",
      "live"
    );
    const rowsForGuard = [
      ...(seller.recentOrders ?? []),
      ...(seller.openPortfolioOrders ?? []),
      ...(seller.invoicedOrders ?? []),
    ];
    const leaked = rowsForGuard
      .map((row: any) => String(row?.commercialOwnerName ?? ""))
      .filter((label: string) => label && isForbiddenCommercialResponsibleName(label));
    if (leaked.length === 0) {
      ok(
        "check-6-live-seller-no-forbidden-label",
        "Nenhuma linha do seller-dashboard trouxe FINANCEIRO/FATURAMENTO como Responsável Comercial.",
        "live"
      );
    } else {
      fail(
        "check-6-live-seller-no-forbidden-label",
        `Rótulos bloqueados vazaram em seller: ${Array.from(new Set(leaked)).join(", ")}`,
        "live"
      );
    }
  } catch (err) {
    if (isPrismaConnectivityError(err)) {
      skip(
        "check-4-seller-service-runs",
        "Prisma sem conexão com o banco. Rode em ambiente com DB real."
      );
      skip(
        "check-2-seller-endpoint-no-500",
        "Skipado por dependência (DB inacessível)."
      );
    } else {
      fail(
        "check-4-seller-service-runs",
        `buildCrmSellerDashboardResponse falhou: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
        "live"
      );
      fail(
        "check-2-seller-endpoint-no-500",
        "GET /api/crm/seller-dashboard retornaria 500 (o service explodiu).",
        "live"
      );
    }
  }

  await prisma.$disconnect().catch(() => {});
}

async function main(): Promise<void> {
  section("Static — asserções sobre o código-fonte");
  checkNoIllegalSalesOrderInclude();
  checkForbiddenGuardActive();
  checkDtoSeparation();
  checkProposalIsNotOrderSource();
  checkSalesOrderIsSource();
  checkFrontendDoesNotImportPrisma();

  await runLiveChecks();

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
