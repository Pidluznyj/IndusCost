/**
 * Fase processual conservadora. Não prevê meritum nem chance de perda.
 */

import { foldText } from "./legalExposureContracts.js";
import type { ExposureMovementRecord } from "./legalExposureStore.js";

export const CASE_STAGES = [
  "INITIAL",
  "INSTRUCTION",
  "DECISION",
  "APPEAL",
  "LIQUIDATION",
  "ENFORCEMENT",
  "ARCHIVED",
  "UNKNOWN",
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
  INITIAL: "Fase inicial",
  INSTRUCTION: "Instrução",
  DECISION: "Julgamento/decisão",
  APPEAL: "Recurso",
  LIQUIDATION: "Liquidação",
  ENFORCEMENT: "Execução",
  ARCHIVED: "Arquivado",
  UNKNOWN: "Não determinada",
};

export type CaseStageResult = {
  stage: CaseStage;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
};

function textBlob(parts: Array<string | null | undefined>): string {
  return foldText(parts.filter(Boolean).join(" "));
}

export function classifyCaseStage(input: {
  currentStatus: string | null;
  className: string | null;
  archivedAt: string | null;
  movements: Array<Pick<ExposureMovementRecord, "name" | "sourceCode">>;
}): CaseStageResult {
  if (input.archivedAt) {
    return { stage: "ARCHIVED", confidence: "HIGH", reason: "Data de arquivamento informada pela fonte." };
  }
  const status = foldText(input.currentStatus ?? "");
  const klass = foldText(input.className ?? "");
  const movement = textBlob(input.movements.slice(0, 8).map((row) => row.name));
  const blob = `${status} ${klass} ${movement}`;

  if (blob.includes("ARQUIV") || blob.includes("BAIXA") || blob.includes("EXTINT")) {
    return { stage: "ARCHIVED", confidence: "MEDIUM", reason: "Status ou movimento de arquivamento/baixa." };
  }
  if (blob.includes("EXECUC") || blob.includes("CUMPRIMENTO DE SENTEN") || blob.includes("PENHORA")) {
    return { stage: "ENFORCEMENT", confidence: "MEDIUM", reason: "Classe ou movimento de execução." };
  }
  if (blob.includes("LIQUID")) {
    return { stage: "LIQUIDATION", confidence: "MEDIUM", reason: "Liquidação identificada." };
  }
  if (blob.includes("AGRAVO") || blob.includes("RECURSO") || blob.includes("APELAC") || blob.includes("G2")) {
    return { stage: "APPEAL", confidence: "MEDIUM", reason: "Recurso ou segundo grau identificado." };
  }
  if (blob.includes("SENTEN") || blob.includes("JULGAM") || blob.includes("ACORDAO") || blob.includes("DECISAO")) {
    return { stage: "DECISION", confidence: "MEDIUM", reason: "Movimento de julgamento/decisão." };
  }
  if (blob.includes("INSTRU") || blob.includes("AUDIENC") || blob.includes("PROVA") || blob.includes("CONCLUSOS")) {
    return { stage: "INSTRUCTION", confidence: "MEDIUM", reason: "Instrução, audiência ou conclusos." };
  }
  if (blob.includes("DISTRIB") || blob.includes("CITAC") || blob.includes("RECEBIDO") || blob.includes("AUTU")) {
    return { stage: "INITIAL", confidence: "LOW", reason: "Distribuição/autuação identificada." };
  }
  return { stage: "UNKNOWN", confidence: "LOW", reason: "Fontes não sustentam uma fase determinada." };
}
