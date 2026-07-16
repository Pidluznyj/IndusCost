/**
 * Loaders read-only do inventário/cobertura do stage NomusStockDocument*.
 * Usa agregações SQL e paginação — não carrega tabelas inteiras em memória.
 */
import { Prisma } from "@prisma/client";
import {
  NOMUS_STOCK_DOCUMENT_ITEM_ABSENT_SCHEMA_FIELDS,
  NOMUS_STOCK_DOCUMENT_TIPO_SAIDA,
  buildEmptyStageInventory,
  buildFieldCoverageStat,
  toAuditIsoDate,
  toAuditNumber,
  toAuditNullableNumber,
  type FieldCoverageStat,
  type StageInventory,
  type StageInventoryMonthCount,
  type StageInventoryTypeCount,
  type StageInventoryYearCount,
} from "./auditOutputDocumentsDb.js";

export type AuditInventoryPrisma = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<T>;
  nomusStockDocument: {
    findMany: (args: {
      where?: unknown;
      select?: unknown;
      orderBy?: unknown;
      take?: number;
      skip?: number;
      cursor?: unknown;
    }) => Promise<Array<{ id: string; externalId: number }>>;
  };
  nomusStockDocumentItem: {
    findMany: (args: {
      where?: unknown;
      select?: unknown;
      orderBy?: unknown;
      take?: number;
      skip?: number;
      cursor?: unknown;
    }) => Promise<Array<{ id: string }>>;
  };
};

const PAGE_SIZE = 200;

function roundAvg(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Pagina IDs de documentos sem itens até sampleLimit, sem carregar a tabela toda.
 */
export async function sampleDocumentsWithoutItems(
  prisma: AuditInventoryPrisma,
  sampleLimit: number
): Promise<number[]> {
  const limit = Math.max(0, Math.trunc(sampleLimit));
  if (limit === 0) return [];

  const samples: number[] = [];
  let cursorId: string | null = null;

  while (samples.length < limit) {
    const take = Math.min(PAGE_SIZE, limit - samples.length);
    const rows = cursorId
      ? await prisma.$queryRaw<Array<{ id: string; externalId: number }>>(Prisma.sql`
          SELECT d.id, d."externalId"
          FROM "NomusStockDocument" d
          WHERE NOT EXISTS (
            SELECT 1
            FROM "NomusStockDocumentItem" i
            WHERE i."stockDocumentId" = d.id
          )
            AND d.id > ${cursorId}
          ORDER BY d.id ASC
          LIMIT ${take}
        `)
      : await prisma.$queryRaw<Array<{ id: string; externalId: number }>>(Prisma.sql`
          SELECT d.id, d."externalId"
          FROM "NomusStockDocument" d
          WHERE NOT EXISTS (
            SELECT 1
            FROM "NomusStockDocumentItem" i
            WHERE i."stockDocumentId" = d.id
          )
          ORDER BY d.id ASC
          LIMIT ${take}
        `);

    if (rows.length === 0) break;
    for (const row of rows) {
      samples.push(toAuditNumber(row.externalId));
      cursorId = row.id;
      if (samples.length >= limit) break;
    }
    if (rows.length < take) break;
  }

  return samples;
}

/**
 * Pagina IDs de itens órfãos até sampleLimit.
 */
export async function sampleOrphanItemIds(
  prisma: AuditInventoryPrisma,
  sampleLimit: number
): Promise<string[]> {
  const limit = Math.max(0, Math.trunc(sampleLimit));
  if (limit === 0) return [];

  const samples: string[] = [];
  let cursorId: string | null = null;

  while (samples.length < limit) {
    const take = Math.min(PAGE_SIZE, limit - samples.length);
    const rows = cursorId
      ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT i.id
          FROM "NomusStockDocumentItem" i
          LEFT JOIN "NomusStockDocument" d ON d.id = i."stockDocumentId"
          WHERE d.id IS NULL
            AND i.id > ${cursorId}
          ORDER BY i.id ASC
          LIMIT ${take}
        `)
      : await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT i.id
          FROM "NomusStockDocumentItem" i
          LEFT JOIN "NomusStockDocument" d ON d.id = i."stockDocumentId"
          WHERE d.id IS NULL
          ORDER BY i.id ASC
          LIMIT ${take}
        `);

    if (rows.length === 0) break;
    for (const row of rows) {
      samples.push(String(row.id));
      cursorId = String(row.id);
      if (samples.length >= limit) break;
    }
    if (rows.length < take) break;
  }

  return samples;
}

async function loadDocumentAggregates(
  prisma: AuditInventoryPrisma
): Promise<{
  total: number;
  documentoSaida: number;
  otherTypes: number;
  nullDataDocumento: number;
  minDataDocumento: string | null;
  maxDataDocumento: string | null;
  minExternalId: number | null;
  maxExternalId: number | null;
  withoutItems: number;
  byType: StageInventoryTypeCount[];
  byYear: StageInventoryYearCount[];
  byMonth: StageInventoryMonthCount[];
  fieldFilled: Record<string, number>;
}> {
  const summaryRows = await prisma.$queryRaw<
    Array<{
      total: unknown;
      documento_saida: unknown;
      other_types: unknown;
      null_data: unknown;
      min_data: unknown;
      max_data: unknown;
      min_external_id: unknown;
      max_external_id: unknown;
      without_items: unknown;
      filled_external_id: unknown;
      filled_id_nfe: unknown;
      filled_tipo: unknown;
      filled_data: unknown;
      filled_raw_json: unknown;
      filled_synced_at: unknown;
      filled_created_at: unknown;
      filled_updated_at: unknown;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (
        WHERE "tipoDocumentoEstoque" = ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
      )::bigint AS documento_saida,
      COUNT(*) FILTER (
        WHERE "tipoDocumentoEstoque" IS DISTINCT FROM ${NOMUS_STOCK_DOCUMENT_TIPO_SAIDA}
      )::bigint AS other_types,
      COUNT(*) FILTER (WHERE "dataDocumento" IS NULL)::bigint AS null_data,
      MIN("dataDocumento") AS min_data,
      MAX("dataDocumento") AS max_data,
      MIN("externalId") AS min_external_id,
      MAX("externalId") AS max_external_id,
      (
        SELECT COUNT(*)::bigint
        FROM "NomusStockDocument" d
        WHERE NOT EXISTS (
          SELECT 1
          FROM "NomusStockDocumentItem" i
          WHERE i."stockDocumentId" = d.id
        )
      ) AS without_items,
      COUNT("externalId")::bigint AS filled_external_id,
      COUNT("idNfe")::bigint AS filled_id_nfe,
      COUNT("tipoDocumentoEstoque")::bigint AS filled_tipo,
      COUNT("dataDocumento")::bigint AS filled_data,
      COUNT("rawJson")::bigint AS filled_raw_json,
      COUNT("syncedAt")::bigint AS filled_synced_at,
      COUNT("createdAt")::bigint AS filled_created_at,
      COUNT("updatedAt")::bigint AS filled_updated_at
    FROM "NomusStockDocument"
  `);

  const summary = summaryRows[0];
  const total = toAuditNumber(summary?.total);

  const byTypeRows = await prisma.$queryRaw<
    Array<{ tipo: string | null; count: unknown }>
  >(Prisma.sql`
    SELECT "tipoDocumentoEstoque" AS tipo, COUNT(*)::bigint AS count
    FROM "NomusStockDocument"
    GROUP BY "tipoDocumentoEstoque"
    ORDER BY count DESC, tipo ASC NULLS LAST
  `);

  const byMonthRows = await prisma.$queryRaw<
    Array<{ year: unknown; month: unknown; count: unknown }>
  >(Prisma.sql`
    SELECT
      EXTRACT(YEAR FROM "dataDocumento")::int AS year,
      EXTRACT(MONTH FROM "dataDocumento")::int AS month,
      COUNT(*)::bigint AS count
    FROM "NomusStockDocument"
    WHERE "dataDocumento" IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 ASC, 2 ASC
  `);

  const byYearMap = new Map<number, number>();
  const byMonth: StageInventoryMonthCount[] = [];
  for (const row of byMonthRows) {
    const year = toAuditNumber(row.year);
    const month = toAuditNumber(row.month);
    const count = toAuditNumber(row.count);
    byMonth.push({ year, month, count });
    byYearMap.set(year, (byYearMap.get(year) ?? 0) + count);
  }

  const byYear: StageInventoryYearCount[] = [...byYearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, count }));

  return {
    total,
    documentoSaida: toAuditNumber(summary?.documento_saida),
    otherTypes: toAuditNumber(summary?.other_types),
    nullDataDocumento: toAuditNumber(summary?.null_data),
    minDataDocumento: toAuditIsoDate(summary?.min_data),
    maxDataDocumento: toAuditIsoDate(summary?.max_data),
    minExternalId: toAuditNullableNumber(summary?.min_external_id),
    maxExternalId: toAuditNullableNumber(summary?.max_external_id),
    withoutItems: toAuditNumber(summary?.without_items),
    byType: byTypeRows.map((row) => ({
      tipoDocumentoEstoque: row.tipo,
      count: toAuditNumber(row.count),
    })),
    byYear,
    byMonth,
    fieldFilled: {
      externalId: toAuditNumber(summary?.filled_external_id),
      idNfe: toAuditNumber(summary?.filled_id_nfe),
      tipoDocumentoEstoque: toAuditNumber(summary?.filled_tipo),
      dataDocumento: toAuditNumber(summary?.filled_data),
      rawJson: toAuditNumber(summary?.filled_raw_json),
      syncedAt: toAuditNumber(summary?.filled_synced_at),
      createdAt: toAuditNumber(summary?.filled_created_at),
      updatedAt: toAuditNumber(summary?.filled_updated_at),
    },
  };
}

async function loadItemAggregates(prisma: AuditInventoryPrisma): Promise<{
  total: number;
  orphanCount: number;
  avgItemsPerDocument: number | null;
  maxItemsPerDocument: number | null;
  withoutProduct: number;
  withoutQuantity: number;
  withoutValue: number;
  fieldFilled: Record<string, number>;
}> {
  const summaryRows = await prisma.$queryRaw<
    Array<{
      total: unknown;
      orphan_count: unknown;
      without_product: unknown;
      without_quantity: unknown;
      without_value: unknown;
      filled_stock_document_id: unknown;
      filled_external_item_id: unknown;
      filled_external_product_id: unknown;
      filled_quantity: unknown;
      filled_unit_value: unknown;
      filled_estimated_total: unknown;
      filled_raw_json: unknown;
      filled_created_at: unknown;
      filled_updated_at: unknown;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      (
        SELECT COUNT(*)::bigint
        FROM "NomusStockDocumentItem" i
        LEFT JOIN "NomusStockDocument" d ON d.id = i."stockDocumentId"
        WHERE d.id IS NULL
      ) AS orphan_count,
      COUNT(*) FILTER (WHERE "externalProductId" IS NULL)::bigint AS without_product,
      COUNT(*) FILTER (WHERE quantity IS NULL)::bigint AS without_quantity,
      COUNT(*) FILTER (WHERE "unitValue" IS NULL)::bigint AS without_value,
      COUNT("stockDocumentId")::bigint AS filled_stock_document_id,
      COUNT("externalItemId")::bigint AS filled_external_item_id,
      COUNT("externalProductId")::bigint AS filled_external_product_id,
      COUNT(quantity)::bigint AS filled_quantity,
      COUNT("unitValue")::bigint AS filled_unit_value,
      COUNT("estimatedTotalValue")::bigint AS filled_estimated_total,
      COUNT("rawJson")::bigint AS filled_raw_json,
      COUNT("createdAt")::bigint AS filled_created_at,
      COUNT("updatedAt")::bigint AS filled_updated_at
    FROM "NomusStockDocumentItem"
  `);

  const summary = summaryRows[0];

  const itemStatsRows = await prisma.$queryRaw<
    Array<{ avg_items: unknown; max_items: unknown }>
  >(Prisma.sql`
    SELECT
      AVG(item_count)::float8 AS avg_items,
      MAX(item_count)::bigint AS max_items
    FROM (
      SELECT COUNT(i.id)::bigint AS item_count
      FROM "NomusStockDocument" d
      LEFT JOIN "NomusStockDocumentItem" i ON i."stockDocumentId" = d.id
      GROUP BY d.id
    ) per_doc
  `);

  const itemStats = itemStatsRows[0];

  return {
    total: toAuditNumber(summary?.total),
    orphanCount: toAuditNumber(summary?.orphan_count),
    avgItemsPerDocument: roundAvg(toAuditNullableNumber(itemStats?.avg_items)),
    maxItemsPerDocument: toAuditNullableNumber(itemStats?.max_items),
    withoutProduct: toAuditNumber(summary?.without_product),
    withoutQuantity: toAuditNumber(summary?.without_quantity),
    withoutValue: toAuditNumber(summary?.without_value),
    fieldFilled: {
      stockDocumentId: toAuditNumber(summary?.filled_stock_document_id),
      externalItemId: toAuditNumber(summary?.filled_external_item_id),
      externalProductId: toAuditNumber(summary?.filled_external_product_id),
      quantity: toAuditNumber(summary?.filled_quantity),
      unitValue: toAuditNumber(summary?.filled_unit_value),
      estimatedTotalValue: toAuditNumber(summary?.filled_estimated_total),
      rawJson: toAuditNumber(summary?.filled_raw_json),
      createdAt: toAuditNumber(summary?.filled_created_at),
      updatedAt: toAuditNumber(summary?.filled_updated_at),
    },
  };
}

export function buildDocumentFieldCoverage(
  total: number,
  fieldFilled: Record<string, number>
): FieldCoverageStat[] {
  const requiredNote = "Coluna NOT NULL no schema — cobertura esperada ~100%.";
  return [
    buildFieldCoverageStat({
      field: "externalId",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.externalId ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "idNfe",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.idNfe ?? 0,
      notes: "Vínculo lógico com NomusNfe.externalId.",
    }),
    buildFieldCoverageStat({
      field: "tipoDocumentoEstoque",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.tipoDocumentoEstoque ?? 0,
    }),
    buildFieldCoverageStat({
      field: "dataDocumento",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.dataDocumento ?? 0,
    }),
    buildFieldCoverageStat({
      field: "rawJson",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.rawJson ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "syncedAt",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.syncedAt ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "createdAt",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.createdAt ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "updatedAt",
      model: "NomusStockDocument",
      presentInSchema: true,
      total,
      filled: fieldFilled.updatedAt ?? 0,
      notes: requiredNote,
    }),
  ];
}

export function buildItemFieldCoverage(
  total: number,
  fieldFilled: Record<string, number>
): FieldCoverageStat[] {
  const requiredNote = "Coluna NOT NULL no schema — cobertura esperada ~100%.";
  const rows: FieldCoverageStat[] = [
    buildFieldCoverageStat({
      field: "stockDocumentId",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.stockDocumentId ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "externalItemId",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.externalItemId ?? 0,
    }),
    buildFieldCoverageStat({
      field: "externalProductId",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.externalProductId ?? 0,
      notes: "Único identificador de produto normalizado no stage do item.",
    }),
    buildFieldCoverageStat({
      field: "quantity",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.quantity ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "unitValue",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.unitValue ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "estimatedTotalValue",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.estimatedTotalValue ?? 0,
      notes: "Derivado no mapper (quantity × unitValue).",
    }),
    buildFieldCoverageStat({
      field: "rawJson",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.rawJson ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "createdAt",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.createdAt ?? 0,
      notes: requiredNote,
    }),
    buildFieldCoverageStat({
      field: "updatedAt",
      model: "NomusStockDocumentItem",
      presentInSchema: true,
      total,
      filled: fieldFilled.updatedAt ?? 0,
      notes: requiredNote,
    }),
  ];

  for (const absent of NOMUS_STOCK_DOCUMENT_ITEM_ABSENT_SCHEMA_FIELDS) {
    rows.push(
      buildFieldCoverageStat({
        field: absent,
        model: "NomusStockDocumentItem",
        presentInSchema: false,
        total: 0,
        filled: 0,
        notes:
          absent === "productCode"
            ? "Não há coluna de código/SKU do produto no stage do item; eventual evidência só em rawJson."
            : "Não há coluna de descrição/nome do produto no stage do item; eventual evidência só em rawJson.",
      })
    );
  }

  return rows;
}

export type StageInventoryCoverageLoad = {
  inventory: StageInventory;
  fieldCoverage: FieldCoverageStat[];
  itemCoverage: FieldCoverageStat[];
};

/**
 * Carrega inventário + cobertura do stage com agregações e amostras paginadas.
 */
export async function loadStageInventoryAndCoverage(
  prisma: AuditInventoryPrisma,
  options: { sampleLimit: number }
): Promise<StageInventoryCoverageLoad> {
  const docs = await loadDocumentAggregates(prisma);
  const items = await loadItemAggregates(prisma);

  const [documentsWithoutItemsExternalIds, orphanItemIds] = await Promise.all([
    sampleDocumentsWithoutItems(prisma, options.sampleLimit),
    sampleOrphanItemIds(prisma, options.sampleLimit),
  ]);

  const inventory = buildEmptyStageInventory();
  inventory.documents = {
    total: docs.total,
    documentoSaida: docs.documentoSaida,
    otherTypes: docs.otherTypes,
    byType: docs.byType,
    byYear: docs.byYear,
    byMonth: docs.byMonth,
    nullDataDocumento: docs.nullDataDocumento,
    minDataDocumento: docs.minDataDocumento,
    maxDataDocumento: docs.maxDataDocumento,
    minExternalId: docs.minExternalId,
    maxExternalId: docs.maxExternalId,
    withoutItems: docs.withoutItems,
  };
  inventory.items = {
    total: items.total,
    orphanCount: items.orphanCount,
    avgItemsPerDocument: items.avgItemsPerDocument,
    maxItemsPerDocument: items.maxItemsPerDocument,
    withoutProduct: items.withoutProduct,
    withoutCode: null,
    withoutDescription: null,
    withoutQuantity: items.withoutQuantity,
    withoutValue: items.withoutValue,
  };
  inventory.samples = {
    documentsWithoutItemsExternalIds,
    orphanItemIds,
  };

  return {
    inventory,
    fieldCoverage: buildDocumentFieldCoverage(docs.total, docs.fieldFilled),
    itemCoverage: buildItemFieldCoverage(items.total, items.fieldFilled),
  };
}
