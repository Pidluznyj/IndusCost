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
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
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
  return {
    source: "MANUAL",
    sellerCanonicalName: row.sellerCanonicalName,
    sellerResponsibleName: row.sellerResponsibleName,
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
      NULLIF(TRIM(so."responsible"), '') AS responsible,
      COUNT(*)::int AS orders_count
    FROM "SalesOrder" so
    WHERE so."customerId" = ${customerId}::uuid
      AND so.status::text NOT IN ('CANCELLED', 'ERROR')
      AND (
        so."externalSellerId" IS NOT NULL
        OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
      )
    GROUP BY so."externalSellerId", NULLIF(TRIM(so."responsible"), '')
    ORDER BY orders_count DESC, external_seller_id ASC NULLS LAST
    LIMIT 1
  `);

  const top = rows[0];
  if (!top) return null;

  const responsible = top.responsible?.trim() || null;
  const canonicalName =
    responsible ||
    (top.external_seller_id != null ? `Vendedor ID ${top.external_seller_id}` : null);
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
  if (!owner?.sellerCanonicalName) return "Sem responsável";
  const ids =
    owner.sellerAliasExternalIds.length > 0
      ? ` (IDs Nomus ${owner.sellerAliasExternalIds.join(", ")})`
      : owner.sellerExternalId != null
        ? ` (ID Nomus ${owner.sellerExternalId})`
        : "";
  return `${owner.sellerCanonicalName}${ids}`;
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

export function buildManualCommercialOwnerPortfolioWhere(
  scope: Pick<CrmCommercialAccessScope, "externalSellerId" | "responsible" | "sellerIdentityKey">
): Prisma.CrmCustomerCommercialOwnerWhereInput | undefined {
  if (scope.sellerIdentityKey?.trim()) {
    return {
      isActive: true,
      sellerIdentityKey: scope.sellerIdentityKey.trim(),
    };
  }
  if (scope.externalSellerId != null) {
    return {
      isActive: true,
      OR: [
        { sellerExternalId: scope.externalSellerId },
        {
          sellerAliasExternalIds: {
            array_contains: scope.externalSellerId,
          },
        },
      ],
    };
  }
  if (scope.responsible?.trim()) {
    return {
      isActive: true,
      sellerIdentityKey: normalizeSellerIdentityName(scope.responsible),
    };
  }
  return undefined;
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
  return map;
}
