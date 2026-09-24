/**
 * Responsável comercial do cliente — camada local manual com prioridade sobre inferência Nomus.
 */
import { Prisma } from "@prisma/client";
import type { CrmCustomerCommercialOwner } from "@prisma/client";
import {
  hasPermission,
  type AppAuthContext,
} from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { writeCommercialAuditLog } from "@/src/lib/commercialAuditLog.js";
import {
  fetchAdminSellerOptionsFromDb,
  formatAdminSellerOptionSublabel,
} from "@/src/lib/adminSellerOptions.js";
import {
  buildAdminSellerOptionKey,
  type AdminSellerOption,
} from "@/src/lib/adminSellerOptionsTypes.js";
import {
  ORDER_SELLER_UNMAPPED_LABEL,
  cleanExecutiveCommercialName,
  resolveCommercialOwnerDisplay,
} from "@/src/lib/commercial/commercialPersonIdentityResolver.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { CUSTOMER_LIST_OWNER_NONE } from "@/src/lib/customerListQuery.js";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import type {
  ActiveCommercialSellerOption,
  CommercialOwnerAuditEntry,
  CustomerCommercialOwnerPayload,
  ResolvedCustomerCommercialOwner,
} from "@/src/lib/crmCustomerCommercialOwnerTypes.js";

export const CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY = "CrmCustomerCommercialOwner";
export const CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION = "crm.customers.assign_seller";

export function canAssignCustomerCommercialOwner(
  auth: Pick<AppAuthContext, "role" | "permissions" | "effectivePermissions">
): boolean {
  if (auth.role === "SUPER_ADMIN" || auth.role === "ADMIN") return true;
  return hasPermission(auth, CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION);
}

export function parseSellerAliasExternalIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((v) => (typeof v === "number" ? v : Number.parseInt(String(v), 10)))
        .filter((n) => Number.isFinite(n))
    ),
  ].sort((a, b) => a - b);
}

export function manualOwnerRowToResolved(
  row: CrmCustomerCommercialOwner
): ResolvedCustomerCommercialOwner {
  const aliasIds = parseSellerAliasExternalIds(row.sellerAliasExternalIds);
  const display = resolveCommercialOwnerDisplay({
    rawId: row.sellerExternalId,
    rawName: row.sellerResponsibleName,
    canonicalName: row.sellerCanonicalName,
    source: row.assignmentSource ?? "CRM",
  });
  const executiveName =
    cleanExecutiveCommercialName(display.canonicalName) ||
    cleanExecutiveCommercialName(display.rawName) ||
    (display.displayName === ORDER_SELLER_UNMAPPED_LABEL
      ? ORDER_SELLER_UNMAPPED_LABEL
      : cleanExecutiveCommercialName(display.displayName));
  return {
    source: "MANUAL",
    sellerCanonicalName: executiveName,
    sellerResponsibleName: cleanExecutiveCommercialName(row.sellerResponsibleName),
    sellerExternalId: row.sellerExternalId,
    sellerIdentityKey: row.sellerIdentityKey,
    sellerAliasExternalIds: aliasIds.length > 0 ? aliasIds : row.sellerExternalId != null ? [row.sellerExternalId] : [],
    confidence: row.sellerExternalId != null ? "HIGH" : "MEDIUM",
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

export async function inferCommercialOwnerFromNomusOrders(
  customerId: string
): Promise<ResolvedCustomerCommercialOwner | null> {
  const rows = await prisma.$queryRaw<
    { external_seller_id: number | null; responsible: string | null; orders_count: number }[]
  >(Prisma.sql`
    SELECT
      so."externalSellerId" AS external_seller_id,
      NULLIF(
        TRIM(COALESCE(NULLIF(TRIM(so."nomusSellerName"), ''), NULLIF(TRIM(so."responsible"), ''))),
        ''
      ) AS responsible,
      COUNT(*)::int AS orders_count
    FROM "SalesOrder" so
    WHERE so."customerId" = ${customerId}::uuid
      AND so.status::text NOT IN ('CANCELLED', 'ERROR')
      AND (
        so."externalSellerId" IS NOT NULL
        OR (so."nomusSellerName" IS NOT NULL AND TRIM(so."nomusSellerName") <> '')
        OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
      )
    GROUP BY so."externalSellerId",
      NULLIF(
        TRIM(COALESCE(NULLIF(TRIM(so."nomusSellerName"), ''), NULLIF(TRIM(so."responsible"), ''))),
        ''
      )
    ORDER BY orders_count DESC, external_seller_id ASC NULLS LAST
    LIMIT 1
  `);

  const top = rows[0];
  if (!top) return null;

  const responsible = cleanExecutiveCommercialName(top.responsible);
  const canonicalName =
    responsible ||
    (top.external_seller_id != null ? ORDER_SELLER_UNMAPPED_LABEL : null);
  if (!canonicalName) return null;

  const sellerIdentityKey = responsible
    ? normalizeSellerIdentityName(responsible)
    : top.external_seller_id != null
      ? `__ID_ONLY__:${top.external_seller_id}`
      : null;

  const allIds = top.external_seller_id != null ? [top.external_seller_id] : [];

  return {
    source: "NOMUS_INFERRED",
    sellerCanonicalName: canonicalName,
    sellerResponsibleName: responsible,
    sellerExternalId: top.external_seller_id,
    sellerIdentityKey,
    sellerAliasExternalIds: allIds,
    confidence: top.external_seller_id != null ? "HIGH" : "MEDIUM",
    updatedAt: null,
    updatedByName: null,
  };
}

export function resolveCustomerCommercialOwner(
  manual: ResolvedCustomerCommercialOwner | null,
  inferred: ResolvedCustomerCommercialOwner | null
): ResolvedCustomerCommercialOwner {
  if (manual) return manual;
  if (inferred) return inferred;
  return {
    source: "NONE",
    sellerCanonicalName: null,
    sellerResponsibleName: null,
    sellerExternalId: null,
    sellerIdentityKey: null,
    sellerAliasExternalIds: [],
    confidence: null,
    updatedAt: null,
    updatedByName: null,
  };
}

export function formatCommercialOwnerLabel(owner: ResolvedCustomerCommercialOwner | null): string {
  const display = resolveCommercialOwnerDisplay({
    rawId: owner?.sellerExternalId,
    rawName: owner?.sellerResponsibleName,
    canonicalName: owner?.sellerCanonicalName,
    source: owner?.source,
  });
  if (display.source === "NONE") return "Sem responsável";
  const ids =
    owner && owner.sellerAliasExternalIds.length > 0
      ? ` (IDs Nomus ${owner.sellerAliasExternalIds.join(", ")})`
      : owner?.sellerExternalId != null
        ? ` (ID Nomus ${owner.sellerExternalId})`
        : "";
  return `${display.displayName}${ids}`;
}

export function manualCommercialOwnerMatchesSellerScope(
  owner: {
    sellerIdentityKey: string | null;
    sellerExternalId: number | null;
    sellerAliasExternalIds: number[];
    sellerResponsibleName?: string | null;
  },
  scope: Pick<CrmCommercialAccessScope, "externalSellerId" | "responsible" | "sellerIdentityKey">
): boolean {
  if (scope.sellerIdentityKey?.trim() && owner.sellerIdentityKey) {
    return owner.sellerIdentityKey === scope.sellerIdentityKey.trim();
  }
  if (scope.externalSellerId != null) {
    const ids =
      owner.sellerAliasExternalIds.length > 0
        ? owner.sellerAliasExternalIds
        : owner.sellerExternalId != null
          ? [owner.sellerExternalId]
          : [];
    return ids.includes(scope.externalSellerId);
  }
  if (scope.responsible?.trim() && owner.sellerResponsibleName) {
    return (
      normalizeSellerIdentityName(owner.sellerResponsibleName) ===
      normalizeSellerIdentityName(scope.responsible)
    );
  }
  return false;
}

const COMMERCIAL_OWNER_ID_ONLY_PREFIX = "__ID_ONLY__:";

export type CommercialOwnerPortfolioScope = Pick<
  CrmCommercialAccessScope,
  "externalSellerId" | "responsible" | "sellerIdentityKey"
> & {
  externalSellerIds?: number[] | null;
};

/** Chaves e IDs usados tanto no WHERE da carteira quanto no match em memória. */
export function commercialOwnerPortfolioMatchParts(scope: CommercialOwnerPortfolioScope): {
  identityKeys: string[];
  ids: number[];
} {
  const ids = [
    ...new Set(
      [
        ...(scope.externalSellerIds ?? []),
        ...(scope.externalSellerId != null ? [scope.externalSellerId] : []),
      ].filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ].sort((a, b) => a - b);
  const identityKey =
    scope.sellerIdentityKey?.trim() ||
    (scope.responsible?.trim() ? normalizeSellerIdentityName(scope.responsible) : "");
  const identityKeys = [
    ...(identityKey ? [identityKey] : []),
    ...ids.map((id) => `${COMMERCIAL_OWNER_ID_ONLY_PREFIX}${id}`),
  ];
  return { identityKeys, ids };
}

export function buildManualCommercialOwnerPortfolioWhere(
  scope: CommercialOwnerPortfolioScope
): Prisma.CrmCustomerCommercialOwnerWhereInput | undefined {
  const { identityKeys, ids } = commercialOwnerPortfolioMatchParts(scope);

  const or: Prisma.CrmCustomerCommercialOwnerWhereInput[] = [];
  for (const identityKey of identityKeys) {
    or.push({ sellerIdentityKey: identityKey });
  }
  if (ids.length === 1) {
    or.push({ sellerExternalId: ids[0]! });
    or.push({
      sellerAliasExternalIds: { array_contains: ids[0]! },
    });
  } else if (ids.length > 1) {
    or.push({ sellerExternalId: { in: ids } });
    for (const id of ids) {
      or.push({
        sellerAliasExternalIds: { array_contains: id },
      });
    }
  }

  if (or.length === 0) return undefined;
  if (or.length === 1) {
    return { isActive: true, ...or[0]! };
  }
  return { isActive: true, OR: or };
}

export type CommercialOwnerAssignmentIdentity = {
  sellerIdentityKey: string | null;
  sellerExternalId: number | null;
  sellerAliasExternalIds: number[];
};

/** Mesma identidade do WHERE da carteira, avaliada em memória. */
export function assignmentMatchesCommercialOwnerPortfolio(
  assignment: CommercialOwnerAssignmentIdentity,
  scope: CommercialOwnerPortfolioScope
): boolean {
  const { identityKeys, ids } = commercialOwnerPortfolioMatchParts(scope);
  const key = assignment.sellerIdentityKey?.trim() ?? "";
  if (key && identityKeys.includes(key)) return true;
  if (assignment.sellerExternalId != null && ids.includes(assignment.sellerExternalId)) return true;
  return assignment.sellerAliasExternalIds.some((id) => ids.includes(id));
}

export function adminSellerOptionToActiveCommercialSeller(
  option: AdminSellerOption
): ActiveCommercialSellerOption {
  const aliasIds =
    option.externalSellerIds.length > 0
      ? option.externalSellerIds
      : option.externalSellerId != null
        ? [option.externalSellerId]
        : [];
  return {
    canonicalName: option.displayName,
    canonicalExternalSellerId: option.externalSellerId,
    aliasExternalSellerIds: aliasIds,
    sellerIdentityKey: option.sellerIdentityKey,
    responsible: option.responsible,
    confidence: option.confidence,
    ordersCount: option.ordersCount,
    totalAmount: option.ordersValue,
    active: option.ordersCount > 0,
    sublabel: formatAdminSellerOptionSublabel(option),
    optionKey: buildAdminSellerOptionKey(option),
  };
}

export async function fetchActiveCommercialSellers(
  query?: string
): Promise<ActiveCommercialSellerOption[]> {
  const options = await fetchAdminSellerOptionsFromDb();
  const q = query?.trim().toLowerCase() ?? "";
  const filtered = q
    ? options.filter((opt) => {
        const hay = [
          opt.displayName,
          opt.normalizedName,
          opt.sellerIdentityKey,
          opt.responsible ?? "",
          ...opt.externalSellerIds.map(String),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
    : options;
  return filtered.map(adminSellerOptionToActiveCommercialSeller);
}

export function resolveSellerOptionFromKey(
  sellers: AdminSellerOption[],
  optionKey: string
): AdminSellerOption | null {
  const key = optionKey.trim();
  if (!key) return null;
  return sellers.find((s) => buildAdminSellerOptionKey(s) === key) ?? null;
}

async function loadCommercialOwnerAuditHistory(
  customerId: string
): Promise<CommercialOwnerAuditEntry[]> {
  const rows = await prisma.commercialAuditLog.findMany({
    where: {
      entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
      entityId: customerId,
    },
    orderBy: { performedAt: "desc" },
    take: 20,
  });
  return rows.map((row) => ({
    performedAt: row.performedAt.toISOString(),
    performedBy: row.performedBy,
    previousLabel: row.oldValue,
    newLabel: row.newValue,
    action: row.action,
  }));
}

export async function getCustomerCommercialOwnerPayload(
  customerId: string,
  auth: AppAuthContext
): Promise<CustomerCommercialOwnerPayload | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, companyName: true },
  });
  if (!customer) return null;

  const manualRow = await prisma.crmCustomerCommercialOwner.findUnique({
    where: { customerId },
  });
  const manual = manualRow?.isActive ? manualOwnerRowToResolved(manualRow) : null;
  const inferred = await inferCommercialOwnerFromNomusOrders(customerId);
  const owner = resolveCustomerCommercialOwner(manual, inferred);
  const auditHistory = await loadCommercialOwnerAuditHistory(customerId);

  return {
    customerId: customer.id,
    customerName: customer.companyName,
    canEdit: canAssignCustomerCommercialOwner(auth),
    owner,
    manualAssignment: manual,
    inferredFromNomus: inferred,
    auditHistory,
  };
}

export type PatchCustomerCommercialOwnerInput = {
  customerId: string;
  auth: AppAuthContext;
  sellerOptionKey?: string | null;
  clear?: boolean;
  notes?: string | null;
};

export async function patchCustomerCommercialOwner(
  input: PatchCustomerCommercialOwnerInput
): Promise<
  | { ok: true; payload: CustomerCommercialOwnerPayload }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  if (!canAssignCustomerCommercialOwner(input.auth)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message:
          "Somente Gestor Comercial ou Administrador pode alterar o responsável comercial do cliente.",
        requiredPermissions: [CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION],
      },
    };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, companyName: true },
  });
  if (!customer) {
    return { ok: false, status: 404, body: { error: "NOT_FOUND", message: "Cliente não encontrado." } };
  }

  const existing = await prisma.crmCustomerCommercialOwner.findUnique({
    where: { customerId: input.customerId },
  });
  const previousLabel = existing?.isActive
    ? formatCommercialOwnerLabel(manualOwnerRowToResolved(existing))
    : formatCommercialOwnerLabel(await inferCommercialOwnerFromNomusOrders(input.customerId));

  if (input.clear) {
    if (existing) {
      await prisma.crmCustomerCommercialOwner.delete({ where: { customerId: input.customerId } });
    }
    const newLabel = formatCommercialOwnerLabel(
      await inferCommercialOwnerFromNomusOrders(input.customerId)
    );
    await writeCommercialAuditLog({
      entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
      entityId: input.customerId,
      action: "CLEAR_MANUAL_ASSIGNMENT",
      fieldName: "commercialOwner",
      oldValue: previousLabel,
      newValue: newLabel,
      performedBy: input.auth.name,
    });
    const payload = await getCustomerCommercialOwnerPayload(input.customerId, input.auth);
    return { ok: true, payload: payload! };
  }

  const optionKey = input.sellerOptionKey?.trim();
  if (!optionKey) {
    return {
      ok: false,
      status: 400,
      body: { error: "VALIDATION", message: "Informe sellerOptionKey ou clear=true." },
    };
  }

  const allSellers = await fetchAdminSellerOptionsFromDb();
  const selected = resolveSellerOptionFromKey(allSellers, optionKey);
  if (!selected) {
    return {
      ok: false,
      status: 400,
      body: { error: "VALIDATION", message: "Vendedor consolidado não encontrado na lista ativa." },
    };
  }

  const aliasIds =
    selected.externalSellerIds.length > 0
      ? selected.externalSellerIds
      : selected.externalSellerId != null
        ? [selected.externalSellerId]
        : [];

  const data = {
    customerNameSnapshot: customer.companyName,
    sellerExternalId: selected.externalSellerId,
    sellerResponsibleName: selected.responsible,
    sellerCanonicalName: selected.displayName,
    sellerIdentityKey: selected.sellerIdentityKey,
    sellerAliasExternalIds: aliasIds,
    assignmentSource: "MANUAL",
    isActive: true,
    notes: input.notes?.trim() || null,
    updatedByUserId: input.auth.id,
    updatedByName: input.auth.name,
  };

  await prisma.crmCustomerCommercialOwner.upsert({
    where: { customerId: input.customerId },
    create: {
      customerId: input.customerId,
      ...data,
      createdByUserId: input.auth.id,
      createdByName: input.auth.name,
    },
    update: data,
  });

  const newResolved = manualOwnerRowToResolved(
    (await prisma.crmCustomerCommercialOwner.findUniqueOrThrow({
      where: { customerId: input.customerId },
    }))!
  );
  const newLabel = formatCommercialOwnerLabel(newResolved);

  await writeCommercialAuditLog({
    entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
    entityId: input.customerId,
    action: existing?.isActive ? "UPDATE_MANUAL_ASSIGNMENT" : "SET_MANUAL_ASSIGNMENT",
    fieldName: "commercialOwner",
    oldValue: previousLabel,
    newValue: newLabel,
    performedBy: input.auth.name,
  });

  const payload = await getCustomerCommercialOwnerPayload(input.customerId, input.auth);
  return { ok: true, payload: payload! };
}

/**
 * Resolve nomes canônicos para owners legados salvos como "Vendedor ID N"
 * (mesma cadeia do filtro Vendedor do Pedido).
 */
async function enrichResolvedCommercialOwnerNames(
  owners: Map<string, ResolvedCustomerCommercialOwner>
): Promise<void> {
  const needLookup: { customerId: string; externalId: number }[] = [];
  for (const [customerId, owner] of owners) {
    const name = cleanExecutiveCommercialName(owner.sellerCanonicalName);
    const hasRealName = Boolean(name) && name !== ORDER_SELLER_UNMAPPED_LABEL;
    if (hasRealName) continue;
    if (owner.sellerExternalId == null || owner.sellerExternalId <= 0) continue;
    needLookup.push({ customerId, externalId: owner.sellerExternalId });
  }
  if (needLookup.length === 0) return;

  const { enrichOrderSellerOptionRowsWithNames } = await import(
    "@/src/lib/crmSellerDashboardService.js"
  );
  const enriched = await enrichOrderSellerOptionRowsWithNames(
    needLookup.map((row) => ({
      external_seller_id: row.externalId,
      responsible: null,
      orders_count: 1,
    }))
  );
  const nameById = new Map<number, string>();
  for (const row of enriched) {
    const name = cleanExecutiveCommercialName(row.responsible);
    if (row.external_seller_id != null && name && name !== ORDER_SELLER_UNMAPPED_LABEL) {
      nameById.set(row.external_seller_id, name);
    }
  }

  for (const { customerId, externalId } of needLookup) {
    const resolved = nameById.get(externalId);
    if (!resolved) continue;
    const prev = owners.get(customerId);
    if (!prev) continue;
    owners.set(customerId, {
      ...prev,
      sellerCanonicalName: resolved,
      sellerResponsibleName: prev.sellerResponsibleName ?? resolved,
      sellerIdentityKey: normalizeSellerIdentityName(resolved),
    });
  }
}

export async function loadManualCommercialOwnersForCustomers(
  customerIds: string[]
): Promise<Map<string, ResolvedCustomerCommercialOwner>> {
  if (customerIds.length === 0) return new Map();
  const rows = await prisma.crmCustomerCommercialOwner.findMany({
    where: { customerId: { in: customerIds }, isActive: true },
  });
  const map = new Map<string, ResolvedCustomerCommercialOwner>();
  for (const row of rows) {
    map.set(row.customerId, manualOwnerRowToResolved(row));
  }
  await enrichResolvedCommercialOwnerNames(map);
  return map;
}

/** Nome de exibição da atribuição persistida. Sem IDs. Null quando não há responsável. */
export function commercialOwnerListDisplayName(
  owner: ResolvedCustomerCommercialOwner | null | undefined
): string | null {
  if (!owner || owner.source === "NONE") return null;
  const display = resolveCommercialOwnerDisplay({
    rawId: owner.sellerExternalId,
    rawName: owner.sellerResponsibleName,
    canonicalName: owner.sellerCanonicalName,
    source: owner.source,
  });
  if (display.source === "NONE") return null;
  const name = display.displayName.trim();
  return name || null;
}

export const COMMERCIAL_OWNER_GRID_EMPTY_LABEL = "Sem responsável";

export type CommercialOwnerFilterOption = {
  key: string;
  name: string;
};

export type CommercialOwnerFilterBuild = {
  options: CommercialOwnerFilterOption[];
  activeAssignments: number;
  resolvedAssignments: number;
  unresolvedAssignments: number;
};

function adminSellerOptionPortfolioScope(option: AdminSellerOption): CommercialOwnerPortfolioScope {
  return {
    sellerIdentityKey: option.sellerIdentityKey,
    externalSellerId: option.externalSellerId,
    externalSellerIds: option.externalSellerIds,
    responsible: option.responsible,
  };
}

function isCanonicalCommercialOwnerFilterSeller(option: AdminSellerOption): boolean {
  const name = option.displayName.trim();
  return Boolean(name) && name !== ORDER_SELLER_UNMAPPED_LABEL;
}

function pickCanonicalSellerOption(
  assignment: CommercialOwnerAssignmentIdentity,
  matches: AdminSellerOption[]
): AdminSellerOption | null {
  const displayable = matches.filter(isCanonicalCommercialOwnerFilterSeller);
  if (displayable.length === 0) return null;
  const key = assignment.sellerIdentityKey?.trim() ?? "";
  const namedExact =
    key && !key.startsWith(COMMERCIAL_OWNER_ID_ONLY_PREFIX)
      ? displayable.filter((option) => option.sellerIdentityKey.trim() === key)
      : [];
  const pool = namedExact.length > 0 ? namedExact : displayable;
  pool.sort((a, b) => {
    if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
    return buildAdminSellerOptionKey(a).localeCompare(buildAdminSellerOptionKey(b));
  });
  return pool[0] ?? null;
}

/**
 * Opções do filtro da grade: só responsáveis do diretório consolidado
 * que tenham ao menos uma atribuição ativa resolvida. Deduplica pela
 * optionKey canônica, não pelo rótulo.
 */
export function buildCommercialOwnerFilterOptions(
  assignments: readonly CommercialOwnerAssignmentIdentity[],
  sellers: readonly AdminSellerOption[]
): CommercialOwnerFilterBuild {
  const byKey = new Map<string, CommercialOwnerFilterOption>();
  let resolvedAssignments = 0;
  let unresolvedAssignments = 0;
  for (const assignment of assignments) {
    const matches = sellers.filter((seller) =>
      assignmentMatchesCommercialOwnerPortfolio(assignment, adminSellerOptionPortfolioScope(seller))
    );
    const seller = pickCanonicalSellerOption(assignment, matches);
    if (!seller) {
      unresolvedAssignments += 1;
      continue;
    }
    resolvedAssignments += 1;
    const key = buildAdminSellerOptionKey(seller);
    if (!byKey.has(key)) {
      byKey.set(key, { key, name: seller.displayName.trim() });
    }
  }
  const options = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    options,
    activeAssignments: assignments.length,
    resolvedAssignments,
    unresolvedAssignments,
  };
}

/**
 * WHERE do filtro da grade. `none` = sem atribuição ativa.
 * Demais valores são `buildAdminSellerOptionKey` e casam aliases legados
 * pela mesma regra de `buildManualCommercialOwnerPortfolioWhere`.
 */
export function buildCustomerCommercialOwnerFilterWhere(
  ownerKey: string,
  sellers: readonly AdminSellerOption[]
): Prisma.CustomerWhereInput | undefined {
  const key = ownerKey.trim();
  if (!key) return undefined;
  if (key === CUSTOMER_LIST_OWNER_NONE) {
    return { NOT: { CrmCustomerCommercialOwner: { is: { isActive: true } } } };
  }
  const seller = resolveSellerOptionFromKey([...sellers], key);
  if (!seller || !isCanonicalCommercialOwnerFilterSeller(seller)) {
    return { id: { in: [] } };
  }
  const portfolio = buildManualCommercialOwnerPortfolioWhere(adminSellerOptionPortfolioScope(seller));
  if (!portfolio) return { id: { in: [] } };
  return { CrmCustomerCommercialOwner: { is: portfolio } };
}

async function loadActiveCommercialOwnerAssignments(): Promise<CommercialOwnerAssignmentIdentity[]> {
  const rows = await prisma.crmCustomerCommercialOwner.findMany({
    where: { isActive: true },
    select: {
      sellerIdentityKey: true,
      sellerExternalId: true,
      sellerAliasExternalIds: true,
    },
  });
  return rows.map((row) => ({
    sellerIdentityKey: row.sellerIdentityKey,
    sellerExternalId: row.sellerExternalId,
    sellerAliasExternalIds: parseSellerAliasExternalIds(row.sellerAliasExternalIds),
  }));
}

/** Opções do filtro da grade. Uma leitura das atribuições e um diretório consolidado. */
export async function listCommercialOwnerFilterOptions(
  sellers?: readonly AdminSellerOption[]
): Promise<CommercialOwnerFilterOption[]> {
  const [assignments, directory] = await Promise.all([
    loadActiveCommercialOwnerAssignments(),
    sellers ?? fetchAdminSellerOptionsFromDb(),
  ]);
  return buildCommercialOwnerFilterOptions(assignments, directory).options;
}

/** Filtro da listagem: opções canônicas e WHERE, sem consulta por cliente. */
export async function prepareCommercialOwnerCustomerListFilter(ownerKey: string): Promise<
  CommercialOwnerFilterBuild & { ownerWhere: Prisma.CustomerWhereInput | undefined }
> {
  const [assignments, directory] = await Promise.all([
    loadActiveCommercialOwnerAssignments(),
    fetchAdminSellerOptionsFromDb(),
  ]);
  const built = buildCommercialOwnerFilterOptions(assignments, directory);
  return {
    ...built,
    ownerWhere: buildCustomerCommercialOwnerFilterWhere(ownerKey, directory),
  };
}

/**
 * Anexa o responsável comercial persistido (CrmCustomerCommercialOwner ativo)
 * em lote. Uma consulta da página, sem inferência por pedidos e sem N+1.
 */
export async function attachCustomerCommercialOwnerListFields<T extends { id: string }>(
  customers: T[]
): Promise<
  Array<T & { commercialOwnerName: string | null; commercialOwnerExternalId: number | null }>
> {
  if (customers.length === 0) return [];
  const owners = await loadManualCommercialOwnersForCustomers(customers.map((c) => c.id));
  return customers.map((customer) => {
    const owner = owners.get(customer.id) ?? null;
    return {
      ...customer,
      commercialOwnerName: commercialOwnerListDisplayName(owner),
      commercialOwnerExternalId: owner?.sellerExternalId ?? null,
    };
  });
}
