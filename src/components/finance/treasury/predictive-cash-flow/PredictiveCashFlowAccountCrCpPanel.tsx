/**
 * CR e CP por conta — motores canônicos via agenda do horizonte filtrado.
 */

import React, { useMemo } from "react";
import { Building2 } from "lucide-react";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { buildPredictiveAccountCrCpBoard } from "@/src/lib/treasury/treasuryPredictiveAccountCrCp.js";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowAccountCrCpPanelProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  fromDate: string;
  toDate: string;
};

export function PredictiveCashFlowAccountCrCpPanel({
  accounts,
  transactions,
  fromDate,
  toDate,
}: PredictiveCashFlowAccountCrCpPanelProps) {
  const board = useMemo(
    () =>
      buildPredictiveAccountCrCpBoard({
        accounts,
        transactions,
        fromDate,
        toDate,
      }),
    [accounts, transactions, fromDate, toDate]
  );

  return (
    <section
      className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-none"
      data-testid="predictive-cf-account-crcp"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold tracking-tight text-[#111827]">
            CR e CP por conta
          </h3>
          <p className="mt-1 text-sm text-[#6B7280]">
            Contas a receber e a pagar do motor canônico no horizonte{" "}
            <span className="font-semibold tabular-nums text-[#111827]">
              {formatPredictiveCashFlowDate(fromDate)}
            </span>
            {" → "}
            <span className="font-semibold tabular-nums text-[#111827]">
              {formatPredictiveCashFlowDate(toDate)}
            </span>
          </p>
        </div>
      </div>

      {board.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Nenhuma conta ativa no consolidado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F8FAFC] text-left text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                <th className="px-3 py-2.5">Conta / banco</th>
                <th className="px-3 py-2.5 text-right">CR (a receber)</th>
                <th className="px-3 py-2.5 text-right">Títulos CR</th>
                <th className="px-3 py-2.5 text-right">CP (a pagar)</th>
                <th className="px-3 py-2.5 text-right">Títulos CP</th>
                <th className="px-3 py-2.5 text-right">Líquido (CR − CP)</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr
                  key={row.accountId}
                  className="border-b border-[#E5E7EB] last:border-0"
                  data-testid={`predictive-cf-crcp-${row.accountId}`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#111827]">
                          {row.accountName}
                        </p>
                        <p className="truncate text-xs text-[#6B7280]">
                          {row.institutionName}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#059669]">
                    {formatPredictiveCashFlowMoney(row.receivables)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                    {row.receivableCount}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#DC2626]">
                    {formatPredictiveCashFlowMoney(row.payables)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                    {row.payableCount}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right tabular-nums font-extrabold",
                      row.net >= 0 ? "text-[#059669]" : "text-[#DC2626]"
                    )}
                  >
                    {formatPredictiveCashFlowMoney(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                className="border-t-2 border-[#111827] bg-[#F1F5F9]"
                data-testid="predictive-cf-crcp-totals"
              >
                <td className="px-3 py-3.5 font-extrabold text-[#111827]">
                  Total consolidado
                </td>
                <td className="px-3 py-3.5 text-right tabular-nums font-extrabold text-[#059669]">
                  {formatPredictiveCashFlowMoney(board.totals.receivables)}
                </td>
                <td className="px-3 py-3.5 text-right tabular-nums text-[#6B7280]">
                  {board.totals.receivableCount}
                </td>
                <td className="px-3 py-3.5 text-right tabular-nums font-extrabold text-[#DC2626]">
                  {formatPredictiveCashFlowMoney(board.totals.payables)}
                </td>
                <td className="px-3 py-3.5 text-right tabular-nums text-[#6B7280]">
                  {board.totals.payableCount}
                </td>
                <td
                  className={cn(
                    "px-3 py-3.5 text-right tabular-nums font-extrabold",
                    board.totals.net >= 0 ? "text-[#059669]" : "text-[#DC2626]"
                  )}
                >
                  {formatPredictiveCashFlowMoney(board.totals.net)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
