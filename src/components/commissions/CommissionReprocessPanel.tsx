import React, { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canReprocessCommissions } from "@/src/lib/commissionsModulePermissions";
import { ACTION_GATE_RESOURCES } from "@/src/lib/actionPermissionAccess";
import { fetchJsonOk } from "@/src/lib/http";
import {
  financeBiButtonOutlineClass,
  financeBiButtonPrimaryClass,
} from "@/src/lib/financeBiDashboardTheme";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { COMMISSIONS_FILTER_FIELD_CLASS, COMMISSIONS_FILTER_LABEL_CLASS } from "@/src/lib/commissionsPeriodFilter";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import {
  buildCommissionReprocessCsv,
  defaultCommissionReprocessFilters,
  type CommissionReprocessApplyResult,
  type CommissionReprocessDiffRow,
  type CommissionReprocessFilters,
  type CommissionReprocessLifecycle,
  type CommissionReprocessPreviewResult,
} from "@/src/lib/commissions/commissionReprocess";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;
const labelClass = COMMISSIONS_FILTER_LABEL_CLASS;

const LIFECYCLE_OPTIONS: Array<{ value: CommissionReprocessLifecycle; label: string }> = [
  { value: "forecast", label: "Previstas" },
  { value: "confirmed", label: "Confirmadas (com NF)" },
  { value: "released", label: "Liberadas (recebível baixado)" },
  { value: "paid", label: "Pagas / fechadas" },
];

const LIFECYCLE_BADGE_CLASS: Record<CommissionReprocessLifecycle, string> = {
  forecast: "bg-slate-100 text-slate-700",
  confirmed: "bg-blue-100 text-blue-700",
  released: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
};

function lifecycleLabel(lifecycle: CommissionReprocessLifecycle): string {
  return LIFECYCLE_OPTIONS.find((o) => o.value === lifecycle)?.label ?? lifecycle;
}

function toOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function CommissionReprocessPanel() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canApply =
    canReprocessCommissions(auth) ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.commissionsReprocess, "reprocess");

  const [filters, setFilters] = useState<CommissionReprocessFilters>(() =>
    defaultCommissionReprocessFilters()
  );
  const [customerExternalIdInput, setCustomerExternalIdInput] = useState("");
  const [sellerExternalIdInput, setSellerExternalIdInput] = useState("");

  const [preview, setPreview] = useState<CommissionReprocessPreviewResult | null>(null);
  const [applyResult, setApplyResult] = useState<CommissionReprocessApplyResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  const rows: CommissionReprocessDiffRow[] = useMemo(() => {
    if (!preview) return [];
    const seen = new Set<string>();
    const combined = [...preview.changedRows, ...preview.blockedRows];
    return combined.filter((row) => {
      if (seen.has(row.salesOrderId)) return false;
      seen.add(row.salesOrderId);
      return true;
    });
  }, [preview]);

  function toggleStatus(status: CommissionReprocessLifecycle) {
    setFilters((prev) => {
      const has = prev.statuses.includes(status);
      const statuses = has
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status];
      return { ...prev, statuses };
    });
  }

  function buildRequestFilters(): CommissionReprocessFilters {
    return {
      ...filters,
      customerExternalId: toOptionalNumber(customerExternalIdInput),
      sellerExternalId: toOptionalNumber(sellerExternalIdInput),
    };
  }

  async function runPreview() {
    setLoadingPreview(true);
    setError(null);
    setApplyResult(null);
    try {
      const requestFilters = buildRequestFilters();
      const result = await fetchJsonOk<CommissionReprocessPreviewResult>(
        "/api/commissions/reprocess/preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestFilters),
        }
      );
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setError(formatCommissionsApiError(err, "Não foi possível gerar a prévia de reprocessamento."));
    } finally {
      setLoadingPreview(false);
    }
  }

  function openConfirm() {
    setReason("");
    setConfirmOpen(true);
  }

  async function confirmApply() {
    if (!preview) return;
    if (reason.trim().length < 3) {
      setError("Informe o motivo do reprocessamento (mínimo 3 caracteres).");
      return;
    }
    setLoadingApply(true);
    setError(null);
    try {
      const requestFilters = buildRequestFilters();
      const result = await fetchJsonOk<CommissionReprocessApplyResult>(
        "/api/commissions/reprocess/apply",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...requestFilters,
            reason: reason.trim(),
            runToken: preview.runToken,
          }),
        }
      );
      setApplyResult(result);
      setConfirmOpen(false);
      setPreview(null);
    } catch (err) {
      setError(formatCommissionsApiError(err, "Erro ao aplicar reprocessamento."));
    } finally {
      setLoadingApply(false);
    }
  }

  function exportCsv() {
    if (!preview) return;
    const csv = buildCommissionReprocessCsv(rows);
    downloadCsv(`comissao-reprocess-diff-${preview.runToken.slice(0, 8)}.csv`, csv);
  }

  return (
    <div className="space-y-4" data-testid="commission-reprocess-panel">
      <ExecutiveAlert
        variant="attention"
        title="Reprocessamento controlado de comissões"
        description="Recalcule comissões impactadas por mudanças de tabela de preço, formação de preço ou regra comercial. Comissões pagas/fechadas nunca são alteradas automaticamente."
      />

      {error ? (
        <CommissionsErrorBanner message={error} onDismiss={() => setError(null)} />
      ) : null}

      <div className="rounded-xl border border-border bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass}>De</label>
            <input
              type="date"
              className={inputClass}
              value={filters.from ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value || null }))}
            />
          </div>
          <div>
            <label className={labelClass}>Até</label>
            <input
              type="date"
              className={inputClass}
              value={filters.to ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value || null }))}
            />
          </div>
          <div>
            <label className={labelClass}>Eixo de data</label>
            <select
              className={inputClass}
              value={filters.dateAxis}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  dateAxis: e.target.value as CommissionReprocessFilters["dateAxis"],
                }))
              }
            >
              <option value="issue">Emissão do pedido</option>
              <option value="nfe">Processamento da NF</option>
              <option value="settlement">Baixa do recebível</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Pedido (código)</label>
            <input
              type="text"
              className={inputClass}
              placeholder="PV-0001"
              value={filters.salesOrderCode ?? ""}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, salesOrderCode: e.target.value || null }))
              }
            />
          </div>
          <div>
            <label className={labelClass}>Cliente (ID externo)</label>
            <input
              type="text"
              className={inputClass}
              value={customerExternalIdInput}
              onChange={(e) => setCustomerExternalIdInput(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Vendedor (ID externo Nomus)</label>
            <input
              type="text"
              className={inputClass}
              value={sellerExternalIdInput}
              onChange={(e) => setSellerExternalIdInput(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Produto (SKU)</label>
            <input
              type="text"
              className={inputClass}
              value={filters.productCode ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, productCode: e.target.value || null }))}
            />
          </div>
          <div>
            <label className={labelClass}>Tabela de preço (ID)</label>
            <input
              type="text"
              className={inputClass}
              value={filters.priceTableId ?? ""}
              onChange={(e) => setFilters((prev) => ({ ...prev, priceTableId: e.target.value || null }))}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {LIFECYCLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] px-3 py-1 text-xs text-[#374151]"
              >
                <input
                  type="checkbox"
                  checked={filters.statuses.includes(option.value)}
                  onChange={() => toggleStatus(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#374151]">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.includeConfirmedNotPaid}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, includeConfirmedNotPaid: e.target.checked }))
              }
            />
            Incluir confirmadas não pagas
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.includeReleasedNotPaid}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, includeReleasedNotPaid: e.target.checked }))
              }
            />
            Incluir liberadas não pagas
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={filters.includePaid}
              onChange={(e) => setFilters((prev) => ({ ...prev, includePaid: e.target.checked }))}
            />
            Listar pagas/fechadas (somente leitura)
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className={financeBiButtonPrimaryClass}
            onClick={() => void runPreview()}
            disabled={loadingPreview}
            data-testid="commission-reprocess-preview"
          >
            {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Gerar prévia
          </button>
        </div>
      </div>

      {loadingPreview ? <CommissionsLoading label="Recalculando comissões via motor oficial…" /> : null}

      {applyResult ? (
        <ExecutiveAlert
          variant="success"
          title="Reprocessamento aplicado"
          description={`Run ${applyResult.runId.slice(0, 8)} — ${applyResult.summary.changedCount} comissão(ões) recalculada(s), ${applyResult.summary.blockedCount} bloqueada(s), ${applyResult.summary.errorCount} erro(s).`}
        />
      ) : null}

      {preview ? (
        <>
          <CommissionsKpiSection title="Resumo do reprocessamento" eyebrow="Prévia">
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Pedidos analisados"
              value={String(preview.summary.analyzedCount)}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="A recalcular"
              value={String(preview.summary.changedCount)}
              tone="success"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Bloqueadas"
              value={String(preview.summary.blockedCount)}
              tone="warning"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Erros"
              value={String(preview.summary.errorCount)}
              tone={preview.summary.errorCount > 0 ? "danger" : undefined}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão atual"
              value={formatFinanceCurrency(preview.summary.currentTotal)}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão recalculada"
              value={formatFinanceCurrency(preview.summary.recalculatedTotal)}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Diferença total"
              value={formatFinanceCurrency(preview.summary.differenceTotal)}
              tone={preview.summary.differenceTotal >= 0 ? "success" : "danger"}
            />
          </CommissionsKpiSection>

          {preview.summary.blockedCount > 0 ? (
            <ExecutiveAlert
              variant="attention"
              icon={<ShieldAlert className="h-4 w-4" />}
              title="Existem linhas bloqueadas"
              description="Comissões já pagas ou fechadas no ledger oficial nunca são alteradas automaticamente. Revise a coluna de bloqueio antes de aplicar."
            />
          ) : null}

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Diferenças encontradas</h3>
            <div className="flex gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={exportCsv}
                disabled={rows.length === 0}
              >
                Exportar CSV
              </button>
              {canApply ? (
                <button
                  type="button"
                  className={financeBiButtonPrimaryClass}
                  onClick={openConfirm}
                  disabled={preview.summary.changedCount === 0 || loadingApply}
                  data-testid="commission-reprocess-apply"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Aplicar reprocessamento
                </button>
              ) : null}
            </div>
          </div>

          {rows.length === 0 ? (
            <CommissionsEmptyState
              title="Nenhuma diferença encontrada"
              description="Com os filtros atuais, o motor oficial não encontrou comissões a recalcular ou bloquear."
            />
          ) : (
            <CommissionsTableScroll testId="commission-reprocess-diff-table">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Vendedor</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Atual</th>
                  <th className="px-3 py-2 text-right font-medium">Recalculada</th>
                  <th className="px-3 py-2 text-right font-medium">Diferença</th>
                  <th className="px-3 py-2 text-left font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.salesOrderId} className="border-t border-border">
                    <td className="px-3 py-2">{row.orderCode ?? row.salesOrderId}</td>
                    <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-3 py-2">{row.sellerName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${LIFECYCLE_BADGE_CLASS[row.lifecycle]}`}
                      >
                        {lifecycleLabel(row.lifecycle)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.currentAmount)}</td>
                    <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.recalculatedAmount)}</td>
                    <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.difference)}</td>
                    <td className="px-3 py-2">
                      {row.blocked ? (
                        <span className="text-xs text-amber-700">{row.blockMessage ?? "Bloqueada"}</span>
                      ) : row.action === "recalculate" ? (
                        <span className="text-xs font-medium text-emerald-700">Será recalculada</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem alteração</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>
          )}
        </>
      ) : !loadingPreview ? (
        <CommissionsEmptyState
          title="Gere uma prévia para começar"
          description="Configure os filtros acima e clique em 'Gerar prévia' para ver o impacto do reprocessamento antes de aplicar."
        />
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold">Confirmar reprocessamento</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Você está prestes a reprocessar{" "}
              <strong>{preview?.summary.changedCount ?? 0}</strong> comissão(ões) usando o motor
              oficial. Comissões pagas/fechadas não serão alteradas.
            </p>
            <label className={`${labelClass} mt-4 block`}>Motivo (mínimo 3 caracteres)</label>
            <textarea
              className={`${inputClass} h-20 resize-none`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: Correção de tabela de preço vigente a partir de 01/07."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={() => setConfirmOpen(false)}
                disabled={loadingApply}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={financeBiButtonPrimaryClass}
                onClick={() => void confirmApply()}
                disabled={loadingApply || reason.trim().length < 3}
              >
                {loadingApply ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
