/**
 * Conciliação Bancária — aba "Revisar Sugestões".
 * Lista candidatos do motor oficial (score/confiança/motivos) que NÃO foram
 * auto-aceitos. Apresentacional: aceitar/rejeitar continua no fluxo manual da
 * aba Movimentos Bancários (dialog oficial) — nada é gravado a partir daqui.
 */

import React from "react";
import { cn } from "@/src/lib/utils";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import type { TreasuryReconciliationSuggestionCandidate } from "@/src/lib/treasury/domain/treasuryReconciliationSuggestionEngine.js";

const REASON_LABELS: Record<string, string> = {
  AMOUNT_EXACT: "Valor exato",
  AMOUNT_COMBINATION_EXACT: "Combinação exata de títulos",
  MOVEMENT_COMBINATION_EXACT: "Combinação exata de movimentos",
  DOCUMENT_MATCH: "Documento",
  TAX_ID_MATCH: "CNPJ/CPF",
  DATE_PROXIMITY: "Data próxima",
  NAME_SIMILAR: "Nome similar",
  HISTORY_MATCH: "Histórico",
  DIRECTION_COMPATIBLE: "Direção compatível",
};

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]",
  MEDIUM: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  LOW: "bg-[#F8FAFC] text-[#475569] border-[#CBD5E1]",
};

export type CashSupportSuggestionsTabProps = {
  loading?: boolean;
  error?: string | null;
  suggestions: TreasuryReconciliationSuggestionCandidate[];
  /** Descrição do movimento por id (contexto visual — vem do read model). */
  movementLabelById?: ReadonlyMap<string, string>;
  /** Leva o usuário ao fluxo manual (aba Movimentos) com o movimento em foco. */
  onOpenManualFlow?: (movementId: string) => void;
};

export function CashSupportSuggestionsTab({
  loading = false,
  error = null,
  suggestions,
  movementLabelById,
  onOpenManualFlow,
}: CashSupportSuggestionsTabProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
        {error}
      </div>
    );
  }
  if (loading) {
    return (
      <p className="rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground">
        Calculando sugestões…
      </p>
    );
  }
  if (suggestions.length === 0) {
    return (
      <p
        className="rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground"
        data-testid="suggestions-empty"
      >
        Nenhuma sugestão pendente de revisão no período. Movimentos com match de
        alta confiança e candidato único já foram conciliados automaticamente.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="suggestions-tab">
      <p className="text-[11px] text-muted-foreground">
        Sugestões NUNCA são aplicadas sozinhas — aceite acontece só no fluxo
        manual (aba Movimentos Bancários), com justificativa e auditoria.
      </p>
      {suggestions.map((s) => (
        <div
          key={s.suggestionKey}
          className="rounded-lg border border-border bg-card p-3"
          data-testid={`suggestion-${s.suggestionKey}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {s.movementLegs.length === 1
                  ? movementLabelById?.get(s.movementId) ?? `Movimento ${s.movementId}`
                  : `${s.movementLegs.length} movimentos (combinação exata)`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {s.allocations.length === 1
                  ? `Título ${s.allocations[0]!.externalId} (${s.allocations[0]!.side})`
                  : `${s.allocations.length} títulos (combinação exata)`}{" "}
                · total {formatTreasuryBankMoney(s.totalSuggestedAmount)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  CONFIDENCE_STYLE[s.confidence] ?? CONFIDENCE_STYLE.LOW
                )}
              >
                score {s.score} · {s.confidence}
              </span>
              {onOpenManualFlow ? (
                <button
                  type="button"
                  className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted"
                  onClick={() => onOpenManualFlow(s.movementId)}
                  data-testid={`suggestion-open-${s.suggestionKey}`}
                >
                  Conciliar manualmente
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {s.reasons.map((r) => (
              <span
                key={r}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {REASON_LABELS[r] ?? r}
              </span>
            ))}
          </div>
          {s.allocations.length > 1 ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              {s.allocations.map((a) => (
                <li key={a.officialTitleId}>
                  Título {a.externalId} ({a.side}) —{" "}
                  {formatTreasuryBankMoney(a.suggestedAmount)}
                </li>
              ))}
            </ul>
          ) : null}
          {s.movementLegs.length > 1 ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              {s.movementLegs.map((leg) => (
                <li key={leg.movementId}>
                  {movementLabelById?.get(leg.movementId) ?? `Movimento ${leg.movementId}`}{" "}
                  — {formatTreasuryBankMoney(leg.suggestedAmount)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
