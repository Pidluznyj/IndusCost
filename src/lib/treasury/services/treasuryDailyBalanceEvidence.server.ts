/**
 * Evidências de saldo por conta × dia civil — server-only.
 *
 * Carrega, numa passada só por período, tudo que a autoridade de saldos
 * precisa: snapshots MANUAL (abertura/fechamento da rotina "Saldos do Dia" e
 * genérico da tela "Saldo"), fechamentos formais CLOSED por companyCode e a
 * posição mais recente por conta (card "Caixa hoje" — informativo).
 *
 * Bucketing civil SEMPRE em America/Sao_Paulo (`civilDateFromInstantInSaoPaulo`):
 * um saldo informado às 21h de São Paulo nunca cai no dia seguinte por o
 * servidor rodar em UTC.
 */

import type { PrismaClient } from "@prisma/client";
import {
  civilDateFromInstantInSaoPaulo,
  civilDateRangeForDbDate,
} from "../contracts/treasuryCivilDate.js";
import { parseTreasuryDailyRoutineSnapshotKey } from "../domain/treasuryDailyAccountRoutineRules.js";
import type {
  TreasuryFormalClosingEvidenceInput,
  TreasuryManualBalanceEvidenceInput,
} from "../domain/treasuryDailyBalanceAuthority.js";

export type TreasuryBalanceSnapshotRowForEvidence = {
  accountId: string;
  idempotencyKey: string;
  referenceAt: Date;
  createdAt: Date;
  availableBalance: { toString(): string } | string | number;
  origin: string;
};

export type TreasuryClassifiedBalanceSnapshot =
  | { kind: "OPENING"; civilDate: string; version: number }
  | { kind: "CLOSING"; civilDate: string; version: number }
  | { kind: "GENERIC"; civilDate: string; version: null };

/**
 * Classifica um snapshot pela chave de idempotência (rotina) ou pelo
 * `referenceAt` em America/Sao_Paulo (genérico). Puro.
 */
export function classifyTreasuryBalanceSnapshotRow(
  row: Pick<TreasuryBalanceSnapshotRowForEvidence, "idempotencyKey" | "referenceAt">
): TreasuryClassifiedBalanceSnapshot {
  const parsed = parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey);
  if (parsed) {
    if (parsed.kind === "opening") {
      return { kind: "OPENING", civilDate: parsed.civilDate, version: parsed.version };
    }
    return { kind: "CLOSING", civilDate: parsed.civilDate, version: parsed.version };
  }
  return {
    kind: "GENERIC",
    civilDate: civilDateFromInstantInSaoPaulo(row.referenceAt),
    version: null,
  };
}

/** `availableBalance` pode vir como string ou objeto Decimal-like ({toString()}). */
function toAmountNumber(value: { toString(): string } | string | number): number {
  return typeof value === "object" ? Number(value.toString()) : Number(value);
}

/** referenceAt desc, createdAt desc como desempate — mais recente primeiro. */
function compareSnapshotRowsDesc(
  a: TreasuryBalanceSnapshotRowForEvidence,
  b: TreasuryBalanceSnapshotRowForEvidence
): number {
  const byReferenceAt = b.referenceAt.getTime() - a.referenceAt.getTime();
  if (byReferenceAt !== 0) return byReferenceAt;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

export type TreasuryAccountLatestPosition = {
  accountId: string;
  amount: number;
  referenceAt: string;
  /** Dia civil (SP) do `referenceAt`. */
  civilDate: string;
  origin: string;
};

export type TreasuryDailyBalanceEvidence = {
  manualOpenings: readonly TreasuryManualBalanceEvidenceInput[];
  manualClosings: readonly TreasuryManualBalanceEvidenceInput[];
  genericSnapshots: readonly TreasuryManualBalanceEvidenceInput[];
  formalClosings: readonly TreasuryFormalClosingEvidenceInput[];
  latestPositions: readonly TreasuryAccountLatestPosition[];
};

/**
 * Uma consulta de snapshots + uma de fechamentos formais. Por conta+dia+tipo
 * fica só a versão mais recente.
 *
 * A consulta de snapshots NÃO filtra `origin` no WHERE — `latestPositions`
 * ("Caixa hoje") precisa enxergar a posição mais recente independentemente da
 * origem (inclusive OFX), então `origin === "MANUAL"` é checado em JS só na
 * hora de popular manualOpenings/manualClosings/genericSnapshots. Já
 * `cancelledAt` TEM que estar no WHERE: o campo nem volta nas linhas (não dá
 * pra filtrar depois).
 */
export async function loadTreasuryDailyBalanceEvidence(
  prisma: PrismaClient,
  input: {
    accountIds: readonly string[];
    companyCodes: readonly string[];
    fromCivilDate: string;
    toCivilDate: string;
  }
): Promise<TreasuryDailyBalanceEvidence> {
  const accountIds = [...input.accountIds];
  const companyCodes = [...input.companyCodes];

  const rawSnapshotRows =
    accountIds.length === 0
      ? []
      : ((await prisma.treasuryBalanceSnapshot.findMany({
          where: {
            accountId: { in: accountIds },
            cancelledAt: null,
          },
          orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
        })) as unknown as TreasuryBalanceSnapshotRowForEvidence[]);

  // A implementação real do Prisma já devolve ordenado pelo orderBy acima,
  // mas ordenamos de novo aqui pra não depender disso: é o que garante
  // "primeira ocorrência vista = mais recente" no laço abaixo.
  const snapshotRows = [...rawSnapshotRows].sort(compareSnapshotRowsDesc);

  const manualOpenings: TreasuryManualBalanceEvidenceInput[] = [];
  const manualClosings: TreasuryManualBalanceEvidenceInput[] = [];
  const genericSnapshots: TreasuryManualBalanceEvidenceInput[] = [];
  const seenOpening = new Set<string>();
  const seenClosing = new Set<string>();
  const seenGeneric = new Set<string>();

  const latestPositions: TreasuryAccountLatestPosition[] = [];
  const seenPositionAccount = new Set<string>();

  for (const row of snapshotRows) {
    // "Caixa hoje": 1 por conta, a posição mais recente, sem restringir ao
    // período consultado e sem restringir a origem (informativo).
    if (!seenPositionAccount.has(row.accountId)) {
      seenPositionAccount.add(row.accountId);
      latestPositions.push({
        accountId: row.accountId,
        amount: toAmountNumber(row.availableBalance),
        referenceAt: row.referenceAt.toISOString(),
        civilDate: civilDateFromInstantInSaoPaulo(row.referenceAt),
        origin: row.origin,
      });
    }

    if (row.origin !== "MANUAL") continue;

    const classified = classifyTreasuryBalanceSnapshotRow(row);
    if (classified.civilDate < input.fromCivilDate || classified.civilDate > input.toCivilDate) {
      continue;
    }

    const key = `${row.accountId}:${classified.civilDate}`;
    const evidence: TreasuryManualBalanceEvidenceInput = {
      accountId: row.accountId,
      civilDate: classified.civilDate,
      amount: toAmountNumber(row.availableBalance),
      informedAt: row.referenceAt.toISOString(),
      version: classified.version,
    };

    if (classified.kind === "OPENING") {
      if (seenOpening.has(key)) continue;
      seenOpening.add(key);
      manualOpenings.push(evidence);
    } else if (classified.kind === "CLOSING") {
      if (seenClosing.has(key)) continue;
      seenClosing.add(key);
      manualClosings.push(evidence);
    } else {
      if (seenGeneric.has(key)) continue;
      seenGeneric.add(key);
      genericSnapshots.push(evidence);
    }
  }

  type RawClosingRowForEvidence = {
    companyCode: string;
    /** `@db.Date` — Prisma entrega meia-noite UTC do dia civil. */
    civilDate: Date;
    version: number;
    openingBalance: { toString(): string } | string | number;
    observedBalance: { toString(): string } | string | number;
    closedAt: Date | null;
  };

  const closingRows =
    companyCodes.length === 0
      ? []
      : ((await prisma.treasuryDailyClosing.findMany({
          where: {
            companyCode: { in: companyCodes },
            status: "CLOSED",
            civilDate: civilDateRangeForDbDate(input.fromCivilDate, input.toCivilDate),
          },
          orderBy: [{ civilDate: "asc" }, { version: "desc" }],
        })) as unknown as RawClosingRowForEvidence[]);

  const formalClosingsByKey = new Map<string, TreasuryFormalClosingEvidenceInput>();
  for (const row of closingRows) {
    // Coluna @db.Date = meia-noite UTC do dia civil — extrai sem deslocar
    // pro fuso de SP (diferente de referenceAt, que é timestamptz).
    const civilDate = row.civilDate.toISOString().slice(0, 10);
    const key = `${row.companyCode}:${civilDate}`;
    const existing = formalClosingsByKey.get(key);
    if (existing && existing.version >= row.version) continue;
    formalClosingsByKey.set(key, {
      companyCode: row.companyCode,
      civilDate,
      observedBalance: toAmountNumber(row.observedBalance),
      openingBalance: row.openingBalance == null ? null : toAmountNumber(row.openingBalance),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      version: row.version,
    });
  }

  return {
    manualOpenings,
    manualClosings,
    genericSnapshots,
    formalClosings: [...formalClosingsByKey.values()],
    latestPositions,
  };
}
