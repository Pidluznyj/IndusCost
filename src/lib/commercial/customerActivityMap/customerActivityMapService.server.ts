/**
 * Mapa de Atuação — serviço READ-ONLY (Clientes › Indicadores).
 *
 * Consultas em lote, nunca por cliente:
 *  - visão geral:  1 leitura de clientes + 1 `groupBy` de pedidos;
 *  - detalhe:      1 leitura de clientes + 1 `groupBy` só dos clientes devolvidos.
 * As coordenadas são resolvidas aqui, em memória, a partir do dataset local de
 * municípios — nada é geocodificado em runtime nem gravado no cadastro.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  BRAZIL_MUNICIPALITY_ROWS,
  BRAZIL_STATE_ROWS,
} from "./brazilMunicipalities.data.js";
import {
  aggregateCustomerMap,
  buildBrazilGeoIndex,
  CUSTOMER_MAP_EXCLUDED_ORDER_STATUSES,
  CUSTOMER_MAP_NO_OWNER_KEY,
  CUSTOMER_MAP_UNRESOLVED_REASON_LABELS,
  isWithinBounds,
  resolveCustomerMapLocation,
  resolveOrderPeriodStart,
  type BrazilGeoIndex,
  type CustomerMapAggregation,
  type CustomerMapBounds,
  type CustomerMapFilters,
  type CustomerMapPrecision,
} from "./customerActivityMap.js";

let cachedIndex: BrazilGeoIndex | null = null;

/** Índice de municípios — montado uma vez por processo (dado estático). */
export function getBrazilGeoIndex(): BrazilGeoIndex {
  cachedIndex ??= buildBrazilGeoIndex({
    states: BRAZIL_STATE_ROWS,
    municipalities: BRAZIL_MUNICIPALITY_ROWS,
  });
  return cachedIndex;
}

export type CustomerMapOverview = CustomerMapAggregation & {
  semantics: {
    activeRule: string;
    ordersRule: string;
    newCustomersRule: string;
    locationRule: string;
  };
  filters: CustomerMapFilters & {
    /** Responsáveis comerciais oficiais presentes na carteira. */
    owners: Array<{ key: string; name: string; customers: number }>;
  };
  generatedAt: string;
};

export type CustomerMapCustomerDto = {
  id: string;
  companyName: string;
  tradeName: string | null;
  /** Cidade/UF como estão no cadastro. */
  city: string | null;
  state: string | null;
  precision: CustomerMapPrecision;
  lat: number | null;
  lng: number | null;
  reason: string | null;
  status: string;
  ownerName: string | null;
  orderCount: number;
  lastOrderAt: string | null;
};

export type CustomerMapDetail = {
  customers: CustomerMapCustomerDto[];
  /** Quantos atendem ao recorte, antes do teto. */
  total: number;
  truncated: boolean;
};

export type CustomerMapDetailScope =
  | { kind: "bounds"; bounds: CustomerMapBounds }
  | { kind: "city"; ibgeCode: number }
  /** Qualidade cadastral: sem localização ou só com UF. */
  | { kind: "unresolved" };

/** Teto de clientes por resposta de detalhe. */
export const CUSTOMER_MAP_DETAIL_LIMIT = 1500;

const SEMANTICS = {
  activeRule: "Ativo = situação do cadastro do cliente (mesma dos cards Ativos/Inativos).",
  ordersRule: "Pedidos = pedidos de venda válidos (fora cancelados e com erro) no período escolhido.",
  newCustomersRule: "Novos = clientes cadastrados nos últimos 30 dias.",
  locationRule:
    "Posição = centro do município informado no cadastro (cidade + UF). Não é o endereço do cliente.",
} as const;

function customerWhere(filters: CustomerMapFilters): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};
  if (filters.status === "ACTIVE") where.status = "ACTIVE";
  if (filters.status === "INACTIVE") where.status = { not: "ACTIVE" };
  if (filters.ownerKey === CUSTOMER_MAP_NO_OWNER_KEY) {
    where.OR = [
      { CrmCustomerCommercialOwner: { is: null } },
      { CrmCustomerCommercialOwner: { is: { isActive: false } } },
    ];
  } else if (filters.ownerKey) {
    where.CrmCustomerCommercialOwner = {
      is: { isActive: true, sellerIdentityKey: filters.ownerKey },
    };
  }
  return where;
}

export function createCustomerActivityMapService(deps: {
  prisma: PrismaClient;
  now?: () => Date;
  index?: BrazilGeoIndex;
}) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const index = deps.index ?? getBrazilGeoIndex();

  /** Pedidos válidos por cliente, em UMA consulta agregada. */
  async function loadOrderFacts(filters: CustomerMapFilters, customerIds?: string[]) {
    if (customerIds && customerIds.length === 0) {
      return new Map<string, { count: number; lastOrderAt: Date | null }>();
    }
    const since = resolveOrderPeriodStart(filters.orderPeriod, now());
    const groups = await prisma.salesOrder.groupBy({
      by: ["customerId"],
      where: {
        status: { notIn: [...CUSTOMER_MAP_EXCLUDED_ORDER_STATUSES] },
        ...(since ? { issueDate: { gte: since } } : {}),
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      },
      _count: { _all: true },
      _max: { issueDate: true },
    });
    return new Map(
      groups.map((group) => [
        group.customerId,
        { count: group._count._all, lastOrderAt: group._max.issueDate },
      ])
    );
  }

  return {
    async getOverview(filters: CustomerMapFilters): Promise<CustomerMapOverview> {
      const [customers, orderFacts, owners] = await Promise.all([
        prisma.customer.findMany({
          where: customerWhere(filters),
          select: {
            id: true,
            city: true,
            state: true,
            country: true,
            status: true,
            createdAt: true,
          },
        }),
        loadOrderFacts(filters),
        // Opções do filtro de responsável: toda a carteira, não o recorte atual.
        prisma.crmCustomerCommercialOwner.groupBy({
          by: ["sellerIdentityKey", "sellerCanonicalName"],
          where: { isActive: true },
          _count: { _all: true },
        }),
      ]);

      const aggregation = aggregateCustomerMap(
        customers.map((customer) => ({
          ...customer,
          orderCount: orderFacts.get(customer.id)?.count ?? 0,
        })),
        index,
        now()
      );

      return {
        ...aggregation,
        semantics: SEMANTICS,
        filters: {
          ...filters,
          owners: owners
            .map((owner) => ({
              key: owner.sellerIdentityKey,
              name: owner.sellerCanonicalName,
              customers: owner._count._all,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        },
        generatedAt: now().toISOString(),
      };
    },

    /** Clientes individuais de um recorte geográfico — sob demanda. */
    async getDetail(
      filters: CustomerMapFilters,
      scope: CustomerMapDetailScope
    ): Promise<CustomerMapDetail> {
      const customers = await prisma.customer.findMany({
        where: customerWhere(filters),
        orderBy: { companyName: "asc" },
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          city: true,
          state: true,
          country: true,
          status: true,
          CrmCustomerCommercialOwner: {
            select: { isActive: true, sellerCanonicalName: true },
          },
        },
      });

      const matched: Array<{
        customer: (typeof customers)[number];
        location: ReturnType<typeof resolveCustomerMapLocation>;
      }> = [];
      for (const customer of customers) {
        const location = resolveCustomerMapLocation(customer, index);
        const inScope =
          scope.kind === "unresolved"
            ? location.precision !== "CITY"
            : scope.kind === "city"
              ? location.precision === "CITY" && location.ibgeCode === scope.ibgeCode
              : location.precision === "CITY" && isWithinBounds(location, scope.bounds);
        if (inScope) matched.push({ customer, location });
      }

      const page = matched.slice(0, CUSTOMER_MAP_DETAIL_LIMIT);
      const orderFacts = await loadOrderFacts(
        filters,
        page.map((entry) => entry.customer.id)
      );

      return {
        total: matched.length,
        truncated: matched.length > page.length,
        customers: page.map(({ customer, location }) => {
          const facts = orderFacts.get(customer.id);
          const owner = customer.CrmCustomerCommercialOwner;
          return {
            id: customer.id,
            companyName: customer.companyName,
            tradeName: customer.tradeName,
            city: customer.city,
            state: customer.state,
            precision: location.precision,
            lat: location.lat,
            lng: location.lng,
            reason: location.reason
              ? CUSTOMER_MAP_UNRESOLVED_REASON_LABELS[location.reason]
              : null,
            status: customer.status,
            ownerName: owner?.isActive ? owner.sellerCanonicalName : null,
            orderCount: facts?.count ?? 0,
            lastOrderAt: facts?.lastOrderAt ? facts.lastOrderAt.toISOString() : null,
          };
        }),
      };
    },
  };
}

export type CustomerActivityMapService = ReturnType<typeof createCustomerActivityMapService>;
