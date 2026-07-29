/**
 * Informar saldo inicial e final do dia — Fluxo Gerencial.
 * Usa APIs canônicas /today/opening e /today/closing (audit + usuário).
 * Dias passados: somente SUPER_ADMIN.
 */

import React, { useEffect, useMemo, useState } from "react";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import {
  fetchTreasuryTodayOpening,
  saveTreasuryTodayOpening,
} from "@/src/lib/treasury/treasuryTodayOpeningApi.js";
import {
  fetchTreasuryTodayClosing,
  saveTreasuryTodayClosing,
} from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import {
  canEditTreasuryCivilDateBalances,
  formatMoneyInputFromString,
  parseMoneyInputPtBr,
} from "@/src/lib/treasury/treasuryPredictiveCashFlowBalanceEdit.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import {
  financeBiButtonOutlineClass,
  financeBiButtonPrimaryClass,
} from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export type PredictiveCashFlowBalanceCorrectDialogProps = {
  account: PredictiveCashFlowAccount;
  open: boolean;
  disabled?: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function PredictiveCashFlowBalanceCorrectDialog({
  account,
  open,
  disabled,
  isSuperAdmin,
  onClose,
  onSaved,
}: PredictiveCashFlowBalanceCorrectDialogProps) {
  const today = useMemo(() => todayTreasuryCivilDateInSaoPaulo(), []);
  const [civilDate, setCivilDate] = useState(today);
  const [openingInput, setOpeningInput] = useState("");
  const [closingInput, setClosingInput] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingVersion, setOpeningVersion] = useState(1);
  const [closingVersion, setClosingVersion] = useState(1);

  const dateGate = canEditTreasuryCivilDateBalances({
    civilDate,
    todayCivilDate: today,
    isSuperAdmin,
  });

  useEffect(() => {
    if (!open) return;
    setCivilDate(today);
    setJustification("");
    setError(null);
    setOpeningInput(
      account.initialBalance.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    setClosingInput("");
    setOpeningVersion(1);
    setClosingVersion(1);
  }, [open, account.id, account.initialBalance, today]);

  useEffect(() => {
    if (!open) return;
    const gate = canEditTreasuryCivilDateBalances({
      civilDate,
      todayCivilDate: today,
      isSuperAdmin,
    });
    if (!gate.allowed) {
      setError(gate.reason);
      return;
    }
    setLoading(true);
    setError(null);
    const ac = new AbortController();
    void Promise.all([
      fetchTreasuryTodayOpening({ date: civilDate, signal: ac.signal }),
      fetchTreasuryTodayClosing({ date: civilDate, signal: ac.signal }),
    ])
      .then(([openingWs, closingWs]) => {
        if (ac.signal.aborted) return;
        const openingAcc = openingWs.accounts.find(
          (a) => a.accountId === account.id
        );
        const closingAcc = closingWs.accounts.find(
          (a) => a.accountId === account.id
        );
        if (openingAcc) {
          setOpeningVersion(openingAcc.expectedVersion);
          setOpeningInput(
            formatMoneyInputFromString(
              openingAcc.currentOpeningBalance ??
                openingAcc.suggestedOpeningBalance
            )
          );
        }
        if (closingAcc) {
          setClosingVersion(closingAcc.expectedVersion);
          setClosingInput(
            formatMoneyInputFromString(closingAcc.informedClosingBalance)
          );
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar os saldos do dia."
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, civilDate, account.id, isSuperAdmin, today]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const gate = canEditTreasuryCivilDateBalances({
      civilDate,
      todayCivilDate: today,
      isSuperAdmin,
    });
    if (!gate.allowed) {
      setError(gate.reason);
      return;
    }
    const openingBalance = parseMoneyInputPtBr(openingInput);
    const closingBalance = parseMoneyInputPtBr(closingInput);
    if (openingBalance == null && closingBalance == null) {
      setError("Informe o saldo inicial e/ou o saldo final do dia.");
      return;
    }
    const reason = justification.trim();
    if (reason.length < 3) {
      setError(
        "Informe o motivo (mín. 3 caracteres) — fica registrado no log com o usuário."
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (openingBalance != null) {
        await saveTreasuryTodayOpening({
          civilDate,
          items: [
            {
              accountId: account.id,
              expectedVersion: openingVersion,
              amount: openingBalance,
              notes: `Fluxo Gerencial · saldo inicial ${civilDate}`,
              justificationCode: "OTHER",
              justificationDetail: reason,
            },
          ],
        });
      }
      if (closingBalance != null) {
        // Reconsulta versão após possível abertura (optimistic lock).
        const closingWs = await fetchTreasuryTodayClosing({ date: civilDate });
        const closingAcc = closingWs.accounts.find(
          (a) => a.accountId === account.id
        );
        const version = closingAcc?.expectedVersion ?? closingVersion;
        await saveTreasuryTodayClosing({
          civilDate,
          items: [
            {
              accountId: account.id,
              expectedVersion: version,
              amount: closingBalance,
              notes: `Fluxo Gerencial · saldo final ${civilDate} · ${reason}`,
            },
          ],
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível gravar os saldos do dia."
      );
    } finally {
      setBusy(false);
    }
  }

  const pastDay = civilDate < today;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcf-balance-correct-title"
      data-testid="predictive-cf-balance-correct-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Saldos do dia
          </p>
          <h2
            id="pcf-balance-correct-title"
            className="text-lg font-extrabold tracking-tight text-[#111827]"
          >
            {account.name}
          </h2>
          <p className="text-sm text-[#6B7280]">
            {account.institutionName} · saldo atual na lista{" "}
            <span className="font-semibold tabular-nums text-[#111827]">
              {formatPredictiveCashFlowMoney(account.initialBalance)}
            </span>
          </p>
          <p className="text-xs text-[#6B7280]">
            Grava saldo inicial e final nas rotinas canônicas da Tesouraria, com
            log e usuário.
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>Dia</span>
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={civilDate}
            max={today}
            disabled={disabled || busy || !isSuperAdmin}
            onChange={(e) => {
              if (!isSuperAdmin) return;
              setCivilDate(e.target.value);
            }}
            data-testid="predictive-cf-balance-correct-date"
          />
          {!isSuperAdmin ? (
            <p className="text-[11px] text-[#6B7280]">
              Dia vigente. Alterar dias passados exige SUPER_ADMIN.
            </p>
          ) : pastDay ? (
            <p className="text-[11px] font-medium text-[#D97706]">
              Dia passado — SUPER_ADMIN · alteração registrada no log.
            </p>
          ) : (
            <p className="text-[11px] text-[#6B7280]">
              SUPER_ADMIN pode mudar a data para corrigir dias passados (log).
            </p>
          )}
        </label>

        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Saldo inicial do dia
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            value={openingInput}
            disabled={disabled || busy || loading || !dateGate.allowed}
            onChange={(e) => setOpeningInput(e.target.value)}
            inputMode="decimal"
            placeholder="Ex.: 60351,00"
            autoFocus
            data-testid="predictive-cf-balance-correct-opening"
          />
        </label>

        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Saldo final do dia (banco)
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            value={closingInput}
            disabled={disabled || busy || loading || !dateGate.allowed}
            onChange={(e) => setClosingInput(e.target.value)}
            inputMode="decimal"
            placeholder="Ex.: 61200,50"
            data-testid="predictive-cf-balance-correct-closing"
          />
        </label>

        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Motivo (obrigatório · log de auditoria)
          </span>
          <textarea
            className={cn(financeModuleFilterFieldClass(), "min-h-[72px] resize-y")}
            value={justification}
            disabled={disabled || busy}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Ex.: conferência com extrato do dia"
            data-testid="predictive-cf-balance-correct-reason"
          />
        </label>

        {error ? (
          <p className="text-sm text-[#DC2626]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={financeBiButtonPrimaryClass}
            disabled={
              disabled || busy || loading || !dateGate.allowed
            }
            data-testid="predictive-cf-balance-correct-submit"
          >
            {busy ? "Salvando…" : "Salvar saldos do dia"}
          </button>
        </div>
      </form>
    </div>
  );
}
