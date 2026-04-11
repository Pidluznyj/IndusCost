/**
 * Funil comercial B2B derivado de Proposal.status (sem CRM paralelo).
 * Probabilidades são heurísticas por etapa — ajuste os números aqui se o negócio mudar.
 */
import type { ProposalStatus } from "@/src/types/commercial";

export const FUNNEL_STATUS_ORDER: ProposalStatus[] = [
  "DRAFT",
  "ANALYSIS",
  "SENT",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELED",
];

/** Metadados por status: rótulo de funil, probabilidade de fechamento, inclusão em pipeline “aberto”. */
export const STATUS_FUNNEL_META: Record<
  ProposalStatus,
  {
    stageLabel: string;
    /** Probabilidade usada no valor ponderado (0–1). */
    probability: number;
    /** Conta em “oportunidades abertas” e valor de pipeline aberto. */
    pipelineOpen: boolean;
  }
> = {
  DRAFT: {
    stageLabel: "Em elaboração / Qualificação",
    probability: 0.2,
    pipelineOpen: true,
  },
  ANALYSIS: {
    stageLabel: "Análise técnico-comercial",
    probability: 0.4,
    pipelineOpen: true,
  },
  SENT: {
    stageLabel: "Proposta enviada / Negociação",
    probability: 0.65,
    pipelineOpen: true,
  },
  APPROVED: { stageLabel: "Ganha", probability: 1, pipelineOpen: false },
  REJECTED: { stageLabel: "Perdida", probability: 0, pipelineOpen: false },
  EXPIRED: {
    stageLabel: "Expirada / Congelada",
    probability: 0.05,
    pipelineOpen: false,
  },
  CANCELED: { stageLabel: "Cancelada", probability: 0, pipelineOpen: false },
};

export function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function proposalExpiryDate(createdAt: string | Date, validityDays: number): Date {
  const start = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const days = Number.isFinite(validityDays) && validityDays > 0 ? validityDays : 15;
  return new Date(start.getTime() + days * 86400000);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export function daysOpen(createdAt: string | Date): number {
  const c = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return daysBetween(c, new Date());
}

/** Aberta comercialmente: rascunho, análise ou enviada. */
export function isPipelineOpenStatus(s: ProposalStatus): boolean {
  return STATUS_FUNNEL_META[s].pipelineOpen;
}

export function weightedNetValue(net: number, status: ProposalStatus): number {
  return net * STATUS_FUNNEL_META[status].probability;
}

/** Navegação para o módulo Propostas e abre a proposta (App + ProposalModule). */
export const STORAGE_OPEN_PROPOSAL_KEY = "induscost_openProposalId";
export const EVENT_OPEN_PROPOSAL = "induscost-open-proposal";

/** Persiste o id e notifica o App para focar o módulo Propostas; o ProposalModule lê o storage ao carregar. */
export function requestOpenProposal(id: string): void {
  try {
    sessionStorage.setItem(STORAGE_OPEN_PROPOSAL_KEY, id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT_OPEN_PROPOSAL));
}
