/**
 * Tipos e rótulos compartilhados entre as rotas e a interface da consulta LIKE SERASA (sem código de servidor).
 */
import type { BoaVistaSections } from "./parse.js";
import type { BoaVistaBillingStatus, BoaVistaConsultationMode, BoaVistaConsultationStatus } from "./store.js";

export type LikeSerasaPublicState = "NOT_CONSULTED" | "IN_PROGRESS" | "PARTIAL" | "UNKNOWN_BILLING" | "FAILED" | "VALID" | "STALE";

export const LIKE_SERASA_STATE_LABEL: Record<LikeSerasaPublicState, string> = {
  NOT_CONSULTED: "Nunca consultado",
  IN_PROGRESS: "Consulta em andamento",
  PARTIAL: "Consulta parcial",
  UNKNOWN_BILLING: "Cobrança desconhecida",
  FAILED: "Consulta com falha",
  VALID: "Consulta válida",
  STALE: "Consulta vencida",
};

export const LIKE_SERASA_BILLING_LABEL: Record<BoaVistaBillingStatus, string> = {
  NOT_SENT: "Não enviada (sem cobrança)",
  UNKNOWN: "Indeterminada — conciliar com a Direct Data",
  ESTIMATED: "Estimada pelo valor autorizado",
  NOT_APPLICABLE: "Não se aplica (simulação)",
};

export type LikeSerasaReportView = {
  id: string;
  mode: BoaVistaConsultationMode;
  displayName: string;
  product: string;
  provider: string;
  source: string;
  attribution: string;
  companyName: string;
  cnpj: string;
  cnpjFormatted: string;
  status: BoaVistaConsultationStatus;
  billingStatus: BoaVistaBillingStatus;
  billingLabel: string;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  providerQueryId: string | null;
  providerResult: string | null;
  failureCode: string | null;
  consultedAt: string | null;
  validUntil: string | null;
  requestedByUserId: string;
  score: number | null;
  scoreRaw: string | null;
  scoreClass: string | null;
  riskText: string | null;
  defaultProbability: string | null;
  suggestedLimitCents: number | null;
  suggestedLimitLabel: string | null;
  restrictionCount: number | null;
  confirmedRestriction: boolean;
  insufficient: boolean;
  parserVersion: string | null;
  hasReceipt: boolean;
  sections: BoaVistaSections | null;
};

export type LikeSerasaHistoryLine = {
  id: string;
  mode: BoaVistaConsultationMode;
  status: BoaVistaConsultationStatus;
  billingStatus: BoaVistaBillingStatus;
  billingLabel: string;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  failureCode: string | null;
  providerQueryId: string | null;
  requestedByUserId: string;
  consultedAt: string | null;
  createdAt: string;
  validUntil: string | null;
  score: number | null;
  suggestedLimitLabel: string | null;
};

export type LikeSerasaStatusPayload = {
  displayName: string;
  product: string;
  provider: string;
  source: string;
  attribution: string;
  unitPriceCents: number;
  priceLabel: string;
  cacheTtlMs: number;
  document: { kind: "CNPJ" | "CPF" | "INVALID"; valid: boolean; formatted: string };
  live: { allowed: boolean; reason: string; message: string };
  demo: { allowed: boolean; reason: string };
  canRequest: boolean;
  state: LikeSerasaPublicState;
  stateLabel: string;
  consultation: LikeSerasaReportView | null;
  history: LikeSerasaHistoryLine[];
};

export type LikeSerasaPostResponse = {
  code: string;
  error?: string;
  message: string;
  charged: boolean;
  priceLabel: string;
  mode: BoaVistaConsultationMode;
  consultation: LikeSerasaReportView | null;
};
