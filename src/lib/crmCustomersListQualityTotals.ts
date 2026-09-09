/**
 * Totais de qualidade da Carteira de Clientes — contados sobre o UNIVERSO do
 * filtro, nunca sobre a página exibida.
 *
 * Regra de produto: um card apresentado como total do filtro tem que contar o
 * conjunto completo filtrado. Antes desta correção os quatro sub-totais de
 * `CrmCustomersListTotals` eram `customers.filter(...).length` sobre o array já
 * paginado (≤ 50 linhas), então "Clientes sem responsável comercial" mudava de
 * valor conforme o usuário paginava e nunca passava de 50.
 *
 * As definições aqui replicam, em SQL, exatamente os predicados que
 * `enrichCustomersFromSalesOrders` e `ownerDiffersFromOrderSellers`
 * (src/lib/crmCustomersList.ts) aplicam por linha — a paridade linha × total é
 * o que permite a reconciliação entre o card e a tabela.
 */
import { Prisma } from "@prisma/client";

/** Teto de clientes agregados numa chamada. Espelha o teto de 20k já adotado pelo motor de métricas do CRM. */
export const CRM_CUSTOMERS_QUALITY_TOTALS_MAX = 20000;

export type CrmCustomersListQualityTotals = {
  customersWithoutCommercialOwner: number;
  customersWithoutPurchase: number;
  customersWithOrderWithoutNomusSeller: number;
  customersWithOwnerSellerDivergence: number;
};

export const EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS: CrmCustomersListQualityTotals = {
  customersWithoutCommercialOwner: 0,
  customersWithoutPurchase: 0,
  customersWithOrderWithoutNomusSeller: 0,
  customersWithOwnerSellerDivergence: 0,
};

type QualityTotalsRow = {
  without_owner: bigint | number | null;
  without_purchase: bigint | number | null;
  order_without_seller: bigint | number | null;
  divergence: bigint | number | null;
};

type RawQueryRunner = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
};

function toCount(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Pedido que conta como compra oficial do cliente.
 *
 * Mantém o mesmo recorte das demais consultas desta tela
 * (`crmCustomersList.ts`): `CANCELLED` e `ERROR` ficam fora.
 */
function validOrderSql(customerIdExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    so."customerId" = ${customerIdExpr}
    AND so.status::text NOT IN ('CANCELLED', 'ERROR')
  `;
}

/**
 * Nome do vendedor do pedido, normalizado para comparação de identidade.
 * Equivale a `normalizeSellerIdentityName` do lado JS (minúsculas, acentos
 * removidos, espaços colapsados).
 */
function normalizedSellerNameSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    LOWER(
      translate(
        REGEXP_REPLACE(TRIM(COALESCE(${expr}, '')), '\\s+', ' ', 'g'),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )
    )
  `;
}

/**
 * Conta os quatro indicadores de qualidade sobre o conjunto de clientes
 * informado (o universo do filtro, já resolvido pelo mesmo `where` da lista).
 *
 * Não carrega pedidos: os predicados são `EXISTS` por cliente, então o custo é
 * de índice, não de varredura de linhas de pedido.
 */
export async function fetchCrmCustomersListQualityTotals(
  prismaClient: RawQueryRunner,
  customerIds: readonly string[]
): Promise<CrmCustomersListQualityTotals> {
  if (customerIds.length === 0) return { ...EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS };

  const idList = Prisma.join(customerIds.map((id) => Prisma.sql`${id}::uuid`));

  // Chave de identidade do responsável: prioriza `sellerIdentityKey`, cai em
  // `sellerCanonicalName` — a mesma precedência de `ownerDiffersFromOrderSellers`.
  const ownerKeySql = normalizedSellerNameSql(
    Prisma.sql`COALESCE(NULLIF(TRIM(o."sellerIdentityKey"), ''), o."sellerCanonicalName")`
  );
  const orderSellerNameSql = normalizedSellerNameSql(
    Prisma.sql`COALESCE(NULLIF(TRIM(so."nomusSellerName"), ''), NULLIF(TRIM(so."responsible"), ''))`
  );

  const rows = await prismaClient.$queryRaw<QualityTotalsRow[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE NOT f.has_owner)::bigint AS without_owner,
      COUNT(*) FILTER (WHERE NOT f.has_purchase)::bigint AS without_purchase,
      COUNT(*) FILTER (WHERE f.order_without_seller)::bigint AS order_without_seller,
      COUNT(*) FILTER (WHERE f.divergence)::bigint AS divergence
    FROM (
      SELECT
        (o."customerId" IS NOT NULL) AS has_owner,
        EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE ${validOrderSql(Prisma.sql`c."id"`)}
        ) AS has_purchase,
        EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE ${validOrderSql(Prisma.sql`c."id"`)}
            AND so."externalSellerId" IS NULL
        ) AS order_without_seller,
        (
          o."customerId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "SalesOrder" so
            WHERE ${validOrderSql(Prisma.sql`c."id"`)}
          )
          AND (
            (
              o."sellerExternalId" IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM "SalesOrder" so
                WHERE ${validOrderSql(Prisma.sql`c."id"`)}
                  AND so."externalSellerId" IS NOT NULL
                  AND so."externalSellerId" <> o."sellerExternalId"
              )
            )
            OR (
              NULLIF(${ownerKeySql}, '') IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM "SalesOrder" so
                WHERE ${validOrderSql(Prisma.sql`c."id"`)}
                  AND so."externalSellerId" IS NOT NULL
                  AND NULLIF(${orderSellerNameSql}, '') IS NOT NULL
                  AND ${orderSellerNameSql} <> ${ownerKeySql}
              )
            )
          )
        ) AS divergence
      FROM "Customer" c
      LEFT JOIN "CrmCustomerCommercialOwner" o
        ON o."customerId" = c."id" AND o."isActive" = true
      WHERE c."id" IN (${idList})
    ) f
  `);

  const row = rows[0];
  return {
    customersWithoutCommercialOwner: toCount(row?.without_owner),
    customersWithoutPurchase: toCount(row?.without_purchase),
    customersWithOrderWithoutNomusSeller: toCount(row?.order_without_seller),
    customersWithOwnerSellerDivergence: toCount(row?.divergence),
  };
}
