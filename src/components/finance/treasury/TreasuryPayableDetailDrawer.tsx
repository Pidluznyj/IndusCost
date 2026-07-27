import React, { useEffect, useMemo, useState } from "react";
import {
  TREASURY_PAYABLE_PROGRAMMING_STATUSES,
  TREASURY_TITLE_OPERATIONAL_PRIORITIES,
  type TreasuryFinancialAccountDto,
  type TreasuryPayableListItemDto,
  type TreasuryPayableProgrammingImpactDto,
  type TreasuryPayableProgrammingStatus,
  type TreasuryTitleOperationalPriority,
} from "@/src/lib/treasury/contracts/index.js";
import {
  cancelTreasuryPayableProgramPayment,
  holdTreasuryPayable,
  programTreasuryPayablePayment,
  releaseHoldTreasuryPayable,
  updateTreasuryPayableProgramPayment,
} from "@/src/lib/treasury/treasuryPayablesApi.js";
import {
  TREASURY_PAYABLE_PRIORITY_LABELS,
  TREASURY_PAYABLE_PROGRAMMING_STATUS_LABELS,
  TREASURY_PAYABLE_STATUS_LABELS,
  TREASURY_PAYABLE_STATUS_TONES,
  buildTreasuryPayableOperationalHistory,
  formatTreasuryPayableDate,
  formatTreasuryPayableDateTime,
  formatTreasuryPayableMoney,
  previewTreasuryPayableProgrammingImpact,
  resolveTreasuryPayableAccountLabel,
} from "@/src/lib/treasury/treasuryPayablesUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import {
  Overlay,
  OverlayBadge,
  OverlayBody,
  OverlayFooter,
  OverlayHeader,
  OverlaySection,
} from "@/src/components/ui/overlay";
import { HttpError } from "@/src/lib/http.js";
import { normalizeTreasuryMoneyString } from "@/src/lib/treasury/treasuryMoney.js";
import { TreasuryPayableProgrammingConfirmDialog } from "./TreasuryPayableProgrammingConfirmDialog.js";

export type TreasuryPayableDetailDrawerProps = {
  open: boolean;
  row: TreasuryPayableListItemDto | null;
  accounts: TreasuryFinancialAccountDto[];
  balancesByAccountId: Record<string, string | null | undefined>;
  canProgram?: boolean;
  onClose: () => void;
  onSaved?: (row: TreasuryPayableListItemDto) => void;
};

type ProgramFormState = {
  scheduledDate: string;
  plannedAccountId: string;
  scheduledAmount: string;
  priority: TreasuryTitleOperationalPriority;
  responsibleUserId: string;
  status: TreasuryPayableProgrammingStatus;
  justification: string;
  notes: string;
  expectedVersion: number;
};

function formFromRow(row: TreasuryPayableListItemDto): ProgramFormState {
  return {
    scheduledDate: row.complement?.scheduledDate ?? row.scheduledDate ?? "",
    plannedAccountId:
      row.complement?.plannedAccountId ?? row.plannedAccountId ?? "",
    scheduledAmount:
      row.complement?.scheduledAmount ?? row.scheduledAmount ?? row.openAmount ?? "",
    priority: row.complement?.priority ?? row.priority ?? "NORMAL",
    responsibleUserId: row.complement?.responsibleUserId ?? "",
    status:
      row.complement?.nextAction === "AUTHORIZED" ? "AUTHORIZED" : "PROGRAMMED",
    justification: row.complement?.reason ?? "",
    notes: row.complement?.notes ?? "",
    expectedVersion: row.complement?.version ?? 0,
  };
}

export function TreasuryPayableDetailDrawer({
  open,
  row,
  accounts,
  balancesByAccountId,
  canProgram = false,
  onClose,
  onSaved,
}: TreasuryPayableDetailDrawerProps) {
  const [form, setForm] = useState<ProgramFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const [confirmImpact, setConfirmImpact] =
    useState<TreasuryPayableProgrammingImpactDto | null>(null);
  const [holdReason, setHoldReason] = useState("");

  useEffect(() => {
    if (!row) {
      setForm(null);
      setError(null);
      setIsConflict(false);
      setConfirmImpact(null);
      setHoldReason("");
      return;
    }
    setForm(formFromRow(row));
    setError(null);
    setIsConflict(false);
    setConfirmImpact(null);
    setHoldReason(row.complement?.reason ?? "");
  }, [row]);

  const history = useMemo(
    () => (row ? buildTreasuryPayableOperationalHistory(row) : []),
    [row]
  );

  if (!row || !form) return null;

  const statusLabel = TREASURY_PAYABLE_STATUS_LABELS[row.operationalStatus];
  const statusTone = TREASURY_PAYABLE_STATUS_TONES[row.operationalStatus];
  const hasProgramming = Boolean(
    row.complement?.scheduledDate || row.complement?.scheduledAmount
  );
  const onHold = row.complement?.status === "ON_HOLD";
  const editable =
    canProgram &&
    !row.official.cancellation.isCancelledOrRemovedFromSource &&
    Number(row.openAmount ?? 0) > 0 &&
    row.complement?.status !== "CANCELLED";

  const field = financeModuleFilterFieldClass();
  const label = financeModuleFilterLabelClass();

  function patchForm(partial: Partial<ProgramFormState>) {
    setForm((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function buildImpactPreview(): TreasuryPayableProgrammingImpactDto | null {
    if (!form.plannedAccountId.trim() || !form.scheduledAmount.trim()) {
      setError("Conta pagadora e valor programado são obrigatórios.");
      return null;
    }
    try {
      const amount = normalizeTreasuryMoneyString(form.scheduledAmount.trim());
      return previewTreasuryPayableProgrammingImpact({
        accountId: form.plannedAccountId.trim(),
        scheduledAmount: amount,
        accounts,
        balancesByAccountId,
      });
    } catch {
      setError("Valor programado inválido.");
      return null;
    }
  }

  function openConfirm() {
    if (!editable) return;
    if (!form.scheduledDate.trim()) {
      setError("Data programada é obrigatória.");
      return;
    }
    if (!form.justification.trim()) {
      setError("Justificativa é obrigatória.");
      return;
    }
    const impact = buildImpactPreview();
    if (!impact) return;
    setError(null);
    setConfirmImpact(impact);
  }

  async function confirmProgram() {
    if (!editable || !confirmImpact) return;
    setSaving(true);
    setError(null);
    setIsConflict(false);
    try {
      const body = {
        scheduledDate: form.scheduledDate.trim(),
        plannedAccountId: form.plannedAccountId.trim(),
        scheduledAmount: normalizeTreasuryMoneyString(
          form.scheduledAmount.trim()
        ),
        priority: form.priority,
        responsibleUserId: form.responsibleUserId.trim() || null,
        justification: form.justification.trim(),
        notes: form.notes.trim() || null,
        status: form.status,
        expectedVersion: form.expectedVersion,
      };
      const result = hasProgramming
        ? await updateTreasuryPayableProgramPayment(row.titleId, body)
        : await programTreasuryPayablePayment(row.titleId, body);
      setForm(formFromRow(result.payable));
      setConfirmImpact(null);
      onSaved?.(result.payable);
    } catch (err) {
      const message =
        err instanceof HttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Não foi possível programar o pagamento.";
      setError(message);
      setIsConflict(err instanceof HttpError && err.status === 409);
      setConfirmImpact(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelProgramming() {
    if (!editable || !hasProgramming) return;
    if (!form.justification.trim()) {
      setError("Informe o motivo do cancelamento da programação.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await cancelTreasuryPayableProgramPayment(row.titleId, {
        reason: form.justification.trim(),
        expectedVersion: form.expectedVersion,
      });
      setForm(formFromRow(result.payable));
      onSaved?.(result.payable);
    } catch (err) {
      setError(
        err instanceof HttpError
          ? err.message
          : "Não foi possível cancelar a programação."
      );
      setIsConflict(err instanceof HttpError && err.status === 409);
    } finally {
      setSaving(false);
    }
  }

  async function handleHold(hold: boolean) {
    if (!editable) return;
    const reason = holdReason.trim() || form.justification.trim();
    if (!reason) {
      setError("Motivo é obrigatório para bloqueio/desbloqueio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = hold
        ? await holdTreasuryPayable(row.titleId, {
            reason,
            notes: form.notes.trim() || null,
            expectedVersion: form.expectedVersion,
          })
        : await releaseHoldTreasuryPayable(row.titleId, {
            reason,
            notes: form.notes.trim() || null,
            expectedVersion: form.expectedVersion,
          });
      setForm(formFromRow(saved));
      onSaved?.(saved);
    } catch (err) {
      setError(
        err instanceof HttpError
          ? err.message
          : "Não foi possível atualizar o bloqueio."
      );
      setIsConflict(err instanceof HttpError && err.status === 409);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Overlay
        open={open}
        onClose={onClose}
        size="lg"
        ariaLabelledBy="treasury-payable-drawer-title"
        testId="treasury-payable-detail-drawer"
      >
        <OverlayHeader
          titleId="treasury-payable-drawer-title"
          eyebrow="Tesouraria · Contas a pagar"
          title={row.official.counterparty.name ?? `Título #${row.externalId}`}
          subtitle={`Nomus ${row.externalId} · venc. ${formatTreasuryPayableDate(row.official.dueDate)}`}
          onClose={onClose}
          actions={
            <OverlayBadge tone={statusTone} variant="soft">
              {statusLabel}
            </OverlayBadge>
          }
        />
        <OverlayBody>
          <OverlaySection title="Título oficial">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Valor original</dt>
                <dd className="font-semibold tabular-nums">
                  {formatTreasuryPayableMoney(row.official.originalAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Saldo aberto</dt>
                <dd className="font-semibold tabular-nums">
                  {formatTreasuryPayableMoney(row.openAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valor pago</dt>
                <dd className="tabular-nums">
                  {formatTreasuryPayableMoney(row.paidAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Documento</dt>
                <dd>{row.official.documentNumber ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Categoria</dt>
                <dd>{row.classification ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Centro de custo</dt>
                <dd>{row.costCenterLabel ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  Vencimento oficial (imutável)
                </dt>
                <dd className="tabular-nums">
                  {formatTreasuryPayableDate(row.official.dueDate)}
                </dd>
              </div>
            </dl>
          </OverlaySection>

          <OverlaySection title="Programação de pagamento">
            <div
              className="space-y-3"
              data-testid="treasury-payable-programming-form"
            >
              {error ? (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    isConflict
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-rose-200 bg-rose-50 text-rose-900"
                  }`}
                  data-testid="treasury-payable-programming-error"
                >
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={label}>Data programada</span>
                  <input
                    type="date"
                    className={field}
                    value={form.scheduledDate}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({ scheduledDate: e.target.value })
                    }
                    data-testid="treasury-payable-program-date"
                  />
                </label>
                <label className="space-y-1">
                  <span className={label}>Conta pagadora</span>
                  <select
                    className={field}
                    value={form.plannedAccountId}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({ plannedAccountId: e.target.value })
                    }
                    data-testid="treasury-payable-program-account"
                  >
                    <option value="">Selecione…</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} · {acc.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={label}>Valor programado</span>
                  <input
                    className={field}
                    value={form.scheduledAmount}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({ scheduledAmount: e.target.value })
                    }
                    placeholder="0.00"
                    data-testid="treasury-payable-program-amount"
                  />
                </label>
                <label className="space-y-1">
                  <span className={label}>Prioridade</span>
                  <select
                    className={field}
                    value={form.priority}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({
                        priority: e.target
                          .value as TreasuryTitleOperationalPriority,
                      })
                    }
                  >
                    {TREASURY_TITLE_OPERATIONAL_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {TREASURY_PAYABLE_PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={label}>Responsável (userId)</span>
                  <input
                    className={field}
                    value={form.responsibleUserId}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({ responsibleUserId: e.target.value })
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className={label}>Status</span>
                  <select
                    className={field}
                    value={form.status}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({
                        status: e.target
                          .value as TreasuryPayableProgrammingStatus,
                      })
                    }
                  >
                    {TREASURY_PAYABLE_PROGRAMMING_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TREASURY_PAYABLE_PROGRAMMING_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className={label}>Justificativa</span>
                  <textarea
                    className={field}
                    rows={2}
                    value={form.justification}
                    disabled={!editable}
                    onChange={(e) =>
                      patchForm({ justification: e.target.value })
                    }
                    data-testid="treasury-payable-program-justification"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className={label}>Observações</span>
                  <textarea
                    className={field}
                    rows={2}
                    value={form.notes}
                    disabled={!editable}
                    onChange={(e) => patchForm({ notes: e.target.value })}
                    data-testid="treasury-payable-program-notes"
                  />
                </label>
              </div>

              {editable ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                    onClick={openConfirm}
                    disabled={saving}
                    data-testid="treasury-payable-program-review"
                  >
                    {hasProgramming
                      ? "Revisar alteração / adiamento"
                      : "Revisar programação"}
                  </button>
                  {hasProgramming ? (
                    <button
                      type="button"
                      className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                      onClick={() => void handleCancelProgramming()}
                      disabled={saving}
                      data-testid="treasury-payable-program-cancel"
                    >
                      Cancelar programação
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sem permissão ou título indisponível para programação.
                </p>
              )}
            </div>
          </OverlaySection>

          <OverlaySection title="Bloqueio operacional">
            <div className="space-y-3" data-testid="treasury-payable-hold-section">
              <label className="space-y-1 block">
                <span className={label}>Motivo do bloqueio</span>
                <input
                  className={field}
                  value={holdReason}
                  disabled={!editable}
                  onChange={(e) => setHoldReason(e.target.value)}
                  data-testid="treasury-payable-hold-reason"
                />
              </label>
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  {!onHold ? (
                    <button
                      type="button"
                      className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                      onClick={() => void handleHold(true)}
                      disabled={saving}
                      data-testid="treasury-payable-hold"
                    >
                      Bloquear título
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                      onClick={() => void handleHold(false)}
                      disabled={saving}
                      data-testid="treasury-payable-release-hold"
                    >
                      Remover bloqueio
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </OverlaySection>

          <OverlaySection title="Impacto no caixa (atual)">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Conta pagadora</dt>
                <dd>
                  {resolveTreasuryPayableAccountLabel(
                    accounts,
                    row.plannedAccountId
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Valor programado
                </dt>
                <dd className="tabular-nums">
                  {formatTreasuryPayableMoney(row.scheduledAmount)}
                </dd>
              </div>
            </dl>
          </OverlaySection>

          <OverlaySection title="Histórico operacional">
            <ul
              className="space-y-2 text-sm"
              data-testid="treasury-payable-history"
            >
              {history.map((item) => (
                <li
                  key={`${item.at}-${item.label}`}
                  className="rounded-lg border border-border/70 px-3 py-2"
                >
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTreasuryPayableDateTime(item.at)}
                  </p>
                  <p className="mt-1 text-muted-foreground">{item.detail}</p>
                </li>
              ))}
            </ul>
          </OverlaySection>
        </OverlayBody>
        <OverlayFooter testId="treasury-payable-detail-footer">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onClose}
          >
            Fechar
          </button>
        </OverlayFooter>
      </Overlay>

      {confirmImpact ? (
        <TreasuryPayableProgrammingConfirmDialog
          accountLabel={resolveTreasuryPayableAccountLabel(
            accounts,
            form.plannedAccountId
          )}
          impact={confirmImpact}
          saving={saving}
          onCancel={() => setConfirmImpact(null)}
          onConfirm={() => void confirmProgram()}
        />
      ) : null}
    </>
  );
}
