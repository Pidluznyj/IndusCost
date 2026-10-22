/**
 * Escolha da evidência QUOD/IEPTB já persistida.
 * A lista e o detalhe usam estas funções. Não consulta bureau.
 */
import { normalizeCnpj } from "../companyCnpjFormat.js";
import {
  interpretIeptbConsultations,
  type CommercialIeptbEvidence,
  type CommercialQuodEvidence,
  type IeptbConsultationFact,
} from "./commercialCreditDecision.js";

export type StoredQuodConsultation = {
  customerId?: string | null;
  cnpj?: string | null;
  status?: string | null;
  confirmedRestriction?: boolean | null;
  insufficient?: boolean | null;
  validUntil?: Date | string | null;
  consultedAt?: Date | string | null;
};

export type StoredIeptbConsultation = Omit<IeptbConsultationFact, "validUntil" | "consultedAt"> & {
  customerId?: string | null;
  cnpj?: string | null;
  validUntil?: Date | string | null;
  consultedAt?: Date | string | null;
};

const QUOD_ABSENT: CommercialQuodEvidence = {
  state: "NOT_CONSULTED",
  confirmedRestriction: false,
  insufficient: false,
  cnpjMatches: true,
};

export const QUOD_READ_FAILED: CommercialQuodEvidence = {
  state: "UNAVAILABLE",
  confirmedRestriction: false,
  insufficient: true,
  cnpjMatches: true,
  readFailed: true,
};

export const IEPTB_READ_FAILED: CommercialIeptbEvidence = {
  state: "UNAVAILABLE",
  confirmedProtest: false,
  insufficient: true,
  confirmedClear: false,
  cnpjMatches: true,
  readFailed: true,
};

function time(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const parsed = date.getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compatible<T extends { cnpj?: string | null }>(rows: readonly T[], customerCnpj: string | null | undefined): {
  rows: T[];
  mismatched: boolean;
} {
  const customer = normalizeCnpj(customerCnpj);
  if (!customer) return { rows: [...rows], mismatched: false };
  const matching = rows.filter((row) => {
    const cnpj = normalizeCnpj(row.cnpj);
    return !cnpj || cnpj === customer;
  });
  return { rows: matching, mismatched: rows.length > 0 && matching.length === 0 };
}

export function selectQuodCreditEvidence(
  rows: readonly StoredQuodConsultation[],
  now: Date,
  customerCnpj?: string | null
): CommercialQuodEvidence {
  const filtered = compatible(rows, customerCnpj);
  if (filtered.mismatched) {
    return { ...QUOD_ABSENT, cnpjMatches: false };
  }
  const ordered = [...filtered.rows].sort((left, right) => time(right.consultedAt) - time(left.consultedAt));
  const succeeded = ordered.filter((row) => (row.status ?? "SUCCEEDED") === "SUCCEEDED");
  const chosen = succeeded[0];
  if (chosen) {
    const until = time(chosen.validUntil);
    return {
      state: until > now.getTime() ? "VALID" : "STALE",
      confirmedRestriction: chosen.confirmedRestriction === true,
      insufficient: chosen.insufficient === true,
      cnpjMatches: true,
      consultedAt: iso(chosen.consultedAt),
      validUntil: iso(chosen.validUntil),
    };
  }
  if (ordered.length === 0) return QUOD_ABSENT;
  const latest = ordered[0]!;
  const status = (latest.status ?? "FAILED").toUpperCase();
  const state =
    status === "PARTIAL" ? "PARTIAL" : status === "FAILED" ? "FAILED" : status === "SENT" || status === "RESERVED" ? "IN_PROGRESS" : "UNAVAILABLE";
  return {
    state,
    confirmedRestriction: latest.confirmedRestriction === true,
    insufficient: true,
    cnpjMatches: true,
    consultedAt: iso(latest.consultedAt),
    validUntil: iso(latest.validUntil),
  };
}

export function selectIeptbCreditEvidence(
  rows: readonly StoredIeptbConsultation[],
  now: Date,
  customerCnpj?: string | null
): CommercialIeptbEvidence {
  const filtered = compatible(rows, customerCnpj);
  if (filtered.mismatched) {
    return {
      state: "NOT_CONSULTED",
      confirmedProtest: false,
      insufficient: false,
      confirmedClear: false,
      cnpjMatches: false,
    };
  }
  const ordered = [...filtered.rows]
    .sort((left, right) => time(right.consultedAt) - time(left.consultedAt))
    .slice(0, 8)
    .map((row) => ({
      ...row,
      consultedAt: row.consultedAt == null ? null : row.consultedAt instanceof Date ? row.consultedAt : new Date(row.consultedAt),
      validUntil: row.validUntil == null ? null : row.validUntil instanceof Date ? row.validUntil : new Date(row.validUntil),
    }));
  const interpreted = interpretIeptbConsultations(ordered, now);
  const latest = ordered[0];
  return {
    ...interpreted,
    cnpjMatches: true,
    consultedAt: latest ? iso(latest.consultedAt) : null,
    validUntil: latest ? iso(latest.validUntil) : null,
  };
}

export function groupConsultationsByCustomer<T extends { customerId?: string | null }>(
  rows: readonly T[],
  customerIds: readonly string[]
): Map<string, T[]> {
  const allowed = new Set(customerIds);
  const grouped = new Map<string, T[]>();
  for (const id of customerIds) grouped.set(id, []);
  for (const row of rows) {
    const id = row.customerId ?? "";
    if (!allowed.has(id)) continue;
    grouped.get(id)?.push(row);
  }
  return grouped;
}
