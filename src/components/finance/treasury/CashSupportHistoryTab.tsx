/**
 * Conciliação Bancária — aba "Histórico".
 * Matches do período, ATIVOS e DESFEITOS (reversão auditável nunca some).
 * Apresentacional; desfazer/reverter delegam aos dialogs oficiais via callback.
 */

import React from "react";
import { cn } from "@/src/lib/utils";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import { CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX } from "@/src/lib/treasury/domain/cashSupportAutoReconcile.js";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/treasuryDto.js";

function civilDateBr(value: string | null): string {
  if (!value) return "—";
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(2, 4)}`;
}

function isAutoMatch(match: TreasuryReconciliationMatchDto): boolean {
  return (
    match.justification != null &&
    match.justification.startsWith(CASH_SUPPORT_AUTO_JUSTIFICATION_PREFIX)
  );
}

export type CashSupportHistoryTabProps = {
  loading?: boolean;
  error?: string | null;
  matches: TreasuryReconciliationMatchDto[];
  onUnmatchRequested?: (match: TreasuryReconciliationMatchDto) => void;
  onReverseRequested?: (match: TreasuryReconciliationMatchDto) => void;
};

export function CashSupportHistoryTab({
  loading = false,
  error = null,
  matches,
  onUnmatchRequested,
  onReverseRequested,
}: CashSupportHistoryTabProps) {
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
        Carregando histórico…
      </p>
    );
  }
  if (matches.length === 0) {
    return (
      <p
        className="rounded-lg border border-border bg-card px-3 py-4 text-sm text-muted-foreground"
        data-testid="history-empty"
      >
        Nenhuma conciliação registrada no período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="history-tab">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-2">Data</th>
            <th className="px-2 py-2">Origem</th>
            <th className="px-2 py-2 text-right">Valor</th>
            <th className="px-2 py-2">Títulos</th>
            <th className="px-2 py-2">Movimentos</th>
            <th className="px-2 py-2">Situação</th>
            <th className="px-2 py-2">Justificativa</th>
            <th className="px-2 py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const auto = isAutoMatch(m);
            const titles = m.allocations
              .filter((a) => a.kind === "TITLE" && a.nomusExternalId != null)
              .map((a) => a.nomusExternalId)
              .join(", ");
            return (
              <tr
                key={m.id}
                className={cn(
                  "border-t border-border/60 align-top",
                  m.isReversed && "opacity-70"
                )}
                data-testid={`history-row-${m.id}`}
              >
                <td className="px-2 py-2 tabular-nums">{civilDateBr(m.matchedCivilDate)}</td>
                <td className="px-2 py-2">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      auto
                        ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
                        : "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]"
                    )}
                  >
                    {auto ? "Automático" : "Manual"}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">
                  {formatTreasuryBankMoney(m.matchedAmount)}
                </td>
                <td className="px-2 py-2 font-mono text-[11px]">{titles || "—"}</td>
                <td className="px-2 py-2 text-[11px]">{m.movements.length} mov.</td>
                <td className="px-2 py-2">
                  {m.isReversed ? (
                    <span
                      className="rounded-full border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#991B1B]"
                      title={m.unmatchReason ?? undefined}
                    >
                      Desfeito
                    </span>
                  ) : (
                    <span className="rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#065F46]">
                      Ativo
                    </span>
                  )}
                </td>
                <td
                  className="max-w-[260px] truncate px-2 py-2 text-[11px] text-muted-foreground"
                  title={m.isReversed ? m.unmatchReason ?? "" : m.justification ?? ""}
                >
                  {m.isReversed
                    ? `Desfeito: ${m.unmatchReason ?? "—"}`
                    : m.justification ?? "—"}
                </td>
                <td className="px-2 py-2 text-right">
                  {!m.isReversed ? (
                    <div className="flex justify-end gap-1">
                      {onUnmatchRequested ? (
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                          onClick={() => onUnmatchRequested(m)}
                          data-testid={`history-unmatch-${m.id}`}
                        >
                          Desfazer
                        </button>
                      ) : null}
                      {onReverseRequested ? (
                        <button
                          type="button"
                          className="rounded-md border border-[#FECACA] px-2 py-0.5 text-[10px] text-[#991B1B] hover:bg-[#FEF2F2]"
                          onClick={() => onReverseRequested(m)}
                          data-testid={`history-reverse-${m.id}`}
                        >
                          Reverter
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
