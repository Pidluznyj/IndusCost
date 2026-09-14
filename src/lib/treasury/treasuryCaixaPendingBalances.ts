/**
 * Caixa — saldos lançados que a tela ainda não recalculou (browser-safe, puro).
 *
 * Gravar o saldo do dia NÃO recalcula a página: contas, movimento de hoje,
 * linha do tempo e projeção são consultas pesadas. O lançamento já está salvo
 * no servidor, mas fica "pendente" na tela até o usuário clicar em
 * "Atualizar tela" — enquanto isso, a página avisa que os dados estão
 * desatualizados e mostra na linha da conta o que foi lançado.
 */

import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
  treasuryMoneyToNumber,
} from "./treasuryPredictiveCashFlow.js";
import type { TreasuryBalanceSaved } from "./treasuryPredictiveCashFlowBalanceEdit.js";

export type TreasuryCaixaPendingBalance = TreasuryBalanceSaved & {
  accountId: string;
  accountName: string;
  /** Instante do lançamento (ISO). */
  savedAt: string;
};

/** Um pendente por conta + dia: o lançamento mais recente substitui o anterior. */
export function addTreasuryCaixaPendingBalance(
  pending: readonly TreasuryCaixaPendingBalance[],
  entry: TreasuryCaixaPendingBalance
): TreasuryCaixaPendingBalance[] {
  return [
    ...pending.filter((p) => !(p.accountId === entry.accountId && p.civilDate === entry.civilDate)),
    entry,
  ];
}

export function treasuryCaixaPendingBalancesForAccount(
  pending: readonly TreasuryCaixaPendingBalance[],
  accountId: string
): TreasuryCaixaPendingBalance[] {
  return pending.filter((p) => p.accountId === accountId);
}

function joinNames(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} e mais ${rest}`;
  return shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`;
}

/** Frase do aviso de dados desatualizados (null = nada pendente). */
export function describeTreasuryCaixaPendingBalances(
  pending: readonly TreasuryCaixaPendingBalance[]
): string | null {
  if (pending.length === 0) return null;
  const names = [...new Set(pending.map((p) => p.accountName))];
  const count = pending.length;
  return `${count === 1 ? "1 saldo lançado" : `${count} saldos lançados`} (${joinNames(names)}) depois do último cálculo da tela.`;
}

const SAO_PAULO_TIME = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** Linha da conta: "Lançado às 10:32 · saldo inicial R$ 131.000,00 de 14/09/2026". */
export function formatTreasuryCaixaPendingBalance(entry: TreasuryCaixaPendingBalance): string {
  const parts: string[] = [];
  if (entry.openingBalance != null) {
    parts.push(`inicial ${formatPredictiveCashFlowMoney(treasuryMoneyToNumber(entry.openingBalance))}`);
  }
  if (entry.closingBalance != null) {
    parts.push(`final ${formatPredictiveCashFlowMoney(treasuryMoneyToNumber(entry.closingBalance))}`);
  }
  const savedAt = new Date(entry.savedAt);
  const time = Number.isNaN(savedAt.getTime()) ? null : SAO_PAULO_TIME.format(savedAt);
  return `Lançado${time ? ` às ${time}` : ""} · saldo ${parts.join(" e ")} de ${formatPredictiveCashFlowDate(entry.civilDate)}`;
}
