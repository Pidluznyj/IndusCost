/**
 * Fechamento diário ampliado — Fluxo Gerencial.
 * Por conta: abertura/fechamento informado × calculado (CR/CP) + diferenças;
 * rodapé consolidado somando todas as contas.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Scale } from "lucide-react";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowTransaction,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { fetchTreasuryTodayOpening } from "@/src/lib/treasury/treasuryTodayOpeningApi.js";
import { fetchTreasuryTodayClosing } from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import {
  buildPredictiveCashFlowReconciliationBoard,
  buildPredictiveCashFlowReconciliationBoardFromLocal,
  filterPredictiveCashFlowReconciliationBoardByAccountIds,
  formatPredictiveReconciliationMoney,
  predictiveReconciliationDiffTone,
  type PredictiveCashFlowReconciliationAccountRow,
  type PredictiveCashFlowReconciliationBoard,
} from "@/src/lib/treasury/treasuryPredictiveCashFlowReconciliation.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowReconciliationPanelProps = {
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  defaultDate: string;
};

function DiffCell({ value }: { value: number | null }) {
  const tone = predictiveReconciliationDiffTone(value);
  return (
    <span
      className={cn(
        "tabular-nums font-semibold",
        tone === "ok" && "text-[#059669]",
        tone === "warn" && "text-[#DC2626]",
        tone === "neutral" && "text-[#6B7280]"
      )}
    >
      {formatPredictiveReconciliationMoney(value)}
    </span>
  );
}

function MoneyCell({
  value,
  emphasize,
}: {
  value: number | null;
  emphasize?: boolean;
}) {
  return (
    <span
      className={cn(
        "tabular-nums",
        emphasize ? "font-semibold text-[#111827]" : "font-medium text-[#374151]"
      )}
    >
      {formatPredictiveReconciliationMoney(value)}
    </span>
  );
}

function AccountRow({ row }: { row: PredictiveCashFlowReconciliationAccountRow }) {
  return (
    <tr
      className={cn(
        "border-b border-[#E5E7EB] last:border-0",
        row.hasDivergence && "bg-[#FEF2F2]/40"
      )}
      data-testid={`predictive-cf-recon-row-${row.accountId}`}
    >
      <td className="px-3 py-3 align-top">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#111827]">
              {row.accountName}
            </p>
            <p className="truncate text-xs text-[#6B7280]">
              {row.bank ?? "—"}
              {row.situationLabel ? ` · ${row.situationLabel}` : ""}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-right align-top">
        <MoneyCell value={row.informedOpening} emphasize />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <MoneyCell value={row.calculatedOpening} />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <DiffCell value={row.openingDiff} />
      </td>
      <td className="px-3 py-3 text-right align-top text-[#059669]">
        <MoneyCell value={row.receivables} />
      </td>
      <td className="px-3 py-3 text-right align-top text-[#DC2626]">
        <MoneyCell value={row.payables} />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <MoneyCell value={row.calculatedClosing} />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <MoneyCell value={row.informedClosing} emphasize />
      </td>
      <td className="px-3 py-3 text-right align-top">
        <DiffCell value={row.closingDiff} />
      </td>
    </tr>
  );
}

export function PredictiveCashFlowReconciliationPanel({
  accounts,
  transactions,
  defaultDate,
}: PredictiveCashFlowReconciliationPanelProps) {
  const [date, setDate] = useState(defaultDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<PredictiveCashFlowReconciliationBoard | null>(
    null
  );
  const [source, setSource] = useState<"canonical" | "local">("local");

  useEffect(() => {
    if (defaultDate) setDate(defaultDate);
  }, [defaultDate]);

  const localFallback = useMemo(
    () =>
      date
        ? buildPredictiveCashFlowReconciliationBoardFromLocal({
            civilDate: date,
            accounts,
            transactions,
          })
        : null,
    [date, accounts, transactions]
  );

  useEffect(() => {
    if (!date) return;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      fetchTreasuryTodayOpening({ date, signal: ac.signal }),
      fetchTreasuryTodayClosing({ date, signal: ac.signal }),
    ])
      .then(([openingWs, closingWs]) => {
        if (ac.signal.aborted) return;
        setBoard(
          filterPredictiveCashFlowReconciliationBoardByAccountIds(
            buildPredictiveCashFlowReconciliationBoard({
              civilDate: date,
              openingAccounts: openingWs.accounts,
              closingAccounts: closingWs.accounts,
            }),
            accounts.map((a) => a.id)
          )
        );
        setSource("canonical");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setBoard(
          buildPredictiveCashFlowReconciliationBoardFromLocal({
            civilDate: date,
            accounts,
            transactions,
          })
        );
        setSource("local");
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar abertura/fechamento canônicos."
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // Contas/transações alimentam o recorte por empresa e o fallback local.
  }, [date, accounts, transactions]);

  const view = board ?? localFallback;

  return (
    <section
      className="rounded-xl border border-[#BFDBFE] bg-white p-5 shadow-none sm:p-6"
      data-testid="predictive-cf-reconciliation"
      data-source={source}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Scale className="mt-0.5 h-5 w-5 shrink-0 text-[#2563EB]" />
          <div>
            <h3 className="text-lg font-extrabold tracking-tight text-[#111827]">
              Fechamento diário
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
              Por conta e banco: abertura e fechamento informados × calculados
              (CR/CP e movimentos do dia). Diferenças destacadas. No rodapé, o
              consolidado das contas da empresa selecionada.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className={financeModuleFilterLabelClass()}>Dia</span>
            <input
              type="date"
              className={cn(financeModuleFilterFieldClass(), "w-auto min-w-[10.5rem]")}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="predictive-cf-recon-date"
            />
          </label>
          <Link
            to={`/finance/treasury/today/closing${date ? `?date=${date}` : ""}`}
            className="text-sm font-semibold text-[#2563EB] hover:underline"
          >
            Fechar o dia
          </Link>
        </div>
      </div>

      {error && source === "local" ? (
        <p className="mb-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
          Usando projeção local (CR/CP da agenda). {error}
        </p>
      ) : null}

      {loading && !view ? (
        <p className="py-8 text-center text-sm text-[#6B7280]">Carregando…</p>
      ) : !view || view.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#E5E7EB] px-4 py-8 text-center text-sm text-[#6B7280]">
          Nenhuma conta ativa para reconciliar neste dia.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
          <table className="min-w-[960px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F8FAFC] text-left text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                <th className="px-3 py-2.5">Conta / banco</th>
                <th className="px-3 py-2.5 text-right">Abert. informada</th>
                <th className="px-3 py-2.5 text-right">Abert. calculada</th>
                <th className="px-3 py-2.5 text-right">Δ abert.</th>
                <th className="px-3 py-2.5 text-right">CR (entradas)</th>
                <th className="px-3 py-2.5 text-right">CP (saídas)</th>
                <th className="px-3 py-2.5 text-right">Fech. calculado</th>
                <th className="px-3 py-2.5 text-right">Fech. informado</th>
                <th className="px-3 py-2.5 text-right">Δ fech.</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <React.Fragment key={row.accountId}>
                  <AccountRow row={row} />
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr
                className="border-t-2 border-[#111827] bg-[#F1F5F9]"
                data-testid="predictive-cf-recon-totals"
              >
                <td className="px-3 py-3.5 align-top">
                  <p className="text-sm font-extrabold text-[#111827]">
                    Fechamento final (todas as contas)
                  </p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">
                    {view.totals.accountCount} conta
                    {view.totals.accountCount === 1 ? "" : "s"}
                    {view.totals.divergenceCount > 0
                      ? ` · ${view.totals.divergenceCount} com diferença`
                      : " · sem diferenças"}
                  </p>
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <MoneyCell value={view.totals.informedOpening} emphasize />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <MoneyCell value={view.totals.calculatedOpening} />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <DiffCell value={view.totals.openingDiff} />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <MoneyCell value={view.totals.receivables} />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <MoneyCell value={view.totals.payables} />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <MoneyCell value={view.totals.calculatedClosing} />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <MoneyCell value={view.totals.informedClosing} emphasize />
                </td>
                <td className="px-3 py-3.5 text-right align-top">
                  <DiffCell value={view.totals.closingDiff} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-[#6B7280]">
        Calculado = abertura + CR − CP (+ transferências/locais na rotina
        canônica). Informado = valores digitados/confirmados na Tesouraria.
        Δ = informado − calculado.
      </p>
    </section>
  );
}
