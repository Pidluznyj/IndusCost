import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { OverlaySection } from "@/src/components/ui/overlay";
import {
  fetchSalesOrderFlowResponsibleUsers,
  patchSalesOrderFlowManagement,
  type SalesOrderFlowManagementApi,
} from "@/src/lib/salesOrderFlowClient";
import {
  buildSalesOrderFlowManagementPatchBody,
  classifySalesOrderFlowManagementError,
  filterSalesOrderFlowManagementAreaOptions,
  formatSalesOrderFlowInconsistencyLabel,
  formatSalesOrderFlowPriorityLabel,
  salesOrderFlowManagementToFormState,
  type SalesOrderFlowManagementFormState,
  type SalesOrderFlowManagementUiCapabilities,
} from "@/src/lib/salesOrderFlowDetailUi";
import { SALES_ORDER_FLOW_PRIORITY_OPTIONS } from "@/src/lib/salesOrderFlowUi";
import type { SalesOrderFlowDetailPayload } from "@/src/lib/sales/salesOrderFlowDetail";
import { cn } from "@/src/lib/utils";

type Props = {
  detail: SalesOrderFlowDetailPayload;
  capabilities: SalesOrderFlowManagementUiCapabilities;
  onManagementSaved: (management: SalesOrderFlowManagementApi) => void;
  onConflictReload: () => Promise<void>;
};

/**
 * Painel de ações manuais do Fluxo de Pedidos (OP-72).
 * Não altera a coluna automática; grava só o overlay de gestão.
 */
export function SalesOrderFlowManagementPanel({
  detail,
  capabilities,
  onManagementSaved,
  onConflictReload,
}: Props) {
  const baseline = useMemo(
    () => salesOrderFlowManagementToFormState(detail.management),
    [detail.management]
  );
  const [draft, setDraft] =
    useState<SalesOrderFlowManagementFormState>(baseline);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [personOptions, setPersonOptions] = useState<
    Array<{ id: string; name: string; email: string | null }>
  >([]);
  const [personLoading, setPersonLoading] = useState(false);
  const [areaQuery, setAreaQuery] = useState("");
  const submitLock = useRef(false);

  useEffect(() => {
    setDraft(baseline);
    setFeedback(null);
    setPersonQuery(baseline.responsibleName);
    setAreaQuery(baseline.responsibleArea);
  }, [baseline]);

  useEffect(() => {
    if (!capabilities.canAssignResponsible) return;
    const q = personQuery.trim();
    if (q.length < 2) {
      setPersonOptions([]);
      return;
    }
    const controller = new AbortController();
    setPersonLoading(true);
    const timer = window.setTimeout(() => {
      void fetchSalesOrderFlowResponsibleUsers(q, controller.signal)
        .then((rows) => {
          if (!controller.signal.aborted) setPersonOptions(rows);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPersonOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPersonLoading(false);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [personQuery, capabilities.canAssignResponsible]);

  const areaOptions = useMemo(
    () => filterSalesOrderFlowManagementAreaOptions(areaQuery),
    [areaQuery]
  );

  const canEditAnything =
    capabilities.canUpdateManually &&
    (capabilities.canChangePriority ||
      capabilities.canAssignResponsible ||
      capabilities.canManageBlocking ||
      capabilities.canUpdateManually);

  const disabled = saving || !canEditAnything;

  const updateDraft = (patch: Partial<SalesOrderFlowManagementFormState>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const save = async () => {
    if (submitLock.current || saving || !capabilities.canUpdateManually) return;

    const becomingBlocked = draft.isBlocked && !baseline.isBlocked;
    const becomingUnblocked = !draft.isBlocked && baseline.isBlocked;
    if (becomingBlocked) {
      const ok = window.confirm(
        "Confirmar bloqueio operacional deste pedido? A coluna automática do Kanban não muda."
      );
      if (!ok) return;
    }
    if (becomingUnblocked) {
      const ok = window.confirm(
        "Remover o bloqueio operacional deste pedido? A coluna automática do Kanban não muda."
      );
      if (!ok) return;
    }

    const { body, validationError } = buildSalesOrderFlowManagementPatchBody({
      expectedUpdatedAt: detail.management?.updatedAt ?? null,
      baseline,
      draft,
      capabilities,
    });
    if (validationError) {
      setFeedback({ kind: "error", message: validationError });
      return;
    }

    submitLock.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await patchSalesOrderFlowManagement(
        detail.salesOrderId,
        body
      );
      onManagementSaved(result.management);
      setFeedback({
        kind: "success",
        message:
          result.changedFields.length > 0
            ? "Gestão atualizada. A coluna automática do fluxo não foi alterada."
            : "Nenhuma mudança persistida.",
      });
    } catch (error) {
      const classified = classifySalesOrderFlowManagementError(error);
      if (classified.kind === "conflict") {
        await onConflictReload();
      }
      setFeedback({ kind: "error", message: classified.message });
    } finally {
      setSaving(false);
      submitLock.current = false;
    }
  };

  return (
    <OverlaySection
      title="Gestão operacional"
      description="Ações manuais do overlay. Não alteram a coluna automática do Kanban; o histórico fica na timeline."
    >
      <div
        className="space-y-3"
        data-testid="sales-order-flow-management-panel"
      >
        {!capabilities.canUpdateManually ? (
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ReadOnly
              label="Prioridade"
              value={formatSalesOrderFlowPriorityLabel(
                detail.management?.priority
              )}
            />
            <ReadOnly
              label="Responsável"
              value={detail.management?.responsibleName?.trim() || "—"}
            />
            <ReadOnly
              label="Área"
              value={detail.management?.responsibleArea?.trim() || "—"}
            />
            <ReadOnly
              label="Bloqueio"
              value={
                detail.management?.isBlocked
                  ? detail.management.blockReason?.trim() || "Bloqueado"
                  : "Não bloqueado"
              }
            />
            <ReadOnly
              label="Previsão de resolução"
              value={
                detail.management?.expectedResolutionAt
                  ? detail.management.expectedResolutionAt.slice(0, 10)
                  : "—"
              }
            />
            <ReadOnly
              label="Nota interna"
              value={detail.management?.internalNote?.trim() || "—"}
            />
          </dl>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Prioridade
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                value={draft.priority}
                disabled={disabled || !capabilities.canChangePriority}
                data-testid="sales-order-flow-management-priority"
                onChange={(event) =>
                  updateDraft({ priority: event.target.value })
                }
              >
                {SALES_ORDER_FLOW_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Área responsável
              <input
                list="sales-order-flow-management-areas"
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                value={areaQuery}
                disabled={disabled || !capabilities.canAssignResponsible}
                data-testid="sales-order-flow-management-area"
                placeholder="Buscar área…"
                onChange={(event) => {
                  const value = event.target.value;
                  setAreaQuery(value);
                  updateDraft({ responsibleArea: value });
                }}
              />
              <datalist id="sales-order-flow-management-areas">
                {areaOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </label>

            <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
              Responsável
              <div className="relative">
                <input
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                  value={personQuery}
                  disabled={disabled || !capabilities.canAssignResponsible}
                  data-testid="sales-order-flow-management-responsible"
                  placeholder="Buscar pessoa…"
                  onChange={(event) => {
                    setPersonQuery(event.target.value);
                    if (!event.target.value.trim()) {
                      updateDraft({
                        responsibleUserId: "",
                        responsibleName: "",
                      });
                    }
                  }}
                />
                {personLoading ? (
                  <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin" />
                ) : null}
              </div>
              {personOptions.length > 0 ? (
                <ul
                  className="max-h-36 overflow-auto rounded-md border border-border bg-background"
                  data-testid="sales-order-flow-management-responsible-options"
                >
                  {personOptions.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="flex w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
                        disabled={disabled}
                        onClick={() => {
                          updateDraft({
                            responsibleUserId: row.id,
                            responsibleName: row.name,
                          });
                          setPersonQuery(row.name);
                          setPersonOptions([]);
                        }}
                      >
                        {row.name}
                        {row.email ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {row.email}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {draft.responsibleUserId ? (
                <button
                  type="button"
                  className="self-start text-xs text-primary underline-offset-2 hover:underline disabled:opacity-60"
                  disabled={disabled || !capabilities.canAssignResponsible}
                  onClick={() => {
                    updateDraft({
                      responsibleUserId: "",
                      responsibleName: "",
                    });
                    setPersonQuery("");
                  }}
                >
                  Limpar responsável
                </button>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.isBlocked}
                disabled={disabled || !capabilities.canManageBlocking}
                data-testid="sales-order-flow-management-blocked"
                onChange={(event) =>
                  updateDraft({
                    isBlocked: event.target.checked,
                    blockReason: event.target.checked
                      ? draft.blockReason
                      : "",
                    expectedResolutionAt: event.target.checked
                      ? draft.expectedResolutionAt
                      : "",
                  })
                }
              />
              Bloquear pedido (não altera a coluna automática)
            </label>

            {draft.isBlocked ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
                  Motivo do bloqueio
                  <input
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                    value={draft.blockReason}
                    disabled={disabled || !capabilities.canManageBlocking}
                    data-testid="sales-order-flow-management-block-reason"
                    onChange={(event) =>
                      updateDraft({ blockReason: event.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Previsão de resolução
                  <input
                    type="date"
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                    value={draft.expectedResolutionAt}
                    disabled={disabled || !capabilities.canManageBlocking}
                    data-testid="sales-order-flow-management-resolution"
                    onChange={(event) =>
                      updateDraft({
                        expectedResolutionAt: event.target.value,
                      })
                    }
                  />
                </label>
              </>
            ) : null}

            <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
              Nota interna
              <textarea
                className="min-h-[72px] rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                value={draft.internalNote}
                disabled={disabled}
                data-testid="sales-order-flow-management-note"
                onChange={(event) =>
                  updateDraft({ internalNote: event.target.value })
                }
              />
            </label>
          </div>
        )}

        {detail.inconsistenciesVisible && detail.inconsistencies.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-amber-950">
            {detail.inconsistencies.map((item) => (
              <li
                key={`${item.code}-${item.detail ?? ""}`}
                className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2"
              >
                <strong>
                  {formatSalesOrderFlowInconsistencyLabel(item.code)}
                </strong>
                {item.detail ? ` — ${item.detail}` : null}
              </li>
            ))}
          </ul>
        ) : null}

        {feedback ? (
          <p
            role="alert"
            data-testid={
              feedback.kind === "success"
                ? "sales-order-flow-management-success"
                : "sales-order-flow-management-error"
            }
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              feedback.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            )}
          >
            {feedback.message}
          </p>
        ) : null}

        {capabilities.canUpdateManually ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
            data-testid="sales-order-flow-management-save"
            disabled={disabled}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {saving ? "Salvando…" : "Salvar gestão"}
          </button>
        ) : null}
      </div>
    </OverlaySection>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  );
}
