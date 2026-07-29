/**
 * Query helpers da listagem de Propostas (browser + server safe).
 */
import { parseMoneyAmountInput } from "./moneyRangeFilter.js";

/** Aceita número livre (inclui milhar/decimal BR). Negativo/inválido → null. */
export function parseProposalListNetValueParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  const parsed = parseMoneyAmountInput(String(raw));
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** Fragmento Prisma `where` para De/Até em `Proposal.totalNetValue`. */
export function buildProposalListNetValueWhere(
  minNetValue: number | null,
  maxNetValue: number | null
): { totalNetValue: { gte?: number; lte?: number } } | Record<string, never> {
  const min =
    minNetValue != null && Number.isFinite(minNetValue) ? minNetValue : null;
  const max =
    maxNetValue != null && Number.isFinite(maxNetValue) ? maxNetValue : null;
  if (min == null && max == null) return {};
  return {
    totalNetValue: {
      ...(min != null ? { gte: min } : {}),
      ...(max != null ? { lte: max } : {}),
    },
  };
}
