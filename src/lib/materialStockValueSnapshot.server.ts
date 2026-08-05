/**
 * Captura e leitura do histórico do VALOR de matéria-prima em estoque.
 *
 * FONTE ÚNICA: o total é calculado com a MESMA função que alimenta o card
 * "Valor em estoque (MP)" (`sumMaterialCatalogStockValue`), sobre a mesma
 * população (todos os materiais, sem filtro de status — igual à listagem
 * `/api/materials`). Não existe uma segunda fórmula que "deveria" bater.
 *
 * A captura é disparada após cada conferência de estoque, já fora da
 * transação e em regime best-effort: falhar aqui NUNCA pode reverter o
 * estoque oficial que acabou de ser gravado.
 */

import type { PrismaClient } from "@prisma/client";
import {
  countMaterialsWithStockQuantity,
  sumMaterialCatalogStockValue,
} from "./materialQuantityTotal.js";
import {
  aggregateMaterialStockValueByWeek,
  summarizeMaterialStockValueSeries,
  type MaterialStockValueSeriesResponse,
  type MaterialStockValueSnapshotPoint,
} from "./materialStockValueSeries.js";

export type MaterialStockValueSnapshotSourceInput =
  | "CONFERENCE"
  | "MANUAL"
  | "BACKFILL";

export type CaptureMaterialStockValueInput = {
  source: MaterialStockValueSnapshotSourceInput;
  /** Conferência que originou (quando source = CONFERENCE). */
  conferenceId?: string | null;
  /** MP conferida que disparou — contexto, não escopo do total. */
  materialId?: string | null;
  userId?: string | null;
  userName?: string | null;
  /** Instante da captura; default = agora (relógio do servidor). */
  capturedAt?: Date;
};

export type CaptureMaterialStockValueResult = {
  id: string;
  capturedAt: string;
  civilDate: string;
  totalValue: number;
  materialsWithStock: number;
  materialsConsidered: number;
};

/** Data civil em America/Sao_Paulo — chave estável de agregação semanal. */
function toSaoPauloCivilDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Converte data civil (YYYY-MM-DD) em Date UTC de meia-noite, p/ coluna @db.Date. */
function civilDateToUtcDate(civilDate: string): Date {
  const [y, m, d] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/**
 * Calcula o valor total de MP em estoque AGORA, com a fórmula canônica do
 * card. Carrega apenas os campos necessários.
 */
export async function computeCurrentMaterialStockValue(
  db: PrismaClient
): Promise<{
  totalValue: number;
  materialsWithStock: number;
  materialsConsidered: number;
}> {
  const materials = await db.material.findMany({
    select: { quantity: true, currentCost: true },
  });
  // `sumMaterialCatalogStockValue` aceita Decimal (converte via Number).
  const rows = materials.map((m) => ({
    quantity: m.quantity,
    currentCost: m.currentCost,
  }));
  return {
    totalValue: sumMaterialCatalogStockValue(rows),
    materialsWithStock: countMaterialsWithStockQuantity(rows),
    materialsConsidered: rows.length,
  };
}

/**
 * Grava uma foto do valor total de MP em estoque.
 * Append-only: nunca atualiza nem apaga snapshot anterior.
 */
export async function captureMaterialStockValueSnapshot(
  db: PrismaClient,
  input: CaptureMaterialStockValueInput
): Promise<CaptureMaterialStockValueResult> {
  const capturedAt = input.capturedAt ?? new Date();
  const civilDate = toSaoPauloCivilDate(capturedAt);
  const totals = await computeCurrentMaterialStockValue(db);

  const created = await db.materialStockValueSnapshot.create({
    data: {
      capturedAt,
      civilDate: civilDateToUtcDate(civilDate),
      totalValue: totals.totalValue,
      materialsWithStock: totals.materialsWithStock,
      materialsConsidered: totals.materialsConsidered,
      source: input.source,
      conferenceId: input.conferenceId ?? null,
      materialId: input.materialId ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
    },
    select: { id: true },
  });

  return {
    id: created.id,
    capturedAt: capturedAt.toISOString(),
    civilDate,
    totalValue: totals.totalValue,
    materialsWithStock: totals.materialsWithStock,
    materialsConsidered: totals.materialsConsidered,
  };
}

/**
 * Versão best-effort para uso pós-commit: registra o erro e segue.
 * O estoque oficial já foi gravado — perder uma foto do gráfico jamais
 * pode derrubar a conferência do usuário.
 */
export async function captureMaterialStockValueSnapshotBestEffort(
  db: PrismaClient,
  input: CaptureMaterialStockValueInput
): Promise<CaptureMaterialStockValueResult | null> {
  try {
    return await captureMaterialStockValueSnapshot(db, input);
  } catch (error) {
    console.error(
      "[materialStockValueSnapshot] falha ao capturar valor de estoque (ignorado)",
      error
    );
    return null;
  }
}

const DEFAULT_WEEKS = 26;
const MAX_WEEKS = 104;

export function parseMaterialStockValueSeriesQuery(
  query: Record<string, unknown>
): { weeks: number } {
  const raw = Array.isArray(query.weeks) ? query.weeks[0] : query.weeks;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return { weeks: DEFAULT_WEEKS };
  return { weeks: Math.min(MAX_WEEKS, n) };
}

/**
 * Série semanal para o gráfico. Busca os snapshots da janela e delega a
 * agregação ao domínio puro (`aggregateMaterialStockValueByWeek`).
 */
export async function listMaterialStockValueSeries(
  db: PrismaClient,
  input: { weeks: number; now?: Date }
): Promise<MaterialStockValueSeriesResponse> {
  const now = input.now ?? new Date();
  // Janela com folga de 1 semana para a semana corrente entrar inteira.
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - (input.weeks + 1) * 7);

  const rows = await db.materialStockValueSnapshot.findMany({
    where: { civilDate: { gte: fromDate } },
    orderBy: { capturedAt: "asc" },
    select: {
      civilDate: true,
      capturedAt: true,
      totalValue: true,
      materialsWithStock: true,
      materialsConsidered: true,
    },
  });

  const points: MaterialStockValueSnapshotPoint[] = rows.map((r) => ({
    civilDate: r.civilDate.toISOString().slice(0, 10),
    capturedAt: r.capturedAt.toISOString(),
    totalValue: Number(r.totalValue),
    materialsWithStock: r.materialsWithStock,
    materialsConsidered: r.materialsConsidered,
  }));

  const allWeeks = aggregateMaterialStockValueByWeek(points);
  // Recorta para a quantidade pedida (as mais recentes).
  const weeks =
    allWeeks.length > input.weeks ? allWeeks.slice(-input.weeks) : allWeeks;

  return {
    weeks,
    summary: summarizeMaterialStockValueSeries(weeks),
    weeksRequested: input.weeks,
    lastCapturedCivilDate:
      points.length > 0 ? points[points.length - 1]!.civilDate : null,
  };
}
