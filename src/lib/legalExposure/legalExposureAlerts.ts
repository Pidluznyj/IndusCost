/**
 * Regras de alerta. Não existe score jurídico.
 */

import type { LegalExposureSeverity } from "./legalExposureContracts.js";
import { LIKELY_REVIEW_COPY } from "./legalExposureContracts.js";

export type AlertKind =
  | "CITATION_PENDING"
  | "CITATION_EXPIRED"
  | "INTIMATION_PENDING"
  | "HEARING"
  | "DECISION"
  | "PASSIVE_CASE"
  | "LIKELY_REVIEW"
  | "SOURCE_STALE"
  | "SOURCE_FAILED"
  | "CANCELLATION"
  | "ARCHIVAL"
  | "SOURCE_CONFIRMATION"
  | "CERTIFICATE_EXPIRED";

export type AlertDraft = {
  kind: AlertKind;
  severity: LegalExposureSeverity;
  requiresAction: boolean;
  title: string;
  summary: string;
};

const RULES: Record<AlertKind, Omit<AlertDraft, "kind">> = {
  CITATION_PENDING: {
    severity: "CRITICAL",
    requiresAction: true,
    title: "Citação pendente",
    summary: "Há citação pendente nas fontes consultadas.",
  },
  CITATION_EXPIRED: {
    severity: "CRITICAL",
    requiresAction: true,
    title: "Citação expirada",
    summary: "A fonte informou citação expirada.",
  },
  INTIMATION_PENDING: {
    severity: "HIGH",
    requiresAction: true,
    title: "Intimação nova",
    summary: "Há intimação pendente nas fontes consultadas.",
  },
  HEARING: {
    severity: "HIGH",
    requiresAction: true,
    title: "Audiência detectada",
    summary: "Movimento ou comunicação confiável indica audiência.",
  },
  DECISION: {
    severity: "HIGH",
    requiresAction: true,
    title: "Decisão ou sentença",
    summary: "Há decisão ou sentença estruturada em fonte confiável.",
  },
  PASSIVE_CASE: {
    severity: "HIGH",
    requiresAction: true,
    title: "Processo novo no polo passivo",
    summary: "Processo confirmado em que a empresa está no polo passivo.",
  },
  LIKELY_REVIEW: {
    severity: "MEDIUM",
    requiresAction: true,
    title: LIKELY_REVIEW_COPY,
    summary: "Correspondência nominal exata ainda não confirmada por número ou CNPJ.",
  },
  SOURCE_STALE: {
    severity: "HIGH",
    requiresAction: true,
    title: "Fonte crítica desatualizada",
    summary: "A fonte passou do prazo de frescor e não sustenta ausência de exposição.",
  },
  SOURCE_FAILED: {
    severity: "HIGH",
    requiresAction: true,
    title: "Fonte indisponível",
    summary: "A consulta falhou. Isso não significa que não existam processos.",
  },
  CANCELLATION: {
    severity: "INFO",
    requiresAction: false,
    title: "Cancelamento informado pela fonte",
    summary: "A fonte informou cancelamento.",
  },
  ARCHIVAL: {
    severity: "INFO",
    requiresAction: false,
    title: "Arquivamento ou baixa",
    summary: "A fonte informou arquivamento ou baixa formal.",
  },
  SOURCE_CONFIRMATION: {
    severity: "LOW",
    requiresAction: false,
    title: "Fonte adicional",
    summary: "Outra fonte confirmou um processo já monitorado.",
  },
  CERTIFICATE_EXPIRED: {
    severity: "LOW",
    requiresAction: false,
    title: "Certidão vencida",
    summary: "Pendência administrativa de certidão. Não encerra exposição processual.",
  },
};

export function buildAlertDraft(kind: AlertKind): AlertDraft {
  return { kind, ...RULES[kind] };
}

export function requiresAction(kind: AlertKind): boolean {
  return RULES[kind].requiresAction;
}
