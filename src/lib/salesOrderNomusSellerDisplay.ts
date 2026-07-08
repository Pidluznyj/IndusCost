/**
 * Vendedor oficial do Pedido de Venda (Nomus) para listagem Comercial.
 *
 * Fonte: SalesOrder.externalSellerId ← idPessoaVendedor.
 * Nunca usa SalesOrder.responsible, Proposal ou CRM.
 */
import {
  resolveNomusOrderSeller,
  type NomusOrderSellerResolution,
} from "./commissions/commissionNomusOrderSellerResolver.js";
import type { CommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.js";

export type SalesOrderNomusSellerApiStatus =
  | "RESOLVED"
  | "RESOLVED_BY_ALIAS"
  | "SELLER_UNRESOLVED"
  | "NO_SELLER";

export type SalesOrderNomusSellerDto = {
  externalSellerId: number | null;
  name: string | null;
  resolutionStatus: SalesOrderNomusSellerApiStatus;
};

export type SalesOrderNomusSellerInput = {
  externalSellerId?: number | null;
  issueDate?: Date | string | null;
};

function mapApiStatus(resolution: NomusOrderSellerResolution): SalesOrderNomusSellerApiStatus {
  switch (resolution.status) {
    case "RESOLVED_BY_NOMUS_PERSON_ID":
    case "RESOLVED_BY_HISTORICAL_RULE":
      return "RESOLVED";
    case "RESOLVED_BY_ALIAS":
      return "RESOLVED_BY_ALIAS";
    case "SELLER_UNRESOLVED":
      return "SELLER_UNRESOLVED";
    case "NO_SELLER":
    default:
      return "NO_SELLER";
  }
}

/** Rótulo de exibição na coluna Vendedor (UI Comercial). */
export function formatSalesOrderNomusSellerListLabel(
  seller: SalesOrderNomusSellerDto
): string {
  if (seller.resolutionStatus === "NO_SELLER") return "—";
  if (seller.resolutionStatus === "SELLER_UNRESOLVED") {
    const id = seller.externalSellerId;
    return id != null ? `Vendedor Nomus não mapeado: ID ${id}` : "Vendedor Nomus não mapeado";
  }
  return seller.name?.trim() || "—";
}

export function buildSalesOrderNomusSellerDto(
  order: SalesOrderNomusSellerInput,
  ctx: CommissionSellerIdentityContext
): SalesOrderNomusSellerDto {
  const resolution = resolveNomusOrderSeller(
    {
      externalSellerId: order.externalSellerId,
      issueDate: order.issueDate,
    },
    ctx
  );
  const resolutionStatus = mapApiStatus(resolution);
  const externalSellerId =
    resolution.rawSellerId != null && resolution.rawSellerId > 0
      ? resolution.rawSellerId
      : null;

  if (resolutionStatus === "NO_SELLER") {
    return { externalSellerId: null, name: null, resolutionStatus };
  }

  if (resolutionStatus === "SELLER_UNRESOLVED") {
    return {
      externalSellerId,
      name: null,
      resolutionStatus,
    };
  }

  return {
    externalSellerId,
    name: resolution.canonicalSellerName?.trim() || null,
    resolutionStatus,
  };
}

/**
 * IDs Nomus (`externalSellerId`) que casam com o filtro de vendedor
 * (nome de CommissionPerson, alias ativo ou ID numérico).
 */
export function collectExternalSellerIdsMatchingSellerFilter(
  term: string,
  ctx: CommissionSellerIdentityContext
): number[] {
  const raw = term.trim();
  if (!raw) return [];

  const ids = new Set<number>();
  const asNum = Number(raw);
  if (Number.isInteger(asNum) && asNum > 0) {
    ids.add(asNum);
  }

  const needle = raw.toLowerCase();
  for (const person of ctx.persons) {
    if (person.type !== "SELLER" || !person.active) continue;
    if (!person.name.toLowerCase().includes(needle)) continue;
    if (person.nomusPersonId != null && person.nomusPersonId > 0) {
      ids.add(person.nomusPersonId);
    }
  }

  for (const alias of ctx.aliases) {
    if (alias.status !== "ACTIVE" || alias.rawSellerId == null || alias.rawSellerId <= 0) {
      continue;
    }
    const person = ctx.persons.find((row) => row.id === alias.commissionedPersonId);
    const personName = person?.name?.toLowerCase() ?? "";
    const aliasName = alias.rawSellerName?.toLowerCase() ?? "";
    if (personName.includes(needle) || aliasName.includes(needle)) {
      ids.add(alias.rawSellerId);
    }
  }

  return [...ids];
}

/** Trecho Prisma para filtrar pedidos pelo vendedor Nomus (não usa `responsible`). */
export function buildSalesOrderNomusSellerWhereFilter(
  term: string | null | undefined,
  ctx: CommissionSellerIdentityContext
): { externalSellerId: { in: number[] } } | { id: { in: [] } } | null {
  const trimmed = term?.trim() ?? "";
  if (!trimmed) return null;
  const ids = collectExternalSellerIdsMatchingSellerFilter(trimmed, ctx);
  if (ids.length === 0) {
    return { id: { in: [] } };
  }
  return { externalSellerId: { in: ids } };
}
