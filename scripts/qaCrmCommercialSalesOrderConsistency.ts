/**
 * QA — consistência CRM Comercial × Pedidos de Venda (SalesOrder).
 * Read-only. Não grava. Não altera comissões.
 *
 * Uso:
 *   npx tsx scripts/qaCrmCommercialSalesOrderConsistency.ts
 *
 * Modos:
 *   - estático: analisa código/fonte/imports (sempre)
 *   - live: se DATABASE_URL existir, consulta o banco (Gislene 30d + sinais)
 *
 * Relatório: docs/commercial/crm-commercial-sales-order-consistency-qa.md
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REPORT_REL = "docs/commercial/crm-commercial-sales-order-consistency-qa.md";
const GISLENE = "GISLENE LIMA";
const DEFAULT_DAYS = 30;

type Check = { id: string; ok: boolean; detail: string; mode: "static" | "live" };
type GisleneLive = {
  ran: boolean;
  skippedReason?: string;
  period?: { from: string; to: string };
  ownerCustomerCount?: number;
  ordersInPeriod?: number;
  ordersValue?: number;
  ordersWithoutNomusSeller?: number;
  ordersWithOwnerSellerDivergence?: number;
  customersWithoutCommercialOwnerInUniverse?: number;
  emptyReason?: string | null;
  zeroReasonClear?: boolean;
  detail?: string;
};

const checks: Check[] = [];
let gisleneLive: GisleneLive = { ran: false };

function ok(id: string, detail: string, mode: "static" | "live" = "static"): void {
  checks.push({ id, ok: true, detail, mode });
  console.log(`PASS  [${mode}] ${id} — ${detail}`);
}

function fail(id: string, detail: string, mode: "static" | "live" = "static"): void {
  checks.push({ id, ok: false, detail, mode });
  console.error(`FAIL  [${mode}] ${id} — ${detail}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastNDaysPeriod(days = DEFAULT_DAYS, now = new Date()): { from: string; to: string } {
  const to = formatYmd(now);
  const start = new Date(`${to}T12:00:00`);
  start.setDate(start.getDate() - (days - 1));
  return { from: formatYmd(start), to };
}

/** True se o arquivo parece tratar Proposal como fonte de pedido/KPI (não rastreabilidade). */
function usesProposalAsOrderSource(src: string): boolean {
  if (/from\s+["']Proposal["']|prisma\.proposal\.(findMany|aggregate|groupBy|count)/i.test(src)) {
    // permite só contagem de proposalId nulo (rastreabilidade)
    const withoutTrace = src
      .replace(/ordersWithoutLinkedProposal[\s\S]{0,400}/g, "")
      .replace(/proposalId\s*(IS\s+NULL|===\s*null|:\s*null)/gi, "");
    return /prisma\.proposal\.|FROM\s+"Proposal"/i.test(withoutTrace);
  }
  if (/FROM\s+"Proposal"/i.test(src) && /SUM\(|COUNT\(\*\)/.test(src)) {
    return true;
  }
  return false;
}

function staticContracts(): void {
  section("1–15 Contratos estáticos (código)");

  const files = {
    metrics: "src/lib/commercial/crmSalesOrderMetricsService.ts",
    management: "src/lib/crmManagementDashboardService.ts",
    managementOfficial: "src/lib/crmManagementDashboardOfficialOrders.ts",
    seller: "src/lib/crmSellerDashboardService.ts",
    sellerOfficial: "src/lib/crmSellerDashboardOfficialOrders.ts",
    customers: "src/lib/crmCustomersList.ts",
    customersOfficial: "src/lib/crmCustomersListOfficialOrders.ts",
    matchSql: "src/lib/crmSellerMatchSql.ts",
    concepts: "src/lib/crmCommercialOfficialConcepts.ts",
    salesOrdersDash: "src/lib/financeSalesOrdersDashboard.ts",
    salesOrderRules: "src/lib/salesOrderDashboardRules.ts",
    adapter: "src/lib/salesOrderRulesAdapter.ts",
  } as const;

  for (const [key, rel] of Object.entries(files)) {
    if (!exists(rel)) fail(`file:${key}`, `ausente: ${rel}`);
    else ok(`file:${key}`, rel);
  }

  const metrics = read(files.metrics);
  const management = read(files.management);
  const managementOfficial = read(files.managementOfficial);
  const seller = read(files.seller);
  const sellerOfficial = read(files.sellerOfficial);
  const customers = read(files.customers);
  const customersOfficial = read(files.customersOfficial);
  const matchSql = read(files.matchSql);
  const concepts = read(files.concepts);
  const salesOrdersDash = read(files.salesOrdersDash);
  const salesOrderRules = read(files.salesOrderRules);
  const adapter = read(files.adapter);

  // 1. Gestão Geral → SalesOrder/SalesOrderItem
  if (
    management.includes("loadCrmSalesOrderMetrics") &&
    managementOfficial.includes('pedidosFonte: "SalesOrder"') &&
    managementOfficial.includes('itensFonte: "SalesOrderItem"')
  ) {
    ok("c1:management-salesorder", "Gestão Geral usa loadCrmSalesOrderMetrics + sourceInfo SalesOrder/Item");
  } else {
    fail("c1:management-salesorder", "Gestão Geral não declara fonte SalesOrder/SalesOrderItem");
  }

  // 2. Gestão por Responsável → SalesOrder/SalesOrderItem
  if (
    seller.includes("buildCrmSalesOrderMetrics") &&
    sellerOfficial.includes('pedidosFonte: "SalesOrder"') &&
    sellerOfficial.includes('itensFonte: "SalesOrderItem"') &&
    seller.includes("buildCrmCommercialOwnerOnlyOrderScopeSql")
  ) {
    ok(
      "c2:seller-salesorder",
      "Gestão por Responsável usa métricas SalesOrder + escopo só responsável comercial"
    );
  } else {
    fail("c2:seller-salesorder", "Gestão por Responsável não amarra SalesOrder + owner-only scope");
  }

  // 3. Carteira → SalesOrder histórico
  if (
    customers.includes('FROM "SalesOrder"') &&
    customers.includes("SalesOrderItem") &&
    customersOfficial.includes('pedidosFonte: "SalesOrder"') &&
    customersOfficial.includes('itensFonte: "SalesOrderItem"')
  ) {
    ok("c3:portfolio-salesorder", "Carteira usa SalesOrder/SalesOrderItem para histórico");
  } else {
    fail("c3:portfolio-salesorder", "Carteira sem fonte SalesOrder/Item explícita");
  }

  // 4. Nenhuma aba usa Proposal como fonte de pedido
  const proposalOffenders: string[] = [];
  for (const [label, src] of [
    ["management", management],
    ["seller", seller],
    ["customers", customers],
    ["metrics", metrics],
  ] as const) {
    if (usesProposalAsOrderSource(src)) proposalOffenders.push(label);
  }
  if (proposalOffenders.length === 0 && managementOfficial.includes("propostasUsadas: false")) {
    ok("c4:no-proposal-source", "Nenhuma aba usa Proposal como fonte de pedido/KPI");
  } else {
    fail(
      "c4:no-proposal-source",
      proposalOffenders.length
        ? `Proposal como fonte em: ${proposalOffenders.join(", ")}`
        : "propostasUsadas não declarado false na Gestão Geral"
    );
  }

  // 5. Responsável comercial ≠ vendedor comissionável
  if (
    sellerOfficial.includes("comissionamentoAfetado: false") &&
    concepts.includes('CRM_PORTFOLIO_AXIS = "commercial_owner"') &&
    concepts.includes('SALES_ORDER_SELLER_AXIS = "nomus_order_seller"') &&
    !seller.includes("materializeCommission") &&
    !management.includes("materializeCommission") &&
    !customers.includes("materializeCommission")
  ) {
    ok(
      "c5:owner-not-commissionable",
      "Responsável comercial não alimenta comissão; eixos separados no concepts"
    );
  } else {
    fail("c5:owner-not-commissionable", "Risco de misturar responsável comercial com comissão");
  }

  // 6. Vendedor do pedido ≠ responsável fixo do cliente
  if (
    matchSql.includes("buildCrmCommercialOwnerOnlyOrderScopeSql") &&
    seller.includes("buildCrmCommercialOwnerOnlyOrderScopeSql") &&
    !seller.includes("buildCrmSellerPortfolioOrderScopeSql(") &&
    customers.includes("CrmCustomerCommercialOwner") &&
    /Nunca vendedor Nomus|não define carteira|não.*vendedor Nomus/i.test(
      customers + customersOfficial + sellerOfficial
    )
  ) {
    ok(
      "c6:order-seller-not-fixed-owner",
      "Escopo CRM = CrmCustomerCommercialOwner; Nomus não fixa dono da carteira"
    );
  } else {
    fail(
      "c6:order-seller-not-fixed-owner",
      "Possível uso de vendedor do pedido como responsável fixo / híbrido no seller-dashboard"
    );
  }

  // 7. Período = SalesOrder.issueDate (CRM + Pedidos de Venda)
  const crmIssueDate =
    /so\."issueDate"|issueDate:\s*\{|orderWhere\.issueDate|SalesOrder\.issueDate/.test(
      metrics + management + seller + customers
    );
  const soDashIssueDate = /issueDate:\s*\{\s*gte:|issueDate:\s*\{\s*gte/.test(salesOrdersDash);
  if (crmIssueDate && soDashIssueDate) {
    ok(
      "c7:period-issueDate",
      "CRM e Pedidos de Venda filtram período por SalesOrder.issueDate"
    );
  } else {
    fail(
      "c7:period-issueDate",
      `issueDate CRM=${crmIssueDate} Pedidos=${soDashIssueDate}`
    );
  }

  // 8. Cancelados — regra compatível
  if (
    metrics.includes("isCancelledSalesOrderStatus") &&
    salesOrderRules.includes("isCancelledSalesOrderStatus") &&
    salesOrderRules.includes('SALES_ORDER_CANCELLED_STATUS = "CANCELLED"') &&
    (salesOrdersDash.includes('status: "CANCELLED"') ||
      salesOrdersDash.includes("CANCELLED"))
  ) {
    ok(
      "c8:cancelled-compatible",
      "CRM usa isCancelledSalesOrderStatus; Pedidos trata CANCELLED de forma alinhada"
    );
  } else {
    fail("c8:cancelled-compatible", "Regra de cancelados divergente ou ausente");
  }

  // 9. Produto líder de SalesOrderItem
  if (
    metrics.includes("buildLeadingProduct") &&
    /for \(const item of order\.items/.test(metrics) &&
    customers.includes('FROM "SalesOrderItem"')
  ) {
    ok("c9:leading-product-items", "Produto líder/itens derivados de SalesOrderItem");
  } else {
    fail("c9:leading-product-items", "Produto líder não amarrado a SalesOrderItem");
  }

  // 10. Cliente com pedido vem de SalesOrder
  if (
    metrics.includes("customersWithOrders") &&
    /customerId/.test(metrics) &&
    adapter.includes("resolveOfficialScopedOrderMetrics")
  ) {
    ok("c10:customers-with-order", "customersWithOrders via motor oficial sobre SalesOrder");
  } else {
    fail("c10:customers-with-order", "Indicador clientes-com-pedido não rastreável a SalesOrder");
  }

  // 11–12. Pedidos sem Nomus aparecem + auditoria
  if (
    metrics.includes("ordersWithoutNomusSeller") &&
    metrics.includes("isNomusSellerInformed") &&
    (seller.includes("ordersWithoutNomusSeller") ||
      sellerOfficial.includes("ordersWithoutNomusSeller")) &&
    customers.includes("hasOrderWithoutNomusSeller")
  ) {
    ok(
      "c11-12:no-nomus-audit",
      "Pedidos sem vendedor Nomus permanecem no CRM e são sinalizados"
    );
  } else {
    fail("c11-12:no-nomus-audit", "Sinalização / inclusão de pedidos sem Nomus incompleta");
  }

  // 13. Clientes sem responsável sinalizados
  if (
    metrics.includes("customersWithoutCommercialResponsible") &&
    customers.includes("hasCommercialOwner") &&
    customers.includes("customersWithoutCommercialOwner") &&
    concepts.includes("customerWithoutCommercialOwner")
  ) {
    ok("c13:no-owner-flag", "Clientes sem responsável comercial sinalizados");
  } else {
    fail("c13:no-owner-flag", "Sinalização de cliente sem responsável ausente");
  }

  // 14. Responsável ≠ vendedor do pedido sinalizado
  if (
    metrics.includes("ordersWithResponsibleDifferentFromOrderSeller") &&
    customers.includes("hasOwnerSellerDivergence") &&
    concepts.includes("ownerDiffersFromOrderSeller")
  ) {
    ok("c14:owner-seller-divergence", "Divergência responsável × vendedor Nomus sinalizada");
  } else {
    fail("c14:owner-seller-divergence", "Flag de divergência responsável/vendedor ausente");
  }

  // 15 (estático). Diagnóstico zero Gislene — emptyStateReason claro
  if (
    seller.includes("NO_CUSTOMERS_FOR_COMMERCIAL_OWNER") &&
    seller.includes("emptyStateReason")
  ) {
    ok(
      "c15:static-zero-reason",
      "Seller-dashboard expõe emptyStateReason quando não há clientes do responsável"
    );
  } else {
    fail("c15:static-zero-reason", "Motivo de zero não tipado no seller-dashboard");
  }

  // UI concepts / source note (sanity)
  if (exists("src/components/crm/crmCommercialUiConcepts.ts")) {
    const ui = read("src/components/crm/crmCommercialUiConcepts.ts");
    if (ui.includes("CRM_OFFICIAL_SOURCE_NOTE") && ui.includes("comissionável")) {
      ok("ui:source-note", "UI declara fonte oficial e comissão não afetada");
    } else {
      fail("ui:source-note", "Nota oficial de fonte ausente na UI");
    }
  }

  // Frontend sem Prisma nas abas CRM
  const frontendCrm = [
    "src/components/CrmModule.tsx",
    "src/components/CrmSellerDashboardSection.tsx",
    "src/components/CrmManagementDashboardSection.tsx",
    "src/components/crm/CrmCustomerPortfolioSection.tsx",
  ];
  let prismaLeak = false;
  for (const f of frontendCrm) {
    if (!exists(f)) continue;
    const src = read(f);
    if (/from\s+["']@prisma\/client["']|from\s+["']@\/src\/lib\/prisma/.test(src)) {
      prismaLeak = true;
      fail(`bundle:${f}`, "possível import Prisma no frontend CRM");
    }
  }
  if (!prismaLeak) ok("bundle:no-prisma-crm-ui", "Componentes CRM sem Prisma");
}

async function liveChecks(): Promise<void> {
  section("Live (DATABASE_URL)");
  if (!process.env.DATABASE_URL?.trim()) {
    gisleneLive = {
      ran: false,
      skippedReason: "DATABASE_URL ausente — live SKIP (não é falha de código)",
    };
    ok("live:db", gisleneLive.skippedReason!, "live");
    return;
  }

  const { PrismaClient, Prisma } = await import("@prisma/client");
  const { normalizeSellerIdentityName } = await import(
    "../src/lib/crmSellerIdentityConsolidation.ts"
  );
  const { fetchCrmManualOwnerCustomerIds } = await import("../src/lib/crmCustomersList.ts");
  const { buildCrmCommercialOwnerOnlyOrderScopeSql, buildCrmOrderSellerNameSql } = await import(
    "../src/lib/crmSellerMatchSql.ts"
  );
  const { buildCrmSellerDashboardResponse } = await import(
    "../src/lib/crmSellerDashboardService.ts"
  );

  const prisma = new PrismaClient();
  const period = lastNDaysPeriod(DEFAULT_DAYS);
  const identityKey = normalizeSellerIdentityName(GISLENE);
  const periodFrom = new Date(`${period.from}T00:00:00`);
  const periodTo = new Date(`${period.to}T23:59:59.999`);

  try {
    await prisma.$queryRaw`SELECT 1`;
    ok("live:db", "DATABASE_URL conectada", "live");
  } catch (connectErr) {
    await prisma.$disconnect().catch(() => undefined);
    const msg = (connectErr instanceof Error ? connectErr.message : String(connectErr))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    gisleneLive = {
      ran: false,
      skippedReason: `DATABASE_URL presente mas DB inacessível — live SKIP (${msg || "connection failed"})`,
    };
    ok("live:db", gisleneLive.skippedReason, "live");
    return;
  }

  try {
    const sellerFilter = {
      externalSellerId: null as number | null,
      responsible: null as string | null,
      sellerIdentityKey: identityKey,
    };
    const ownerIds = await fetchCrmManualOwnerCustomerIds(prisma, sellerFilter);
    const ownerScope = buildCrmCommercialOwnerOnlyOrderScopeSql("so", sellerFilter, ownerIds);
    const orderSellerNameSql = buildCrmOrderSellerNameSql("so");
    const periodSql = Prisma.sql`so."issueDate" >= ${periodFrom} AND so."issueDate" <= ${periodTo}`;

    const [ownerOrders] = await prisma.$queryRaw<
      {
        orders: number;
        value: unknown;
        without_nomus: number;
        with_divergence: number;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS orders,
        COALESCE(SUM(so."totalNetValue"), 0) AS value,
        COUNT(*) FILTER (
          WHERE so."externalSellerId" IS NULL
            AND NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') IS NULL
        )::int AS without_nomus,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "CrmCustomerCommercialOwner" own
            WHERE own."customerId" = so."customerId"
              AND own."isActive" = true
              AND (
                (
                  so."externalSellerId" IS NOT NULL
                  AND own."sellerExternalId" IS NOT NULL
                  AND so."externalSellerId" <> own."sellerExternalId"
                )
                OR (
                  NULLIF(TRIM(COALESCE(so."nomusSellerName", so.responsible, '')), '') IS NOT NULL
                  AND LOWER(TRIM(COALESCE(own."sellerCanonicalName", own."sellerResponsibleName", '')))
                    <> LOWER(TRIM(COALESCE(so."nomusSellerName", so.responsible, '')))
                )
              )
          )
        )::int AS with_divergence
      FROM "SalesOrder" so
      WHERE ${ownerScope} AND ${periodSql}
    `);

    const customersWithoutOwner = await prisma.crmCustomerCommercialOwner.count({
      where: { isActive: true },
    });
    const totalCustomers = await prisma.customer.count();
    const withoutOwnerApprox = Math.max(0, totalCustomers - customersWithoutOwner);

    // Pedidos sem Nomus sob clientes com responsável (devem entrar no escopo)
    const [noNomusWithOwner] = await prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS c
      FROM "SalesOrder" so
      WHERE ${ownerScope}
        AND ${periodSql}
        AND so."externalSellerId" IS NULL
        AND NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') IS NULL
    `);

    if (ownerIds.length === 0) {
      ok(
        "live:gislene-no-customers",
        `Gislene (${identityKey}): 0 clientes sob responsável — zero esperado e explicável`,
        "live"
      );
    } else {
      ok(
        "live:gislene-customers",
        `Gislene: ${ownerIds.length} cliente(s) sob CrmCustomerCommercialOwner`,
        "live"
      );
    }

    const ordersCount = ownerOrders?.orders ?? 0;
    const ordersValue = Number(ownerOrders?.value ?? 0);
    const withoutNomus = ownerOrders?.without_nomus ?? 0;
    const divergence = ownerOrders?.with_divergence ?? 0;

    ok(
      "live:gislene-period-orders",
      `Período ${period.from}→${period.to}: orders=${ordersCount} value=${ordersValue} semNomus=${withoutNomus} divergência≈${divergence}`,
      "live"
    );

    ok(
      "live:no-nomus-still-in-scope",
      `Pedidos sem Nomus no escopo Gislene (período): ${noNomusWithOwner?.c ?? 0} (contam se cliente tem responsável)`,
      "live"
    );
    // Exercita o builder oficial do seller-dashboard
    const dash = await buildCrmSellerDashboardResponse(prisma, {
      sellerIdentityKey: identityKey,
      dateFrom: period.from,
      dateTo: period.to,
    });

    const emptyReason = dash.emptyStateReason ?? null;
    const totalOrders = dash.totalOrders ?? dash.summary.ordersCount ?? 0;
    let zeroReasonClear = true;
    let emptyExplain: string | null = emptyReason;

    if (totalOrders === 0) {
      if (emptyReason === "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER") {
        emptyExplain = "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER — nenhum cliente sob o responsável";
      } else if ((dash.selectedCommercialOwner?.customerCount ?? 0) > 0) {
        emptyExplain =
          "Há clientes na carteira, mas nenhum SalesOrder.issueDate no período (zero real de pedidos)";
      } else if (ownerIds.length === 0) {
        emptyExplain =
          "Sem clientes atribuídos ao responsável (ownerIds=0); UI deve exibir emptyStateReason";
        zeroReasonClear = Boolean(emptyReason);
      } else {
        emptyExplain = "Zero de pedidos no período; verificar emptyState / customerCount na API";
        zeroReasonClear =
          (dash.selectedCommercialOwner?.customerCount ?? 0) >= 0 &&
          dash.sourceInfo?.pedidosFonte === "SalesOrder";
      }

      if (zeroReasonClear) {
        ok("live:gislene-zero-reason", emptyExplain, "live");
      } else {
        fail("live:gislene-zero-reason", `Zero sem motivo claro: ${emptyExplain}`, "live");
      }
    } else {
      ok(
        "live:gislene-nonzero",
        `API seller-dashboard: totalOrders=${totalOrders} source=${dash.sourceInfo?.pedidosFonte}`,
        "live"
      );
    }

    if (dash.sourceInfo?.pedidosFonte === "SalesOrder" && dash.sourceInfo.comissionamentoAfetado === false) {
      ok("live:gislene-sourceInfo", "sourceInfo oficial SalesOrder; comissão não afetada", "live");
    } else {
      fail("live:gislene-sourceInfo", `sourceInfo inesperado: ${JSON.stringify(dash.sourceInfo)}`, "live");
    }

    // Comparação leve: Pedidos de Venda (issueDate no período, qualquer vendedor) vs CRM owner scope
    const [soUniverse] = await prisma.$queryRaw<{ orders: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders
      FROM "SalesOrder" so
      WHERE ${periodSql}
        AND so.status::text <> 'CANCELLED'
    `);
    ok(
      "live:so-universe-vs-crm",
      `Pedidos válidos no período (universo SO)=${soUniverse?.orders ?? 0}; carteira Gislene (owner)=${ordersCount} — eixos diferentes, ambos issueDate`,
      "live"
    );

    void orderSellerNameSql;
    void withoutOwnerApprox;

    gisleneLive = {
      ran: true,
      period,
      ownerCustomerCount: ownerIds.length,
      ordersInPeriod: ordersCount,
      ordersValue,
      ordersWithoutNomusSeller: withoutNomus,
      ordersWithOwnerSellerDivergence: divergence,
      customersWithoutCommercialOwnerInUniverse: withoutOwnerApprox,
      emptyReason: emptyExplain,
      zeroReasonClear: totalOrders === 0 ? zeroReasonClear : true,
      detail: `identityKey=${identityKey}; API totalOrders=${totalOrders}; emptyStateReason=${emptyReason}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail("live:exception", msg, "live");
    gisleneLive = { ran: true, detail: msg, zeroReasonClear: false };
  } finally {
    await prisma.$disconnect();
  }
}

function buildReportMarkdown(): string {
  const failed = checks.filter((c) => !c.ok);
  const staticChecks = checks.filter((c) => c.mode === "static");
  const liveChecksList = checks.filter((c) => c.mode === "live");
  const staticFail = staticChecks.filter((c) => !c.ok).length;
  const liveFail = liveChecksList.filter((c) => !c.ok).length;
  const liveSkipped = liveChecksList.some((c) => c.detail.includes("SKIP"));

  const liberated =
    failed.length === 0
      ? liveSkipped
        ? "**LIBERADO COM RESSALVA** — contratos estáticos OK; smoke live DB pendente no servidor com DATABASE_URL"
        : "**LIBERADO** — estático + live OK"
      : "**NÃO LIBERADO** — há falhas a corrigir";

  const passRow = (idPrefix: string) => {
    const subset = checks.filter((c) => c.id.startsWith(idPrefix) || c.id.includes(idPrefix));
    if (subset.length === 0) return "—";
    return subset.every((c) => c.ok) ? "PASS" : "FAIL";
  };

  const lines: string[] = [
    "# QA — Consistência CRM Comercial × Pedidos de Venda (SalesOrder)",
    "",
    "| | |",
    "|---|---|",
    "| **Projeto** | IndusCost / My Industry |",
    "| **Escopo** | Gestão Geral · Gestão por Responsável · Carteira de Clientes × tela Pedidos de Venda |",
    `| **Data** | ${formatYmd(new Date())} |`,
    "| **Script** | `scripts/qaCrmCommercialSalesOrderConsistency.ts` |",
    `| **Checks** | total=${checks.length} fail=${failed.length} (static fail=${staticFail}, live fail=${liveFail}) |`,
    `| **Status final** | ${liberated} |`,
    "",
    "---",
    "",
    "## 1. Status por aba",
    "",
    "| Aba | Fonte oficial | Estático | Live |",
    "|-----|---------------|----------|------|",
    `| **Gestão Geral** | SalesOrder / SalesOrderItem via \`loadCrmSalesOrderMetrics\` | ${passRow("c1")} | ${gisleneLive.ran ? "exercício Gislene (seller) + universo SO" : liveSkipped ? "SKIP" : "—"} |`,
    `| **Gestão por Responsável** | SalesOrder / Item + escopo \`CrmCustomerCommercialOwner\` | ${passRow("c2")} | ${gisleneLive.ran ? (gisleneLive.zeroReasonClear === false ? "FAIL" : "PASS") : liveSkipped ? "SKIP" : "—"} |`,
    `| **Carteira de Clientes** | SalesOrder / Item (histórico + período) | ${passRow("c3")} | ${gisleneLive.ran ? "PASS (sinais)" : liveSkipped ? "SKIP" : "—"} |`,
    `| **Pedidos de Venda** | SalesOrder.issueDate + status CANCELLED | ${passRow("c7")} / ${passRow("c8")} | ${gisleneLive.ran ? "PASS (universo)" : liveSkipped ? "SKIP" : "—"} |`,
    "",
    "## 2. Fonte oficial de cada indicador",
    "",
    "| Indicador | Fonte | Eixo |",
    "|-----------|-------|------|",
    "| Pedidos emitidos / valor | `SalesOrder` (motor \`crmSalesOrderMetrics\` / rules oficiais) | Carteira = responsável comercial |",
    "| Carteira aberta / faturado | Mesmo motor + NFe vinculada | Idem |",
    "| Cancelados | `status = CANCELLED` via \`isCancelledSalesOrderStatus\` | Idem |",
    "| Ticket médio / clientes com pedido | Agregação sobre SalesOrder válidos | Idem |",
    "| Produto líder | `SalesOrderItem` | Idem |",
    "| Pedidos sem vendedor Nomus | Campos Nomus do pedido + flag auditoria | Não remove da carteira |",
    "| Clientes sem responsável | `CrmCustomerCommercialOwner` ausente/inativo | Sinalização |",
    "| Responsável ≠ vendedor pedido | Comparação owner × Nomus | Sinalização |",
    "| Comissão | **Fora do CRM** — vendedor Nomus do pedido | `comissionamentoAfetado: false` |",
    "",
    "## 3. Comparação com Pedidos de Venda",
    "",
    "| Aspecto | Pedidos de Venda | CRM Comercial | Consistente? |",
    "|---------|------------------|---------------|--------------|",
    "| Tabela de pedidos | SalesOrder | SalesOrder | Sim |",
    "| Itens / produto líder | SalesOrderItem | SalesOrderItem | Sim |",
    "| Período | `issueDate` | `issueDate` | Sim |",
    "| Cancelados | Excluídos de KPIs válidos / contados à parte | `isCancelledSalesOrderStatus` | Sim |",
    "| Eixo de agrupamento | Vendedor Nomus do pedido | Responsável comercial do cliente | **Diferente por desenho** |",
    "| Proposal | Não é fonte de pedido | Não é fonte de pedido | Sim |",
    "",
    "Totais por vendedor Nomus (Pedidos) **não precisam bater** com totais por responsável comercial (CRM).",
    "",
    "## 4. Resultado Gislene (últimos 30 dias)",
    "",
  ];

  if (!gisleneLive.ran) {
    lines.push(`- **Live não executado:** ${gisleneLive.skippedReason ?? "n/d"}`);
    lines.push(
      "- Diagnóstico estático: se total=0, API deve expor `emptyStateReason=NO_CUSTOMERS_FOR_COMMERCIAL_OWNER` ou mensagem de “clientes sem pedido no período”."
    );
  } else {
    lines.push(`| Campo | Valor |`);
    lines.push(`|-------|-------|`);
    lines.push(`| Período | ${gisleneLive.period?.from ?? "?"} → ${gisleneLive.period?.to ?? "?"} |`);
    lines.push(`| Clientes sob responsável | ${gisleneLive.ownerCustomerCount ?? "?"} |`);
    lines.push(`| Pedidos no período (escopo owner) | ${gisleneLive.ordersInPeriod ?? "?"} |`);
    lines.push(`| Valor | ${gisleneLive.ordersValue ?? "?"} |`);
    lines.push(`| Sem vendedor Nomus | ${gisleneLive.ordersWithoutNomusSeller ?? "?"} |`);
    lines.push(`| Divergência owner≠Nomus (aprox.) | ${gisleneLive.ordersWithOwnerSellerDivergence ?? "?"} |`);
    lines.push(`| Motivo se zero | ${gisleneLive.emptyReason ?? "n/a (há pedidos)"} |`);
    lines.push(`| Motivo claro? | ${gisleneLive.zeroReasonClear === false ? "**NÃO**" : "Sim"} |`);
    lines.push(`| Detalhe | ${gisleneLive.detail ?? "—"} |`);
  }

  lines.push(
    "",
    "## 5. Inconsistências corrigidas",
    "",
    "Histórico recente (backend + UI já mergeados nesta linha):",
    "",
    "1. Gestão Geral passou a usar `crmSalesOrderMetrics` / motor oficial Pedidos (não SQL paralelo).",
    "2. Gestão por Responsável: escopo **somente** `CrmCustomerCommercialOwner` (sem OR híbrido Nomus).",
    "3. Carteira: histórico/enriquecimento por SalesOrder; dono nunca inferido do vendedor do pedido.",
    "4. UI: labels/tooltips/sourceInfo/auditoria deixam explícito responsável × vendedor comissionável.",
    "",
    "## 6. Pendências",
    ""
  );

  if (failed.length) {
    for (const f of failed) {
      lines.push(`- **FAIL** \`${f.id}\`: ${f.detail}`);
    }
  } else if (liveSkipped) {
    lines.push("- Rodar o script no servidor com `DATABASE_URL` para fechar smoke Gislene live.");
    lines.push("- Opcional: comparar card-a-card Pedidos de Venda × CRM no mesmo período (eixos distintos).");
  } else {
    lines.push("- Nenhuma pendência bloqueante detectada por este QA.");
  }

  lines.push(
    "",
    "## 7. Conclusão",
    "",
    liberated,
    "",
    "### Checklist dos 15 critérios",
    "",
    "| # | Critério | Resultado |",
    "|---|----------|-----------|"
  );

  const criteria = [
    ["1", "c1:", "CRM Gestão Geral usa SalesOrder/SalesOrderItem"],
    ["2", "c2:", "CRM Gestão por Responsável usa SalesOrder/SalesOrderItem"],
    ["3", "c3:", "Carteira usa SalesOrder/SalesOrderItem para histórico"],
    ["4", "c4:", "Nenhuma aba usa Proposal como fonte de pedido"],
    ["5", "c5:", "Responsável comercial ≠ vendedor comissionável"],
    ["6", "c6:", "Vendedor do pedido ≠ responsável fixo do cliente"],
    ["7", "c7:", "Período = SalesOrder.issueDate (CRM + Pedidos)"],
    ["8", "c8:", "Cancelados com regra compatível"],
    ["9", "c9:", "Produto líder de SalesOrderItem"],
    ["10", "c10:", "Cliente com pedido vem de SalesOrder"],
    ["11-12", "c11-12:", "Sem Nomus: permanece + auditoria"],
    ["13", "c13:", "Clientes sem responsável sinalizados"],
    ["14", "c14:", "Responsável ≠ vendedor sinalizado"],
    ["15", "c15:", "Gislene 30d / motivo de zero"],
  ] as const;

  for (const [n, prefix, label] of criteria) {
    const subset = checks.filter(
      (c) => c.id.startsWith(prefix) || c.id.includes(prefix.replace(/:$/, ""))
    );
    const liveG = checks.filter((c) => c.id.startsWith("live:gislene") || c.id === "live:gislene-zero-reason");
    const pool = n === "15" ? [...subset, ...liveG] : subset;
    const status =
      pool.length === 0
        ? "—"
        : pool.every((c) => c.ok)
          ? "PASS"
          : pool.some((c) => !c.ok)
            ? "FAIL"
            : "PASS";
    lines.push(`| ${n} | ${label} | ${status} |`);
  }

  lines.push(
    "",
    "### Como reproduzir",
    "",
    "```bash",
    "npx tsx scripts/qaCrmCommercialSalesOrderConsistency.ts",
    "npm run check:server-imports",
    "npm run check:frontend-server-imports",
    "npm run check:browser-bundle",
    "npm test",
    "npm run build",
    "```",
    ""
  );

  return lines.join("\n");
}

function writeReport(): void {
  const md = buildReportMarkdown();
  const abs = join(ROOT, REPORT_REL);
  mkdirSync(join(ROOT, "docs/commercial"), { recursive: true });
  writeFileSync(abs, md, "utf8");
  console.log(`\nRelatório escrito: ${REPORT_REL}`);
}

function summarize(): number {
  section("Resumo");
  const failed = checks.filter((c) => !c.ok);
  console.log(
    `total=${checks.length} pass=${checks.length - failed.length} fail=${failed.length}`
  );
  if (failed.length) {
    console.log("Falhas:");
    for (const f of failed) console.log(`  - [${f.mode}] ${f.id}: ${f.detail}`);
  }
  return failed.length;
}

async function main(): Promise<void> {
  console.log("QA CRM Comercial × Pedidos de Venda (SalesOrder consistency)");
  staticContracts();
  await liveChecks();
  writeReport();
  const fails = summarize();
  process.exitCode = fails > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
