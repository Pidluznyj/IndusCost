import React, { useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileWarning,
  Info,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canReprocessCommissions } from "@/src/lib/commissionsModulePermissions";
import { ACTION_GATE_RESOURCES } from "@/src/lib/actionPermissionAccess";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CommissionsAuditItem } from "@/src/components/commissions/commissionsTypes";
import { CommissionsAuditDetailDrawer } from "@/src/components/commissions/audit/CommissionsAuditDetailDrawer";
import { CommissionsAuditFiltersPanel } from "@/src/components/commissions/audit/CommissionsAuditFiltersPanel";
import {
  EMPTY_COMMISSIONS_AUDIT_FILTERS,
  resolveCommissionsAuditRerunPeriod,
  type CommissionsAuditFilters,
} from "@/src/components/commissions/audit/commissionsAuditFilters";
import {
  auditRowClassName,
  auditSeverityClassName,
  auditTypeClassName,
  formatAuditSeverity,
  formatAuditStatus,
  formatAuditType,
} from "@/src/components/commissions/audit/commissionsAuditLabels";
import {
  reopenAuditIssueApi,
  rerunAuditApi,
  resolveAuditIssueApi,
  useCommissionsAuditData,
} from "@/src/components/commissions/audit/useCommissionsAuditData";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}

export function CommissionsAuditPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canReprocess =
    canReprocessCommissions(auth) ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.commissionsReprocess, "reprocess");

  const [draftFilters, setDraftFilters] = useState<CommissionsAuditFilters>(
    EMPTY_COMMISSIONS_AUDIT_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsAuditFilters>(
    EMPTY_COMMISSIONS_AUDIT_FILTERS
  );
  const [selectedItem, setSelectedItem] = useState<CommissionsAuditItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunResult, setRerunResult] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsAuditData(appliedFilters);

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  async function handleResolve(item: CommissionsAuditItem) {
    setActionLoading(true);
    setActionError(null);
    try {
      const updated = await resolveAuditIssueApi(item.id);
      setSelectedItem(updated);
      await reload();
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível resolver a issue."));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReopen(item: CommissionsAuditItem) {
    setActionLoading(true);
    setActionError(null);
    try {
      const updated = await reopenAuditIssueApi(item.id);
      setSelectedItem(updated);
      await reload();
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível reabrir a issue."));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReprocessItem() {
    if (!canReprocess || !selectedItem) return;
    const period = resolveCommissionsAuditRerunPeriod(appliedFilters);
    const ok = window.confirm(
      `Reprocessar comissões e auditoria de ${period.from} até ${period.to}?\n\nIsso recalcula o período e pode gerar novas issues.`
    );
    if (!ok) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await rerunAuditApi(period);
      setRerunResult(
        `Auditoria reexecutada. ${result.summary.issuesCreated} issue(s) criada(s), ${result.summary.errorsCount} erro(s).`
      );
      await reload();
      if (selectedItem) {
        const refreshed = data?.items.find((i) => i.id === selectedItem.id);
        if (refreshed) setSelectedItem(refreshed);
      }
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível reprocessar o registro."));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRerunAudit() {
    if (!canReprocess) return;
    const period = resolveCommissionsAuditRerunPeriod(appliedFilters);
    const ok = window.confirm(
      `Reexecutar auditoria do período ${period.from} até ${period.to}?\n\nO cálculo completo será refeito e novas inconsistências serão registradas.`
    );
    if (!ok) return;

    setRerunLoading(true);
    setRerunError(null);
    setRerunResult(null);
    try {
      const result = await rerunAuditApi(period);
      setRerunResult(
        `Auditoria concluída: ${result.summary.ordersEvaluated} pedido(s) avaliado(s), ${result.summary.issuesCreated} issue(s) criada(s), ${result.summary.errorsCount} erro(s).`
      );
      await reload();
    } catch (e: unknown) {
      setRerunError(formatCommissionsApiError(e, "Não foi possível reexecutar a auditoria."));
    } finally {
      setRerunLoading(false);
    }
  }

  const cards = data?.cards;
  const rows = data?.rows ?? data?.items ?? [];
  const pagination = data?.pagination;
  const criticalOpen = cards?.criticalOpenCount ?? 0;

  return (
    <div className="space-y-5" data-testid="commissions-audit-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Auditoria
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Inconsistências do comissionamento
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Toda divergência relevante fica visível para gestão. Issues críticas abertas não devem
            ser ignoradas — resolva a causa ou marque como tratada após análise.
          </p>
        </div>
        {canReprocess ? (
          <button
            type="button"
            disabled={rerunLoading || loading}
            onClick={() => void handleRerunAudit()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            data-testid="commissions-audit-rerun-btn"
          >
            <RefreshCw className={`h-4 w-4 ${rerunLoading ? "animate-spin" : ""}`} />
            Reexecutar auditoria do período
          </button>
        ) : null}
      </div>

      {criticalOpen > 0 ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-red-900"
          data-testid="commissions-audit-critical-banner"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="font-bold">
              {criticalOpen} issue{criticalOpen === 1 ? "" : "s"} crítica
              {criticalOpen === 1 ? "" : "s"} aberta{criticalOpen === 1 ? "" : "s"}
            </p>
            <p className="text-sm text-red-800/90">
              Problemas críticos exigem ação imediata antes de liberar ou pagar comissões.
            </p>
          </div>
        </div>
      ) : null}

      {rerunError ? (
        <CommissionsErrorBanner message={rerunError} onRetry={() => void handleRerunAudit()} />
      ) : null}
      {rerunResult ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {rerunResult}
        </div>
      ) : null}
      {actionError ? (
        <CommissionsErrorBanner message={actionError} onRetry={() => setActionError(null)} />
      ) : null}
      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}

      <CommissionsAuditFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {cards ? (
        <CommissionsKpiSection
          title="Resumo de auditoria"
          eyebrow="Apontamentos e pendências do filtro"
          testId="commissions-audit-kpi"
        >
          <FinanceKpiCard
            label="Críticas abertas"
            value={String(cards.criticalOpenCount)}
            icon={AlertOctagon}
            tone={cards.criticalOpenCount > 0 ? "danger" : "neutral"}
          />
          <FinanceKpiCard
            label="Warnings abertos"
            value={String(cards.warningOpenCount)}
            icon={AlertTriangle}
            tone={cards.warningOpenCount > 0 ? "warning" : "neutral"}
          />
          <FinanceKpiCard
            label="Informativas abertas"
            value={String(cards.infoOpenCount)}
            icon={Info}
            tone="neutral"
          />
          <FinanceKpiCard
            label="Resolvidas no período"
            value={String(cards.resolvedInPeriodCount)}
            icon={ClipboardCheck}
            tone="success"
          />
          <FinanceKpiCard
            label="Pedidos sem regra"
            value={String(cards.ordersWithoutRuleCount)}
            icon={FileWarning}
            tone={cards.ordersWithoutRuleCount > 0 ? "warning" : "neutral"}
          />
          <FinanceKpiCard
            label="NF-es sem Doc. Saída"
            value={String(cards.nfesWithoutOutputDocumentCount)}
            icon={FileWarning}
            tone={cards.nfesWithoutOutputDocumentCount > 0 ? "warning" : "neutral"}
          />
          <FinanceKpiCard
            label="NF-es sem CR"
            value={String(cards.nfesWithoutReceivableCount)}
            icon={FileWarning}
            tone={cards.nfesWithoutReceivableCount > 0 ? "warning" : "neutral"}
          />
        </CommissionsKpiSection>
      ) : null}

      {loading ? <CommissionsLoading /> : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma issue encontrada"
            description="Ajuste os filtros ou reexecute a auditoria do período para detectar inconsistências."
          />
        ) : (
          <>
            <CommissionsTableScroll>
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Severidade</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium">Mensagem</th>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">NF-e</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Comissionado</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-left font-medium">Criado em</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => (
                  <tr key={row.id} className={auditRowClassName(row)}>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${auditSeverityClassName(row.severity)}`}
                      >
                        {formatAuditSeverity(row.severity)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${auditTypeClassName(row.type)}`}
                      >
                        {formatAuditType(row.type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate" title={row.message}>
                      {row.message}
                    </td>
                    <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[10rem] truncate" title={row.customerName ?? ""}>
                      {row.customerName ?? "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[10rem] truncate" title={row.commissionPersonName ?? ""}>
                      {row.commissionPersonName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {row.involvedAmount != null
                        ? formatFinanceCurrency(row.involvedAmount)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.resolved
                            ? "text-emerald-700 font-medium"
                            : "text-red-700 font-semibold"
                        }
                      >
                        {formatAuditStatus(row.resolved)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedItem(row)}
                        className="text-sm font-semibold text-[#2563EB] hover:underline"
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>

            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 text-sm text-[#6B7280]">
                <span>
                  Página {pagination.page} de {pagination.totalPages} · {pagination.total}{" "}
                  registro(s)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5E7EB] px-2 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => changePage(pagination.page + 1)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5E7EB] px-2 disabled:opacity-40"
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}

      <CommissionsAuditDetailDrawer
        open={selectedItem != null}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
        onResolve={() => selectedItem && void handleResolve(selectedItem)}
        onReopen={() => selectedItem && void handleReopen(selectedItem)}
        onReprocess={() => void handleReprocessItem()}
        actionLoading={actionLoading}
        canReprocess={canReprocess}
      />
    </div>
  );
}
