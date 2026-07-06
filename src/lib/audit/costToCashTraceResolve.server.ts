/**
 * Resolução de priceItemId por SKU/tabela — read-only para API de rastreabilidade.
 */
import type { PrismaClient } from "@prisma/client";
import { resolvePublishedPriceTableVersionForDate } from "../priceTablePublication.server.js";
import {
  COMMERCIAL_TABLE_CODE_PRIORITY,
} from "../pricing/commercialPublishedPrices.server.js";

export type ResolvePublishedPriceItemInput = {
  priceItemId?: string | null;
  sku?: string | null;
  productId?: string | null;
  tableCode?: string | null;
  tableId?: string | null;
  referenceDate?: Date;
};

export type ResolvePublishedPriceItemResult = {
  priceItemId: string | null;
  errorMessage: string | null;
};

function sortTablesByPriority<T extends { code: string }>(tables: T[]): T[] {
  return [...tables].sort((a, b) => {
    const ai = COMMERCIAL_TABLE_CODE_PRIORITY.indexOf(a.code as (typeof COMMERCIAL_TABLE_CODE_PRIORITY)[number]);
    const bi = COMMERCIAL_TABLE_CODE_PRIORITY.indexOf(b.code as (typeof COMMERCIAL_TABLE_CODE_PRIORITY)[number]);
    const ar = ai === -1 ? 999 : ai;
    const br = bi === -1 ? 999 : bi;
    return ar - br || a.code.localeCompare(b.code, "pt-BR");
  });
}

export async function resolvePublishedPriceItemIdForTrace(
  db: PrismaClient,
  input: ResolvePublishedPriceItemInput
): Promise<ResolvePublishedPriceItemResult> {
  const priceItemId = input.priceItemId?.trim();
  if (priceItemId) {
    return { priceItemId, errorMessage: null };
  }

  const sku = input.sku?.trim();
  if (!sku && !input.productId?.trim()) {
    return { priceItemId: null, errorMessage: "Informe priceItemId ou sku." };
  }

  const product = input.productId?.trim()
    ? await db.product.findUnique({
        where: { id: input.productId.trim() },
        select: { id: true, sku: true },
      })
    : await db.product.findUnique({
        where: { sku: sku! },
        select: { id: true, sku: true },
      });

  if (!product) {
    return {
      priceItemId: null,
      errorMessage: `Produto não encontrado para ${sku ? `SKU ${sku}` : "productId informado"}.`,
    };
  }

  const referenceDate = input.referenceDate ?? new Date();
  const tableCode = input.tableCode?.trim();
  const tableId = input.tableId?.trim();

  if (tableCode || tableId) {
    const table = tableId
      ? await db.priceTable.findUnique({ where: { id: tableId }, select: { id: true, code: true } })
      : await db.priceTable.findUnique({ where: { code: tableCode! }, select: { id: true, code: true } });

    if (!table) {
      return {
        priceItemId: null,
        errorMessage: `Tabela comercial não encontrada: ${tableCode ?? tableId}.`,
      };
    }

    const version = await resolvePublishedPriceTableVersionForDate(db, table.id, referenceDate);
    if (!version) {
      return {
        priceItemId: null,
        errorMessage: `Nenhuma versão publicada vigente para tabela ${table.code}.`,
      };
    }

    const item = await db.priceTableItem.findFirst({
      where: { priceTableVersionId: version.id, productId: product.id },
      select: { id: true },
    });

    if (!item) {
      return {
        priceItemId: null,
        errorMessage: `SKU ${product.sku} sem preço publicado na tabela ${table.code}.`,
      };
    }

    return { priceItemId: item.id, errorMessage: null };
  }

  const activeTables = await db.priceTable.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true },
  });

  for (const table of sortTablesByPriority(activeTables)) {
    const version = await resolvePublishedPriceTableVersionForDate(db, table.id, referenceDate);
    if (!version) continue;

    const item = await db.priceTableItem.findFirst({
      where: { priceTableVersionId: version.id, productId: product.id },
      select: { id: true },
    });

    if (item) {
      return { priceItemId: item.id, errorMessage: null };
    }
  }

  return {
    priceItemId: null,
    errorMessage: `SKU ${product.sku} sem preço publicado em tabelas comerciais vigentes.`,
  };
}
