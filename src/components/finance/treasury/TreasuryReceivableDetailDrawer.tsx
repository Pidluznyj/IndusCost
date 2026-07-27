import React, { useEffect, useState } from "react";
import {
  TREASURY_TITLE_OPERATIONAL_PRIORITIES,
  type TreasuryReceivableListItemDto,
  type TreasuryTitleOperationalPriority,
} from "@/src/lib/treasury/contracts/index.js";
import { putTreasuryReceivableExpectation } from "@/src/lib/treasury/treasuryReceivablesApi.js";
import {
  TREASURY_PRIORITY_LABELS,
  TREASURY_RECEIVABLE_STATUS_LABELS,
  TREASURY_RECEIVABLE_STATUS_TONES,
  buildTreasuryReceivableOperationalHistory,
  formatTreasuryReceivableDate,
  formatTreasuryReceivableDateTime,
  formatTreasuryReceivableMoney,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
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

export type TreasuryReceivableDetailDrawerProps = {
  open: boolean;
  row: TreasuryReceivableListItemDto | null;
  canManage?: boolean;
  onClose: () => void;
  onSaved?: (row: TreasuryReceivableListItemDto) => void;
};

type ExpectationFormState = {
  expectedDate: string;
  plannedAccountId: string;
  responsibleUserId: string;
  priority: TreasuryTitleOperationalPriority | "";
  nextAction: string;
  reason: string;
  notes: string;
  expectedVersion: number;
};

function formFromRow(row: TreasuryReceivableListItemDto): ExpectationFormState {
  return {
    expectedDate: row.complement?.expectedDate ?? "",
    plannedAccountId: row.complement?.plannedAccountId ?? "",
    responsibleUserId: row.complement?.responsibleUserId ?? "",
    priority: row.complement?.priority ?? "NORMAL",
    nextAction: row.complement?.nextAction ?? "",
    reason: row.complement?.reason ?? "",
    notes: row.complement?.notes ?? "",
    expectedVersion: row.complement?.version ?? 0,
  };
}

export function TreasuryReceivableDetailDrawer({
  open,
  row,
  canManage = false,
  onClose,
  onSaved,
}: TreasuryReceivableDetailDrawerProps) {
  const [form, setForm] = useState<ExpectationFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  useEffect(() => {
    if (!row) {
      setForm(null);
      setError(null);
      setIsConflict(false);
      return;
    }
    setForm(formFromRow(row));
    setError(null);
    setIsConflict(false);
  }, [row]);

  if (!row || !form) return null;

  const history = buildTreasuryReceivableOperationalHistory(row);
  const statusLabel =
    TREASURY_RECEIVABLE_STATUS_LABELS[row.operationalStatus];
  const statusTone = TREASURY_RECEIVABLE_STATUS_TONES[row.operationalStatus];
  const previousExpected = row.complement?.expectedDate ?? "";
  const dateChanging =
    (form.expectedDate || "") !== (previousExpected || "");
  const editable =
    canManage &&
    !row.official.cancellation.isCancelledOrRemovedFromSource &&
    Number(row.openAmount ?? 0) > 0 &&
    row.complement?.status !== "CANCELLED";

  async function handleSave() {
    if (!editable) return;
    setSaving(true);
    setError(null);
    setIsConflict(false);
    try {
      const nextExpected = form.expectedDate.trim() || null;
      if (dateChanging && !form.reason.trim()) {
        setError("Motivo é obrigatório ao alterar a data esperada.");
        setSaving(false);
        return;
      }
      const saved = await putTreasuryReceivableExpectation(row.titleId, {
        expectedDate: nextExpected,
        plannedAccountId: form.plannedAccountId.trim() || null,
        responsibleUserId: form.responsibleUserId.trim() || null,
        priority: (form.priority || "NORMAL") as TreasuryTitleOperationalPriority,
        nextAction: form.nextAction.trim() || null,
        reason: form.reason.trim() || null,
        notes: form.notes.trim() || null,
        expectedVersion: form.expectedVersion,
      });
      setForm(formFromRow(saved));
      onSaved?.(saved);
    } catch (err) {
      const message =
        err instanceof HttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Não foi possível salvar a expectativa.";
      setError(message);
      setIsConflict(err instanceof HttpError && err.status === 409);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      size="lg"
      ariaLabelledBy="treasury-receivable-drawer-title"
      testId="treasury-receivable-detail-drawer"
    >
      <OverlayHeader
        titleId="treasury-receivable-drawer-title"
        eyebrow="Tesouraria · Contas a receber"
        title={row.official.counterparty.name ?? `Título #${row.externalId}`}
        subtitle={`Nomus ${row.externalId} · venc. ${formatTreasuryReceivableDate(row.official.dueDate)}`}
        onClose={onClose}
        actions={
          <OverlayBadge tone={statusTone} variant="soft">
            {statusLabel}
          </OverlayBadge>
        }
      />
      <OverlayBody>
        <div className="space-y-5" data-testid="treasury-receivable-detail-body">
          <OverlaySection title="Título oficial">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <Field label="Cliente" value={row.official.counterparty.name} />
              <Field label="CNPJ/CPF" value={row.official.counterparty.taxId} />
              <Field
                label="Valor original"
                value={formatTreasuryReceivableMoney(row.official.originalAmount)}
              />
              <Field
                label="Saldo aberto"
                value={formatTreasuryReceivableMoney(row.openAmount)}
              />
              <Field
                label="Valor recebido"
                value={formatTreasuryReceivableMoney(row.receivedAmount)}
              />
              <Field
                label="Emissão (competência)"
                value={formatTreasuryReceivableDate(row.official.issuedOn)}
              />
              <Field
                label="Vencimento oficial"
                value={formatTreasuryReceivableDate(row.official.dueDate)}
              />
              <Field label="Dias de atraso" value={String(row.daysOverdue)} />
              <Field
                label="Descrição"
                value={row.official.description}
                className="sm:col-span-2"
              />
            </dl>
          </OverlaySection>

          <OverlaySection title="Pedido e nota fiscal">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <Field
                label="Pedido"
                value={
                  row.official.salesOrderCode ??
                  (row.official.salesOrderExternalId != null
                    ? String(row.official.salesOrderExternalId)
                    : null)
                }
              />
              <Field
                label="Nota fiscal"
                value={
                  row.official.invoice.number ??
                  (row.official.invoice.externalId != null
                    ? String(row.official.invoice.externalId)
                    : null)
                }
              />
              <Field label="Vendedor" value={row.sellerName} />
              <Field
                label="Resp. comercial"
                value={row.commercialOwnerName}
              />
            </dl>
          </OverlaySection>

          <OverlaySection title="Expectativa operacional">
            {editable ? (
              <form
                className="space-y-3"
                data-testid="treasury-receivable-expectation-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSave();
                }}
              >
                <p className="text-xs text-muted-foreground">
                  Altera apenas o complemento local. O vencimento oficial Nomus
                  permanece intacto.
                </p>
                {error ? (
                  <div
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    role="alert"
                    data-testid="treasury-receivable-expectation-error"
                  >
                    <p>{error}</p>
                    {isConflict ? (
                      <p className="mt-1 text-xs">
                        Conflito de versão — recarregue o título e tente
                        novamente.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className={financeModuleFilterLabelClass()}>
                      Data esperada
                    </span>
                    <input
                      type="date"
                      className={financeModuleFilterFieldClass()}
                      value={form.expectedDate}
                      onChange={(e) =>
                        setForm({ ...form, expectedDate: e.target.value })
                      }
                      data-testid="treasury-expectation-expected-date"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className={financeModuleFilterLabelClass()}>
                      Conta prevista
                    </span>
                    <input
                      type="text"
                      className={financeModuleFilterFieldClass()}
                      value={form.plannedAccountId}
                      onChange={(e) =>
                        setForm({ ...form, plannedAccountId: e.target.value })
                      }
                      data-testid="treasury-expectation-planned-account"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className={financeModuleFilterLabelClass()}>
                      Responsável
                    </span>
                    <input
                      type="text"
                      className={financeModuleFilterFieldClass()}
                      value={form.responsibleUserId}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          responsibleUserId: e.target.value,
                        })
                      }
                      data-testid="treasury-expectation-responsible"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className={financeModuleFilterLabelClass()}>
                      Prioridade
                    </span>
                    <select
                      className={financeModuleFilterFieldClass()}
                      value={form.priority}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          priority: e.target
                            .value as TreasuryTitleOperationalPriority,
                        })
                      }
                      data-testid="treasury-expectation-priority"
                    >
                      {TREASURY_TITLE_OPERATIONAL_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {TREASURY_PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm sm:col-span-2">
                    <span className={financeModuleFilterLabelClass()}>
                      Próxima ação
                    </span>
                    <input
                      type="text"
                      className={financeModuleFilterFieldClass()}
                      value={form.nextAction}
                      onChange={(e) =>
                        setForm({ ...form, nextAction: e.target.value })
                      }
                      data-testid="treasury-expectation-next-action"
                    />
                  </label>
                  <label className="space-y-1 text-sm sm:col-span-2">
                    <span className={financeModuleFilterLabelClass()}>
                      Motivo{dateChanging ? " *" : ""}
                    </span>
                    <textarea
                      className={financeModuleFilterFieldClass()}
                      rows={2}
                      value={form.reason}
                      onChange={(e) =>
                        setForm({ ...form, reason: e.target.value })
                      }
                      data-testid="treasury-expectation-reason"
                    />
                  </label>
                  <label className="space-y-1 text-sm sm:col-span-2">
                    <span className={financeModuleFilterLabelClass()}>
                      Observação
                    </span>
                    <textarea
                      className={financeModuleFilterFieldClass()}
                      rows={2}
                      value={form.notes}
                      onChange={(e) =>
                        setForm({ ...form, notes: e.target.value })
                      }
                      data-testid="treasury-expectation-notes"
                    />
                  </label>
                </div>
                {row.complement ? (
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm pt-1">
                    <Field
                      label="Data confirmada"
                      value={formatTreasuryReceivableDate(
                        row.complement.confirmedDate
                      )}
                    />
                    <Field
                      label="Versão"
                      value={String(form.expectedVersion)}
                    />
                  </dl>
                ) : null}
              </form>
            ) : row.complement ? (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                <Field
                  label="Data esperada"
                  value={formatTreasuryReceivableDate(
                    row.complement.expectedDate
                  )}
                />
                <Field
                  label="Data confirmada"
                  value={formatTreasuryReceivableDate(
                    row.complement.confirmedDate
                  )}
                />
                <Field
                  label="Prioridade"
                  value={
                    TREASURY_PRIORITY_LABELS[row.complement.priority] ??
                    row.complement.priority
                  }
                />
                <Field
                  label="Responsável cobrança"
                  value={row.complement.responsibleUserId}
                />
                <Field
                  label="Conta prevista"
                  value={row.complement.plannedAccountId}
                />
                <Field
                  label="Próxima ação"
                  value={row.nextAction}
                  className="sm:col-span-2"
                />
                <Field
                  label="Motivo"
                  value={row.complement.reason}
                  className="sm:col-span-2"
                />
                <Field
                  label="Observações"
                  value={row.complement.notes}
                  className="sm:col-span-2"
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                {canManage
                  ? "Sem complemento operacional. Use o formulário quando o título estiver elegível (saldo em aberto)."
                  : "Sem complemento operacional local para este título."}
              </p>
            )}
          </OverlaySection>

          <OverlaySection title="Histórico operacional">
            <ul
              className="space-y-2"
              data-testid="treasury-receivable-history"
            >
              {history.map((item, idx) => (
                <li
                  key={`${item.at}-${idx}`}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-muted-foreground">{item.detail}</p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {formatTreasuryReceivableDateTime(item.at)}
                  </p>
                </li>
              ))}
            </ul>
          </OverlaySection>
        </div>
      </OverlayBody>
      {editable ? (
        <OverlayFooter
          hint="Optimistic locking por versão do complemento"
          testId="treasury-receivable-expectation-footer"
        >
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1.5 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            onClick={() => void handleSave()}
            disabled={saving}
            data-testid="treasury-expectation-save"
          >
            {saving ? "Salvando…" : "Salvar expectativa"}
          </button>
        </OverlayFooter>
      ) : null}
    </Overlay>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-foreground">
        {value?.trim() || "—"}
      </dd>
    </div>
  );
}
