import React, { useCallback, useState } from "react";
import { Download, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import { fetchJsonOk } from "@/src/lib/http";
import { canManageReceiptClosing } from "@/src/lib/commissionsModulePermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import type {
  CommissionsReceiptClosingLine,
  CommissionsReceiptClosingPayload,
  CommissionsReceiptClosingSellerRow,
} from "@/src/components/commissions/commissionsTypes";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

function currentYearMonth(): { year: string; month: string } {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function statusBadgeClass(status: string): string {
  if (status === "COMMISSIONABLE") return "bg-emerald-100 text-emerald-800";
  if (status === "EXCLUDED") return "bg-slate-100 text-slate-700";
  return "bg-amber-100 text-amber-900";
}

function SellerTable({ rows }: { rows: CommissionsReceiptClosingSellerRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum vendedor no período.</p>;
  }
  return (
    <CommissionsTableScroll>
      <table className="min-w-[900px] text-xs">
        <thead>
          <tr className="border-b text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">Vendedor canônico</th>
            <th className="px-2 py-2 text-right">Recebido</th>
            <th className="px-2 py-2 text-right">Base</th>
            <th className="px-2 py-2 text-right">Comissão</th>
            <th className="px-2 py-2 text-right">Exceções</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.sellerId ?? row.sellerName ?? idx} className="border-b">
              <td className="px-2 py-2 font-medium">{row.sellerName ?? "—"}</td>
              <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
              <td className="px-2 py-2 text-right">
                {formatFinanceCurrency(row.commissionableBase)}
              </td>
              <td className="px-2 py-2 text-right font-semibold">
                {formatFinanceCurrency(row.releasedCommission)}
              </td>
              <td className="px-2 py-2 text-right">{row.exceptionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CommissionsTableScroll>
  );
}

function DetailTable({ rows }: { rows: CommissionsReceiptClosingLine[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma linha no período.</p>;
  }
  return (
    <CommissionsTableScroll>
      <table className="min-w-[1400px] text-xs">
        <thead>
          <tr className="border-b text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">CR</th>
            <th className="px-2 py-2">Parcela</th>
            <th className="px-2 py-2">Baixa</th>
            <th className="px-2 py-2">Cliente</th>
            <th className="px-2 py-2">Pedido/NF</th>
            <th className="px-2 py-2">Vendedor raw</th>
            <th className="px-2 py-2">Vendedor canônico</th>
            <th className="px-2 py-2">Produto</th>
            <th className="px-2 py-2 text-right">Recebido</th>
            <th className="px-2 py-2 text-right">Base</th>
            <th className="px-2 py-2 text-right">%</th>
            <th className="px-2 py-2 text-right">Comissão</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lineKey} className="border-b">
              <td className="px-2 py-2">{row.receivableNumber ?? row.nomusReceivableId ?? "—"}</td>
              <td className="px-2 py-2">{row.installmentNumber ?? "—"}</td>
              <td className="px-2 py-2">{formatDate(row.settlementDate)}</td>
              <td className="px-2 py-2">{row.customerName ?? "—"}</td>
              <td className="px-2 py-2">
                {[row.orderCode, row.nfeNumber].filter(Boolean).join(" / ") || "—"}
              </td>
              <td className="px-2 py-2">{row.rawSellerName ?? "—"}</td>
              <td className="px-2 py-2">{row.canonicalSellerName ?? "—"}</td>
              <td className="px-2 py-2">{row.productName ?? row.productCode ?? "—"}</td>
              <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
              <td className="px-2 py-2 text-right">
                {formatFinanceCurrency(row.commissionableBaseAmount)}
              </td>
              <td className="px-2 py-2 text-right">{row.ratePercent.toFixed(2)}%</td>
              <td className="px-2 py-2 text-right">
                {formatFinanceCurrency(row.releasedCommissionAmount)}
              </td>
              <td className="px-2 py-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(row.status)}`}
                >
                  {row.status}
                </span>
              </td>
              <td className="px-2 py-2 text-muted-foreground">{row.statusReason ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CommissionsTableScroll>
  );
}

export function CommissionsReceiptClosingPage() {
  const auth = useAuth();
  const canManage = canManageReceiptClosing(auth);
  const initial = currentYearMonth();

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [data, setData] = useState<CommissionsReceiptClosingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState("");
  const [applyNotes, setApplyNotes] = useState("");
  const [applying, setApplying] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessConfirm, setReprocessConfirm] = useState("");
  const [reprocessReason, setReprocessReason] = useState("");
  const [reprocessing, setReprocessing] = useState(false);

  const loadClosed = useCallback(async (y: string, m: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsReceiptClosingPayload>(
        `/api/commissions/receipt-closing/${encodeURIComponent(y)}/${encodeURIComponent(m)}`
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar o fechamento."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ year, month });
      const payload = await fetchJsonOk<CommissionsReceiptClosingPayload>(
        `/api/commissions/receipt-closing/preview?${qs}`
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível gerar a prévia."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/commissions/receipt-closing/${encodeURIComponent(year)}/${encodeURIComponent(month)}/export.csv`
      );
      if (!res.ok) throw new Error("Falha ao exportar CSV.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `commission-receipt-closing-${year}-${month.padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar CSV."));
    } finally {
      setExporting(false);
    }
  }

  async function applyClosing() {
    if (!canManage) return;
    setApplying(true);
    setError(null);
    try {
      await fetchJsonOk("/api/commissions/receipt-closing/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
          confirm: applyConfirm,
          notes: applyNotes || null,
        }),
      });
      setApplyOpen(false);
      setApplyConfirm("");
      setApplyNotes("");
      await loadClosed(year, month);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível fechar a comissão."));
    } finally {
      setApplying(false);
    }
  }

  async function reprocessClosing() {
    if (!canManage) return;
    setReprocessing(true);
    setError(null);
    try {
      await fetchJsonOk("/api/commissions/receipt-closing/reprocess-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
          confirm: reprocessConfirm,
          reason: reprocessReason,
        }),
      });
      setReprocessOpen(false);
      setReprocessConfirm("");
      setReprocessReason("");
      await loadClosed(year, month);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível reprocessar o fechamento."));
    } finally {
      setReprocessing(false);
    }
  }

  const summary = data?.summary;
  const countByStatus = summary?.countByStatus ?? {};
  const excludedCount =
    (countByStatus.EXCLUDED ?? 0) +
    (countByStatus.CUSTOMER_EXCLUDED ?? 0);
  const exceptionCount = Object.entries(countByStatus).reduce((acc, [k, v]) => {
    if (k === "COMMISSIONABLE") return acc;
    if (k === "EXCLUDED" || k === "CUSTOMER_EXCLUDED") return acc;
    return acc + v;
  }, 0);
  const unlinkedCount =
    (countByStatus.NO_ORDER_LINK ?? 0) + (countByStatus.NO_NFE_LINK ?? 0);
  const unresolvedSellerCount = countByStatus.SELLER_UNRESOLVED ?? 0;
  const isClosed = data?.mode === "CLOSED";

  return (
    <div className="space-y-5" data-testid="commissions-receipt-closing-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Comissões
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Fechamento por recebimento
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Fechamento oficial mensal com base nos títulos de Contas a Receber baixados no mês (
            <code>settlementDate</code>). Valores vêm exclusivamente da API — sem recálculo no
            frontend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void loadClosed(year, month)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </button>
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => void exportCsv()}
            disabled={exporting || !data || data.lines.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </button>
        </div>
      </div>

      {isClosed && data?.closing ? (
        <ExecutiveAlert
          variant="info"
          density="compact"
          title={`Fechamento FECHADO — ${data.closing.closedAt ? formatDate(data.closing.closedAt) : ""}`}
          description={`Relatório lendo ledger gravado (id ${data.closing.closingId.slice(0, 8)}…). Hash: ${data.closing.calculationHash ?? "—"}`}
        />
      ) : data?.mode === "PREVIEW" ? (
        <ExecutiveAlert
          variant="attention"
          density="compact"
          title="Prévia — não aplicada"
          description="Os valores abaixo são prévia calculada no backend. Exporte ou feche a comissão para gravar o ledger oficial."
        />
      ) : null}

      {error ? <CommissionsErrorBanner message={error} /> : null}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <CommissionsPeriodFilterFields
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
          fieldClassName={inputClass}
        />
        <button
          type="button"
          className={financeBiButtonOutlineClass}
          onClick={() => void loadPreview()}
          disabled={loading}
        >
          Gerar prévia
        </button>
        <button
          type="button"
          className={financeBiButtonOutlineClass}
          onClick={() => void loadClosed(year, month)}
          disabled={loading}
        >
          Carregar fechamento
        </button>
        {canManage && data?.canApply && data.mode === "PREVIEW" ? (
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-[#111827] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f2937] disabled:opacity-50"
            onClick={() => setApplyOpen(true)}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Fechar comissão
          </button>
        ) : null}
        {canManage && isClosed ? (
          <button
            type="button"
            className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            onClick={() => setReprocessOpen(true)}
          >
            <Lock className="mr-2 h-4 w-4" />
            Reprocessar
          </button>
        ) : null}
      </div>

      {data?.applyBlockedReason && !isClosed ? (
        <p className="text-sm text-amber-700">{data.applyBlockedReason}</p>
      ) : null}

      {loading && !data ? <CommissionsLoading label="Carregando fechamento…" /> : null}

      {!loading && data && data.mode === "EMPTY" ? (
        <CommissionsEmptyState
          title="Nenhum dado carregado"
          description='Selecione ano/mês e clique em "Gerar prévia" ou "Carregar fechamento".'
        />
      ) : null}

      {summary && data && data.mode !== "EMPTY" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FinanceKpiCard
              label="Total recebido no mês"
              value={formatFinanceCurrency(summary.totalReceivedAmount)}
            />
            <FinanceKpiCard
              label="Base comissionável"
              value={formatFinanceCurrency(summary.totalCommissionableBase)}
            />
            <FinanceKpiCard
              label="Comissão calculada"
              value={formatFinanceCurrency(summary.totalReleasedCommission)}
            />
            <FinanceKpiCard
              label="Clientes excluídos"
              value={String(excludedCount)}
              helperText={formatFinanceCurrency(summary.totalExcludedAmount)}
            />
            <FinanceKpiCard label="Exceções" value={String(exceptionCount)} />
            <FinanceKpiCard label="Títulos sem vínculo" value={String(unlinkedCount)} />
            <FinanceKpiCard label="Vendedores não resolvidos" value={String(unresolvedSellerCount)} />
            <FinanceKpiCard
              label="Modo exportação"
              value={data.exportMode}
              helperText={isClosed ? "Ledger gravado" : "Prévia"}
            />
          </div>

          <section className="space-y-2">
            <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Por vendedor
            </h4>
            <SellerTable rows={data.bySeller} />
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Detalhamento ({data.lines.length} linhas)
            </h4>
            <DetailTable rows={data.lines} />
          </section>
        </>
      ) : null}

      {applyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-lg font-bold">Fechar comissão do mês</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta ação grava o ledger oficial. Digite{" "}
              <strong>FECHAR COMISSAO</strong> para confirmar.
            </p>
            <input
              className={`${inputClass} mt-3 w-full`}
              value={applyConfirm}
              onChange={(e) => setApplyConfirm(e.target.value)}
              placeholder="FECHAR COMISSAO"
            />
            <textarea
              className={`${inputClass} mt-2 w-full`}
              rows={2}
              value={applyNotes}
              onChange={(e) => setApplyNotes(e.target.value)}
              placeholder="Observações (opcional)"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={() => setApplyOpen(false)}
                disabled={applying}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#111827] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => void applyClosing()}
                disabled={applying || applyConfirm !== "FECHAR COMISSAO"}
              >
                {applying ? "Aplicando…" : "Confirmar fechamento"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reprocessOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-lg font-bold">Reprocessar fechamento</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Substitui o fechamento CLOSED por um novo cálculo. Digite{" "}
              <strong>REPROCESSAR COMISSAO</strong> e informe o motivo.
            </p>
            <input
              className={`${inputClass} mt-3 w-full`}
              value={reprocessConfirm}
              onChange={(e) => setReprocessConfirm(e.target.value)}
              placeholder="REPROCESSAR COMISSAO"
            />
            <textarea
              className={`${inputClass} mt-2 w-full`}
              rows={2}
              value={reprocessReason}
              onChange={(e) => setReprocessReason(e.target.value)}
              placeholder="Motivo do reprocessamento"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={() => setReprocessOpen(false)}
                disabled={reprocessing}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => void reprocessClosing()}
                disabled={
                  reprocessing ||
                  reprocessConfirm !== "REPROCESSAR COMISSAO" ||
                  reprocessReason.trim().length < 3
                }
              >
                {reprocessing ? "Reprocessando…" : "Confirmar reprocessamento"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
