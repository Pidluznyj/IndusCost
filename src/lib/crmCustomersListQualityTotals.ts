/**
 * Totais de qualidade da Carteira de Clientes — contados sobre o UNIVERSO do
 * filtro, nunca sobre a página exibida.
 *
 * Regra de produto: um card apresentado como total do filtro tem que contar o
 * conjunto completo filtrado. Antes desta correção os sub-totais eram
 * `customers.filter(...).length` sobre o array já paginado (≤ 50 linhas), então
 * "Clientes sem responsável comercial" mudava de valor conforme o usuário
 * paginava e nunca passava de 50.
 *
 * Implementação: `customer.count` sobre o MESMO `where` da página, com
 * predicados relacionais. Não materializa ids, não tem teto e não trunca — o
 * número é exato para qualquer tamanho de universo.
 *
 * Os predicados são todos POSITIVOS ("tem responsável ativo", "tem compra") e
 * o complemento sai por subtração do total. Isso evita `NOT`/`isNot` sobre
 * relação opcional, padrão que já zerou resultado neste projeto
 * (ver a armadilha registrada em docs/finance — `NOT`+`is` vs `isNot`).
 *
 * A divergência responsável × vendedor NÃO mora aqui, de propósito: ela depende
 * de `sellerIdentityKey` já enriquecido em JS e da normalização de nome do JS.
 * Reimplementá-la em SQL produzia divergência sistemática contra a linha da
 * tabela (owners `__ID_ONLY__:N` nunca casam com nome). Ver
 * `fetchCrmOwnerSellerDivergenceCount` em `crmCustomersList.ts`, que reusa a
 * MESMA função que decide a flag por linha.
 *
 * Nomes das chaves são repetidos como literais em `CRM_QUALITY_TOTAL_KEYS`
 * para o gate estático `scripts/qaCrmCommercialSalesOrderConsistency.ts`.
 */
import { Prisma } from "@prisma/client";

/** Status de pedido que não contam como compra oficial nesta tela. */
export const CRM_QUALITY_TOTALS_EXCLUDED_ORDER_STATUSES = ["CANCELLED", "ERROR"] as const;

/** Chaves expostas no payload — referenciadas por auditoria estática. */
export const CRM_QUALITY_TOTAL_KEYS = [
  "customersWithoutCommercialOwner",
  "customersWithoutPurchase",
  "customersWithOrderWithoutNomusSeller",
] as const;

export type CrmCustomersListQualityTotals = {
  customersWithoutCommercialOwner: number;
  customersWithoutPurchase: number;
  customersWithOrderWithoutNomusSeller: number;
};

export const EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS: CrmCustomersListQualityTotals = {
  customersWithoutCommercialOwner: 0,
  customersWithoutPurchase: 0,
  customersWithOrderWithoutNomusSeller: 0,
};

type CustomerCounter = {
  customer: { count: (args: { where: Prisma.CustomerWhereInput }) => Promise<number> };
};

function and(
  base: Prisma.CustomerWhereInput,
  extra: Prisma.CustomerWhereInput
): Prisma.CustomerWhereInput {
  return { AND: [base, extra] };
}

/** Cliente com Responsável Comercial ATIVO — o mesmo critério de `loadManualCommercialOwnersForCustomers`. */
export const CRM_HAS_ACTIVE_OWNER_WHERE: Prisma.CustomerWhereInput = {
  CrmCustomerCommercialOwner: { is: { isActive: true } },
};

/** Cliente com ao menos um pedido que conta como compra. */
export const CRM_HAS_PURCHASE_WHERE: Prisma.CustomerWhereInput = {
  salesOrders: {
    some: { status: { notIn: [...CRM_QUALITY_TOTALS_EXCLUDED_ORDER_STATUSES] } },
  },
};

/** Cliente com ao menos um pedido válido sem vendedor Nomus informado (`externalSellerId` nulo). */
export const CRM_HAS_ORDER_WITHOUT_NOMUS_SELLER_WHERE: Prisma.CustomerWhereInput = {
  salesOrders: {
    some: {
      status: { notIn: [...CRM_QUALITY_TOTALS_EXCLUDED_ORDER_STATUSES] },
      externalSellerId: null,
    },
  },
};

/**
 * Conta os três indicadores de qualidade sobre o universo do filtro.
 *
 * @param where o MESMO `where` que produz a página — é o que garante que o
 *   card e a tabela falem do mesmo conjunto.
 * @param totalCustomersInScope `customer.count({ where })`, já calculado pela
 *   chamada da lista; serve de minuendo dos complementos.
 */
export async function fetchCrmCustomersListQualityTotals(
  prismaClient: CustomerCounter,
  where: Prisma.CustomerWhereInput,
  totalCustomersInScope: number
): Promise<CrmCustomersListQualityTotals> {
  if (totalCustomersInScope <= 0) return { ...EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS };

  const [withOwner, withPurchase, withOrderWithoutNomusSeller] = await Promise.all([
    prismaClient.customer.count({ where: and(where, CRM_HAS_ACTIVE_OWNER_WHERE) }),
    prismaClient.customer.count({ where: and(where, CRM_HAS_PURCHASE_WHERE) }),
    prismaClient.customer.count({
      where: and(where, CRM_HAS_ORDER_WITHOUT_NOMUS_SELLER_WHERE),
    }),
  ]);

  return {
    customersWithoutCommercialOwner: Math.max(0, totalCustomersInScope - withOwner),
    customersWithoutPurchase: Math.max(0, totalCustomersInScope - withPurchase),
    customersWithOrderWithoutNomusSeller: withOrderWithoutNomusSeller,
  };
}

export type CrmOrderSellerPairRow = {
  customer_id: string;
  external_seller_id: number | null;
  nomus_seller_name: string | null;
  responsible: string | null;
};

type RawQueryRunner = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
};

/**
 * Pares distintos (cliente, vendedor do pedido) — só de pedidos válidos com
 * vendedor Nomus informado, a mesma condição que
 * `enrichCustomersFromSalesOrders` usa para popular `orderSeller*`.
 *
 * `DISTINCT` mantém o volume no número de combinações cliente×vendedor, não no
 * número de pedidos. O universo entra como um único parâmetro array
 * (`= ANY($1::uuid[])`), não como lista literal de binds.
 */
export async function fetchCrmOrderSellerPairs(
  prismaClient: RawQueryRunner,
  customerIds: readonly string[]
): Promise<CrmOrderSellerPairRow[]> {
  if (customerIds.length === 0) return [];
  return prismaClient.$queryRaw<CrmOrderSellerPairRow[]>(Prisma.sql`
    SELECT DISTINCT
      so."customerId" AS customer_id,
      so."externalSellerId" AS external_seller_id,
      so."nomusSellerName" AS nomus_seller_name,
      so."responsible" AS responsible
    FROM "SalesOrder" so
    WHERE so."customerId" = ANY(${[...customerIds]}::uuid[])
      AND so.status::text NOT IN ('CANCELLED', 'ERROR')
      AND so."externalSellerId" IS NOT NULL
  `);
}
