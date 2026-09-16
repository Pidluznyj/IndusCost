/**
 * Rematerializa totalAmount do espelho Nomus a partir do rawPayload já persistido.
 *
 * Não chama a API Nomus. Não cria pedido. Não apaga histórico.
 * Idempotente: só atualiza cabeçalho/linhas cujo valor financeiro mudou.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { mapNomusPurchaseOrderPayload } from "./nomusPurchaseOrderMapper.js";
import type { JsonObject, MappedNomusPurchaseOrder } from "./nomusPurchaseOrderTypes.js";

type DecimalLike = { toString(): string } | number | null | undefined;

export function moneyNumber(value: DecimalLike): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export function moneyEquals(stored: DecimalLike, mapped: number | null): boolean {
  const left = moneyNumber(stored);
  if (left == null && mapped == null) return true;
  if (left == null || mapped == null) return false;
  return Math.round(left * 100) === Math.round(mapped * 100);
}

function toDecimal(value: number | null | undefined): Prisma.Decimal | null {
  return value == null || !Number.isFinite(value) ? null : new Prisma.Decimal(value);
}

export type RematerializeOrderRow = {
  id: string;
  externalId: number;
  totalAmount: DecimalLike;
  rawPayload: unknown;
  items: Array<{ id: string; lineIndex: number; totalAmount: DecimalLike }>;
};

export function planNomusPurchaseOrderFinancialRematerialize(
  row: RematerializeOrderRow
): { action: "skip_unmapped" | "unchanged" | "update"; mapped: MappedNomusPurchaseOrder | null } {
  const raw = row.rawPayload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { action: "skip_unmapped", mapped: null };
  }
  const mapped = mapNomusPurchaseOrderPayload(raw as JsonObject);
  if (!mapped.ok) return { action: "skip_unmapped", mapped: null };

  const headerChanged = !moneyEquals(row.totalAmount, mapped.row.totalAmount);
  const itemChanged = mapped.row.items.some((item) => {
    const stored = row.items.find((line) => line.lineIndex === item.lineIndex);
    if (!stored) return mapped.row.totalAmount != null && item.totalAmount != null;
    return !moneyEquals(stored.totalAmount, item.totalAmount);
  });
  return {
    action: headerChanged || itemChanged ? "update" : "unchanged",
    mapped: mapped.row,
  };
}

export type RematerializeFinancialCounts = {
  scanned: number;
  updated: number;
  unchanged: number;
  skippedUnmapped: number;
  failed: number;
};

export type RematerializeFinancialOptions = {
  dryRun?: boolean;
  limit?: number;
  batchSize?: number;
  onlyMissing?: boolean;
};

type RematerializeDb = Pick<PrismaClient, "nomusPurchaseOrder" | "nomusPurchaseOrderItem">;

export async function rematerializeNomusPurchaseOrderFinancials(
  prisma: RematerializeDb,
  options: RematerializeFinancialOptions = {}
): Promise<RematerializeFinancialCounts> {
  const dryRun = options.dryRun === true;
  const onlyMissing = options.onlyMissing !== false;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 200, 1000));
  const limit = options.limit != null && Number.isFinite(options.limit) ? Math.max(0, options.limit) : null;

  const counts: RematerializeFinancialCounts = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    skippedUnmapped: 0,
    failed: 0,
  };

  let cursor: string | null = null;
  while (true) {
    if (limit != null && counts.scanned >= limit) break;
    const take = limit != null ? Math.min(batchSize, limit - counts.scanned) : batchSize;
    const rows = await prisma.nomusPurchaseOrder.findMany({
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      where: onlyMissing
        ? {
            OR: [{ totalAmount: null }, { items: { some: { totalAmount: null } } }],
          }
        : undefined,
      select: {
        id: true,
        externalId: true,
        totalAmount: true,
        rawPayload: true,
        items: { select: { id: true, lineIndex: true, totalAmount: true } },
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      counts.scanned += 1;
      try {
        const plan = planNomusPurchaseOrderFinancialRematerialize(row);
        if (plan.action === "skip_unmapped") {
          counts.skippedUnmapped += 1;
          continue;
        }
        if (plan.action === "unchanged" || !plan.mapped) {
          counts.unchanged += 1;
          continue;
        }
        if (!dryRun) {
          await prisma.nomusPurchaseOrder.update({
            where: { id: row.id },
            data: {
              totalAmount: toDecimal(plan.mapped.totalAmount),
              discountAmount: toDecimal(plan.mapped.discountAmount),
              freightAmount: toDecimal(plan.mapped.freightAmount),
            },
          });
          for (const item of plan.mapped.items) {
            await prisma.nomusPurchaseOrderItem.updateMany({
              where: { purchaseOrderId: row.id, lineIndex: item.lineIndex },
              data: { totalAmount: toDecimal(item.totalAmount) },
            });
          }
        }
        counts.updated += 1;
      } catch {
        counts.failed += 1;
      }
    }

    if (rows.length < take) break;
  }

  return counts;
}
