/**
 * Lógica auxiliar para Sincronização Incremental de Propostas Nomus.
 */
import type { PrismaClient } from "@prisma/client";
import { NOMUS_PROPOSALS_SYNC_TARGET } from "./nomusProposalsSyncConstants.js";

export type IncrementalWindowResult = {
  startDate: Date;
  overlapFrom: Date | null;
  lastSuccessfulCheckpoint: Date | null;
  isIncremental: boolean;
};

/**
 * Consulta a última execução bem-sucedida de propostas em `IntegrationRun`.
 * Retorna null se nenhuma execução SUCCESS em modo `apply` for encontrada.
 */
export async function getLatestProposalsSuccessfulCheckpoint(
  prisma: PrismaClient
): Promise<Date | null> {
  const lastRun = await prisma.integrationRun.findFirst({
    where: {
      sourceSystem: "NOMUS",
      target: NOMUS_PROPOSALS_SYNC_TARGET,
      status: "SUCCESS",
      mode: "apply",
    },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true, startedAt: true },
  });

  return lastRun?.finishedAt ?? lastRun?.startedAt ?? null;
}

import { parseNomusBrazilianDateTime } from "./nomusDateTime.js";

export function parseProposalEventDate(proposal: Record<string, unknown>): Date | null {
  const rawDate =
    proposal.dataHoraAlteracao ??
    proposal.dataAlteracao ??
    proposal.dataHoraUltimaAlteracao ??
    proposal.dataHoraModificacao ??
    proposal.dataHoraAbertura;
  if (!rawDate) return null;
  const brazilian = parseNomusBrazilianDateTime(rawDate);
  if (brazilian.ok) return brazilian.value;
  if (typeof rawDate === "string" && !rawDate.includes("/")) {
    const iso = new Date(rawDate.trim());
    if (!Number.isNaN(iso.getTime())) return iso;
  }
  return null;
}

/**
 * Calcula a janela incremental com sobreposição de segurança (safety overlap).
 */
export function calculateProposalsIncrementalWindow(input: {
  lastCheckpoint: Date | null;
  now?: Date;
  overlapMinutes?: number;
  envStartDate?: Date | null;
  forceFull?: boolean;
}): IncrementalWindowResult {
  const now = input.now ?? new Date();
  const overlapMinutes = Math.max(0, input.overlapMinutes ?? 30);

  if (input.forceFull || !input.lastCheckpoint) {
    const fallbackStart =
      input.envStartDate ?? new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    return {
      startDate: fallbackStart,
      overlapFrom: null,
      lastSuccessfulCheckpoint: input.lastCheckpoint ?? null,
      isIncremental: false,
    };
  }

  const overlapFrom = new Date(
    input.lastCheckpoint.getTime() - overlapMinutes * 60 * 1000
  );
  return {
    startDate: overlapFrom,
    overlapFrom,
    lastSuccessfulCheckpoint: input.lastCheckpoint,
    isIncremental: true,
  };
}

export type ProposalPlanComparisonItem = {
  productId: string;
  quantity: number;
  unitCost: number;
  negotiatedPrice: number;
  marginValue: number;
  externalItemId?: number | null;
};

export type ProposalPlanComparisonData = {
  externalProposalId: number;
  externalProposalCode: string;
  customerId: string;
  status: string;
  totalItems: number;
  totalGrossValue: number;
  totalNetValue: number;
  totalCost: number;
  totalMarginValue: number;
  totalTaxes: number;
  items: ProposalPlanComparisonItem[];
};

export type ExistingProposalDbData = {
  id: string;
  externalProposalId: number | null;
  externalProposalCode: string | null;
  customerId: string | null;
  status: string;
  totalItems: number;
  totalGrossValue: PrismaClient extends Record<string, unknown> ? unknown : any;
  totalNetValue: any;
  totalCost: any;
  totalMarginValue: any;
  totalTaxes: any;
  items: Array<{
    id: string;
    productId: string;
    quantity: any;
    unitCost: any;
    negotiatedPrice: any;
    marginValue: any;
    externalItemId: number | null;
  }>;
};

function roundMoney(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function numVal(v: unknown): number {
  if (typeof v === "number") return v;
  if (v != null && typeof v === "object" && "toNumber" in v && typeof (v as { toNumber: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Compara uma `ProposalPlan` proposta contra os dados atuais da proposta no banco.
 * Retorna true se 100% idênticos (sem necessidade de update ou substituição de itens).
 */
export function isProposalPlanEqual(
  plan: ProposalPlanComparisonData,
  existing: ExistingProposalDbData
): boolean {
  if (existing.customerId !== plan.customerId) return false;
  if (existing.status !== plan.status) return false;
  if (existing.totalItems !== plan.totalItems) return false;
  if (roundMoney(numVal(existing.totalNetValue)) !== roundMoney(plan.totalNetValue)) return false;
  if (roundMoney(numVal(existing.totalGrossValue)) !== roundMoney(plan.totalGrossValue)) return false;
  if (roundMoney(numVal(existing.totalCost)) !== roundMoney(plan.totalCost)) return false;
  if (roundMoney(numVal(existing.totalMarginValue)) !== roundMoney(plan.totalMarginValue)) return false;
  if (roundMoney(numVal(existing.totalTaxes)) !== roundMoney(plan.totalTaxes)) return false;

  if (existing.items.length !== plan.items.length) return false;

  // Comparação linha a linha dos itens
  for (let i = 0; i < plan.items.length; i += 1) {
    const itemPlan = plan.items[i];
    const itemDb = existing.items[i];
    if (!itemDb) return false;

    if (itemDb.productId !== itemPlan.productId) return false;
    if (roundMoney(numVal(itemDb.quantity)) !== roundMoney(itemPlan.quantity)) return false;
    if (roundMoney(numVal(itemDb.negotiatedPrice)) !== roundMoney(itemPlan.negotiatedPrice)) return false;
    if (roundMoney(numVal(itemDb.unitCost)) !== roundMoney(itemPlan.unitCost)) return false;
    if (roundMoney(numVal(itemDb.marginValue)) !== roundMoney(itemPlan.marginValue)) return false;
  }

  return true;
}
