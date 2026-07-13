#!/usr/bin/env npx tsx
/**
 * Diagnóstico READ-ONLY: fontes de dados CRM Comercial vs Pedidos de Venda.
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-crm-commercial-data-sources.ts
 *   npx tsx scripts/inspect-crm-commercial-data-sources.ts --days=30 --responsibleName="GISLENE LIMA"
 *   npx tsx scripts/inspect-crm-commercial-data-sources.ts --from=2026-06-13 --to=2026-07-13 --sellerName="GISLENE LIMA"
 *
 * Não altera dados. Não toca comissões/financeiro.
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeSellerIdentityName } from "../src/lib/crmSellerIdentityConsolidation.ts";
import {
  buildCrmCommercialOwnerOnlyOrderScopeSql,
  buildCrmOrderSellerNameSql,
  buildCrmSellerFilterSql,
  buildCrmSellerPortfolioOrderScopeSql,
} from "../src/lib/crmSellerMatchSql.ts";
import { fetchCrmManualOwnerCustomerIds } from "../src/lib/crmCustomersList.ts";
import { crmOrderIsInvoicedSql, CRM_VALID_PURCHASE_STATUS_SQL } from "../src/lib/crmOrderPortfolioSql.ts";

// ─── defaults (sobrescrevíveis por CLI) ─────────────────────────────────────
const DEFAULT_DAYS = 30;
const DEFAULT_RESPONSIBLE_NAME = "GISLENE LIMA";
const DEFAULT_SELLER_NAME = "GISLENE LIMA";
const EXAMPLE_LIMIT = 20;

type CliConfig = {
  from: string;
  to: string;
  days: number;
  responsibleName: string;
  sellerName: string;
};

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim() || null;
  }
  return null;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveCliConfig(): CliConfig {
  const daysRaw = parseArg("days");
  const days = daysRaw ? Number.parseInt(daysRaw, 10) : DEFAULT_DAYS;
  const toArg = parseArg("to");
  const fromArg = parseArg("from");
  const to = toArg && /^\d{4}-\d{2}-\d{2}$/.test(toArg) ? toArg : formatYmd(new Date());
  let from = fromArg && /^\d{4}-\d{2}-\d{2}$/.test(fromArg) ? fromArg : "";
  if (!from) {
    const end = new Date(`${to}T12:00:00`);
    end.setDate(end.getDate() - (Number.isFinite(days) && days > 0 ? days - 1 : DEFAULT_DAYS - 1));
    from = formatYmd(end);
  }
  return {
    from,
    to,
    days: Number.isFinite(days) ? days : DEFAULT_DAYS,
    responsibleName: parseArg("responsibleName") || DEFAULT_RESPONSIBLE_NAME,
    sellerName: parseArg("sellerName") || DEFAULT_SELLER_NAME,
  };
}

function money(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

function codePathWhySellerTabZeros(name: string) {
  return {
    filterUsesOrderSeller: false,
    filterUsesCommercialOwner: true,
    detail:
      "Escopo oficial do seller-dashboard = somente customerId IN (CrmCustomerCommercialOwner ativo do responsável). KPIs via buildCrmSalesOrderMetrics / motor Pedidos. Vendedor Nomus do pedido NÃO define carteira (só auditoria/divergência).",
    nameNormalization: `sellerIdentityKey = normalize("${name}") → "${normalizeSellerIdentityName(name)}"`,
    commonZeroCauses: [
      "Nenhum CrmCustomerCommercialOwner ativo para a identidade (clientes sem responsável comercial atribuído)",
      "Há clientes sob o responsável, mas nenhum SalesOrder.issueDate no período",
      "Filtro ainda apontava só para vendedor Nomus do pedido (bug legado — corrigido: eixo = responsável comercial)",
      "SalesOrder.responsible legado NULL após sync Nomus (só afetava o filtro antigo por vendedor do pedido)",
      "Escopo own sem vínculo AppUser.sellerResponsibleName/externalSellerId alinhado ao responsável comercial",
      "Propostas NÃO alimentam o endpoint (não é causa de zero por Proposal)",
    ],
    frontendDoesNotClearNumbers: "CrmModule seta summary da API; zeros vêm do backend se ordersCount=0",
    permissionsCanBlock: "crm.seller.own sem vínculo → UI bloqueia; crm.seller.all permite filtro",
    apiUsesProposals: false,
    commissionAffected: false,
  };
}

async function main() {
  const cfg = resolveCliConfig();
  const identityKey = normalizeSellerIdentityName(cfg.sellerName || cfg.responsibleName);
  const periodFrom = new Date(`${cfg.from}T00:00:00`);
  const periodTo = new Date(`${cfg.to}T23:59:59.999`);

  const structural = {
    generatedAt: new Date().toISOString(),
    config: { ...cfg, sellerIdentityKey: identityKey },
    concepts: {
      crmAxis: "Responsável Comercial do Cliente (CrmCustomerCommercialOwner) — eixo único da aba Gestão por Vendedor",
      salesOrdersAxis: "Vendedor Nomus do pedido (externalSellerId + nomusSellerName) — auditoria/comissão",
      commissionsAxis: "Vendedor Nomus do pedido — nunca responsável comercial",
      proposalIsOfficialOrderSource: false,
    },
    whySellerTabMayShowZeros: codePathWhySellerTabZeros(cfg.responsibleName),
    dbReachable: false as boolean,
    error: null as string | null,
  };

  if (!process.env.DATABASE_URL?.trim()) {
    structural.error = "DATABASE_URL ausente — diagnóstico de dados não executado; apenas análise estrutural.";
    printAndPersist(structural, null);
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    structural.dbReachable = true;

    const sellerFilter = {
      externalSellerId: null as number | null,
      responsible: null as string | null,
      sellerIdentityKey: identityKey,
    };
    const orderSellerNameSql = buildCrmOrderSellerNameSql("so");
    const orderSellerMatch = buildCrmSellerFilterSql("so", sellerFilter);
    const manualOwnerIds = await fetchCrmManualOwnerCustomerIds(prisma, sellerFilter);
    const hybridLegacyScope = buildCrmSellerPortfolioOrderScopeSql("so", sellerFilter, manualOwnerIds);
    const ownerOnlyScope = buildCrmCommercialOwnerOnlyOrderScopeSql("so", sellerFilter, manualOwnerIds);
    const invoicedSql = crmOrderIsInvoicedSql("so");

    const periodSql = Prisma.sql`so."issueDate" >= ${periodFrom} AND so."issueDate" <= ${periodTo}`;
    const validSql = Prisma.sql`so.status::text NOT IN ('CANCELLED', 'ERROR')`;

    // A) Origem oficial SalesOrder (período)
    const [officialSummary] = await prisma.$queryRaw<
      {
        total_orders: number;
        total_value: unknown;
        cancelled: number;
        without_nomus_seller: number;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(so."totalNetValue"), 0) AS total_value,
        COUNT(*) FILTER (WHERE so.status::text = 'CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (
          WHERE so."externalSellerId" IS NULL
            AND NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') IS NULL
        )::int AS without_nomus_seller
      FROM "SalesOrder" so
      WHERE ${periodSql}
    `);

    const byNomusSeller = await prisma.$queryRaw<
      { seller_name: string | null; external_seller_id: number | null; orders: number; value: unknown }[]
    >(Prisma.sql`
      SELECT
        ${orderSellerNameSql} AS seller_name,
        so."externalSellerId" AS external_seller_id,
        COUNT(*)::int AS orders,
        COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${validSql}
      GROUP BY 1, 2
      ORDER BY orders DESC
      LIMIT 25
    `);

    const byCommercialOwner = await prisma.$queryRaw<
      { owner_name: string | null; owner_key: string | null; orders: number; value: unknown; customers: number }[]
    >(Prisma.sql`
      SELECT
        COALESCE(own."sellerCanonicalName", '(sem responsável comercial ativo)') AS owner_name,
        own."sellerIdentityKey" AS owner_key,
        COUNT(so.id)::int AS orders,
        COALESCE(SUM(so."totalNetValue"), 0) AS value,
        COUNT(DISTINCT so."customerId")::int AS customers
      FROM "SalesOrder" so
      LEFT JOIN "CrmCustomerCommercialOwner" own
        ON own."customerId" = so."customerId" AND own."isActive" = true
      WHERE ${periodSql} AND ${validSql}
      GROUP BY 1, 2
      ORDER BY orders DESC
      LIMIT 25
    `);

    const topCustomers = await prisma.$queryRaw<
      { customer_id: string; customer_name: string; orders: number; value: unknown }[]
    >(Prisma.sql`
      SELECT
        c.id AS customer_id,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        COUNT(so.id)::int AS orders,
        COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${periodSql} AND ${validSql}
      GROUP BY c.id, customer_name
      ORDER BY value DESC
      LIMIT 10
    `);

    const topProducts = await prisma.$queryRaw<
      { product_id: string | null; product_name: string | null; revenue: unknown; qty: unknown }[]
    >(Prisma.sql`
      SELECT
        soi."productId" AS product_id,
        MAX(soi."productNameSnapshot") AS product_name,
        COALESCE(SUM(soi."totalNetValue"), 0) AS revenue,
        COALESCE(SUM(soi.quantity), 0) AS qty
      FROM "SalesOrderItem" soi
      INNER JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
      WHERE ${periodSql} AND ${validSql}
      GROUP BY soi."productId"
      ORDER BY revenue DESC
      LIMIT 10
    `);

    // Pedidos de Venda (mesma origem/período; filtro vendedor Nomus opcional = sellerName)
    const [salesOrdersScreen] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${validSql}
    `);
    const [salesOrdersScreenSeller] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${validSql} AND ${orderSellerMatch}
    `);

    // Gestão Geral: não filtra vendedor; "compra válida" estreita + período issueDate
    const [mgmtGeneralPeriod] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${CRM_VALID_PURCHASE_STATUS_SQL}
    `);
    const [mgmtGeneralOpen] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${CRM_VALID_PURCHASE_STATUS_SQL} AND NOT ${invoicedSql}
    `);

    // B) CRM por responsável comercial (manual ativo)
    const ownerCustomers = await prisma.crmCustomerCommercialOwner.findMany({
      where: {
        isActive: true,
        OR: [
          { sellerIdentityKey: identityKey },
          { sellerCanonicalName: { equals: cfg.responsibleName, mode: "insensitive" } },
          { sellerResponsibleName: { equals: cfg.responsibleName, mode: "insensitive" } },
        ],
      },
      select: {
        customerId: true,
        sellerCanonicalName: true,
        sellerIdentityKey: true,
        sellerExternalId: true,
      },
    });
    const ownerCustomerIds = ownerCustomers.map((r) => r.customerId);

    let crmByOwner = {
      customersUnderOwner: ownerCustomerIds.length,
      ownerRows: ownerCustomers.slice(0, 50),
      ordersInPeriod: 0,
      valueInPeriod: 0,
      openPortfolioOrders: 0,
      openPortfolioValue: 0,
      invoicedOrders: 0,
      invoicedValue: 0,
    };
    if (ownerCustomerIds.length > 0) {
      const idList = Prisma.join(ownerCustomerIds.map((id) => Prisma.sql`${id}::uuid`));
      const [row] = await prisma.$queryRaw<
        {
          orders: number;
          value: unknown;
          open_orders: number;
          open_value: unknown;
          invoiced_orders: number;
          invoiced_value: unknown;
        }[]
      >(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE ${periodSql} AND ${validSql})::int AS orders,
          COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${periodSql} AND ${validSql}), 0) AS value,
          COUNT(*) FILTER (WHERE ${validSql} AND NOT ${invoicedSql})::int AS open_orders,
          COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${validSql} AND NOT ${invoicedSql}), 0) AS open_value,
          COUNT(*) FILTER (WHERE ${periodSql} AND ${validSql} AND ${invoicedSql})::int AS invoiced_orders,
          COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${periodSql} AND ${validSql} AND ${invoicedSql}), 0) AS invoiced_value
        FROM "SalesOrder" so
        WHERE so."customerId" IN (${idList})
      `);
      crmByOwner = {
        ...crmByOwner,
        ordersInPeriod: row?.orders ?? 0,
        valueInPeriod: money(row?.value),
        openPortfolioOrders: row?.open_orders ?? 0,
        openPortfolioValue: money(row?.open_value),
        invoicedOrders: row?.invoiced_orders ?? 0,
        invoicedValue: money(row?.invoiced_value),
      };
    }

    // C) Pedidos por vendedor Nomus (sellerName)
    const [byOrderSeller] = await prisma.$queryRaw<
      {
        orders: number;
        value: unknown;
        cancelled: number;
        invoiced: number;
        invoiced_value: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE ${validSql})::int AS orders,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${validSql}), 0) AS value,
        COUNT(*) FILTER (WHERE so.status::text = 'CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE ${validSql} AND ${invoicedSql})::int AS invoiced,
        COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${validSql} AND ${invoicedSql}), 0) AS invoiced_value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${orderSellerMatch}
    `);

    // Seller-dashboard escopo oficial = só responsável comercial
    const [sellerDashScope] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${validSql} AND ${ownerOnlyScope}
    `);
    const [sellerDashHybridLegacy] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
      FROM "SalesOrder" so
      WHERE ${periodSql} AND ${validSql} AND ${hybridLegacyScope}
    `);

    // Carteira: clientes no union (owner manual ∪ customers with order seller match)
    const customersViaOrders = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT DISTINCT so."customerId" AS id
      FROM "SalesOrder" so
      WHERE so."customerId" IS NOT NULL
        AND so.status::text NOT IN ('CANCELLED', 'ERROR')
        AND ${orderSellerMatch}
    `);
    const portfolioCustomerIds = Array.from(
      new Set([...ownerCustomerIds, ...customersViaOrders.map((r) => r.id).filter(Boolean)])
    );
    let portfolioOrdersInPeriod = { orders: 0, value: 0 };
    if (portfolioCustomerIds.length > 0) {
      const idList = Prisma.join(portfolioCustomerIds.map((id) => Prisma.sql`${id}::uuid`));
      const [row] = await prisma.$queryRaw<{ orders: number; value: unknown }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS orders, COALESCE(SUM(so."totalNetValue"), 0) AS value
        FROM "SalesOrder" so
        WHERE ${periodSql} AND ${validSql} AND so."customerId" IN (${idList})
      `);
      portfolioOrdersInPeriod = { orders: row?.orders ?? 0, value: money(row?.value) };
    }

    // D/E exemplos
    const ownerOnlyOrders =
      ownerCustomerIds.length === 0
        ? []
        : await prisma.$queryRaw<
            {
              id: string;
              order_code: string | null;
              issue_date: Date;
              value: unknown;
              nomus_seller: string | null;
              external_seller_id: number | null;
              customer_name: string;
            }[]
          >(Prisma.sql`
            SELECT
              so.id,
              so."orderCode" AS order_code,
              so."issueDate" AS issue_date,
              so."totalNetValue" AS value,
              ${orderSellerNameSql} AS nomus_seller,
              so."externalSellerId" AS external_seller_id,
              COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name
            FROM "SalesOrder" so
            INNER JOIN "Customer" c ON c.id = so."customerId"
            WHERE ${periodSql} AND ${validSql}
              AND so."customerId" IN (${Prisma.join(ownerCustomerIds.map((id) => Prisma.sql`${id}::uuid`))})
              AND NOT (${orderSellerMatch})
            ORDER BY so."issueDate" DESC
            LIMIT ${EXAMPLE_LIMIT}
          `);

    const orderSellerOtherOwner = await prisma.$queryRaw<
      {
        id: string;
        order_code: string | null;
        issue_date: Date;
        value: unknown;
        nomus_seller: string | null;
        owner_name: string | null;
        customer_name: string;
      }[]
    >(Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        so."issueDate" AS issue_date,
        so."totalNetValue" AS value,
        ${orderSellerNameSql} AS nomus_seller,
        own."sellerCanonicalName" AS owner_name,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      LEFT JOIN "CrmCustomerCommercialOwner" own
        ON own."customerId" = so."customerId" AND own."isActive" = true
      WHERE ${periodSql} AND ${validSql} AND ${orderSellerMatch}
        AND (
          own."sellerIdentityKey" IS NULL
          OR own."sellerIdentityKey" <> ${identityKey}
        )
      ORDER BY so."issueDate" DESC
      LIMIT ${EXAMPLE_LIMIT}
    `);

    const noNomusWithOwner = await prisma.$queryRaw<
      {
        id: string;
        order_code: string | null;
        issue_date: Date;
        value: unknown;
        owner_name: string | null;
        customer_name: string;
      }[]
    >(Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        so."issueDate" AS issue_date,
        so."totalNetValue" AS value,
        own."sellerCanonicalName" AS owner_name,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      INNER JOIN "CrmCustomerCommercialOwner" own
        ON own."customerId" = so."customerId" AND own."isActive" = true
      WHERE ${periodSql} AND ${validSql}
        AND so."externalSellerId" IS NULL
        AND NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') IS NULL
        AND own."sellerIdentityKey" = ${identityKey}
      ORDER BY so."issueDate" DESC
      LIMIT ${EXAMPLE_LIMIT}
    `);

    // Nome bate? amostras de sellers próximos
    const similarSellers = await prisma.$queryRaw<{ name: string | null; id: number | null; n: number }[]>(
      Prisma.sql`
        SELECT ${orderSellerNameSql} AS name, so."externalSellerId" AS id, COUNT(*)::int AS n
        FROM "SalesOrder" so
        WHERE ${periodSql}
          AND (
            ${orderSellerNameSql} ILIKE ${"%" + cfg.sellerName.split(/\s+/)[0] + "%"}
            OR so."responsible" ILIKE ${"%" + cfg.sellerName.split(/\s+/)[0] + "%"}
          )
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT 15
      `
    );

    const legacyResponsibleHits = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "SalesOrder" so
      WHERE ${periodSql}
        AND LOWER(translate(REGEXP_REPLACE(TRIM(COALESCE(so."responsible",'')),'\\s+',' ','g'),
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')) = ${identityKey}
    `);
    const nomusNameHits = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "SalesOrder" so
      WHERE ${periodSql}
        AND LOWER(translate(REGEXP_REPLACE(TRIM(COALESCE(so."nomusSellerName",'')),'\\s+',' ','g'),
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')) = ${identityKey}
    `);

    const gisleneZeroDiagnosis = {
      ...codePathWhySellerTabZeros(cfg.responsibleName),
      live: {
        manualOwnerCustomers: ownerCustomerIds.length,
        ordersByCommercialOwnerInPeriod: crmByOwner.ordersInPeriod,
        ordersByNomusSellerInPeriod: byOrderSeller?.orders ?? 0,
        ordersByOfficialSellerDashboardOwnerScope: sellerDashScope?.orders ?? 0,
        ordersByLegacyHybridScope: sellerDashHybridLegacy?.orders ?? 0,
        hitsOnLegacyResponsibleField: legacyResponsibleHits[0]?.n ?? 0,
        hitsOnNomusSellerNameField: nomusNameHits[0]?.n ?? 0,
        similarSellerNameSamples: similarSellers,
        likelyZeroReason:
          (sellerDashScope?.orders ?? 0) === 0
            ? ownerCustomerIds.length === 0
              ? "Sem CrmCustomerCommercialOwner ativo para a identidade — aba Gestão por Vendedor zera (eixo = responsável comercial)."
              : crmByOwner.ordersInPeriod === 0
                ? "Há clientes sob o responsável, mas nenhum SalesOrder no período (issueDate) — zero por período, não por vendedor Nomus."
                : "Owner scope zerado apesar de crmByOwner>0 — checar SQL/ids."
            : ownerCustomerIds.length > 0 && (byOrderSeller?.orders ?? 0) === 0
              ? "Há pedidos na carteira do responsável, mas quase/nenhum com vendedor Nomus=identidade — antes o filtro Nomus-only zerava; agora a API usa owner-only."
              : "Backend NÃO está zerado no escopo oficial (responsável comercial) neste período — se UI mostra 0, investigar período/frontend/permissão ou deploy antigo.",
      },
    };

    const data = {
      ...structural,
      sections: {
        A_officialSalesOrder: {
          totalOrdersInPeriod: officialSummary?.total_orders ?? 0,
          totalValue: money(officialSummary?.total_value),
          cancelled: officialSummary?.cancelled ?? 0,
          withoutNomusSeller: officialSummary?.without_nomus_seller ?? 0,
          byNomusSeller: byNomusSeller.map((r) => ({
            ...r,
            value: money(r.value),
          })),
          byCommercialOwner: byCommercialOwner.map((r) => ({
            ...r,
            value: money(r.value),
          })),
          topCustomers: topCustomers.map((r) => ({ ...r, value: money(r.value) })),
          topProducts: topProducts.map((r) => ({
            ...r,
            revenue: money(r.revenue),
            qty: money(r.qty),
          })),
        },
        B_crmByCommercialOwner: crmByOwner,
        C_ordersByNomusSeller: {
          orders: byOrderSeller?.orders ?? 0,
          value: money(byOrderSeller?.value),
          cancelled: byOrderSeller?.cancelled ?? 0,
          invoiced: byOrderSeller?.invoiced ?? 0,
          invoicedValue: money(byOrderSeller?.invoiced_value),
        },
        D_difference: {
          ownerOrdersMinusNomusSellerOrders:
            crmByOwner.ordersInPeriod - (byOrderSeller?.orders ?? 0),
          officialSellerDashboardOwnerOrders: sellerDashScope?.orders ?? 0,
          officialSellerDashboardOwnerValue: money(sellerDashScope?.value),
          legacyHybridOrders: sellerDashHybridLegacy?.orders ?? 0,
          legacyHybridValue: money(sellerDashHybridLegacy?.value),
          note:
            "Owner = pedidos dos clientes com responsável comercial. Nomus seller = vendedor do pedido. Oficial seller-dashboard = owner-only. Híbrido legado = owner OR Nomus (não usado mais na API).",
        },
        E_examples: {
          ownerButNotNomusSeller: ownerOnlyOrders.map((r) => ({
            ...r,
            value: money(r.value),
            issue_date: r.issue_date?.toISOString?.() ?? r.issue_date,
          })),
          nomusSellerButOtherOwner: orderSellerOtherOwner.map((r) => ({
            ...r,
            value: money(r.value),
            issue_date: r.issue_date?.toISOString?.() ?? r.issue_date,
          })),
          noNomusSellerButHasCommercialOwner: noNomusWithOwner.map((r) => ({
            ...r,
            value: money(r.value),
            issue_date: r.issue_date?.toISOString?.() ?? r.issue_date,
          })),
        },
        comparisonTable: {
          salesOrdersScreenAllValidInPeriod: {
            orders: salesOrdersScreen?.orders ?? 0,
            value: money(salesOrdersScreen?.value),
          },
          salesOrdersScreenFilteredByNomusSeller: {
            orders: salesOrdersScreenSeller?.orders ?? 0,
            value: money(salesOrdersScreenSeller?.value),
          },
          crmGestaoGeralValidPurchaseStatusesInPeriod: {
            orders: mgmtGeneralPeriod?.orders ?? 0,
            value: money(mgmtGeneralPeriod?.value),
            note: "Status só READY_TO_SEND/SENT_TO_NOMUS — mais estreito que Pedidos.",
          },
          crmGestaoGeralOpenPortfolioAllDates: {
            orders: mgmtGeneralOpen?.orders ?? 0,
            value: money(mgmtGeneralOpen?.value),
          },
          crmGestaoPorVendedorOwnerScope: {
            orders: sellerDashScope?.orders ?? 0,
            value: money(sellerDashScope?.value),
            note: "Escopo oficial: somente clientes do responsável comercial.",
          },
          crmGestaoPorVendedorLegacyHybrid: {
            orders: sellerDashHybridLegacy?.orders ?? 0,
            value: money(sellerDashHybridLegacy?.value),
            note: "Legado (owner OR Nomus) — não usado pela API após correção.",
          },
          crmCarteiraUnionCustomers: {
            customers: portfolioCustomerIds.length,
            ordersOfThoseCustomersInPeriod: portfolioOrdersInPeriod.orders,
            value: portfolioOrdersInPeriod.value,
            note: "Carteira lista clientes; pedidos aqui = todos os pedidos válidos desses clientes no período.",
          },
        },
        gisleneZeroDiagnosis,
      },
    };

    printAndPersist(data, prisma);
  } catch (error) {
    structural.error = error instanceof Error ? error.message : String(error);
    structural.dbReachable = false;
    printAndPersist(structural, prisma);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

function printAndPersist(payload: unknown, _prisma: PrismaClient | null) {
  const text = JSON.stringify(payload, null, 2);
  console.log(text);
  try {
    const outDir = join(process.cwd(), "tmp-audits");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, "crm-commercial-data-sources-last-run.json");
    writeFileSync(outPath, text, "utf8");
    console.error(`[inspect-crm-commercial-data-sources] wrote ${outPath}`);
  } catch (e) {
    console.error("[inspect-crm-commercial-data-sources] não gravou JSON local:", e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
