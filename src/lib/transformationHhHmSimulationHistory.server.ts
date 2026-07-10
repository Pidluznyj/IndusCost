/**
 * Persistência do histórico HH/HM — Prisma apenas neste módulo.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  normalizeTransformationHhHmSimulationListPayload,
  TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS,
  type TransformationHhHmCostSimulationType,
  type TransformationHhHmSimulationCreateInput,
  type TransformationHhHmSimulationListItem,
  type TransformationHhHmSimulationListResponse,
} from "./transformationHhHmSimulationHistory.js";

function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: {
  id: string;
  type: TransformationHhHmCostSimulationType;
  observation: string | null;
  periodLabel: string | null;
  dateAxis: string | null;
  hhEffectiveRate: Prisma.Decimal | null;
  hmEffectiveRate: Prisma.Decimal | null;
  finalHhHmRate: Prisma.Decimal | null;
  inputSnapshot: Prisma.JsonValue;
  resultSnapshot: Prisma.JsonValue;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TransformationHhHmSimulationListItem {
  const normalized = normalizeTransformationHhHmSimulationListPayload({
    items: [
      {
        id: row.id,
        type: row.type,
        typeLabel: TRANSFORMATION_HH_HM_SIMULATION_TYPE_LABELS[row.type],
        observation: row.observation,
        periodLabel: row.periodLabel,
        dateAxis: row.dateAxis,
        hhEffectiveRate: toNumber(row.hhEffectiveRate),
        hmEffectiveRate: toNumber(row.hmEffectiveRate),
        finalHhHmRate: toNumber(row.finalHhHmRate),
        inputSnapshot: row.inputSnapshot,
        resultSnapshot: row.resultSnapshot,
        createdByUserId: row.createdByUserId,
        createdByName: row.createdByName,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    ],
    total: 1,
  });
  return normalized.items[0]!;
}

export async function createTransformationHhHmCostSimulation(
  prisma: PrismaClient,
  input: TransformationHhHmSimulationCreateInput & {
    createdByUserId?: string | null;
    createdByName?: string | null;
  }
): Promise<TransformationHhHmSimulationListItem> {
  const row = await prisma.transformationHhHmCostSimulation.create({
    data: {
      type: input.type,
      observation: input.observation ?? null,
      periodLabel: input.periodLabel ?? null,
      dateAxis: input.dateAxis ?? null,
      hhEffectiveRate: input.hhEffectiveRate ?? null,
      hmEffectiveRate: input.hmEffectiveRate ?? null,
      finalHhHmRate: input.finalHhHmRate ?? null,
      inputSnapshot: input.inputSnapshot as Prisma.InputJsonValue,
      resultSnapshot: input.resultSnapshot as Prisma.InputJsonValue,
      createdByUserId: input.createdByUserId ?? null,
      createdByName: input.createdByName ?? null,
    },
  });
  return mapRow(row);
}

export async function listTransformationHhHmCostSimulations(
  prisma: PrismaClient,
  filters: {
    type?: TransformationHhHmCostSimulationType | null;
    limit?: number;
  } = {}
): Promise<TransformationHhHmSimulationListResponse> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const where =
    filters.type != null
      ? { type: filters.type }
      : {};

  const [rows, total] = await Promise.all([
    prisma.transformationHhHmCostSimulation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.transformationHhHmCostSimulation.count({ where }),
  ]);

  return {
    items: rows.map(mapRow),
    total,
  };
}

export async function getTransformationHhHmCostSimulationById(
  prisma: PrismaClient,
  id: string
): Promise<TransformationHhHmSimulationListItem | null> {
  const row = await prisma.transformationHhHmCostSimulation.findUnique({ where: { id } });
  return row ? mapRow(row) : null;
}
