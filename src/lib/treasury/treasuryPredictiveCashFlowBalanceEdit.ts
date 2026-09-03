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

/**
 * Identidade do que está sendo editado. A hidratação é assíncrona, então cada
 * resposta carrega a chave que pediu: resposta de outra conta/data (request
 * abortado que chegou atrasado) é descartada em vez de contaminar a tela.
 */
export function treasuryBalanceHydrationKey(input: {
  accountId: string;
  civilDate: string;
}): string {
  return `${input.accountId}|${input.civilDate}`;
}

/**
 * Só escreve o valor persistido no campo se a resposta for da conta/data em
 * edição e o usuário ainda não tiver digitado ali (dirty). Digitação do
 * usuário nunca é sobrescrita por resposta tardia.
 */
export function shouldApplyTreasuryBalanceHydration(input: {
  responseKey: string;
  currentKey: string;
  dirty: boolean;
}): boolean {
  if (input.responseKey !== input.currentKey) return false;
  return !input.dirty;
}

/**
 * Saldo inicial exibido após hidratar: o valor já gravado; sem valor gravado,
 * a sugestão canônica do fechamento anterior; sem nenhum dos dois, campo vazio
 * (a regra canônica exige digitação — nunca assumir zero).
 */
export function resolveTreasuryOpeningInputValue(input: {
  amount: string | null;
  suggestedBalance: string | null;
}): string {
  return formatMoneyInputFromString(input.amount ?? input.suggestedBalance);
}

/** Saldo final exibido: só o valor informado; sem valor informado, vazio. */
export function resolveTreasuryClosingInputValue(input: {
  amount: string | null;
}): string {
  return formatMoneyInputFromString(input.amount);
}

/**
 * Optimistic lock: gravar exige conhecer a versão persistida da conta/data em
 * edição. Enquanto a hidratação daquela chave não terminou, o submit fica
 * bloqueado — mas os campos seguem editáveis (o usuário não espera parado).
 */
export function canSubmitTreasuryBalanceEdit(input: {
  hydratedKey: string | null;
  currentKey: string;
  dateAllowed: boolean;
  saving: boolean;
  disabled?: boolean;
}): boolean {
  if (input.disabled) return false;
  if (input.saving) return false;
  if (!input.dateAllowed) return false;
  return input.hydratedKey === input.currentKey;
}
