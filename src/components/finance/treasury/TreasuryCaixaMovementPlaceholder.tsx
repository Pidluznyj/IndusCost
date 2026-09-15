/**
 * Caixa — movimentação sob demanda.
 *
 * A tela abre só com os saldos (Caixa hoje). Movimento de hoje, atrasados,
 * linha do tempo, evolução do saldo, projeção e títulos do período são as
 * consultas pesadas: só carregam quando o usuário clica em
 * "Carregar movimentação" (ou em Pesquisar).
 */

import React from "react";
import { BarChart3 } from "lucide-react";

export type TreasuryCaixaMovementPlaceholderProps = {
  onLoad: () => void;
};

export function TreasuryCaixaMovementPlaceholder({ onLoad }: TreasuryCaixaMovementPlaceholderProps) {
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[#93C5FD] bg-card px-4 py-3 shadow-sm"
      data-testid="caixa-movement-placeholder"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">Movimentação não carregada</h2>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
          Para abrir mais rápido, a tela carrega só os saldos. Movimento de hoje, atrasados, linha do tempo,
          evolução do saldo, projeção e títulos do período (filtros acima) carregam quando você pedir.
        </p>
      </div>
      <button
        type="button"
        onClick={onLoad}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#93C5FD]"
        data-testid="caixa-movement-load"
      >
        <BarChart3 className="h-3.5 w-3.5" aria-hidden />
        Carregar movimentação
      </button>
    </section>
  );
}
