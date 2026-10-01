/**
 * Narrativa executiva do processo para PDF e resumo.
 * Só emite frases sustentadas pelos dados.
 */

import { ACTION_NONE_QUALIFIED_COPY, actionLevelRank } from "./legalExposureActionClassifier.js";
import type { ExposureCaseListItem } from "./legalExposureContracts.js";
import { formatExposureDate, formatExposureDateTime } from "./legalExposureCaseListUi.js";
import type { ExposureMovementExecutiveItem } from "./legalExposureMovementExecutive.js";
import { sortMovementsForPdf } from "./legalExposureMovementExecutive.js";

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function buildProcessStoryNarrative(input: {
  dossier: Pick<
    ExposureCaseListItem,
    | "className"
    | "filedAt"
    | "claimants"
    | "groupEntities"
    | "courtUnit"
    | "tribunal"
    | "stage"
    | "stageLabel"
    | "claimValueFormatted"
    | "movementCount"
    | "publicationCount"
    | "latestMovement"
    | "latestPublication"
    | "nextHearing"
    | "currentStatus"
  >;
  movements: ExposureMovementExecutiveItem[];
}): string {
  const { dossier, movements } = input;
  const sentences: string[] = [];
  const claimants = dossier.claimants.map((row) => row.name).filter(Boolean);
  const defendants = dossier.groupEntities.filter((row) => row.pole === "PASSIVE").map((row) => row.legalName);
  const where = [dossier.courtUnit, dossier.tribunal].filter(Boolean).join(", ");
  const filed = formatExposureDate(dossier.filedAt);
  const className = (dossier.className ?? "processo").toLowerCase();
  const who = claimants.length ? claimants.join(", ") : "parte autora ainda não identificada nas fontes";
  const against = defendants.length ? defendants.join(", ") : "empresa do grupo";
  const start = filed
    ? `Trata-se de ${className} ajuizada em ${filed} por ${who} contra ${against}`
    : `Trata-se de ${className} em que ${who} figura contra ${against}`;
  sentences.push(where ? `${start}, em tramitação perante ${where}.` : `${start}.`);

  if (dossier.stage && dossier.stage !== "UNKNOWN") {
    sentences.push(`O processo encontra-se atualmente em fase de ${dossier.stageLabel.toLowerCase()}.`);
  }
  if (dossier.claimValueFormatted) {
    sentences.push(`O valor da causa informado pelas fontes é ${dossier.claimValueFormatted}.`);
  }
  const movementCount = Math.max(dossier.movementCount, movements.filter((row) => row.displayKind === "movement" || row.kind === "movement").length);
  const publicationCount = Math.max(
    dossier.publicationCount,
    movements.filter((row) => row.kind === "publication" || row.displayKind === "publication").length
  );
  if (movementCount > 0 || publicationCount > 0) {
    const parts = [
      movementCount > 0 ? `${movementCount} movimentaç${movementCount === 1 ? "ão" : "ões"}` : null,
      publicationCount > 0 ? `${publicationCount} publica${publicationCount === 1 ? "ção" : "ções"}` : null,
    ].filter(Boolean);
    sentences.push(`Foram identificadas ${parts.join(" e ")}.`);
  }

  const latest = sortMovementsForPdf(movements).at(-1) ?? null;
  if (latest) {
    const when = formatExposureDate(latest.occurredAt ?? latest.at);
    sentences.push(
      `A movimentação mais recente conhecida é ${latest.title.toLowerCase()}${when ? `, em ${when}` : ""}.`
    );
  } else if (dossier.latestMovement?.name) {
    const when = formatExposureDate(dossier.latestMovement.occurredAt);
    sentences.push(`A movimentação mais recente conhecida é ${dossier.latestMovement.name.toLowerCase()}${when ? `, em ${when}` : ""}.`);
  }

  if (dossier.nextHearing?.scheduledAt) {
    const when = formatExposureDateTime(dossier.nextHearing.scheduledAt);
    sentences.push(
      `Há audiência ${dossier.nextHearing.type ? dossier.nextHearing.type.toLowerCase() + " " : ""}designada para ${when ?? "data informada pelas fontes"}.`
    );
  }

  const attention = movements.filter((row) => actionLevelRank(row.actionLevel) >= actionLevelRank("REVIEW"));
  const newestAttention = attention.find((row) => row.isNew) ?? attention[0];
  if (newestAttention) {
    sentences.push(`Existe uma providência recomendada para revisão: ${newestAttention.actionLabel.toLowerCase()}`);
  }

  return sentences.map((row) => sentenceCase(row.replace(/\s+/g, " ").trim())).join(" ");
}

export function buildAttentionSectionCopy(movements: ExposureMovementExecutiveItem[]): {
  state: "ACTIONS" | "REVIEW" | "NONE";
  title: string;
  body: string;
} {
  const actionable = movements.filter((row) => actionLevelRank(row.actionLevel) >= actionLevelRank("DEADLINE_OR_EVENT"));
  const review = movements.filter((row) => actionLevelRank(row.actionLevel) >= actionLevelRank("REVIEW"));
  if (actionable.length > 0) {
    return {
      state: "ACTIONS",
      title: "Ações/prazos identificados",
      body: actionable.map((row) => row.actionLabel).join(" "),
    };
  }
  if (review.length > 0) {
    return {
      state: "REVIEW",
      title: "Revisão recomendada",
      body: review.map((row) => row.actionLabel).join(" "),
    };
  }
  return {
    state: "NONE",
    title: "Nenhuma ação explícita identificada nas fontes",
    body: ACTION_NONE_QUALIFIED_COPY,
  };
}

export function originFacts(dossier: Pick<
  ExposureCaseListItem,
  "filedAt" | "claimants" | "groupEntities" | "className" | "subjects" | "claimValueFormatted" | "courtUnit" | "tribunal"
>): Array<[string, string]> {
  return [
    ["Ajuizamento/distribuição", formatExposureDate(dossier.filedAt) ?? "não informado pelas fontes"],
    ["Autor/reclamante", dossier.claimants.map((row) => row.name).join("; ") || "não identificado"],
    ["Réus (grupo)", dossier.groupEntities.filter((row) => row.pole === "PASSIVE").map((row) => row.legalName).join("; ") || "não identificado"],
    ["Classe", dossier.className ?? "não informada"],
    ["Assuntos", dossier.subjects.map((row) => row.name).join("; ") || "não informados"],
    ["Valor", dossier.claimValueFormatted ?? "não informado"],
    ["Vara", dossier.courtUnit ?? "não informada"],
    ["Tribunal", dossier.tribunal ?? "não informado"],
  ];
}
