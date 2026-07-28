/**
 * Consulta paginada do histórico de conferência — somente leitura.
 * Não permite editar/excluir registros.
 */
import type { PrismaClient } from "@prisma/client";
import { MaterialStockConferenceError } from "./materialStockConferenceRules.js";
import { roundMaterialStockQuantity } from "./materialStockConferenceMath.js";
import { assertMaterialStockMaterialId } from "./materialStockParametersRules.js";
import {
  MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE,
  MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE,
  type MaterialStockHistoryListItem,
  type MaterialStockHistoryResponse,
} from "./materialStockTabletTypes.js";

function toNumber(value: unknown): number {
  const n = roundMaterialStockQuantity(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePage(value: unknown, fallback = 1): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parsePageSize(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE;
  return Math.min(MATERIAL_STOCK_TABLET_MAX_PAGE_SIZE, n);
}

export function parseMaterialStockHistoryQuery(
  query: Record<string, unknown>
): { page: number; pageSize: number; skip: number } {
  const page = parsePage(query.page);
  const pageSize = parsePageSize(query.pageSize ?? query.limit);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function serializeHistoryRow(row: {
  id: string;
  recordedAt: Date;
  userId: string;
  userName: string | null;
  previousQuantity: unknown;
  reportedQuantity: unknown;
  difference: unknown;
  unitSnapshot: string;
  reason: string;
  notes: string | null;
  source: string;
}): MaterialStockHistoryListItem {
  return {
    id: row.id,
    recordedAt: row.recordedAt.toISOString(),
    userId: row.userId,
    userName: row.userName,
    previousQuantity: toNumber(row.previousQuantity),
    reportedQuantity: toNumber(row.reportedQuantity),
    difference: toNumber(row.difference),
    unit: row.unitSnapshot,
    reason: row.reason,
    notes: row.notes,
    source: row.source,
  };
}

export async function listMaterialStockConferenceHistory(
  db: PrismaClient,
  input: {
    materialId: string;
    query: Record<string, unknown>;
  }
): Promise<MaterialStockHistoryResponse> {
  const materialId = assertMaterialStockMaterialId(input.materialId);
  const { page, pageSize, skip } = parseMaterialStockHistoryQuery(input.query);

  const material = await db.material.findUnique({
    where: { id: materialId },
    select: { id: true },
  });
  if (!material) {
    throw new MaterialStockConferenceError(
      "NOT_FOUND",
      "Matéria-prima não encontrada.",
      "materialId"
    );
  }

  const where = { materialId };
  const [rows, total] = await Promise.all([
    db.materialStockConference.findMany({
      where,
      orderBy: { recordedAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        recordedAt: true,
        userId: true,
        userName: true,
        previousQuantity: true,
        reportedQuantity: true,
        difference: true,
        unitSnapshot: true,
        reason: true,
        notes: true,
        source: true,
      },
    }),
    db.materialStockConference.count({ where }),
  ]);

  return {
    rows: rows.map(serializeHistoryRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
