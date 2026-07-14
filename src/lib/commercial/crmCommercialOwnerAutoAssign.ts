/**
 * Autoatribuição de Responsável Comercial a partir do Vendedor do Pedido.
 * Preenche carteira vazia; nunca substitui responsável ativo.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { writeCommercialAuditLog } from "@/src/lib/commercialAuditLog.js";
import { isForbiddenCommercialResponsibleName } from "@/src/lib/commercial/crmCommercialResponsibleResolver.js";
import { CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY } from "@/src/lib/crmCustomerCommercialOwner.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";

export const AUTO_ASSIGN_SOURCE = "AUTO_FROM_SALES_ORDER_SELLER" as const;

export type AutoAssignSellerSuggestion = {
  customerId: string;
  customerName: string;
  salesOrderId: string;
  orderCode: string;
  externalSalesOrderId: number | null;
  sellerExternalId: number | null;
  sellerName: string;
  sellerIdentityKey: string;
  distinctSellerCount: number;
  alert?: "MULTIPLE_ORDER_SELLERS_FOR_CUSTOMER" | "CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED";
};

export type AutoAssignResult = {
  attempted: number;
  assigned: number;
  skippedAlreadyOwned: number;
  skippedUnmapped: number;
  skippedForbidden: number;
  errors: number;
  assignedCustomerIds: string[];
};

function resolveSellerLabel(row: {
  nomusSellerName: string | null;
  responsible: string | null;
  externalSellerId: number | null;
}): string | null {
  const name =
    row.nomusSellerName?.trim() ||
    row.responsible?.trim() ||
    (row.externalSellerId != null ? `Vendedor ID ${row.externalSellerId}` : null);
  return name?.trim() || null;
}

export function isMappableOrderSeller(row: {
  nomusSellerName: string | null;
  responsible: string | null;
  externalSellerId: number | null;
}): boolean {
  const label = resolveSellerLabel(row);
  if (!label) return false;
  if (isForbiddenCommercialResponsibleName(label)) return false;
  return (
    Boolean(row.nomusSellerName?.trim()) ||
    Boolean(row.responsible?.trim()) ||
    row.externalSellerId != null
  );
}

/**
 * Clientes sem owner ativo + pedido mais recente com vendedor mapeável.
 */
export async function previewCommercialOwnerAutoAssignFromOrders(
  prisma: PrismaClient,
  options?: { customerIds?: string[]; limit?: number }
): Promise<AutoAssignSellerSuggestion[]> {
  const customerFilter =
    options?.customerIds && options.customerIds.length > 0
      ? Prisma.sql`AND c.id IN (${Prisma.join(
          options.customerIds.map((id) => Prisma.sql`${id}::uuid`)
        )})`
      : Prisma.empty;
  const limit = options?.limit ?? 5000;

  const rows = await prisma.$queryRaw<
    {
      customer_id: string;
      customer_name: string;
      sales_order_id: string;
      order_code: string;
      external_sales_order_id: number | null;
      external_seller_id: number | null;
      seller_name: string | null;
      distinct_seller_count: number;
    }[]
  >(Prisma.sql`
    WITH eligible_customers AS (
      SELECT c.id, c."companyName" AS customer_name
      FROM "Customer" c
      WHERE NOT EXISTS (
        SELECT 1
        FROM "CrmCustomerCommercialOwner" own
        WHERE own."customerId" = c.id AND own."isActive" = true
      )
      ${customerFilter}
    ),
    seller_counts AS (
      SELECT
        so."customerId" AS customer_id,
        COUNT(
          DISTINCT LOWER(
            COALESCE(
              NULLIF(TRIM(so."nomusSellerName"), ''),
              NULLIF(TRIM(so."responsible"), ''),
              CASE WHEN so."externalSellerId" IS NOT NULL
                THEN CONCAT('id:', so."externalSellerId"::text)
                ELSE NULL
              END
            )
          )
        )::int AS distinct_seller_count
      FROM "SalesOrder" so
      INNER JOIN eligible_customers ec ON ec.id = so."customerId"
      WHERE so.status::text NOT IN ('CANCELLED', 'ERROR')
        AND (
          so."externalSellerId" IS NOT NULL
          OR (so."nomusSellerName" IS NOT NULL AND TRIM(so."nomusSellerName") <> '')
          OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
        )
      GROUP BY so."customerId"
    ),
    latest_seller_order AS (
      SELECT DISTINCT ON (so."customerId")
        so."customerId" AS customer_id,
        so.id AS sales_order_id,
        so."orderCode" AS order_code,
        so."externalSalesOrderId" AS external_sales_order_id,
        so."externalSellerId" AS external_seller_id,
        NULLIF(
          TRIM(COALESCE(NULLIF(TRIM(so."nomusSellerName"), ''), NULLIF(TRIM(so."responsible"), ''))),
          ''
        ) AS seller_name
      FROM "SalesOrder" so
      INNER JOIN eligible_customers ec ON ec.id = so."customerId"
      WHERE so.status::text NOT IN ('CANCELLED', 'ERROR')
        AND (
          so."externalSellerId" IS NOT NULL
          OR (so."nomusSellerName" IS NOT NULL AND TRIM(so."nomusSellerName") <> '')
          OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
        )
      ORDER BY so."customerId", so."issueDate" DESC NULLS LAST, so."createdAt" DESC
    )
    SELECT
      ec.id AS customer_id,
      ec.customer_name,
      lso.sales_order_id,
      lso.order_code,
      lso.external_sales_order_id,
      lso.external_seller_id,
      COALESCE(
        lso.seller_name,
        CASE WHEN lso.external_seller_id IS NOT NULL
          THEN CONCAT('Vendedor ID ', lso.external_seller_id::text)
          ELSE NULL
        END
      ) AS seller_name,
      COALESCE(sc.distinct_seller_count, 0)::int AS distinct_seller_count
    FROM eligible_customers ec
    INNER JOIN latest_seller_order lso ON lso.customer_id = ec.id
    LEFT JOIN seller_counts sc ON sc.customer_id = ec.id
    ORDER BY ec.customer_name ASC
    LIMIT ${limit}
  `);

  const out: AutoAssignSellerSuggestion[] = [];
  for (const row of rows) {
    const sellerName = row.seller_name?.trim() || null;
    if (!sellerName) {
      out.push({
        customerId: row.customer_id,
        customerName: row.customer_name,
        salesOrderId: row.sales_order_id,
        orderCode: row.order_code,
        externalSalesOrderId: row.external_sales_order_id,
        sellerExternalId: row.external_seller_id,
        sellerName: "",
        sellerIdentityKey: "",
        distinctSellerCount: row.distinct_seller_count,
        alert: "CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED",
      });
      continue;
    }
    if (isForbiddenCommercialResponsibleName(sellerName)) {
      out.push({
        customerId: row.customer_id,
        customerName: row.customer_name,
        salesOrderId: row.sales_order_id,
        orderCode: row.order_code,
        externalSalesOrderId: row.external_sales_order_id,
        sellerExternalId: row.external_seller_id,
        sellerName,
        sellerIdentityKey: normalizeSellerIdentityName(sellerName),
        distinctSellerCount: row.distinct_seller_count,
        alert: "CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED",
      });
      continue;
    }
    out.push({
      customerId: row.customer_id,
      customerName: row.customer_name,
      salesOrderId: row.sales_order_id,
      orderCode: row.order_code,
      externalSalesOrderId: row.external_sales_order_id,
      sellerExternalId: row.external_seller_id,
      sellerName,
      sellerIdentityKey: normalizeSellerIdentityName(sellerName),
      distinctSellerCount: row.distinct_seller_count,
      alert:
        row.distinct_seller_count > 1 ? "MULTIPLE_ORDER_SELLERS_FOR_CUSTOMER" : undefined,
    });
  }
  return out;
}

export async function assignCommercialOwnerFromSuggestion(
  prisma: PrismaClient,
  suggestion: AutoAssignSellerSuggestion,
  options?: { performedBy?: string; dryRun?: boolean }
): Promise<"assigned" | "skipped_owned" | "skipped_unmapped" | "skipped_forbidden" | "error"> {
  if (!suggestion.sellerName || suggestion.alert === "CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED") {
    return "skipped_unmapped";
  }
  if (isForbiddenCommercialResponsibleName(suggestion.sellerName)) {
    return "skipped_forbidden";
  }

  try {
    const existing = await prisma.crmCustomerCommercialOwner.findUnique({
      where: { customerId: suggestion.customerId },
    });
    if (existing?.isActive) {
      if (!options?.dryRun) {
        await writeCommercialAuditLog({
          entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
          entityId: suggestion.customerId,
          action: "SKIP_AUTO_ASSIGN_ALREADY_OWNED",
          fieldName: "commercialOwner",
          oldValue: existing.sellerCanonicalName,
          newValue: suggestion.sellerName,
          performedBy: options?.performedBy ?? "system/auto-assign",
        });
      }
      return "skipped_owned";
    }

    if (options?.dryRun) return "assigned";

    const aliasIds =
      suggestion.sellerExternalId != null ? [suggestion.sellerExternalId] : [];
    const notes = [
      `source=${AUTO_ASSIGN_SOURCE}`,
      `sourceOrderCode=${suggestion.orderCode}`,
      suggestion.externalSalesOrderId != null
        ? `sourceExternalSalesOrderId=${suggestion.externalSalesOrderId}`
        : null,
      suggestion.sellerExternalId != null
        ? `sourceSellerExternalId=${suggestion.sellerExternalId}`
        : null,
      `sourceSellerName=${suggestion.sellerName}`,
      suggestion.alert ? `alert=${suggestion.alert}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    await prisma.crmCustomerCommercialOwner.upsert({
      where: { customerId: suggestion.customerId },
      create: {
        customerId: suggestion.customerId,
        customerNameSnapshot: suggestion.customerName,
        sellerExternalId: suggestion.sellerExternalId,
        sellerResponsibleName: suggestion.sellerName,
        sellerCanonicalName: suggestion.sellerName,
        sellerIdentityKey: suggestion.sellerIdentityKey,
        sellerAliasExternalIds: aliasIds,
        assignmentSource: AUTO_ASSIGN_SOURCE,
        isActive: true,
        notes,
        createdByName: options?.performedBy ?? "system/auto-assign",
        updatedByName: options?.performedBy ?? "system/auto-assign",
      },
      update: {
        // Só reativa/preenche se linha existia inativa — nunca sobrescreve ativa (guard acima).
        customerNameSnapshot: suggestion.customerName,
        sellerExternalId: suggestion.sellerExternalId,
        sellerResponsibleName: suggestion.sellerName,
        sellerCanonicalName: suggestion.sellerName,
        sellerIdentityKey: suggestion.sellerIdentityKey,
        sellerAliasExternalIds: aliasIds,
        assignmentSource: AUTO_ASSIGN_SOURCE,
        isActive: true,
        notes,
        updatedByName: options?.performedBy ?? "system/auto-assign",
      },
    });

    await writeCommercialAuditLog({
      entityType: CRM_CUSTOMER_COMMERCIAL_OWNER_ENTITY,
      entityId: suggestion.customerId,
      action: "AUTO_ASSIGN_FROM_SALES_ORDER_SELLER",
      fieldName: "commercialOwner",
      oldValue: null,
      newValue: suggestion.sellerName,
      performedBy: options?.performedBy ?? "system/auto-assign",
    });

    return "assigned";
  } catch {
    return "error";
  }
}

export async function applyCommercialOwnerAutoAssignFromOrders(
  prisma: PrismaClient,
  options?: { customerIds?: string[]; performedBy?: string; dryRun?: boolean }
): Promise<AutoAssignResult> {
  const suggestions = await previewCommercialOwnerAutoAssignFromOrders(prisma, {
    customerIds: options?.customerIds,
  });
  const result: AutoAssignResult = {
    attempted: suggestions.length,
    assigned: 0,
    skippedAlreadyOwned: 0,
    skippedUnmapped: 0,
    skippedForbidden: 0,
    errors: 0,
    assignedCustomerIds: [],
  };

  for (const suggestion of suggestions) {
    const status = await assignCommercialOwnerFromSuggestion(prisma, suggestion, {
      performedBy: options?.performedBy,
      dryRun: options?.dryRun,
    });
    if (status === "assigned") {
      result.assigned += 1;
      result.assignedCustomerIds.push(suggestion.customerId);
    } else if (status === "skipped_owned") result.skippedAlreadyOwned += 1;
    else if (status === "skipped_unmapped") result.skippedUnmapped += 1;
    else if (status === "skipped_forbidden") result.skippedForbidden += 1;
    else result.errors += 1;
  }

  return result;
}

/**
 * Após sync Nomus: tenta autoatribuir owner para clientes dos pedidos afetados (carteira vazia).
 * Falhas não interrompem o sync.
 */
export async function autoAssignCommercialOwnersAfterNomusSync(
  prisma: PrismaClient,
  salesOrderIds: string[]
): Promise<AutoAssignResult> {
  const empty: AutoAssignResult = {
    attempted: 0,
    assigned: 0,
    skippedAlreadyOwned: 0,
    skippedUnmapped: 0,
    skippedForbidden: 0,
    errors: 0,
    assignedCustomerIds: [],
  };
  if (salesOrderIds.length === 0) return empty;

  try {
    const orders = await prisma.salesOrder.findMany({
      where: { id: { in: salesOrderIds } },
      select: { customerId: true },
    });
    const customerIds = [
      ...new Set(orders.map((o) => o.customerId).filter((id): id is string => Boolean(id))),
    ];
    if (customerIds.length === 0) return empty;

    return await applyCommercialOwnerAutoAssignFromOrders(prisma, {
      customerIds,
      performedBy: "system/nomus-sales-orders-sync",
    });
  } catch (err) {
    console.error(
      "[crmCommercialOwnerAutoAssign] falha controlada pós-sync:",
      err instanceof Error ? err.message : err
    );
    return { ...empty, errors: 1 };
  }
}
