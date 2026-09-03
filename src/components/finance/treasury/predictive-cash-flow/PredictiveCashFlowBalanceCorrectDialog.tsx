/**
 * Informar saldo inicial e final do dia — Fluxo Gerencial.
 * Grava nas rotinas canônicas /today/opening e /today/closing (audit + usuário).
 * Dias passados: somente SUPER_ADMIN.
 *
 * Leitura: o modal edita UMA conta, então hidrata pela leitura leve
 * `accounts/:id/daily-balance` — não pelos workspaces completos de abertura e
 * fechamento (que varrem todas as contas e, no fechamento, ainda carregam
 * CR/CP, ledger, transferências, preview e previsão do dia).
 *
 * Enquanto hidrata, o modal não trava: os campos já ficam editáveis e só o
 * submit espera a versão persistida (optimistic lock). Valor digitado pelo
 * usuário nunca é sobrescrito por resposta que chegou depois.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import { saveTreasuryTodayOpening } from "@/src/lib/treasury/treasuryTodayOpeningApi.js";
import { saveTreasuryTodayClosing } from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import { fetchTreasuryAccountDailyBalance } from "@/src/lib/treasury/treasuryAccountDailyBalanceApi.js";
import {
  canEditTreasuryCivilDateBalances,
  canSubmitTreasuryBalanceEdit,
  parseMoneyInputPtBr,
  resolveTreasuryClosingInputValue,
  resolveTreasuryOpeningInputValue,
  shouldApplyTreasuryBalanceHydration,
  treasuryBalanceHydrationKey,
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
  const [saving, setSaving] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingVersion, setOpeningVersion] = useState(0);
  const [closingVersion, setClosingVersion] = useState(0);
  const [openingExists, setOpeningExists] = useState(false);
  const [closingExists, setClosingExists] = useState(false);
  /** Conta/data cuja versão persistida já é conhecida (libera o submit). */
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  /**
   * Campo "sujo" = o usuário já digitou nele. Em ref porque a resposta HTTP
   * precisa do valor no instante em que chega, não do valor capturado quando
   * o efeito foi montado.
   */
  const openingDirtyRef = useRef(false);
  const closingDirtyRef = useRef(false);

  const currentKey = treasuryBalanceHydrationKey({
    accountId: account.id,
    civilDate,
  });
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;

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
    setOpeningVersion(0);
    setClosingVersion(0);
    setOpeningExists(false);
    setClosingExists(false);
    setHydratedKey(null);
    openingDirtyRef.current = false;
    closingDirtyRef.current = false;
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

    // Troca de conta/data: o que já foi digitado não vale para a nova chave.
    const requestKey = treasuryBalanceHydrationKey({
      accountId: account.id,
      civilDate,
    });
    openingDirtyRef.current = false;
    closingDirtyRef.current = false;
    setHydratedKey(null);
    setHydrating(true);
    setError(null);

    const ac = new AbortController();
    void fetchTreasuryAccountDailyBalance({
      accountId: account.id,
      date: civilDate,
      signal: ac.signal,
    })
      .then((data) => {
        if (ac.signal.aborted) return;
        // Resposta de conta/data que já não está em edição não contamina.
        if (requestKey !== currentKeyRef.current) return;

        setOpeningVersion(data.opening.expectedVersion);
        setClosingVersion(data.closing.expectedVersion);
        setOpeningExists(data.opening.exists);
        setClosingExists(data.closing.exists);
        setHydratedKey(requestKey);

        if (
          shouldApplyTreasuryBalanceHydration({
            responseKey: requestKey,
            currentKey: currentKeyRef.current,
            dirty: openingDirtyRef.current,
          })
        ) {
          setOpeningInput(
            resolveTreasuryOpeningInputValue({
              amount: data.opening.amount,
              suggestedBalance: data.opening.suggestedBalance,
            })
          );
        }
        if (
          shouldApplyTreasuryBalanceHydration({
            responseKey: requestKey,
            currentKey: currentKeyRef.current,
            dirty: closingDirtyRef.current,
          })
        ) {
          setClosingInput(
            resolveTreasuryClosingInputValue({ amount: data.closing.amount })
          );
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (requestKey !== currentKeyRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar os saldos do dia."
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setHydrating(false);
      });
    return () => ac.abort();
  }, [open, civilDate, account.id, isSuperAdmin, today]);

  if (!open) return null;

  const canSubmit = canSubmitTreasuryBalanceEdit({
    hydratedKey,
    currentKey,
    dateAllowed: dateGate.allowed,
    saving,
    disabled,
  });

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

    setSaving(true);
    setError(null);
    try {
      let closingExpectedVersion = closingVersion;
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
        if (closingBalance != null) {
          /**
           * Abertura e fechamento compartilham o contador de versão da rotina
           * (a versão do fechamento é o max das duas), então gravar a abertura
           * invalida o expectedVersion do fechamento. Reconsulta a versão pela
           * leitura leve da própria conta/data — não pelo workspace completo.
           */
          const refreshed = await fetchTreasuryAccountDailyBalance({
            accountId: account.id,
            date: civilDate,
          });
          closingExpectedVersion = refreshed.closing.expectedVersion;
        }
      }
      if (closingBalance != null) {
        await saveTreasuryTodayClosing({
          civilDate,
          items: [
            {
              accountId: account.id,
              expectedVersion: closingExpectedVersion,
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
      setSaving(false);
    }
  }

  const pastDay = civilDate < today;
  const fieldsDisabled = disabled || saving || !dateGate.allowed;
  const hydrated = hydratedKey === currentKey;

  /**
   * "Criando" vs. "corrigindo" só pode ser afirmado depois de hidratar —
   * antes disso o texto informa que a consulta está em curso, nunca que não
   * existe saldo gravado.
   */
  function fieldStateText(
    exists: boolean,
    existingText: string,
    missingText: string
  ): string | null {
    if (hydrating) return "Carregando saldo gravado…";
    if (!hydrated) return null;
    return exists ? existingText : missingText;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcf-balance-correct-title"
      data-testid="predictive-cf-balance-correct-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
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
            disabled={disabled || saving || !isSuperAdmin}
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
            disabled={fieldsDisabled}
            onChange={(e) => {
              openingDirtyRef.current = true;
              setOpeningInput(e.target.value);
            }}
            inputMode="decimal"
            placeholder="Ex.: 60351,00"
            autoFocus
            data-testid="predictive-cf-balance-correct-opening"
          />
          <p
            className="text-[11px] text-[#6B7280]"
            data-testid="predictive-cf-balance-correct-opening-state"
          >
            {fieldStateText(
              openingExists,
              "Corrigindo o saldo inicial já informado neste dia.",
              "Nenhum saldo inicial informado ainda para este dia."
            )}
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Saldo final do dia (banco)
          </span>
          <input
            className={financeModuleFilterFieldClass()}
            value={closingInput}
            disabled={fieldsDisabled}
            onChange={(e) => {
              closingDirtyRef.current = true;
              setClosingInput(e.target.value);
            }}
            inputMode="decimal"
            placeholder="Ex.: 61200,50"
            data-testid="predictive-cf-balance-correct-closing"
          />
          <p
            className="text-[11px] text-[#6B7280]"
            data-testid="predictive-cf-balance-correct-closing-state"
          >
            {fieldStateText(
              closingExists,
              "Corrigindo o saldo final já informado neste dia.",
              "Nenhum saldo final informado ainda para este dia."
            )}
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className={financeModuleFilterLabelClass()}>
            Motivo (obrigatório · log de auditoria)
          </span>
          <textarea
            className={cn(financeModuleFilterFieldClass(), "min-h-[72px] resize-y")}
            value={justification}
            disabled={disabled || saving}
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
            disabled={saving}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={financeBiButtonPrimaryClass}
            disabled={!canSubmit}
            data-testid="predictive-cf-balance-correct-submit"
          >
            {saving ? "Salvando…" : "Salvar saldos do dia"}
          </button>
        </div>
      </form>
    </div>
  );
}
