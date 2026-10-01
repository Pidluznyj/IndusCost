/**
 * Classificador determinístico de triagem — não é parecer jurídico.
 * Não calcula prazo em dias úteis nem data final processual.
 */

import { foldText } from "./legalExposureContracts.js";

export const EXPOSURE_ACTION_LEVELS = [
  "NONE",
  "REVIEW",
  "ACTION_POSSIBLE",
  "DEADLINE_OR_EVENT",
  "URGENT_REVIEW",
] as const;
export type ExposureActionLevel = (typeof EXPOSURE_ACTION_LEVELS)[number];

export const ACTION_CLASSIFIER_DISCLAIMER =
  "Classificação automática para triagem. Revise o processo quando necessário.";

export const ACTION_NONE_COPY = "Nenhuma ação explícita identificada.";
export const ACTION_NONE_QUALIFIED_COPY =
  "Nenhuma ação explícita foi identificada automaticamente nas fontes consultadas até a data-base deste relatório.";

const LEVEL_RANK: Record<ExposureActionLevel, number> = {
  NONE: 0,
  REVIEW: 1,
  ACTION_POSSIBLE: 2,
  DEADLINE_OR_EVENT: 3,
  URGENT_REVIEW: 4,
};

const ROUTINE =
  /\b(CONCLUSOS?|JUNTADA|DISTRIBU|REMESSA|AUTUAD|RECEBIDOS? OS AUTOS|CERTIDAO DE PUBLICACAO|VISTA DOS AUTOS)\b/;

export type ExposureActionClassification = {
  actionLevel: ExposureActionLevel;
  actionLabel: string;
  deadlineText: string | null;
  deadlineAt: string | null;
  topic: string | null;
};

export function actionLevelRank(level: ExposureActionLevel): number {
  return LEVEL_RANK[level];
}

export function maxActionLevel(
  levels: Array<ExposureActionLevel | null | undefined>
): ExposureActionLevel {
  let best: ExposureActionLevel = "NONE";
  for (const level of levels) {
    if (level && LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

export function extractExplicitDeadline(text: string): { deadlineText: string; deadlineAt: string | null } | null {
  const folded = foldText(text);
  if (!folded) return null;
  const dateMatch = folded.match(/\bATE\s+(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (dateMatch) {
    const day = dateMatch[1]!.padStart(2, "0");
    const month = dateMatch[2]!.padStart(2, "0");
    const year = dateMatch[3]!;
    return {
      deadlineText: `até ${day}/${month}/${year}`,
      deadlineAt: `${year}-${month}-${day}T12:00:00.000-03:00`,
    };
  }
  const useful = folded.match(/\b(?:NO\s+PRAZO\s+DE|PRAZO\s+DE|PRAZO\s+)\s*(\d{1,3})\s+(DIAS?\s+UTEIS|DIAS?\s+CORRIDOS|DIAS?|HORAS?)\b/);
  if (useful) {
    const count = useful[1]!;
    const unitRaw = useful[2]!;
    const unit =
      unitRaw.includes("UTEIS") ? "dias úteis" : unitRaw.includes("CORR") ? "dias corridos" : unitRaw.includes("HORA") ? "horas" : "dias";
    return { deadlineText: `${count} ${unit}`, deadlineAt: null };
  }
  return null;
}

function topicOf(folded: string): string | null {
  if (folded.includes("CITAC")) return "CITAÇÃO";
  if (folded.includes("INTIM")) return "INTIMAÇÃO";
  if (folded.includes("AUDIEN")) return "AUDIÊNCIA";
  if (folded.includes("PERICIA") || folded.includes("PERÍCIA")) return "PERÍCIA";
  if (folded.includes("SENTEN")) return "SENTENÇA";
  if (/\bDECISA/.test(folded)) return "DECISÃO";
  if (folded.includes("PENHOR")) return "PENHORA";
  if (folded.includes("BLOQUEIO")) return "BLOQUEIO";
  if (folded.includes("EXECUC")) return "EXECUÇÃO";
  if (folded.includes("RECURSO") || folded.includes("RECURSAL")) return "RECURSO";
  if (folded.includes("TUTELA") || folded.includes("LIMINAR")) return "TUTELA";
  return null;
}

function labelFor(level: ExposureActionLevel, deadlineText: string | null, topic: string | null): string {
  if (level === "NONE") return ACTION_NONE_COPY;
  if (level === "DEADLINE_OR_EVENT") {
    if (deadlineText) return `Prazo mencionado: ${deadlineText}.`;
    if (topic === "AUDIÊNCIA") return "Audiência designada — conferir data, hora e local.";
    return "Há prazo ou evento futuro identificado nas fontes.";
  }
  if (level === "URGENT_REVIEW") {
    if (deadlineText) return `Revisão urgente. Prazo mencionado: ${deadlineText}.`;
    if (topic) return `Revisão urgente recomendada (${topic.toLowerCase()}).`;
    return "Revisão urgente recomendada.";
  }
  if (level === "ACTION_POSSIBLE") return "Pode exigir providência. Revise o processo.";
  if (topic === "INTIMAÇÃO") return "Revisar conteúdo da intimação.";
  if (topic === "CITAÇÃO") return "Revisar conteúdo da citação.";
  if (topic === "SENTENÇA" || topic === "DECISÃO") return "Revisar a decisão/sentença identificada.";
  return "Revisar conteúdo desta movimentação.";
}

export function classifyExposureAction(input: {
  kind?: string | null;
  title?: string | null;
  description?: string | null;
  subject?: string | null;
  communicationType?: string | null;
  scheduledAt?: string | null;
}): ExposureActionClassification {
  const blob = [input.kind, input.title, input.description, input.subject, input.communicationType]
    .filter(Boolean)
    .join(" ");
  const folded = foldText(blob);
  const deadline = extractExplicitDeadline(blob);
  const topic = topicOf(folded);
  const isHearing = input.kind === "hearing" || Boolean(topic === "AUDIÊNCIA" || input.scheduledAt);
  const hoursDeadline = Boolean(deadline?.deadlineText.toLowerCase().includes("hora"));

  let actionLevel: ExposureActionLevel = "NONE";
  if (/\b(PENHOR|BLOQUEIO|TUTELA|LIMINAR)\b/.test(folded) || (folded.includes("EXECUC") && !folded.includes("CONCLUS"))) {
    actionLevel = "URGENT_REVIEW";
  } else if (hoursDeadline) {
    actionLevel = "URGENT_REVIEW";
  } else if (isHearing && (input.scheduledAt || deadline || folded.includes("DESIGNAD") || folded.includes("AUDIEN"))) {
    actionLevel = "DEADLINE_OR_EVENT";
  } else if (deadline) {
    actionLevel = "DEADLINE_OR_EVENT";
  } else if (ROUTINE.test(folded)) {
    actionLevel = "NONE";
  } else if (
    topic === "CITAÇÃO" ||
    topic === "INTIMAÇÃO" ||
    topic === "SENTENÇA" ||
    topic === "DECISÃO" ||
    topic === "PERÍCIA" ||
    topic === "RECURSO"
  ) {
    actionLevel = "REVIEW";
  } else if (folded.includes("CUMPR") && (folded.includes("INTIM") || folded.includes("PRAZO"))) {
    actionLevel = "ACTION_POSSIBLE";
  }

  return {
    actionLevel,
    actionLabel: labelFor(actionLevel, deadline?.deadlineText ?? null, topic),
    deadlineText: deadline?.deadlineText ?? null,
    deadlineAt: deadline?.deadlineAt ?? null,
    topic,
  };
}

export function actionRequiresPersistentAlert(level: ExposureActionLevel, topic: string | null): boolean {
  if (level === "NONE") return false;
  if (level === "URGENT_REVIEW" || level === "DEADLINE_OR_EVENT") return true;
  return Boolean(topic && ["CITAÇÃO", "INTIMAÇÃO", "SENTENÇA", "DECISÃO", "PERÍCIA", "RECURSO"].includes(topic));
}
