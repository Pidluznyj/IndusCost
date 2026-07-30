/**
 * CR e CP por conta — API agrupada (Nomus bankAccountId → conta local).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Building2, Eye, X } from "lucide-react";
import {
  TREASURY_CRCP_UNLINKED_ID,
  type TreasuryCrCpAccountGroupDto,
  type TreasuryCrCpByAccountBoardDto,
  type TreasuryCrCpTitleDto,
} from "@/src/lib/treasury/domain/treasuryPredictiveCrCpByAccountRules.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
  treasuryMoneyToNumber,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { fetchTreasuryPredictiveCrCpByAccount } from "@/src/lib/treasury/treasuryPredictiveCrCpByAccountApi.js";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowAccountCrCpPanelProps = {
  companyCode: string | null;
  fromDate: string;
  toDate: string;
};

type TitleFilter = "ALL" | "RECEIVABLE" | "PAYABLE" | "OVERDUE" | "UPCOMING";

function moneyLabel(value: string | null | undefined): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(treasuryMoneyToNumber(value));
}

function TitleDetailDialog({
  group,
  onClose,
}: {
  group: TreasuryCrCpAccountGroupDto;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<TitleFilter>("ALL");
  const titles = useMemo(() => {
    const all = [...group.receivableTitles, ...group.payableTitles];
    return all
      .filter((t) => {
        if (filter === "RECEIVABLE") return t.side === "RECEIVABLE";
        if (filter === "PAYABLE") return t.side === "PAYABLE";
        if (filter === "OVERDUE") return t.situation === "OVERDUE";
        if (filter === "UPCOMING") return t.situation === "UPCOMING";
        return true;
      })
      .sort((a, b) => {
        if (a.situation !== b.situation) {
          return a.situation === "OVERDUE" ? -1 : 1;
        }
        return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      });
  }, [group, filter]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="predictive-cf-crcp-titles-dialog"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[#E5E7EB] bg-white shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <h3 className="text-base font-extrabold text-[#111827]">
              Títulos · {group.accountName}
            </h3>
            <p className="mt-1 text-sm text-[#6B7280]">
              CR {group.accountsReceivableCount} · CP{" "}
              {group.accountsPayableCount}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#E5E7EB] p-2 text-[#6B7280] hover:bg-[#F8FAFC]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-[#E5E7EB] px-5 py-3">
          {(
            [
              ["ALL", "Todos"],
              ["RECEIVABLE", "Contas a Receber"],
              ["PAYABLE", "Contas a Pagar"],
              ["OVERDUE", "Vencidos"],
              ["UPCOMING", "A vencer"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                filter === id
                  ? "border-sky-300 bg-sky-50 text-sky-950"
                  : "border-[#E5E7EB] bg-white text-[#374151]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-auto px-5 py-4">
          {titles.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#6B7280]">
              Nenhum título neste filtro.
            </p>
          ) : (
            <table className="min-w-[900px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Vencimento</th>
                  <th className="px-2 py-2">Situação</th>
                  <th className="px-2 py-2">Cliente / fornecedor</th>
                  <th className="px-2 py-2">Documento</th>
                  <th className="px-2 py-2">Parcela</th>
                  <th className="px-2 py-2 text-right">Original</th>
                  <th className="px-2 py-2 text-right">Pago/Recebido</th>
                  <th className="px-2 py-2 text-right">Saldo</th>
                  <th className="px-2 py-2">Conta Nomus</th>
                  <th className="px-2 py-2">Agrupamento</th>
                </tr>
              </thead>
              <tbody>
                {titles.map((t: TreasuryCrCpTitleDto) => (
                  <tr
                    key={`${t.side}-${t.id}`}
                    className="border-b border-[#E5E7EB] last:border-0"
                  >
                    <td className="px-2 py-2 font-semibold">
                      {t.side === "RECEIVABLE" ? "CR" : "CP"}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {t.dueDate
                        ? formatPredictiveCashFlowDate(t.dueDate)
                        : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {t.situation === "OVERDUE" ? "Vencido" : "A vencer"}
                    </td>
                    <td className="px-2 py-2">{t.counterpartyName ?? "—"}</td>
                    <td className="px-2 py-2">{t.documentNumber ?? "—"}</td>
                    <td className="px-2 py-2">{t.installmentLabel ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {moneyLabel(t.originalAmount)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {moneyLabel(t.settledAmount)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold">
                      {moneyLabel(t.openBalance)}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {t.nomusFinancialAccountName
                        ? `${t.nomusFinancialAccountName}${
                            t.nomusFinancialAccountId
                              ? ` (#${t.nomusFinancialAccountId})`
                              : ""
                          }`
                        : t.nomusFinancialAccountId
                          ? `#${t.nomusFinancialAccountId}`
                          : "Sem conta financeira"}
                      {t.unlinkedReasonLabel ? (
                        <span className="mt-0.5 block text-[#B45309]">
                          {t.unlinkedReasonLabel}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {t.destinationBucketLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export function PredictiveCashFlowAccountCrCpPanel({
  companyCode,
  fromDate,
  toDate,
}: PredictiveCashFlowAccountCrCpPanelProps) {
  const [board, setBoard] = useState<TreasuryCrCpByAccountBoardDto | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailGroup, setDetailGroup] =
    useState<TreasuryCrCpAccountGroupDto | null>(null);

  useEffect(() => {
    if (!companyCode?.trim() || !fromDate || !toDate) {
      setBoard(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchTreasuryPredictiveCrCpByAccount({
      companyCode,
      fromDate,
      toDate,
      signal: controller.signal,
    })
      .then((payload) => {
        if (!controller.signal.aborted) setBoard(payload);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar CR e CP por conta."
        );
        setBoard(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [companyCode, fromDate, toDate]);

  const groups = board?.groups ?? [];
  const totals = board?.totals;

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
            Contas a receber e a pagar oficiais agrupadas pelo ID Nomus da conta
            financeira · horizonte{" "}
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

      {!companyCode ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Informe a empresa para carregar CR e CP.
        </p>
      ) : loading && !board ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Carregando títulos…
        </p>
      ) : error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Nenhum título aberto no horizonte.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
          <table className="min-w-[820px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F8FAFC] text-left text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                <th className="px-3 py-2.5">Conta / banco</th>
                <th className="px-3 py-2.5 text-right">CR a receber</th>
                <th className="px-3 py-2.5 text-right">Títulos CR</th>
                <th className="px-3 py-2.5 text-right">CP a pagar</th>
                <th className="px-3 py-2.5 text-right">Títulos CP</th>
                <th className="px-3 py-2.5 text-right">Líquido</th>
                <th className="px-3 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((row) => (
                <tr
                  key={row.treasuryAccountId}
                  className={cn(
                    "border-b border-[#E5E7EB] last:border-0",
                    row.isUnlinked ? "bg-amber-50/40" : ""
                  )}
                  data-testid={`predictive-cf-crcp-${row.treasuryAccountId}`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#111827]">
                          {row.accountName}
                        </p>
                        <p className="truncate text-xs text-[#6B7280]">
                          {row.isUnlinked
                            ? "Sem saldo bancário próprio"
                            : row.institutionName ??
                              (row.nomusFinancialAccountId
                                ? `Nomus #${row.nomusFinancialAccountId}`
                                : "—")}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#059669]">
                    {moneyLabel(row.accountsReceivableTotal)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                    {row.accountsReceivableCount}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-[#DC2626]">
                    {moneyLabel(row.accountsPayableTotal)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                    {row.accountsPayableCount}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3 text-right tabular-nums font-extrabold",
                      treasuryMoneyToNumber(row.netMovement) >= 0
                        ? "text-[#059669]"
                        : "text-[#DC2626]"
                    )}
                  >
                    {moneyLabel(row.netMovement)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setDetailGroup(row)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#111827] hover:bg-[#F8FAFC]"
                      data-testid={`predictive-cf-crcp-view-${row.treasuryAccountId}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver títulos
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {totals ? (
              <tfoot>
                <tr
                  className="border-t-2 border-[#111827] bg-[#F1F5F9]"
                  data-testid="predictive-cf-crcp-totals"
                >
                  <td className="px-3 py-3.5 font-extrabold text-[#111827]">
                    Total consolidado
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-extrabold text-[#059669]">
                    {moneyLabel(totals.accountsReceivableTotal)}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-[#6B7280]">
                    {totals.accountsReceivableCount}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums font-extrabold text-[#DC2626]">
                    {moneyLabel(totals.accountsPayableTotal)}
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums text-[#6B7280]">
                    {totals.accountsPayableCount}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-3.5 text-right tabular-nums font-extrabold",
                      treasuryMoneyToNumber(totals.netMovement) >= 0
                        ? "text-[#059669]"
                        : "text-[#DC2626]"
                    )}
                  >
                    {moneyLabel(totals.netMovement)}
                  </td>
                  <td className="px-3 py-3.5" />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      {detailGroup ? (
        <TitleDetailDialog
          group={detailGroup}
          onClose={() => setDetailGroup(null)}
        />
      ) : null}

      {/* hint for tests / a11y */}
      <span className="sr-only" data-testid="predictive-cf-crcp-unlinked-id">
        {TREASURY_CRCP_UNLINKED_ID}
      </span>
    </section>
  );
}
