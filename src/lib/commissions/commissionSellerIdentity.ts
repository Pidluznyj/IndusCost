/**
 * Resolução canônica de vendedor para comissões — lógica pura (sem Prisma).
 */
import {
  groupCommissionPersonsByIdentity,
  normalizeCommissionPersonName,
  pickCanonicalCommissionPerson,
  type CommissionPersonIdentityRow,
} from "./commissionPersonIdentity.js";

export type SellerIdentityResolutionStatus =
  | "OK_CANONICAL"
  | "MULTIPLE_EXTERNAL_IDS_SAME_NAME"
  | "MISSING_EXTERNAL_ID"
  | "MULTIPLE_CANONICALS"
  | "UNRESOLVED"
  | "CONFLICT";

export type CommissionPersonAliasRow = {
  id: string;
  commissionedPersonId: string;
  source: string;
  rawSellerId: number | null;
  rawSellerName: string;
  normalizedSellerName: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING" | string;
  confidence: number | null;
};

export type CommissionSellerIdentityInput = {
  rawSellerId?: number | null;
  rawSellerName?: string | null;
  source?: string | null;
};

export type CommissionSellerIdentityResolution = {
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  normalizedSellerName: string | null;
  resolutionStatus: SellerIdentityResolutionStatus;
  resolutionMethod: string | null;
  warnings: string[];
};

export type CommissionSellerIdentityContext = {
  persons: CommissionPersonIdentityRow[];
  aliases: CommissionPersonAliasRow[];
};

export function buildRawSellerKey(
  rawSellerId: number | null | undefined,
  rawSellerName: string | null | undefined
): string {
  if (rawSellerId != null && rawSellerId > 0) return `id:${rawSellerId}`;
  const normalized = normalizeCommissionPersonName(rawSellerName);
  return normalized ? `name:${normalized}` : "unknown";
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

function personsByNomusId(
  ctx: CommissionSellerIdentityContext,
  nomusId: number,
  type = "SELLER"
): CommissionPersonIdentityRow[] {
  return ctx.persons.filter(
    (row) => row.type === type && row.nomusPersonId === nomusId
  );
}

function personsByNormalizedName(
  ctx: CommissionSellerIdentityContext,
  normalized: string,
  type = "SELLER"
): CommissionPersonIdentityRow[] {
  return ctx.persons.filter(
    (row) => row.type === type && normalizeCommissionPersonName(row.name) === normalized
  );
}

function resolveFromPersons(
  matches: CommissionPersonIdentityRow[]
): CommissionSellerIdentityResolution | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    const person = matches[0]!;
    return {
      canonicalSellerId: person.id,
      canonicalSellerName: person.name,
      rawSellerId: person.nomusPersonId,
      rawSellerName: person.name,
      normalizedSellerName: normalizeCommissionPersonName(person.name),
      resolutionStatus: "OK_CANONICAL",
      resolutionMethod: "COMMISSION_PERSON",
      warnings: [],
    };
  }

  const groups = groupCommissionPersonsByIdentity(matches);
  if (groups.length === 1) {
    const canonical = pickCanonicalCommissionPerson(groups[0]!);
    if (!canonical) return null;
    const duplicateIds = groups[0]!
      .filter((row) => row.id !== canonical.id)
      .map((row) => row.id);
    return {
      canonicalSellerId: canonical.id,
      canonicalSellerName: canonical.name,
      rawSellerId: canonical.nomusPersonId,
      rawSellerName: canonical.name,
      normalizedSellerName: normalizeCommissionPersonName(canonical.name),
      resolutionStatus: "MULTIPLE_CANONICALS",
      resolutionMethod: "COMMISSION_PERSON_GROUP",
      warnings:
        duplicateIds.length > 0
          ? [`Múltiplos cadastros internos para o mesmo vendedor: ${duplicateIds.join(", ")}`]
          : [],
    };
  }

  return {
    canonicalSellerId: null,
    canonicalSellerName: null,
    rawSellerId: matches[0]?.nomusPersonId ?? null,
    rawSellerName: matches[0]?.name ?? null,
    normalizedSellerName: normalizeCommissionPersonName(matches[0]?.name),
    resolutionStatus: "CONFLICT",
    resolutionMethod: null,
    warnings: [`Conflito: ${matches.length} cadastros distintos sem consolidação segura`],
  };
}

/** Resolve vendedor bruto para pessoa comissionada canônica. */
export function resolveCommissionSellerIdentity(
  input: CommissionSellerIdentityInput,
  ctx: CommissionSellerIdentityContext
): CommissionSellerIdentityResolution {
  const rawSellerId =
    input.rawSellerId != null && input.rawSellerId > 0 ? input.rawSellerId : null;
  const rawSellerName = input.rawSellerName?.trim() || null;
  const normalizedSellerName = normalizeCommissionPersonName(rawSellerName);
  const source = input.source?.trim() || "OTHER";
  const warnings: string[] = [];

  const base: Omit<
    CommissionSellerIdentityResolution,
    "canonicalSellerId" | "canonicalSellerName" | "resolutionStatus" | "resolutionMethod" | "warnings"
  > = {
    rawSellerId,
    rawSellerName,
    normalizedSellerName: normalizedSellerName || null,
  };

  if (rawSellerId != null) {
    const aliasById = activeAliases(ctx).filter(
      (row) => row.rawSellerId === rawSellerId && (row.source === source || row.source === "OTHER")
    );
    if (aliasById.length === 1) {
      const person = personById(ctx, aliasById[0]!.commissionedPersonId);
      if (person) {
        return {
          ...base,
          canonicalSellerId: person.id,
          canonicalSellerName: person.name,
          resolutionStatus: "OK_CANONICAL",
          resolutionMethod: "ALIAS_RAW_SELLER_ID",
          warnings,
        };
      }
    }
    if (aliasById.length > 1) {
      return {
        ...base,
        canonicalSellerId: null,
        canonicalSellerName: null,
        resolutionStatus: "CONFLICT",
        resolutionMethod: null,
        warnings: [`Múltiplos aliases ativos para rawSellerId ${rawSellerId}`],
      };
    }

    const byNomus = personsByNomusId(ctx, rawSellerId);
    const fromPerson = resolveFromPersons(byNomus);
    if (fromPerson) {
      return { ...fromPerson, rawSellerId, rawSellerName, normalizedSellerName: base.normalizedSellerName };
    }
  }

  if (normalizedSellerName) {
    const aliasByName = activeAliases(ctx).filter(
      (row) => row.normalizedSellerName === normalizedSellerName
    );
    const uniquePersonIds = [...new Set(aliasByName.map((row) => row.commissionedPersonId))];
    if (uniquePersonIds.length === 1) {
      const person = personById(ctx, uniquePersonIds[0]!);
      if (person) {
        if (rawSellerId == null) {
          warnings.push("Resolvido por alias de nome sem rawSellerId");
        }
        return {
          ...base,
          canonicalSellerId: person.id,
          canonicalSellerName: person.name,
          resolutionStatus: rawSellerId == null ? "MISSING_EXTERNAL_ID" : "OK_CANONICAL",
          resolutionMethod: "ALIAS_NORMALIZED_NAME",
          warnings,
        };
      }
    }
    if (uniquePersonIds.length > 1) {
      return {
        ...base,
        canonicalSellerId: null,
        canonicalSellerName: null,
        resolutionStatus: "CONFLICT",
        resolutionMethod: null,
        warnings: ["Aliases de nome apontam para cadastros diferentes"],
      };
    }

    const byName = personsByNormalizedName(ctx, normalizedSellerName);
    const fromPerson = resolveFromPersons(byName);
    if (fromPerson) {
      const status: SellerIdentityResolutionStatus =
        rawSellerId == null
          ? byName.some((row) => row.nomusPersonId != null && row.nomusPersonId > 0)
            ? "MISSING_EXTERNAL_ID"
            : fromPerson.resolutionStatus === "OK_CANONICAL"
              ? "OK_CANONICAL"
              : fromPerson.resolutionStatus
          : fromPerson.resolutionStatus;
      return {
        ...fromPerson,
        rawSellerId,
        rawSellerName,
        normalizedSellerName,
        resolutionStatus: status,
        warnings: [...fromPerson.warnings, ...warnings],
      };
    }
  }

  if (!rawSellerId && !normalizedSellerName) {
    return {
      ...base,
      canonicalSellerId: null,
      canonicalSellerName: null,
      resolutionStatus: "UNRESOLVED",
      resolutionMethod: null,
      warnings: ["Sem rawSellerId e sem nome de vendedor"],
    };
  }

  return {
    ...base,
    canonicalSellerId: null,
    canonicalSellerName: null,
    resolutionStatus: rawSellerId == null ? "MISSING_EXTERNAL_ID" : "UNRESOLVED",
    resolutionMethod: null,
    warnings: ["Vendedor não vinculado a pessoa comissionada"],
  };
}

export type SellerIdentityGroupStatus =
  | "OK_CANONICAL"
  | "MULTIPLE_EXTERNAL_IDS_SAME_NAME"
  | "MISSING_EXTERNAL_ID"
  | "MULTIPLE_CANONICALS"
  | "UNRESOLVED"
  | "CONFLICT";

export type SellerIdentityGroupSummary = {
  normalizedSellerName: string;
  rawSellerNames: string[];
  rawSellerIds: number[];
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  status: SellerIdentityGroupStatus;
  orderCount: number;
  nfeCount: number;
  receivableCount: number;
  recordCount: number;
  baseAmount: number;
  expectedCommission: number;
  releasedCommission: number;
  warnings: string[];
};

export function classifySellerGroupStatus(input: {
  rawSellerIds: number[];
  canonicalSellerId: string | null;
  personIdsSeen: string[];
  hasMissingId: boolean;
  hasConflict: boolean;
}): SellerIdentityGroupStatus {
  if (input.hasConflict) return "CONFLICT";
  if (input.personIdsSeen.length > 1 && !input.canonicalSellerId) return "MULTIPLE_CANONICALS";
  if (input.rawSellerIds.length > 1 && input.canonicalSellerId) {
    return "MULTIPLE_EXTERNAL_IDS_SAME_NAME";
  }
  if (input.hasMissingId && input.canonicalSellerId) return "MISSING_EXTERNAL_ID";
  if (input.canonicalSellerId) return "OK_CANONICAL";
  if (input.hasMissingId) return "MISSING_EXTERNAL_ID";
  return "UNRESOLVED";
}

export function sellerNameMatchesFilter(
  normalizedName: string,
  filter: string | null | undefined
): boolean {
  if (!filter?.trim()) return true;
  const haystack = normalizeCommissionPersonName(normalizedName);
  const needle = normalizeCommissionPersonName(filter);
  if (!needle) return true;
  return haystack.includes(needle) || needle.includes(haystack);
}

/** Mapeia commissionPersonId para o cadastro canônico quando há duplicatas por nome. */
export function resolveCanonicalCommissionPersonId(
  personId: string,
  ctx: CommissionSellerIdentityContext
): string {
  const person = ctx.persons.find((row) => row.id === personId);
  if (!person) return personId;
  const normalized = normalizeCommissionPersonName(person.name);
  const matches = ctx.persons.filter(
    (row) => normalizeCommissionPersonName(row.name) === normalized
  );
  if (matches.length <= 1) return personId;
  const canonical = pickCanonicalCommissionPerson(matches);
  return canonical?.id ?? personId;
}
