import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Copy,
  Download,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
  buildCommissionsYearOptions,
} from "@/src/lib/commissionsPeriodFilter";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import type {
  CommissionClosingDetailPayload,
  CommissionClosingListItem,
  CommissionClosingSellerReport,
} from "@/src/lib/commissions/commissionClosings.shared";
import { isCanonicalSellerDisplayName } from "@/src/lib/commissions/commissionClosings.shared";
import { CommissionClosingSellerReportPrintDocument } from "@/src/components/commissions/CommissionClosingSellerReportPrintDocument";
import { CommissionClosingReportPrintDocument } from "@/src/components/commissions/CommissionClosingReportPrintDocument";
import type { ReceiptClosingPagePayload } from "@/src/lib/commissions/commissionReceiptClosingApi.shared";
import type { ReceiptClosingReprocessPreview } from "@/src/lib/commissions/commissionReceiptClosing";
import { cn } from "@/src/lib/utils";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canReprocessCommissions } from "@/src/lib/commissionsModulePermissions";
import { ACTION_GATE_RESOURCES } from "@/src/lib/actionPermissionAccess";

const MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

type ViewMode = "list" | "detail" | "seller";

export function CommissionsClosingsPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canManageClosing =
    canReprocessCommissions(auth) ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.commissionsReprocess, "reprocess");

  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<CommissionClosingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [detail, setDetail] = useState<CommissionClosingDetailPayload | null>(null);
  const [sellerReport, setSellerReport] = useState<CommissionClosingSellerReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sellerSearch, setSellerSearch] = useState("");
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [printMode, setPrintMode] = useState<"seller" | "closing" | null>(null);
  const [closingPrintPayload, setClosingPrintPayload] = useState<ReceiptClosingPagePayload | null>(null);
  const [exporting, setExporting] = useState(false);

  const [recalcTarget, setRecalcTarget] = useState<CommissionClosingListItem | null>(null);
  const [recalcPreview, setRecalcPreview] = useState<ReceiptClosingReprocessPreview | null>(null);
  const [recalcLoadingPreview, setRecalcLoadingPreview] = useState(false);
  const [recalcConfirm, setRecalcConfirm] = useState("");
  const [recalcReason, setRecalcReason] = useState("");
  const [recalcApplying, setRecalcApplying] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<CommissionClosingListItem | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelApplying, setCancelApplying] = useState(false);

  const yearOptions = useMemo(
    () => buildCommissionsYearOptions(Number.parseInt(year, 10) || now.getFullYear()),
    [year, now]
  );

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("year", year);
      if (month) qs.set("month", month);
      qs.set("status", "CLOSED");
      if (search.trim()) qs.set("search", search.trim());
      const data = await fetchJsonOk<{ items: CommissionClosingListItem[] }>(
        `/api/commissions/closings?${qs.toString()}`
      );
      setItems(data.items ?? []);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar os fechamentos."));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (printRequestId === 0 || !printMode) return;
    document.body.classList.add("sales-orders-print-route");

    // Força A4 retrato mesmo com @page landscape de outros CSS globais.
    const style = document.createElement("style");
    style.setAttribute("data-commission-closing-print-page", "1");
    style.textContent = "@page { size: A4 portrait; margin: 8mm; }";
    document.head.appendChild(style);

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      style.remove();
      setPrintRequestId(0);
      setPrintMode(null);
      setClosingPrintPayload(null);
    };
    window.addEventListener("afterprint", onAfterPrint, { once: true });
    const timer = window.setTimeout(() => window.print(), 350);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
      style.remove();
    };
  }, [printRequestId, printMode]);

  async function openClosing(item: CommissionClosingListItem) {
    setDetailLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<CommissionClosingDetailPayload>(
        `/api/commissions/closings/${item.closingId}`
      );
      setDetail(data);
      setView("detail");
      setSellerReport(null);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível abrir o fechamento."));
    } finally {
      setDetailLoading(false);
    }
  }

  async function openSeller(sellerGroupKey: string) {
    if (!detail) return;
    setDetailLoading(true);
    setError(null);
    try {
      const key = encodeURIComponent(sellerGroupKey);
      const qs = sellerSearch.trim() ? `?search=${encodeURIComponent(sellerSearch.trim())}` : "";
      const data = await fetchJsonOk<CommissionClosingSellerReport>(
        `/api/commissions/closings/${detail.closing.closingId}/sellers/${key}${qs}`
      );
      setSellerReport(data);
      setView("seller");
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível abrir o relatório do vendedor."));
    } finally {
      setDetailLoading(false);
    }
  }

  async function exportSellerXlsx() {
    if (!detail || !sellerReport) return;
    setExporting(true);
    try {
      const key = encodeURIComponent(sellerReport.seller.groupKey);
      const res = await fetch(
        `/api/commissions/closings/${detail.closing.closingId}/sellers/${key}/xlsx`
      );
      if (!res.ok) throw new Error("Falha ao exportar XLSX.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comissao-${sellerReport.closing.year}-${sellerReport.closing.month}-${sellerReport.seller.displayName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar o XLSX."));
    } finally {
      setExporting(false);
    }
  }

  async function exportClosingXlsx(item: CommissionClosingListItem) {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/commissions/receipt-closing/${item.year}/${item.month}/report.xlsx`
      );
      if (!res.ok) throw new Error("Falha ao exportar XLSX geral.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comissao-fechamento-${item.year}-${String(item.month).padStart(2, "0")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar o XLSX geral."));
    } finally {
      setExporting(false);
    }
  }

  async function printClosingGeneral(item: CommissionClosingListItem) {
    try {
      const payload = await fetchJsonOk<ReceiptClosingPagePayload>(
        `/api/commissions/receipt-closing/${item.year}/${item.month}/report`
      );
      setClosingPrintPayload(payload);
      setPrintMode("closing");
      setPrintRequestId((n) => n + 1);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível gerar o PDF geral."));
    }
  }

  async function openRecalc(item: CommissionClosingListItem) {
    setRecalcTarget(item);
    setRecalcPreview(null);
    setRecalcConfirm("");
    setRecalcReason("");
    setRecalcLoadingPreview(true);
    setError(null);
    try {
      const preview = await fetchJsonOk<ReceiptClosingReprocessPreview>(
        "/api/commissions/receipt-closing/reprocess-preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: item.year, month: item.month }),
        }
      );
      setRecalcPreview(preview);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível gerar a prévia de recálculo."));
      setRecalcTarget(null);
    } finally {
      setRecalcLoadingPreview(false);
    }
  }

  function closeRecalcModal() {
    if (recalcApplying) return;
    setRecalcTarget(null);
    setRecalcPreview(null);
    setRecalcConfirm("");
    setRecalcReason("");
  }

  async function confirmRecalc() {
    if (!recalcTarget) return;
    setRecalcApplying(true);
    setError(null);
    try {
      await fetchJsonOk("/api/commissions/receipt-closing/reprocess-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: recalcTarget.year,
          month: recalcTarget.month,
          confirm: recalcConfirm,
          reason: recalcReason,
        }),
      });
      closeRecalcModal();
      if (view !== "list") {
        setView("list");
        setDetail(null);
        setSellerReport(null);
      }
      await reload();
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível recalcular o fechamento."));
    } finally {
      setRecalcApplying(false);
    }
  }

  function openCancel(item: CommissionClosingListItem) {
    setCancelTarget(item);
    setCancelConfirm("");
    setCancelReason("");
  }

  function closeCancelModal() {
    if (cancelApplying) return;
    setCancelTarget(null);
    setCancelConfirm("");
    setCancelReason("");
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelApplying(true);
    setError(null);
    try {
      await fetchJsonOk("/api/commissions/receipt-closing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingId: cancelTarget.closingId,
          confirm: cancelConfirm,
          reason: cancelReason,
        }),
      });
      closeCancelModal();
      if (view !== "list") {
        setView("list");
        setDetail(null);
        setSellerReport(null);
      }
      await reload();
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível cancelar o fechamento."));
    } finally {
      setCancelApplying(false);
    }
  }

  function printSellerPdf() {
    if (!sellerReport) return;
    setPrintMode("seller");
    setPrintRequestId((n) => n + 1);
  }

  async function copySellerSummary() {
    if (!sellerReport) return;
    const text = [
      `Relatório de Comissão — ${sellerReport.seller.displayName}`,
      `Fechamento ${sellerReport.closing.periodLabel}`,
      `Comissão final: ${formatFinanceCurrency(sellerReport.summary.finalCommissionAmount)}`,
      `Base: ${formatFinanceCurrency(sellerReport.summary.commissionBaseAmount)}`,
      `Recebido: ${formatFinanceCurrency(sellerReport.summary.totalReceivedAmount)}`,
      `Títulos: ${sellerReport.summary.titleCount}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Não foi possível copiar o resumo.");
    }
  }

  const filteredSellerRows = useMemo(() => {
    if (!sellerReport) return [];
    if (!sellerSearch.trim()) return sellerReport.rows;
    const needle = sellerSearch.trim().toLowerCase();
    return sellerReport.rows.filter((r) =>
      [r.orderCode, r.customerName, r.nfeNumber, r.receivableNumber].some(
        (v) => v != null && String(v).toLowerCase().includes(needle)
      )
    );
  }, [sellerReport, sellerSearch]);

  return (
    <div className="space-y-5" data-testid="commissions-closings-page">
      <CommissionsSectionIntro
        title="Fechamentos de Comissão"
        description="Consulte relatórios oficiais já fechados, por mês e por vendedor. A fonte é o ledger oficial — sem recálculo."
        testId="commissions-closings-intro"
      />

      {error ? (
        <CommissionsErrorBanner
          message={error}
          onRetry={() => void reload()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {view === "list" ? (
        <>
          <div
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            data-testid="commissions-closings-filters"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1">
                <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Ano</span>
                <select
                  className={COMMISSIONS_FILTER_FIELD_CLASS}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Mês</span>
                <select
                  className={COMMISSIONS_FILTER_FIELD_CLASS}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value || "all"} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Busca</span>
                <input
                  className={COMMISSIONS_FILTER_FIELD_CLASS}
                  placeholder="Pedido, cliente, NF, CR, vendedor…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setSearch(searchInput);
                    }
                  }}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => setSearch(searchInput)}
              >
                <Search className="mr-2 h-4 w-4" />
                Buscar
              </button>
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => {
                  setMonth("");
                  setSearchInput("");
                  setSearch("");
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => void reload()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar
              </button>
            </div>
          </div>

          {loading ? <CommissionsLoading label="Carregando fechamentos…" /> : null}

          {!loading && items.length === 0 ? (
            <CommissionsEmptyState
              title="Nenhum fechamento oficial encontrado"
              description="Feche um mês em Fechamento do mês para consultá-lo aqui."
            />
          ) : null}

          {items.length > 0 ? (
            <CommissionsTableScroll testId="commissions-closings-table">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Período</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Fechado em</th>
                  <th className="px-3 py-2">Fechado por</th>
                  <th className="px-3 py-2">Recebido</th>
                  <th className="px-3 py-2">Base</th>
                  <th className="px-3 py-2">Comissão final</th>
                  <th className="px-3 py-2">Vendedores</th>
                  <th className="px-3 py-2">Títulos</th>
                  <th className="px-3 py-2">Divergências</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.closingId} data-testid="commissions-closings-row">
                    <td className="px-3 py-2 font-medium">{item.periodLabel}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                        {item.statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {item.closedAt ? formatFinanceDateTime(item.closedAt) : "—"}
                    </td>
                    <td className="px-3 py-2">{item.closedByName ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatFinanceCurrency(item.totalReceivedAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatFinanceCurrency(item.commissionBaseAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">
                      {formatFinanceCurrency(item.finalCommissionAmount)}
                    </td>
                    <td className="px-3 py-2">{item.sellerCount}</td>
                    <td className="px-3 py-2">{item.lineCount}</td>
                    <td className="px-3 py-2">{item.criticalDivergence ? "Sim" : "Não"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs font-medium hover:bg-accent"
                          onClick={() => void openClosing(item)}
                          data-testid="commissions-closings-open"
                        >
                          Ver
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs hover:bg-accent"
                          onClick={() => void printClosingGeneral(item)}
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs hover:bg-accent"
                          disabled={exporting}
                          onClick={() => void exportClosingXlsx(item)}
                        >
                          XLSX
                        </button>
                        {canManageClosing ? (
                          <>
                            <button
                              type="button"
                              className="rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
                              onClick={() => void openRecalc(item)}
                              data-testid="commissions-closings-recalc"
                            >
                              Recalcular
                            </button>
                            <button
                              type="button"
                              className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                              onClick={() => openCancel(item)}
                              data-testid="commissions-closings-cancel"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>
          ) : null}
        </>
      ) : null}

      {view === "detail" && detail ? (
        <div className="space-y-4" data-testid="commissions-closings-detail">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <button
                type="button"
                className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setView("list");
                  setDetail(null);
                }}
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
              </button>
              <h2 className="text-lg font-semibold">
                Fechamento de Comissão — {detail.closing.periodLabel}
              </h2>
              <p className="text-sm text-muted-foreground">
                Fechado em{" "}
                {detail.closing.closedAt
                  ? formatFinanceDateTime(detail.closing.closedAt)
                  : "—"}{" "}
                por {detail.closing.closedByName ?? "—"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => void printClosingGeneral(detail.closing)}
              >
                <Printer className="mr-2 h-4 w-4" /> PDF geral
              </button>
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                disabled={exporting}
                onClick={() => void exportClosingXlsx(detail.closing)}
              >
                <Download className="mr-2 h-4 w-4" /> XLSX geral
              </button>
              {canManageClosing ? (
                <>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                    onClick={() => void openRecalc(detail.closing)}
                    data-testid="commissions-closings-detail-recalc"
                  >
                    Recalcular
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    onClick={() => openCancel(detail.closing)}
                    data-testid="commissions-closings-detail-cancel"
                  >
                    Cancelar
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <CommissionsKpiSection title="Resumo" testId="commissions-closings-detail-cards">
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Total recebido"
              amount={detail.cards.totalReceivedAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Base comissionável"
              amount={detail.cards.commissionBaseAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão bruta"
              amount={detail.cards.grossCommissionAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão excluída"
              amount={detail.cards.excludedCommissionAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão final a pagar"
              amount={detail.cards.finalCommissionAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Vendedores"
              amount={detail.cards.sellerCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Títulos"
              amount={detail.cards.titleCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Divergências críticas"
              value={detail.cards.criticalDivergence ? "Sim" : "Não"}
            />
          </CommissionsKpiSection>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Por vendedor</h3>
            <CommissionsTableScroll testId="commissions-closings-sellers-table">
              <thead className="bg-sky-50 text-left text-xs uppercase tracking-wide text-sky-900">
                <tr>
                  <th className="px-3 py-2">Vendedor</th>
                  <th className="px-3 py-2">Títulos</th>
                  <th className="px-3 py-2">Pedidos</th>
                  <th className="px-3 py-2">Clientes</th>
                  <th className="px-3 py-2">Recebido</th>
                  <th className="px-3 py-2">Base</th>
                  <th className="px-3 py-2">Bruta</th>
                  <th className="px-3 py-2">Excluída</th>
                  <th className="px-3 py-2">Final</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.sellers.map((row) => (
                  <tr key={row.sellerGroupKey} data-testid="commissions-closings-seller-row">
                    <td className="px-3 py-2 font-medium">
                      {row.sellerName}
                      {!isCanonicalSellerDisplayName(row.sellerName) ? (
                        <span className="ml-2 text-[10px] text-amber-700">verificar nome</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{row.titleCount}</td>
                    <td className="px-3 py-2">{row.orderCount}</td>
                    <td className="px-3 py-2">{row.customerCount}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatFinanceCurrency(row.totalReceivedAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatFinanceCurrency(row.commissionBaseAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatFinanceCurrency(row.grossCommissionAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatFinanceCurrency(row.excludedCommissionAmount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">
                      {formatFinanceCurrency(row.finalCommissionAmount)}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.primaryStatusLabel}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs font-medium hover:bg-accent"
                        onClick={() => void openSeller(row.sellerGroupKey)}
                        data-testid="commissions-closings-open-seller"
                      >
                        Ver relatório
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>
          </section>
        </div>
      ) : null}

      {view === "seller" && sellerReport ? (
        <div className="space-y-4" data-testid="commissions-closings-seller-report">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <button
                type="button"
                className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setView("detail")}
              >
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao fechamento
              </button>
              <h2 className="text-xl font-semibold tracking-tight">
                Relatório de Comissão — {sellerReport.seller.displayName}
              </h2>
              <p className="text-sm text-muted-foreground">
                Fechamento {sellerReport.closing.periodLabel} · {sellerReport.closing.statusLabel} ·
                Ledger oficial
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => printSellerPdf()}
                data-testid="commissions-closings-seller-pdf"
              >
                <Printer className="mr-2 h-4 w-4" /> PDF
              </button>
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                disabled={exporting}
                onClick={() => void exportSellerXlsx()}
                data-testid="commissions-closings-seller-xlsx"
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                XLSX
              </button>
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => void copySellerSummary()}
              >
                <Copy className="mr-2 h-4 w-4" /> Copiar resumo
              </button>
              <button
                type="button"
                className={`${financeBiButtonOutlineClass} inline-flex items-center`}
                onClick={() => {
                  setView("list");
                  setDetail(null);
                  setSellerReport(null);
                }}
              >
                <X className="mr-2 h-4 w-4" /> Fechar
              </button>
            </div>
          </div>

          <CommissionsKpiSection title="Resumo" testId="commissions-closings-seller-cards">
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Total recebido"
              amount={sellerReport.summary.totalReceivedAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Base comissionável"
              amount={sellerReport.summary.commissionBaseAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão bruta"
              amount={sellerReport.summary.grossCommissionAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão excluída"
              amount={sellerReport.summary.excludedCommissionAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão final a pagar"
              amount={sellerReport.summary.finalCommissionAmount}
              amountFormat="currency"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Títulos"
              amount={sellerReport.summary.titleCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Pedidos"
              amount={sellerReport.summary.orderCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Clientes"
              amount={sellerReport.summary.customerCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Percentual médio"
              value={
                sellerReport.summary.averageRate != null
                  ? `${sellerReport.summary.averageRate.toFixed(2)}%`
                  : "—"
              }
            />
          </CommissionsKpiSection>

          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className={cn(COMMISSIONS_FILTER_FIELD_CLASS, "max-w-md")}
              placeholder="Buscar pedido, cliente, NF ou CR…"
              value={sellerSearch}
              onChange={(e) => setSellerSearch(e.target.value)}
            />
          </div>

          <CommissionsTableScroll
            testId="commissions-closings-seller-grid"
            tableClassName="min-w-[920px]"
          >
            <thead className="bg-sky-50 text-left text-xs uppercase tracking-wide text-sky-900">
              <tr>
                <th className="px-3 py-2">Pedido / Cliente</th>
                <th className="px-3 py-2">Documentos</th>
                <th className="px-3 py-2">Datas</th>
                <th className="px-3 py-2 text-right">Valores CR</th>
                <th className="px-3 py-2 text-right">Base / %</th>
                <th className="px-3 py-2 text-right">Comissão</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {filteredSellerRows.map((row) => (
                <tr key={row.lineKey}>
                  <td className="px-3 py-2 align-top">
                    <p className="font-semibold leading-snug">{row.orderCode ?? "—"}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {row.customerName ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-xs leading-snug">
                    <p>
                      <span className="text-muted-foreground">NF </span>
                      {row.nfeNumber ?? "—"}
                    </p>
                    <p className="mt-0.5">
                      <span className="text-muted-foreground">CR </span>
                      {row.receivableNumber ?? "—"}
                      <span className="text-muted-foreground"> · Parc. </span>
                      {row.installment ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-xs leading-snug tabular-nums">
                    <p>
                      <span className="text-muted-foreground">Venc. </span>
                      {row.receivableDueDate
                        ? new Date(row.receivableDueDate).toLocaleDateString("pt-BR")
                        : "—"}
                    </p>
                    <p className="mt-0.5">
                      <span className="text-muted-foreground">Baixa </span>
                      {row.settlementDate
                        ? new Date(row.settlementDate).toLocaleDateString("pt-BR")
                        : "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-right text-xs leading-snug tabular-nums">
                    <p>
                      <span className="text-muted-foreground">Orig. </span>
                      {row.originalReceivableAmount != null
                        ? formatFinanceCurrency(row.originalReceivableAmount)
                        : "—"}
                    </p>
                    <p className="mt-0.5">
                      <span className="text-muted-foreground">Rec. </span>
                      {formatFinanceCurrency(row.receivedGrossAmount)}
                      {row.overpaidAmount > 0
                        ? ` · +${formatFinanceCurrency(row.overpaidAmount)}`
                        : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-right text-xs leading-snug tabular-nums">
                    <p className="font-medium">
                      {formatFinanceCurrency(row.commissionBaseAmount)}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {row.commissionRate.toFixed(2)}%
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top text-right font-semibold tabular-nums text-sky-950">
                    {formatFinanceCurrency(row.commissionAmount)}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">
                      {row.statusLabel}
                    </span>
                    {row.reasonLabel ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {row.reasonLabel}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className="px-3 py-2" colSpan={3}>
                  Totais ({filteredSellerRows.length} linha(s))
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatFinanceCurrency(sellerReport.totals.totalReceivedAmount)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatFinanceCurrency(sellerReport.totals.commissionBaseAmount)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatFinanceCurrency(sellerReport.totals.finalCommissionAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </CommissionsTableScroll>

          <details className="rounded-lg border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Auditoria técnica</summary>
            <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <dt>ID do fechamento</dt>
                <dd className="font-mono text-foreground">{sellerReport.closing.id}</dd>
              </div>
              <div>
                <dt>Chave do vendedor</dt>
                <dd className="font-mono text-foreground">{sellerReport.seller.groupKey}</dd>
              </div>
              <div>
                <dt>ID canônico</dt>
                <dd className="font-mono text-foreground">{sellerReport.seller.id ?? "—"}</dd>
              </div>
            </dl>
          </details>
        </div>
      ) : null}

      {detailLoading ? <CommissionsLoading label="Carregando…" /> : null}

      {recalcTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-lg font-bold">
              Recalcular fechamento — {recalcTarget.periodLabel}
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Roda o motor oficial de novo com a tabela de preço e os pedidos como estão hoje. O
              fechamento atual vira histórico (Reprocessado) e um novo Fechado é criado — nada é
              apagado. Comissão já liberada/paga não é alterada automaticamente.
            </p>

            {recalcLoadingPreview ? (
              <div className="mt-3">
                <CommissionsLoading label="Calculando prévia…" />
              </div>
            ) : null}

            {recalcPreview ? (
              <div
                className="mt-3 space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs"
                data-testid="commissions-closings-recalc-diff"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Comissão liberada</span>
                  <span className="font-medium tabular-nums">
                    {formatFinanceCurrency(recalcPreview.before.totalReleasedCommission)} →{" "}
                    {formatFinanceCurrency(recalcPreview.afterTotals.totalReleasedCommission)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Comissão prevista</span>
                  <span className="font-medium tabular-nums">
                    {formatFinanceCurrency(recalcPreview.before.totalExpectedCommission)} →{" "}
                    {formatFinanceCurrency(recalcPreview.afterTotals.totalExpectedCommission)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Base comissionável</span>
                  <span className="font-medium tabular-nums">
                    {formatFinanceCurrency(recalcPreview.before.totalCommissionableBase)} →{" "}
                    {formatFinanceCurrency(recalcPreview.afterTotals.totalCommissionableBase)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Linhas</span>
                  <span className="font-medium tabular-nums">
                    {recalcPreview.before.lineCount} → {recalcPreview.afterTotals.lineCount}{" "}
                    ({recalcPreview.diff.changedLines} alterada(s),{" "}
                    {recalcPreview.diff.addedLines} nova(s),{" "}
                    {recalcPreview.diff.removedLines} removida(s))
                  </span>
                </div>
              </div>
            ) : null}

            <label className="mt-4 block text-xs font-semibold uppercase text-muted-foreground">
              Digite REPROCESSAR COMISSAO para confirmar
            </label>
            <input
              className={`${COMMISSIONS_FILTER_FIELD_CLASS} mt-1 w-full`}
              value={recalcConfirm}
              onChange={(e) => setRecalcConfirm(e.target.value)}
              placeholder="REPROCESSAR COMISSAO"
              disabled={recalcApplying}
            />
            <textarea
              className={`${COMMISSIONS_FILTER_FIELD_CLASS} mt-2 w-full`}
              rows={2}
              value={recalcReason}
              onChange={(e) => setRecalcReason(e.target.value)}
              placeholder="Motivo do recálculo (ex.: tabela de preço corrigida em 01/07)"
              disabled={recalcApplying}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={closeRecalcModal}
                disabled={recalcApplying}
              >
                Voltar
              </button>
              <button
                type="button"
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => void confirmRecalc()}
                disabled={
                  recalcApplying ||
                  recalcLoadingPreview ||
                  recalcConfirm !== "REPROCESSAR COMISSAO" ||
                  recalcReason.trim().length < 3
                }
                data-testid="commissions-closings-recalc-confirm"
              >
                {recalcApplying ? "Recalculando…" : "Confirmar recálculo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-lg font-bold">Cancelar fechamento — {cancelTarget.periodLabel}</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              O fechamento deixa de ser oficial (vira Cancelado) e o período fica livre para um
              novo fechamento. As linhas já gravadas ficam preservadas para auditoria — nada é
              apagado, e comissão já liberada/paga não é alterada.
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase text-muted-foreground">
              Digite CANCELAR COMISSAO para confirmar
            </label>
            <input
              className={`${COMMISSIONS_FILTER_FIELD_CLASS} mt-1 w-full`}
              value={cancelConfirm}
              onChange={(e) => setCancelConfirm(e.target.value)}
              placeholder="CANCELAR COMISSAO"
              disabled={cancelApplying}
            />
            <textarea
              className={`${COMMISSIONS_FILTER_FIELD_CLASS} mt-2 w-full`}
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Motivo do cancelamento"
              disabled={cancelApplying}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                onClick={closeCancelModal}
                disabled={cancelApplying}
              >
                Voltar
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={() => void confirmCancel()}
                disabled={
                  cancelApplying ||
                  cancelConfirm !== "CANCELAR COMISSAO" ||
                  cancelReason.trim().length < 3
                }
                data-testid="commissions-closings-cancel-confirm"
              >
                {cancelApplying ? "Cancelando…" : "Confirmar cancelamento"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {printRequestId > 0 && printMode === "seller" && sellerReport
        ? createPortal(
            <CommissionClosingSellerReportPrintDocument
              report={sellerReport}
              branding={branding}
            />,
            document.body
          )
        : null}
      {printRequestId > 0 && printMode === "closing" && closingPrintPayload
        ? createPortal(
            <CommissionClosingReportPrintDocument
              payload={closingPrintPayload}
              branding={branding}
            />,
            document.body
          )
        : null}
    </div>
  );
}
