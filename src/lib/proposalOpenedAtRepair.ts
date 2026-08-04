/**
 * Reparo de `Proposal.externalOpenedAt` gravado com o mês/dia trocados.
 *
 * CONTEXTO
 * O sync antigo chamava `new Date("03/08/2026")` antes do regex brasileiro. O
 * JavaScript lê string com barras no formato AMERICANO (MM/DD), então a data
 * de abertura foi gravada invertida — 03/08 virou 08/03. O parser já foi
 * corrigido (`nomusDateTime.ts`), mas as linhas gravadas antes seguem erradas.
 *
 * A recuperação é determinística e sem perda: `externalRawPayload` guarda o
 * `dataHoraAbertura` original em texto. Basta reparsear com o parser correto e
 * comparar com o que está gravado.
 *
 * Lógica pura, sem Prisma — o script decide e persiste.
 */

import {
  isNomusDateTimeFailure,
  isNomusDateTimeSuccess,
  nomusDateTimeToCivilKey,
  parseNomusBrazilianDateTime,
} from "./nomusDateTime.js";

export type ProposalOpenedAtRepairRow = {
  id: string;
  externalProposalCode: string | null;
  sourceSystem: string | null;
  externalOpenedAt: Date | null;
  externalRawPayload: unknown;
};

export type ProposalOpenedAtRepairDecision =
  /** Gravado difere do payload — reparo determinístico disponível. */
  | {
      kind: "REPAIR";
      id: string;
      code: string | null;
      rawText: string;
      storedCivilDate: string | null;
      correctCivilDate: string;
      correctValue: Date;
      /** Inversão dia↔mês: assinatura clássica do defeito. */
      isDayMonthSwap: boolean;
    }
  /** Já está correto. */
  | { kind: "OK"; id: string; code: string | null; civilDate: string }
  /** Não dá para decidir com segurança — nunca reparar no escuro. */
  | {
      kind: "SKIP";
      id: string;
      code: string | null;
      reason: string;
    };

function readRawOpeningText(payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).dataHoraAbertura;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `YYYY-MM-DD` a partir de um Date, no fuso operacional. */
function storedCivilKey(value: Date | null): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return nomusDateTimeToCivilKey(value);
}

/** Dia e mês trocados entre si (03-08 ↔ 08-03), mesmo ano. */
function isDayMonthSwap(storedKey: string | null, correctKey: string): boolean {
  if (!storedKey) return false;
  const [sy, sm, sd] = storedKey.split("-");
  const [cy, cm, cd] = correctKey.split("-");
  return sy === cy && sm === cd && sd === cm;
}

export function decideProposalOpenedAtRepair(
  row: ProposalOpenedAtRepairRow
): ProposalOpenedAtRepairDecision {
  // Só propostas de origem externa: proposta nascida no IndusCost não tem
  // data de origem para conferir.
  if (!row.sourceSystem || row.sourceSystem.trim() === "") {
    return {
      kind: "SKIP",
      id: row.id,
      code: row.externalProposalCode,
      reason: "proposta sem sourceSystem (criada no IndusCost)",
    };
  }

  const rawText = readRawOpeningText(row.externalRawPayload);
  if (!rawText) {
    return {
      kind: "SKIP",
      id: row.id,
      code: row.externalProposalCode,
      reason: "externalRawPayload sem dataHoraAbertura — origem não recuperável",
    };
  }

  const parsed = parseNomusBrazilianDateTime(rawText);
  if (isNomusDateTimeFailure(parsed)) {
    return {
      kind: "SKIP",
      id: row.id,
      code: row.externalProposalCode,
      reason: `dataHoraAbertura inválida no payload: ${parsed.reason}`,
    };
  }
  if (!isNomusDateTimeSuccess(parsed)) {
    return {
      kind: "SKIP",
      id: row.id,
      code: row.externalProposalCode,
      reason: "resultado de parse inesperado",
    };
  }

  const correctCivilDate = nomusDateTimeToCivilKey(parsed.value);
  const storedKey = storedCivilKey(row.externalOpenedAt);

  if (storedKey === correctCivilDate) {
    return {
      kind: "OK",
      id: row.id,
      code: row.externalProposalCode,
      civilDate: correctCivilDate,
    };
  }

  return {
    kind: "REPAIR",
    id: row.id,
    code: row.externalProposalCode,
    rawText,
    storedCivilDate: storedKey,
    correctCivilDate,
    correctValue: parsed.value,
    isDayMonthSwap: isDayMonthSwap(storedKey, correctCivilDate),
  };
}

export type ProposalOpenedAtRepairSummary = {
  analyzed: number;
  okCount: number;
  repairCount: number;
  /** Subconjunto de `repairCount` com a assinatura exata do defeito MM/DD. */
  dayMonthSwapCount: number;
  skipCount: number;
  skipReasons: Record<string, number>;
};

export function summarizeProposalOpenedAtRepair(
  decisions: readonly ProposalOpenedAtRepairDecision[]
): ProposalOpenedAtRepairSummary {
  const skipReasons: Record<string, number> = {};
  let okCount = 0;
  let repairCount = 0;
  let dayMonthSwapCount = 0;
  let skipCount = 0;

  for (const d of decisions) {
    if (d.kind === "OK") okCount += 1;
    else if (d.kind === "REPAIR") {
      repairCount += 1;
      if (d.isDayMonthSwap) dayMonthSwapCount += 1;
    } else {
      skipCount += 1;
      skipReasons[d.reason] = (skipReasons[d.reason] ?? 0) + 1;
    }
  }

  return {
    analyzed: decisions.length,
    okCount,
    repairCount,
    dayMonthSwapCount,
    skipCount,
    skipReasons,
  };
}
