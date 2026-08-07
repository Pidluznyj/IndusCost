/**
 * Conciliação manual do Apoio ao Caixa — 1:1, 1:N, N:1, parcial e ajustes
 * (CS-012/013/014). Delega integralmente ao motor oficial já corrigido
 * (`acceptTreasuryReconciliation` → POST /reconciliations, mesma rota do
 * resto da Tesouraria) — nenhum cálculo aqui é autoritativo.
 *
 * A simulação de residual nesta tela é só visual (Prompt 0 §19): o backend
 * revalida capacidade e residual dentro da transação e é quem decide de
 * fato. Só títulos reais (`officialTitleKey`) entram como candidato —
 * previsão nunca aparece na lista.
 */

import React, { useMemo, useState } from "react";
import { renderInPortal } from "@/src/lib/renderInPortal.js";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import type {
  TreasuryReconciliationAllocationKind,
} from "@/src/lib/treasury/contracts/treasuryEnums.js";
import type { CashSupportUnifiedRow } from "@/src/lib/treasury/contracts/cashSupportContracts.js";

const ADJUSTMENT_KINDS: { kind: TreasuryReconciliationAllocationKind; label: string; needsMemo: boolean }[] = [
  { kind: "FEE", label: "Tarifa", needsMemo: false },
  { kind: "INTEREST", label: "Juros", needsMemo: false },
  { kind: "DISCOUNT", label: "Desconto", needsMemo: false },
  { kind: "ABATEMENT", label: "Abatimento", needsMemo: false },
  { kind: "DIFFERENCE", label: "Diferença", needsMemo: true },
  { kind: "UNIDENTIFIED", label: "Não identificado (investigação)", needsMemo: true },
];

const NEGATIVE_KINDS = new Set<TreasuryReconciliationAllocationKind>(["DISCOUNT", "ABATEMENT"]);

function money(value: string): string {
  return formatTreasuryBankMoney(value);
}

function toCents(value: string): number {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function isPositiveMoneyInput(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value.trim()) && toCents(value) > 0;
}

export type CashSupportReconcileAllocationDraft = {
  kind: TreasuryReconciliationAllocationKind;
  amount: string;
  memo: string | null;
  nomusSide?: "AR" | "AP" | null;
  officialTitleId?: string | null;
  nomusExternalId?: number | null;
  openBalance?: string | null;
};

export type CashSupportReconcileSubmitPayload = {
  companyCode: string;
  accountId: string;
  justification: string | null;
  movements: Array<{ bankMovementId: string; amount: string }>;
  allocations: CashSupportReconcileAllocationDraft[];
};

export type CashSupportReconcileDialogProps = {
  open: boolean;
  movements: CashSupportUnifiedRow[];
  candidateTitles: CashSupportUnifiedRow[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (payload: CashSupportReconcileSubmitPayload) => void;
};

export function CashSupportReconcileDialog({
  open,
  movements,
  candidateTitles,
  busy = false,
  error = null,
  onCancel,
  onSubmit,
}: CashSupportReconcileDialogProps) {
  const [movementAmounts, setMovementAmounts] = useState<Record<string, string>>(
    () => Object.fromEntries(movements.map((m) => [m.displayId, m.residualAmount]))
  );
  const [titleAllocations, setTitleAllocations] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<
    { id: string; kind: TreasuryReconciliationAllocationKind; amount: string; memo: string }[]
  >([]);
  const [justification, setJustification] = useState("");

  // MVP: exige mesma conta e empresa em todos os movimentos selecionados —
  // é a mesma exigência do accept() oficial (um match, uma conta).
  const consistency = useMemo(() => {
    const accountIds = new Set(movements.map((m) => m.accountContext?.accountId));
    const companyCodes = new Set(movements.map((m) => m.companyContext?.companyCode));
    return {
      ok: accountIds.size === 1 && companyCodes.size === 1 && !accountIds.has(undefined),
      accountId: movements[0]?.accountContext?.accountId ?? null,
      companyCode: movements[0]?.companyContext?.companyCode ?? null,
    };
  }, [movements]);

  const movementsTotalCents = useMemo(
    () =>
      movements.reduce(
        (sum, m) => sum + toCents(movementAmounts[m.displayId] ?? "0"),
        0
      ),
    [movements, movementAmounts]
  );

  const titlesTotalCents = useMemo(
    () =>
      candidateTitles.reduce(
        (sum, t) => sum + toCents(titleAllocations[t.displayId] ?? "0"),
        0
      ),
    [candidateTitles, titleAllocations]
  );

  const adjustmentsNetCents = useMemo(
    () =>
      adjustments.reduce((sum, a) => {
        const cents = toCents(a.amount);
        return NEGATIVE_KINDS.has(a.kind) ? sum - cents : sum + cents;
      }, 0),
    [adjustments]
  );

  // Simulação apenas visual — o backend é quem confirma (Prompt 0 §19).
  const simulatedCoveringCents = titlesTotalCents + adjustmentsNetCents;
  const balanced = movementsTotalCents > 0 && simulatedCoveringCents === movementsTotalCents;
  const missingMemo = adjustments.some(
    (a) => ADJUSTMENT_KINDS.find((k) => k.kind === a.kind)?.needsMemo && !a.memo.trim()
  );

  const canSubmit =
    consistency.ok &&
    balanced &&
    !missingMemo &&
    movements.every((m) => isPositiveMoneyInput(movementAmounts[m.displayId] ?? "0")) &&
    !busy;

  function addAdjustment() {
    setAdjustments((prev) => [
      ...prev,
      { id: `adj-${prev.length}-${Date.now()}`, kind: "FEE", amount: "0.00", memo: "" },
    ]);
  }

  function handleSubmit() {
    if (!canSubmit || !consistency.accountId || !consistency.companyCode) return;

    const allocations: CashSupportReconcileAllocationDraft[] = [];
    for (const title of candidateTitles) {
      const amount = titleAllocations[title.displayId];
      if (!amount || toCents(amount) <= 0) continue;
      allocations.push({
        kind: "TITLE",
        amount,
        memo: null,
        nomusSide: title.officialTitleKey?.side === "ACCOUNTS_RECEIVABLE" ? "AR" : "AP",
        officialTitleId: String(title.officialTitleKey?.externalId ?? ""),
        nomusExternalId: title.officialTitleKey?.externalId ?? null,
        openBalance: title.residualAmount,
      });
    }
    for (const adj of adjustments) {
      if (toCents(adj.amount) <= 0) continue;
      allocations.push({
        kind: adj.kind,
        amount: adj.amount,
        memo: adj.memo.trim() || null,
      });
    }

    onSubmit({
      companyCode: consistency.companyCode,
      accountId: consistency.accountId,
      justification: justification.trim() || null,
      movements: movements.map((m) => ({
        bankMovementId: m.bankMovementKey!.bankMovementId,
        amount: movementAmounts[m.displayId] ?? "0.00",
      })),
      allocations,
    });
  }

  if (!open) return null;

  return renderInPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      data-testid="cash-support-reconcile-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
        <div>
          <h2 className="text-base font-semibold text-foreground">Conciliar</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Conciliação bancária local — não altera baixa, vencimento ou saldo oficial no Nomus.
          </p>
        </div>

        {!consistency.ok ? (
          <p className="rounded-md bg-red-50 p-2 text-xs text-red-700" data-testid="cash-support-reconcile-inconsistent">
            Os movimentos selecionados precisam ser da mesma conta e empresa.
          </p>
        ) : null}

        <section>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Movimentos</h3>
          {movements.map((m) => (
            <div key={m.displayId} className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span>
                {m.bankDate} · {m.description ?? m.bankMovementKey?.bankMovementId} · disponível {money(m.residualAmount)}
              </span>
              <input
                className="w-24 rounded border border-border px-1.5 py-0.5 text-right tabular-nums"
                value={movementAmounts[m.displayId] ?? ""}
                onChange={(e) =>
                  setMovementAmounts((prev) => ({ ...prev, [m.displayId]: e.target.value }))
                }
                data-testid={`cash-support-reconcile-movement-amount-${m.displayId}`}
              />
            </div>
          ))}
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Títulos oficiais (previsão não aparece aqui)
          </h3>
          {candidateTitles.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Nenhum título oficial em aberto compatível.</p>
          ) : null}
          {candidateTitles.map((t) => (
            <div key={t.displayId} className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span>
                {t.description ?? "—"} · vence {t.dueDate} · saldo {money(t.residualAmount)}
              </span>
              <input
                className="w-24 rounded border border-border px-1.5 py-0.5 text-right tabular-nums"
                placeholder="0.00"
                value={titleAllocations[t.displayId] ?? ""}
                onChange={(e) =>
                  setTitleAllocations((prev) => ({ ...prev, [t.displayId]: e.target.value }))
                }
                data-testid={`cash-support-reconcile-title-amount-${t.displayId}`}
              />
            </div>
          ))}
        </section>

        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Ajustes</h3>
            <button
              type="button"
              className="text-[11px] font-semibold text-primary"
              onClick={addAdjustment}
              data-testid="cash-support-reconcile-add-adjustment"
            >
              + adicionar
            </button>
          </div>
          {adjustments.map((adj, i) => (
            <div key={adj.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <select
                className="rounded border border-border px-1.5 py-0.5"
                value={adj.kind}
                onChange={(e) =>
                  setAdjustments((prev) =>
                    prev.map((a, idx) =>
                      idx === i ? { ...a, kind: e.target.value as TreasuryReconciliationAllocationKind } : a
                    )
                  )
                }
              >
                {ADJUSTMENT_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                className="w-20 rounded border border-border px-1.5 py-0.5 text-right tabular-nums"
                value={adj.amount}
                onChange={(e) =>
                  setAdjustments((prev) =>
                    prev.map((a, idx) => (idx === i ? { ...a, amount: e.target.value } : a))
                  )
                }
              />
              <input
                className="min-w-[140px] flex-1 rounded border border-border px-1.5 py-0.5"
                placeholder="Motivo (obrigatório para diferença/não identificado)"
                value={adj.memo}
                onChange={(e) =>
                  setAdjustments((prev) =>
                    prev.map((a, idx) => (idx === i ? { ...a, memo: e.target.value } : a))
                  )
                }
              />
            </div>
          ))}
        </section>

        <input
          className="w-full rounded border border-border px-2 py-1 text-xs"
          placeholder="Justificativa (opcional)"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />

        <div
          className="rounded-md bg-muted/40 p-2 text-xs"
          data-testid="cash-support-reconcile-preview"
        >
          Simulação (não oficial) — movimentos: {money((movementsTotalCents / 100).toFixed(2))} ·
          {" "}cobertura: {money((simulatedCoveringCents / 100).toFixed(2))}
          {balanced ? (
            <span className="ml-2 font-semibold text-emerald-700">balanceado</span>
          ) : (
            <span className="ml-2 font-semibold text-amber-700">não balanceado</span>
          )}
        </div>

        {error ? (
          <p className="text-xs text-red-600" role="alert" data-testid="cash-support-reconcile-error">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="text-xs text-muted-foreground" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="cash-support-reconcile-submit"
          >
            {busy ? "Enviando…" : "Confirmar conciliação"}
          </button>
        </div>
      </div>
    </div>
  );
}
