/**
 * Fase processual conservadora. Não prevê meritum nem chance de perda.
 * Código TPU prevalece sobre texto. Ambiguidade permanece UNKNOWN.
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

/**
 * Códigos TPU confiáveis. Preferir código ao texto.
 * DataJud real TRT9 00002860620215090021:
 * 51 = Conclusão (não audiência); 848 = Trânsito em julgado (não arquivamento); 22 = Baixa Definitiva.
 */
export const TPU_MOVEMENT_STAGE: Record<string, CaseStage> = {
  "26": "INITIAL",
  "193": "DECISION",
  "196": "DECISION",
  "198": "DECISION",
  "220": "DECISION",
  "221": "DECISION",
  "12164": "DECISION",
  "239": "APPEAL",
  "219": "APPEAL",
  "11384": "LIQUIDATION",
  "11385": "ENFORCEMENT",
  "276": "ENFORCEMENT",
  "22": "ARCHIVED",
  "861": "ARCHIVED",
};

const CASE_STAGE_RANK: Record<CaseStage, number> = {
  UNKNOWN: -1,
  INITIAL: 0,
  INSTRUCTION: 1,
  DECISION: 2,
  APPEAL: 3,
  LIQUIDATION: 4,
  ENFORCEMENT: 5,
  ARCHIVED: 6,
};

export type CaseStageResult = {
  stage: CaseStage;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
};

export function stageFromTpuCode(code: string | null | undefined): CaseStage | null {
  if (!code) return null;
  return TPU_MOVEMENT_STAGE[String(code).trim()] ?? null;
}

function betterStage(current: CaseStage, next: CaseStage): CaseStage {
  return CASE_STAGE_RANK[next] > CASE_STAGE_RANK[current] ? next : current;
}

function stageFromPhrase(folded: string): CaseStage | null {
  if (!folded) return null;
  if (folded.includes("BAIXA DEFINITIVA") || folded.includes("ARQUIVAMENTO DEFINITIVO")) return "ARCHIVED";
  if (folded.includes("LIQUIDACAO INICIADA") || folded === "LIQUIDACAO") return "LIQUIDATION";
  if (
    folded.includes("EXECUCAO/CUMPRIMENTO DE SENTENCA INICIADA") ||
    folded.includes("CUMPRIMENTO DE SENTENCA INICIADA") ||
    folded.includes("EXECUCAO INICIADA")
  ) {
    return "ENFORCEMENT";
  }
  if (folded.includes("CONCLUSOS PARA DECISAO")) return "DECISION";
  if (folded.includes("AUDIENCIA")) return "INSTRUCTION";
  if (folded.includes("SENTENCA") || folded.includes("PROCEDENCIA") || folded.includes("IMPROCEDENCIA")) {
    return "DECISION";
  }
  if (folded.includes("AGRAVO DE PETICAO") || folded.includes("INTERPOSICAO DE RECURSO")) return "APPEAL";
  if (folded.includes("DISTRIBUICAO")) return "INITIAL";
  return null;
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

  let fromCode: CaseStage = "UNKNOWN";
  for (const movement of input.movements) {
    const mapped = stageFromTpuCode(movement.sourceCode);
    if (mapped) fromCode = betterStage(fromCode, mapped);
  }
  if (fromCode !== "UNKNOWN") {
    return { stage: fromCode, confidence: "HIGH", reason: "Fase derivada de código TPU da movimentação." };
  }

  let fromText: CaseStage = "UNKNOWN";
  for (const movement of input.movements) {
    const mapped = stageFromPhrase(foldText(movement.name));
    if (mapped) fromText = betterStage(fromText, mapped);
  }
  const statusPhrase = stageFromPhrase(foldText(input.currentStatus ?? ""));
  if (statusPhrase) fromText = betterStage(fromText, statusPhrase);
  if (fromText !== "UNKNOWN") {
    return { stage: fromText, confidence: "MEDIUM", reason: "Fase derivada de descrição oficial da movimentação." };
  }

  const klass = stageFromPhrase(foldText(input.className ?? ""));
  if (klass === "APPEAL" || klass === "ENFORCEMENT" || klass === "LIQUIDATION") {
    return { stage: klass, confidence: "LOW", reason: "Fase derivada da classe processual." };
  }

  return { stage: "UNKNOWN", confidence: "LOW", reason: "Fontes não sustentam uma fase determinada." };
}
