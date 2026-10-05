/**
 * Action points de uma pesquisa encerrada: um por ponto de atenção (nota ≤ 2).
 * Tudo que é derivado (atraso, contadores) vem pronto do backend.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import {
  ACTION_POINT_PRIORITY_LABELS,
  ACTION_POINT_STATUS_LABELS,
  formatDate,
  satisfactionApi,
  type SatisfactionActionPoint,
  type SatisfactionActionPointBoard,
  type SatisfactionAttentionPointRow,
} from "./satisfactionApi.js";

const STATUS_BADGE: Record<SatisfactionActionPoint["status"], string> = {
  OPEN: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]",
  IN_PROGRESS: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]",
  DONE: "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]",
  CANCELLED: "border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]",
};

type FormState = {
  responsibleUserId: string;
  priority: SatisfactionActionPoint["priority"];
  status: SatisfactionActionPoint["status"];
  rootCause: string;
  actionPlan: string;
  dueDate: string;
  resultNotes: string;
  customerFeedbackAt: string;
};

function toFormState(actionPoint: SatisfactionActionPoint | null): FormState {
  return {
    responsibleUserId: actionPoint?.responsibleUserId ?? "",
    priority: actionPoint?.priority ?? "MEDIUM",
    status: actionPoint?.status ?? "OPEN",
    rootCause: actionPoint?.rootCause ?? "",
    actionPlan: actionPoint?.actionPlan ?? "",
    dueDate: actionPoint?.dueDate ?? "",
    resultNotes: actionPoint?.resultNotes ?? "",
    customerFeedbackAt: actionPoint?.customerFeedbackAt ?? "",
  };
}

/** "AAAA-MM-DD" → "DD/MM/AAAA" sem passar por fuso. */
function formatDateOnly(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

const FIELD = "w-full rounded-md border border-[#CBD5E1] px-3 py-2 text-[13px] text-[#0F172A]";
const LABEL = "mb-1 block text-[12px] font-semibold text-[#374151]";

function ActionPointDialog(props: {
  row: SatisfactionAttentionPointRow;
  assignees: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { row, assignees, onClose, onSaved } = props;
  const [form, setForm] = useState<FormState>(() => toFormState(row.actionPoint));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Responsável atual que ficou inativo continua aparecendo na lista.
  const options =
    row.actionPoint && !assignees.some((a) => a.id === row.actionPoint!.responsibleUserId)
      ? [
          { id: row.actionPoint.responsibleUserId, name: row.actionPoint.responsibleName },
          ...assignees,
        ]
      : assignees;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await satisfactionApi.saveActionPoint(row.answerId, {
        ...form,
        customerFeedbackAt: form.customerFeedbackAt || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o action point.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="satisfaction-action-point-title"
      data-testid="satisfaction-action-point-dialog"
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-[92vh] w-full max-w-[640px] overflow-y-auto rounded-xl bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#F3F4F6] px-5 py-4">
          <div>
            <h2
              id="satisfaction-action-point-title"
              className="text-[16px] font-bold text-[#0F172A]"
            >
              {row.actionPoint ? "Editar action point" : "Novo action point"}
            </h2>
            <p className="mt-1 text-[13px] text-[#475569]">
              {row.customerName} · {row.criterion} · nota{" "}
              <strong className="text-[#B91C1C]">{row.rating}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-[#6b7280] hover:bg-[#F3F4F6]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {error ? (
            <div
              className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="ap-responsible">
                Responsável *
              </label>
              <select
                id="ap-responsible"
                required
                className={FIELD}
                value={form.responsibleUserId}
                onChange={(e) => set("responsibleUserId", e.target.value)}
              >
                <option value="">Selecione…</option>
                {options.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL} htmlFor="ap-due-date">
                Data limite *
              </label>
              <input
                id="ap-due-date"
                type="date"
                required
                className={FIELD}
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="ap-priority">
                Prioridade
              </label>
              <select
                id="ap-priority"
                className={FIELD}
                value={form.priority}
                onChange={(e) => set("priority", e.target.value as FormState["priority"])}
              >
                {Object.entries(ACTION_POINT_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="ap-root-cause">
              Causa identificada
            </label>
            <textarea
              id="ap-root-cause"
              rows={2}
              maxLength={2000}
              className={FIELD}
              placeholder="Por que o cliente deu esta nota?"
              value={form.rootCause}
              onChange={(e) => set("rootCause", e.target.value)}
            />
          </div>

          <div>
            <label className={LABEL} htmlFor="ap-action-plan">
              Plano de ação *
            </label>
            <textarea
              id="ap-action-plan"
              rows={4}
              required
              maxLength={4000}
              className={FIELD}
              placeholder="O que será feito para resolver e evitar que se repita?"
              value={form.actionPlan}
              onChange={(e) => set("actionPlan", e.target.value)}
            />
          </div>

          <div className="grid gap-4 border-t border-[#F3F4F6] pt-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="ap-status">
                Situação
              </label>
              <select
                id="ap-status"
                className={FIELD}
                value={form.status}
                onChange={(e) => set("status", e.target.value as FormState["status"])}
              >
                {Object.entries(ACTION_POINT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL} htmlFor="ap-feedback">
                Retorno dado ao cliente em
              </label>
              <input
                id="ap-feedback"
                type="date"
                className={FIELD}
                value={form.customerFeedbackAt}
                onChange={(e) => set("customerFeedbackAt", e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor="ap-result">
                Resultado da ação{form.status === "DONE" ? " *" : ""}
              </label>
              <textarea
                id="ap-result"
                rows={3}
                maxLength={4000}
                required={form.status === "DONE"}
                className={FIELD}
                placeholder="O que foi feito e qual foi o resultado."
                value={form.resultNotes}
                onChange={(e) => set("resultNotes", e.target.value)}
              />
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#F3F4F6] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[13px] font-semibold text-[#6b7280] hover:bg-[#F3F4F6]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#1D4ED8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function SatisfactionActionPointsTab(props: { campaignId: string }) {
  const { campaignId } = props;
  const [board, setBoard] = useState<SatisfactionActionPointBoard | null>(null);
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<SatisfactionAttentionPointRow | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setBoard(await satisfactionApi.actionPoints(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os action points.");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    satisfactionApi
      .actionPointAssignees()
      .then((result) => {
        if (!cancelled) setAssignees(result.users);
      })
      .catch(() => {
        /* a lista de pontos continua visível; o erro aparece ao salvar */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && !board) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-[14px] text-[#B91C1C]">
        {error}
      </div>
    );
  }
  if (!board) {
    return <div className="h-32 animate-pulse rounded-lg bg-[#F1F5F9]" />;
  }

  const rows = onlyPending
    ? board.rows.filter(
        (row) =>
          !row.actionPoint ||
          row.actionPoint.status === "OPEN" ||
          row.actionPoint.status === "IN_PROGRESS"
      )
    : board.rows;

  return (
    <div className="space-y-3" data-testid="satisfaction-action-points">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Pontos de atenção", value: board.summary.attentionPoints },
          { label: "Sem action point", value: board.summary.withoutActionPoint },
          { label: "Em aberto", value: board.summary.open + board.summary.inProgress },
          { label: "Atrasados", value: board.summary.overdue },
          { label: "Concluídos", value: board.summary.done },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-[#E2E8F0] bg-white p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#64748B]">
              {kpi.label}
            </p>
            <p className="mt-1 text-[24px] font-bold text-[#0F172A]">{kpi.value}</p>
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 text-[13px] text-[#334155]">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
        />
        Mostrar apenas pendentes (sem action point, aberto ou em andamento)
      </label>

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead className="bg-[#F8FAFC] text-[12px] uppercase tracking-wide text-[#64748B]">
              <tr>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Critério</th>
                <th className="px-4 py-3 text-right font-semibold">Nota</th>
                <th className="px-4 py-3 font-semibold">Responsável</th>
                <th className="px-4 py-3 font-semibold">Plano de ação</th>
                <th className="px-4 py-3 font-semibold">Data limite</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3 font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[14px] text-[#64748B]">
                    {board.rows.length === 0
                      ? "Esta pesquisa não teve nenhuma nota crítica (≤ 2)."
                      : "Nenhum ponto de atenção pendente."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.answerId} className="align-top hover:bg-[#F8FAFC]">
                    <td className="px-4 py-3 font-medium text-[#0F172A]">
                      <Link
                        className="hover:underline"
                        to={`/commercial/satisfaction/responses/${row.responseId}`}
                      >
                        {row.customerName}
                      </Link>
                      <p className="text-[12px] font-normal text-[#64748B]">
                        {formatDate(row.submittedAt)}
                        {row.responsibleCommercialName
                          ? ` · ${row.responsibleCommercialName}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[#334155]">{row.criterion}</td>
                    <td className="px-4 py-3 text-right font-bold text-[#B91C1C]">{row.rating}</td>
                    <td className="px-4 py-3 text-[#334155]">
                      {row.actionPoint?.responsibleName ?? "—"}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-[#475569]">
                      {row.actionPoint ? (
                        <span className="line-clamp-2" title={row.actionPoint.actionPlan}>
                          {row.actionPoint.actionPlan}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#334155]">
                      {formatDateOnly(row.actionPoint?.dueDate ?? null)}
                      {row.actionPoint?.overdue ? (
                        <span className="ml-2 rounded bg-[#FEF2F2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">
                          atrasado
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {row.actionPoint ? (
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[12px] font-semibold ${STATUS_BADGE[row.actionPoint.status]}`}
                        >
                          {ACTION_POINT_STATUS_LABELS[row.actionPoint.status]}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold text-[#92400E]">
                          Sem action point
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-[#1D4ED8] hover:underline"
                        onClick={() => setEditing(row)}
                      >
                        {row.actionPoint ? "Editar" : "Criar action point"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <ActionPointDialog
          row={editing}
          assignees={assignees}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
