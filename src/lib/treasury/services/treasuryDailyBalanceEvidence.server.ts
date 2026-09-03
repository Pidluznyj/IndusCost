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
  void row;
  throw new Error("not implemented: classifyTreasuryBalanceSnapshotRow");
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
 * Uma consulta de snapshots + uma de fechamentos formais + uma de posição
 * mais recente. Por conta+dia+tipo fica só a versão mais recente.
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
  void prisma;
  void input;
  throw new Error("not implemented: loadTreasuryDailyBalanceEvidence");
}
