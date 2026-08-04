import React from "react";
import type { TreasuryBalanceSnapshotDto } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_BALANCE_ORIGIN_LABELS } from "@/src/lib/treasury/treasuryAccountsUi.js";
import {
  formatTreasuryBalanceCurrencyPtBr,
  formatTreasuryBalanceDateTimePtBr,
} from "@/src/lib/treasury/treasuryBalancesUi.js";
import { FinanceModuleEmptyState } from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";

type Props = {
  rows: TreasuryBalanceSnapshotDto[];
  /** Editar/excluir só aparece para SUPER_ADMIN. */
  isSuperAdmin?: boolean;
  onEdit?: (row: TreasuryBalanceSnapshotDto) => void;
  onCancel?: (row: TreasuryBalanceSnapshotDto) => void;
  /** id do snapshot com exclusão em andamento — desabilita as ações da linha. */
  cancellingId?: string | null;
};

export function TreasuryBalanceHistory({
  rows,
  isSuperAdmin = false,
  onEdit,
  onCancel,
  cancellingId = null,
}: Props) {
  if (rows.length === 0) {
    return (
      <FinanceModuleEmptyState
        title="Sem histórico de saldo"
        description="Os snapshots informados aparecerão aqui em ordem cronológica."
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="treasury-balance-history">
      <h3 className="text-sm font-semibold text-foreground">Histórico</h3>

      {/* Timeline (mobile-first) */}
      <ol className="space-y-3 md:hidden">
        {rows.map((row, index) => (
          <li
            key={row.id}
            className="relative rounded-xl border border-border bg-card p-3 pl-4"
          >
            <span
              className="absolute left-0 top-3 h-8 w-1 rounded-r bg-primary/70"
              aria-hidden
            />
            <p className="text-xs font-semibold text-muted-foreground">
              {formatTreasuryBalanceDateTimePtBr(row.referenceAt)}
              {index === 0 ? " · atual" : ""}
            </p>
            <p className="mt-1 text-sm font-semibold">
              Disponível{" "}
              {formatTreasuryBalanceCurrencyPtBr(row.operationalAvailableBalance)}
            </p>
            <p className="text-xs text-muted-foreground">
              Obs. {formatTreasuryBalanceCurrencyPtBr(row.observedBalance)} ·
              Bloq. {formatTreasuryBalanceCurrencyPtBr(row.blockedBalance)} ·
              Apl. {formatTreasuryBalanceCurrencyPtBr(row.investmentsBalance)} ·
              Lim. {formatTreasuryBalanceCurrencyPtBr(row.usedLimit)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {TREASURY_BALANCE_ORIGIN_LABELS[row.origin]}
              {row.notes ? ` · ${row.notes}` : ""}
            </p>
            {row.cancelledAt ? (
              <p
                className="mt-1 text-xs font-semibold text-destructive"
                data-testid={`treasury-balance-cancelled-${row.id}`}
              >
                Excluído{row.cancelReason ? ` · ${row.cancelReason}` : ""}
              </p>
            ) : isSuperAdmin ? (
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  className="text-xs font-semibold text-primary"
                  disabled={cancellingId === row.id}
                  onClick={() => onEdit?.(row)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="text-xs font-semibold text-destructive"
                  disabled={cancellingId === row.id}
                  onClick={() => onCancel?.(row)}
                >
                  {cancellingId === row.id ? "Excluindo…" : "Excluir"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {/* Tabela desktop */}
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="min-w-[880px] w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Referência
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Disponível
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Bloqueado
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Aplicação
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Limite
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Observado
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Origem
              </th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                Observação
              </th>
              {isSuperAdmin ? (
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                  Ações
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border/60",
                  row.cancelledAt && "opacity-60"
                )}
              >
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {formatTreasuryBalanceDateTimePtBr(row.referenceAt)}
                </td>
                <td className="px-3 py-2 tabular-nums font-semibold">
                  {formatTreasuryBalanceCurrencyPtBr(
                    row.operationalAvailableBalance
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatTreasuryBalanceCurrencyPtBr(row.blockedBalance)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatTreasuryBalanceCurrencyPtBr(row.investmentsBalance)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatTreasuryBalanceCurrencyPtBr(row.usedLimit)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatTreasuryBalanceCurrencyPtBr(row.observedBalance)}
                </td>
                <td className="px-3 py-2">
                  {TREASURY_BALANCE_ORIGIN_LABELS[row.origin]}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.notes || "—"}
                </td>
                {isSuperAdmin ? (
                  <td className="px-3 py-2">
                    {row.cancelledAt ? (
                      <span
                        className="text-xs font-semibold text-destructive"
                        title={row.cancelReason ?? undefined}
                        data-testid={`treasury-balance-cancelled-${row.id}`}
                      >
                        Excluído
                      </span>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-primary hover:underline"
                          disabled={cancellingId === row.id}
                          onClick={() => onEdit?.(row)}
                          data-testid={`treasury-balance-edit-${row.id}`}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-destructive hover:underline disabled:opacity-60"
                          disabled={cancellingId === row.id}
                          onClick={() => onCancel?.(row)}
                          data-testid={`treasury-balance-delete-${row.id}`}
                        >
                          {cancellingId === row.id ? "Excluindo…" : "Excluir"}
                        </button>
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
