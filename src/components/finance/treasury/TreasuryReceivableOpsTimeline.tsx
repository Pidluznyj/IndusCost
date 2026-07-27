import React, { useEffect, useMemo, useState } from "react";
import {
  TREASURY_COLLECTION_ACTION_TYPES,
  type TreasuryCollectionActionDto,
  type TreasuryCollectionActionType,
  type TreasuryDisputeDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  createTreasuryCollectionAction,
  createTreasuryDispute,
  fetchTreasuryCollectionActions,
  fetchTreasuryDisputes,
  updateTreasuryDisputeStatus,
} from "@/src/lib/treasury/treasuryReceivablesApi.js";
import {
  TREASURY_COLLECTION_ACTION_TYPE_LABELS,
  TREASURY_DISPUTE_STATUS_LABELS,
  formatTreasuryReceivableDate,
  formatTreasuryReceivableDateTime,
  formatTreasuryReceivableMoney,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

type Props = {
  titleId: string;
  canCollect: boolean;
  canManage: boolean;
  onChanged?: () => void;
};

type TimelineItem = {
  at: string;
  kind: "action" | "dispute";
  title: string;
  detail: string;
  tone?: string;
};

function nowIsoOffset(): string {
  return new Date().toISOString().replace(/Z$/, "+00:00");
}

export function TreasuryReceivableOpsTimeline({
  titleId,
  canCollect,
  canManage,
  onChanged,
}: Props) {
  const [actions, setActions] = useState<TreasuryCollectionActionDto[]>([]);
  const [disputes, setDisputes] = useState<TreasuryDisputeDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [actionType, setActionType] =
    useState<TreasuryCollectionActionType>("PHONE");
  const [contactPerson, setContactPerson] = useState("");
  const [result, setResult] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [responsible, setResponsible] = useState("");

  const [disputeReason, setDisputeReason] = useState("");
  const [disputeAmount, setDisputeAmount] = useState("");
  const [disputeArea, setDisputeArea] = useState("");
  const [disputeDue, setDisputeDue] = useState("");
  const [disputeNotes, setDisputeNotes] = useState("");
  const [disputeResponsible, setDisputeResponsible] = useState("");

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [a, d] = await Promise.all([
        fetchTreasuryCollectionActions(titleId),
        fetchTreasuryDisputes(titleId),
      ]);
      setActions(a);
      setDisputes(d);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao carregar timeline."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [titleId]);

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const a of actions) {
      items.push({
        at: a.performedAt,
        kind: "action",
        title: `${TREASURY_COLLECTION_ACTION_TYPE_LABELS[a.actionType] ?? a.actionType}${a.cancelledAt ? " (cancelada)" : ""}`,
        detail: [
          a.contactPerson ? `Contato: ${a.contactPerson}` : null,
          a.result ? `Resultado: ${a.result}` : null,
          a.nextAction ? `Próxima: ${a.nextAction}` : null,
          a.notes,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    for (const d of disputes) {
      items.push({
        at: d.openedAt,
        kind: "dispute",
        title: `Contestação · ${TREASURY_DISPUTE_STATUS_LABELS[d.status] ?? d.status}`,
        detail: [
          d.reason,
          d.amountDisputed
            ? `Valor: ${formatTreasuryReceivableMoney(d.amountDisputed)}`
            : null,
          d.involvedArea ? `Área: ${d.involvedArea}` : null,
          d.dueDate
            ? `Prazo: ${formatTreasuryReceivableDate(d.dueDate)}`
            : null,
          d.notes,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
    return items.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  }, [actions, disputes]);

  async function submitAction() {
    if (!canCollect) return;
    setSaving(true);
    setError(null);
    try {
      await createTreasuryCollectionAction(titleId, {
        actionType,
        performedAt: nowIsoOffset(),
        contactPerson: contactPerson.trim() || null,
        result: result.trim() || null,
        notes: actionNotes.trim() || null,
        nextAction: nextAction.trim() || null,
        responsibleUserId: responsible.trim() || null,
      });
      setContactPerson("");
      setResult("");
      setActionNotes("");
      setNextAction("");
      setResponsible("");
      await reload();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao registrar ação."
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitDispute() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      await createTreasuryDispute(titleId, {
        reason: disputeReason.trim(),
        amountDisputed: disputeAmount.trim() || null,
        responsibleUserId: disputeResponsible.trim() || null,
        involvedArea: disputeArea.trim() || null,
        dueDate: disputeDue.trim() || null,
        notes: disputeNotes.trim() || null,
      });
      setDisputeReason("");
      setDisputeAmount("");
      setDisputeArea("");
      setDisputeDue("");
      setDisputeNotes("");
      setDisputeResponsible("");
      await reload();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao abrir contestação."
      );
    } finally {
      setSaving(false);
    }
  }

  async function resolveDispute(d: TreasuryDisputeDto, status: "RESOLVED" | "CANCELLED") {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      await updateTreasuryDisputeStatus(d.id, {
        status,
        resolutionNote: null,
        notes: null,
        expectedVersion: d.version,
      });
      await reload();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao atualizar contestação."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="treasury-receivable-ops-timeline">
      <p className="text-xs text-muted-foreground">
        Timeline operacional append-only. Cancelamentos são lógicos — o histórico
        anterior permanece.
      </p>
      {error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando timeline…</p>
      ) : timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma ação ou contestação registrada.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="treasury-ops-timeline-list">
          {timeline.map((item, idx) => (
            <li
              key={`${item.kind}-${item.at}-${idx}`}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            >
              <p className="font-semibold">{item.title}</p>
              <p className="text-muted-foreground">{item.detail || "—"}</p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatTreasuryReceivableDateTime(item.at)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {disputes.some((d) => d.status === "OPEN") && canManage ? (
        <div className="space-y-2">
          {disputes
            .filter((d) => d.status === "OPEN")
            .map((d) => (
              <div key={d.id} className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs"
                  disabled={saving}
                  onClick={() => void resolveDispute(d, "RESOLVED")}
                >
                  Resolver contestação
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-xs"
                  disabled={saving}
                  onClick={() => void resolveDispute(d, "CANCELLED")}
                >
                  Cancelar contestação
                </button>
              </div>
            ))}
        </div>
      ) : null}

      {canCollect ? (
        <form
          className="space-y-3 rounded-lg border border-border p-3"
          data-testid="treasury-collection-action-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAction();
          }}
        >
          <p className="text-sm font-semibold">Nova ação de cobrança</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>Tipo</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={actionType}
                onChange={(e) =>
                  setActionType(e.target.value as TreasuryCollectionActionType)
                }
              >
                {TREASURY_COLLECTION_ACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TREASURY_COLLECTION_ACTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Pessoa de contato
              </span>
              <input
                className={financeModuleFilterFieldClass()}
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>Resultado</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={result}
                onChange={(e) => setResult(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Próxima ação
              </span>
              <input
                className={financeModuleFilterFieldClass()}
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Responsável
              </span>
              <input
                className={financeModuleFilterFieldClass()}
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>
                Observação
              </span>
              <textarea
                className={financeModuleFilterFieldClass()}
                rows={2}
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            Registrar ação
          </button>
        </form>
      ) : null}

      {canManage ? (
        <form
          className="space-y-3 rounded-lg border border-border p-3"
          data-testid="treasury-dispute-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitDispute();
          }}
        >
          <p className="text-sm font-semibold">Nova contestação</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>Motivo *</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Valor contestado
              </span>
              <input
                className={financeModuleFilterFieldClass()}
                value={disputeAmount}
                onChange={(e) => setDisputeAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Responsável interno
              </span>
              <input
                className={financeModuleFilterFieldClass()}
                value={disputeResponsible}
                onChange={(e) => setDisputeResponsible(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>
                Área envolvida
              </span>
              <input
                className={financeModuleFilterFieldClass()}
                value={disputeArea}
                onChange={(e) => setDisputeArea(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className={financeModuleFilterLabelClass()}>Prazo</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={disputeDue}
                onChange={(e) => setDisputeDue(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className={financeModuleFilterLabelClass()}>
                Observação
              </span>
              <textarea
                className={financeModuleFilterFieldClass()}
                rows={2}
                value={disputeNotes}
                onChange={(e) => setDisputeNotes(e.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            Abrir contestação
          </button>
        </form>
      ) : null}
    </div>
  );
}
