/**
 * Caixa — aviso de dados desatualizados.
 *
 * Aparece quando um saldo foi gravado depois do último cálculo da tela: o
 * lançamento já está salvo, mas Caixa hoje, Movimento de hoje, Linha do tempo
 * e Projeção só o consideram depois de "Atualizar tela" (recalcular tudo é
 * pesado e não roda sozinho a cada saldo).
 */

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  describeTreasuryCaixaPendingBalances,
  type TreasuryCaixaPendingBalance,
} from "@/src/lib/treasury/treasuryCaixaPendingBalances.js";

export type TreasuryCaixaStaleBannerProps = {
  pendingBalances: readonly TreasuryCaixaPendingBalance[];
  onRefresh: () => void;
};

export function TreasuryCaixaStaleBanner({ pendingBalances, onRefresh }: TreasuryCaixaStaleBannerProps) {
  const description = describeTreasuryCaixaPendingBalances(pendingBalances);
  if (!description) return null;
  return (
    <div
      className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#FCD34D] bg-[#FFFBEB] px-4 py-3 text-[#92400E] shadow-md"
      role="status"
      aria-live="polite"
      data-testid="caixa-stale-banner"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold">Dados desatualizados</p>
          <p className="text-xs leading-snug">
            {description} O saldo já está salvo. Caixa hoje, Movimento de hoje, Linha do tempo e Projeção só
            passam a considerá-lo depois de atualizar a tela.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#D97706] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#B45309] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/50"
        data-testid="caixa-stale-refresh"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Atualizar tela
      </button>
    </div>
  );
}
