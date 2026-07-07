/**
 * Resolvedor canônico de vendedor Nomus para pedidos — comissões, gestão e auditorias.
 *
 * Ordem obrigatória:
 * 1. externalSellerId → CommissionPerson.nomusPersonId (SELLER ativo)
 * 2. externalSellerId → CommissionPersonAlias.rawSellerId (ACTIVE) → pessoa ativa
 * 3. Regra histórica: issueDate anterior a 2026-02-01 → GISLENE LIMA (nomusPersonId 464)
 * 4. SELLER_UNRESOLVED
 * 5. NO_SELLER (sem externalSellerId)
 *
 * Nunca usa SalesOrder.responsible, Proposal ou nomusSellerName vazio como ausência de vendedor.
 */
import type { CommissionPersonIdentityRow } from "./commissionPersonIdentity.js";
import { normalizeCommissionPersonName } from "./commissionPersonIdentity.js";
import type {
  CommissionPersonAliasRow,
  CommissionSellerIdentityContext,
  CommissionSellerIdentityResolution,
} from "./commissionSellerIdentity.js";

export type NomusOrderSellerResolutionStatus =
  | "RESOLVED_BY_NOMUS_PERSON_ID"
  | "RESOLVED_BY_ALIAS"
  | "RESOLVED_BY_HISTORICAL_RULE"
  | "SELLER_UNRESOLVED"
  | "NO_SELLER";

export type NomusOrderSellerResolution = {
  status: NomusOrderSellerResolutionStatus;
  rawSellerId: number | null;
  canonicalCommissionPersonId: string | null;
  canonicalSellerName: string | null;
  evidence: string;
  warnings: string[];
};

export const COMMISSION_HISTORICAL_SELLER_CUTOFF_DATE = new Date(2026, 1, 1);
export const COMMISSION_HISTORICAL_SELLER_NOMUS_PERSON_ID = 464;
export const COMMISSION_HISTORICAL_SELLER_WARNING =
  "Regra histórica: pedidos anteriores a 02/2026 atribuídos a GISLENE LIMA (nomusPersonId 464)";

export type NomusOrderSellerInput = {
  externalSellerId?: number | null;
  issueDate?: Date | string | null;
  /** Somente informativo — não usado para resolução nem para NO_SELLER. */
  nomusSellerName?: string | null;
  /** Legado CRM — somente auditoria; nunca fonte de comissão. */
  legacyResponsible?: string | null;
  aliasSource?: string | null;
};

function parseIssueDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isBeforeHistoricalCutoff(issueDate: Date | string | null | undefined): boolean {
  const parsed = parseIssueDate(issueDate);
  if (!parsed) return false;
  return parsed.getTime() < COMMISSION_HISTORICAL_SELLER_CUTOFF_DATE.getTime();
}

function activeSellerPersons(
  ctx: CommissionSellerIdentityContext
): CommissionPersonIdentityRow[] {
  return ctx.persons.filter((row) => row.type === "SELLER" && row.active);
}

function activeAliases(ctx: CommissionSellerIdentityContext): CommissionPersonAliasRow[] {
  return ctx.aliases.filter((row) => row.status === "ACTIVE");
}

function personById(
  ctx: CommissionSellerIdentityContext,
  id: string
): CommissionPersonIdentityRow | null {
  return ctx.persons.find((row) => row.id === id) ?? null;
}

function resolveActivePersonByNomusId(
  ctx: CommissionSellerIdentityContext,
  nomusPersonId: number
): CommissionPersonIdentityRow | null {
  const matches = activeSellerPersons(ctx).filter((row) => row.nomusPersonId === nomusPersonId);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    return matches.sort((a, b) => (b.linkedRecordCount ?? 0) - (a.linkedRecordCount ?? 0))[0]!;
  }
  return null;
}

function resolveHistoricalGislenePerson(
  ctx: CommissionSellerIdentityContext
): CommissionPersonIdentityRow | null {
  return resolveActivePersonByNomusId(ctx, COMMISSION_HISTORICAL_SELLER_NOMUS_PERSON_ID);
}

function buildLegacyResponsibleWarning(legacyResponsible: string | null | undefined): string[] {
  const legacy = legacyResponsible?.trim();
  if (!legacy) return [];
  return [`Campo legado SalesOrder.responsible="${legacy}" — não confiável para comissão`];
}

/** Resolvedor único de vendedor Nomus para pedido. */
export function resolveNomusOrderSeller(
  input: NomusOrderSellerInput,
  ctx: CommissionSellerIdentityContext
): NomusOrderSellerResolution {
  const rawSellerId =
    input.externalSellerId != null && input.externalSellerId > 0
      ? input.externalSellerId
      : null;
  const legacyWarnings = buildLegacyResponsibleWarning(input.legacyResponsible);
  const aliasSource = input.aliasSource?.trim() || "NOMUS_ORDER";

  if (rawSellerId == null) {
    return {
      status: "NO_SELLER",
      rawSellerId: null,
      canonicalCommissionPersonId: null,
      canonicalSellerName: null,
      evidence: "NO_EXTERNAL_SELLER_ID",
      warnings: legacyWarnings,
    };
  }

  const byNomus = resolveActivePersonByNomusId(ctx, rawSellerId);
  if (byNomus) {
    return {
      status: "RESOLVED_BY_NOMUS_PERSON_ID",
      rawSellerId,
      canonicalCommissionPersonId: byNomus.id,
      canonicalSellerName: byNomus.name,
      evidence: `CommissionPerson.nomusPersonId=${rawSellerId}`,
      warnings: legacyWarnings,
    };
  }

  const aliasMatches = activeAliases(ctx).filter(
    (row) =>
      row.rawSellerId === rawSellerId &&
      (row.source === aliasSource || row.source === "OTHER" || row.source === "NOMUS_ORDER")
  );
  const uniqueAliasPersonIds = [
    ...new Set(aliasMatches.map((row) => row.commissionedPersonId)),
  ];
  if (uniqueAliasPersonIds.length === 1) {
    const person = personById(ctx, uniqueAliasPersonIds[0]!);
    if (person?.active && person.type === "SELLER") {
      return {
        status: "RESOLVED_BY_ALIAS",
        rawSellerId,
        canonicalCommissionPersonId: person.id,
        canonicalSellerName: person.name,
        evidence: `CommissionPersonAlias.rawSellerId=${rawSellerId}`,
        warnings: legacyWarnings,
      };
    }
  }
  if (uniqueAliasPersonIds.length > 1) {
    return {
      status: "SELLER_UNRESOLVED",
      rawSellerId,
      canonicalCommissionPersonId: null,
      canonicalSellerName: null,
      evidence: `MULTIPLE_ACTIVE_ALIASES_FOR_${rawSellerId}`,
      warnings: [
        ...legacyWarnings,
        `Múltiplos aliases ativos para rawSellerId ${rawSellerId}`,
      ],
    };
  }

  if (isBeforeHistoricalCutoff(input.issueDate)) {
    const gislene = resolveHistoricalGislenePerson(ctx);
    if (gislene) {
      return {
        status: "RESOLVED_BY_HISTORICAL_RULE",
        rawSellerId,
        canonicalCommissionPersonId: gislene.id,
        canonicalSellerName: gislene.name,
        evidence: `HISTORICAL_RULE_BEFORE_2026-02-01:nomusPersonId=${COMMISSION_HISTORICAL_SELLER_NOMUS_PERSON_ID}`,
        warnings: [...legacyWarnings, COMMISSION_HISTORICAL_SELLER_WARNING],
      };
    }
  }

  return {
    status: "SELLER_UNRESOLVED",
    rawSellerId,
    canonicalCommissionPersonId: null,
    canonicalSellerName: null,
    evidence: `UNMAPPED_NOMUS_SELLER_ID_${rawSellerId}`,
    warnings: [
      ...legacyWarnings,
      `Vendedor Nomus ID ${rawSellerId} não mapeado em CommissionPerson ativo`,
    ],
  };
}

export function isNomusOrderSellerResolved(
  resolution: NomusOrderSellerResolution
): boolean {
  return (
    resolution.canonicalCommissionPersonId != null &&
    resolution.status !== "SELLER_UNRESOLVED" &&
    resolution.status !== "NO_SELLER"
  );
}

/** Compatibilidade com motor de comissão legado (CommissionSellerIdentityResolution). */
export function nomusOrderSellerToIdentityResolution(
  resolution: NomusOrderSellerResolution,
  rawSellerName?: string | null
): CommissionSellerIdentityResolution {
  const name = rawSellerName?.trim() || resolution.canonicalSellerName;
  const resolved = isNomusOrderSellerResolved(resolution);
  const methodMap: Record<NomusOrderSellerResolutionStatus, string | null> = {
    RESOLVED_BY_NOMUS_PERSON_ID: "COMMISSION_PERSON_NOMUS_ID",
    RESOLVED_BY_ALIAS: "ALIAS_RAW_SELLER_ID",
    RESOLVED_BY_HISTORICAL_RULE: "HISTORICAL_RULE_PRE_2026_02",
    SELLER_UNRESOLVED: null,
    NO_SELLER: null,
  };

  return {
    canonicalSellerId: resolution.canonicalCommissionPersonId,
    canonicalSellerName: resolution.canonicalSellerName,
    rawSellerId: resolution.rawSellerId,
    rawSellerName: name,
    normalizedSellerName: normalizeCommissionPersonName(name),
    resolutionStatus: resolved
      ? "OK_CANONICAL"
      : resolution.status === "NO_SELLER"
        ? "UNRESOLVED"
        : "UNRESOLVED",
    resolutionMethod: methodMap[resolution.status],
    warnings: resolution.warnings,
  };
}

export function resolveOrderCommissionSeller(input: {
  externalSellerId?: number | null;
  issueDate?: Date | string | null;
  nomusSellerName?: string | null;
  legacyResponsible?: string | null;
  aliasSource?: string | null;
  identityCtx: CommissionSellerIdentityContext;
}): {
  nomus: NomusOrderSellerResolution;
  identity: CommissionSellerIdentityResolution;
} {
  const nomus = resolveNomusOrderSeller(
    {
      externalSellerId: input.externalSellerId,
      issueDate: input.issueDate,
      nomusSellerName: input.nomusSellerName,
      legacyResponsible: input.legacyResponsible,
      aliasSource: input.aliasSource,
    },
    input.identityCtx
  );
  return {
    nomus,
    identity: nomusOrderSellerToIdentityResolution(nomus, input.nomusSellerName),
  };
}

export type NomusOrderSellerResolutionCounts = {
  total: number;
  withExternalSellerId: number;
  resolvedByNomusPersonId: number;
  resolvedByAlias: number;
  resolvedByHistoricalRule: number;
  sellerUnresolved: number;
  noSeller: number;
};

/** Contagem agregada para auditoria SQL/teste equivalente. */
export function countNomusOrderSellerResolutions(
  orders: Array<{
    externalSellerId?: number | null;
    issueDate?: Date | string | null;
    legacyResponsible?: string | null;
  }>,
  ctx: CommissionSellerIdentityContext
): NomusOrderSellerResolutionCounts {
  const counts: NomusOrderSellerResolutionCounts = {
    total: orders.length,
    withExternalSellerId: 0,
    resolvedByNomusPersonId: 0,
    resolvedByAlias: 0,
    resolvedByHistoricalRule: 0,
    sellerUnresolved: 0,
    noSeller: 0,
  };

  for (const order of orders) {
    const resolution = resolveNomusOrderSeller(order, ctx);
    if (resolution.rawSellerId != null) counts.withExternalSellerId += 1;
    switch (resolution.status) {
      case "RESOLVED_BY_NOMUS_PERSON_ID":
        counts.resolvedByNomusPersonId += 1;
        break;
      case "RESOLVED_BY_ALIAS":
        counts.resolvedByAlias += 1;
        break;
      case "RESOLVED_BY_HISTORICAL_RULE":
        counts.resolvedByHistoricalRule += 1;
        break;
      case "SELLER_UNRESOLVED":
        counts.sellerUnresolved += 1;
        break;
      case "NO_SELLER":
        counts.noSeller += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

export function formatNomusOrderSellerDisplayName(
  resolution: NomusOrderSellerResolution
): string {
  switch (resolution.status) {
    case "RESOLVED_BY_NOMUS_PERSON_ID":
    case "RESOLVED_BY_ALIAS":
    case "RESOLVED_BY_HISTORICAL_RULE":
      return resolution.canonicalSellerName ?? "—";
    case "SELLER_UNRESOLVED":
      return `Vendedor Nomus ID ${resolution.rawSellerId} não mapeado`;
    case "NO_SELLER":
      return "Vendedor não informado no Nomus";
    default:
      return "—";
  }
}

export function formatNomusOrderSellerStatusLabel(
  resolution: NomusOrderSellerResolution
): string {
  switch (resolution.status) {
    case "RESOLVED_BY_NOMUS_PERSON_ID":
    case "RESOLVED_BY_ALIAS":
      return "Vendedor resolvido";
    case "RESOLVED_BY_HISTORICAL_RULE":
      return "Regra histórica anterior a 02/2026";
    case "SELLER_UNRESOLVED":
      return `Vendedor Nomus ID ${resolution.rawSellerId} não mapeado`;
    case "NO_SELLER":
      return "Vendedor não informado no Nomus";
    default:
      return "—";
  }
}

export function isNomusOrderSellerHistoricalRule(
  resolution: NomusOrderSellerResolution
): boolean {
  return resolution.status === "RESOLVED_BY_HISTORICAL_RULE";
}
