/**
 * Regras de data para informar saldo inicial/final no Fluxo Gerencial.
 * Client-safe — sem Prisma.
 */

export function canEditTreasuryCivilDateBalances(input: {
  civilDate: string;
  todayCivilDate: string;
  isSuperAdmin: boolean;
}): { allowed: boolean; reason: string | null } {
  const civil = input.civilDate.trim();
  const today = input.todayCivilDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(civil)) {
    return { allowed: false, reason: "Data inválida." };
  }
  if (civil > today) {
    return {
      allowed: false,
      reason: "Não é possível informar saldo de dias futuros.",
    };
  }
  if (civil < today && !input.isSuperAdmin) {
    return {
      allowed: false,
      reason:
        "Somente SUPER_ADMIN pode alterar saldos de dias passados. A alteração fica no log.",
    };
  }
  return { allowed: true, reason: null };
}

export function formatMoneyInputFromString(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseMoneyInputPtBr(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}
