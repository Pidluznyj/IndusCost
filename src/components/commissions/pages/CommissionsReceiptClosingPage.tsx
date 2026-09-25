import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Lock, Printer, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { CommissionClosingReportPrintDocument } from "@/src/components/commissions/CommissionClosingReportPrintDocument";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  receiptClosingStatusBadgeLabel,
  receiptClosingStatusBadgeTone,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import { fetchJsonOk } from "@/src/lib/http";
import { canCloseReceiptClosing, canReprocessCommissions } from "@/src/lib/commissionsModulePermissions";
import { usePermissions } from "@/src/hooks/usePermissions";
import { ACTION_GATE_RESOURCES } from "@/src/lib/actionPermissionAccess";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import { CommissionsReceiptClosingDetailTable } from "@/src/components/commissions/CommissionsReceiptClosingDetailTable";
import { CommissionsReceiptClosingCarryoverGrid } from "@/src/components/commissions/CommissionsReceiptClosingCarryoverGrid";
import {
  COMMISSION_LEGACY_REPORT_TEXT,
  formatCommissionYearMonthLabel,
} from "@/src/lib/commissions/commissionCoverageCutover";
import { CommissionLegacyPeriodBanner } from "@/src/components/commissions/CommissionLegacyPeriodBanner";
import { CommissionTechnicalMirrorConfirmDialog } from "@/src/components/commissions/CommissionTechnicalMirrorConfirmDialog";
import {
  summarizeCarryoverRows,
  type ReceiptClosingCarryoverRow,
} from "@/src/lib/commissions/commissionReceiptCoverage.shared";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import type {
  CommissionsReceiptClosingLine,
  CommissionsReceiptClosingPayload,
  CommissionsReceiptClosingSellerRow,
} from "@/src/components/commissions/commissionsTypes";
import { DiagnosticReportButton } from "@/src/components/diagnostics/DiagnosticReportButton";
import {
  buildReceiptClosingDetailExportArrayBuffer,
  buildReceiptClosingDetailExportFilename,
} from "@/src/lib/commissions/commissionReceiptClosingDetailExport.shared";
import type { ReceiptClosingPagePayload } from "@/src/lib/commissions/commissionReceiptClosingApi.shared";
import {
  computeReceiptClosingDetailTotals,
  computeReceiptClosingSellerTotals,
  filterReceiptClosingLinesBySellerKey,
  findReceiptClosingSellerRowByKey,
  receiptClosingLineSellerKey,
  receiptClosingSellerFilterLabel,
  receiptClosingSellerRowKey,
  type ReceiptClosingSellerTotals,
} from "@/src/lib/commissions/commissionReceiptClosingSellerFilter.shared";
import { RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL } from "@/src/lib/commissions/commissionReceiptClosingApi.shared";

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

function SellerTable({
  rows,
  totals,
  selectedKey,
  onRowClick,
  legacy = false,
}: {
  rows: CommissionsReceiptClosingSellerRow[];
  totals: ReceiptClosingSellerTotals;
  selectedKey: string | null;
  onRowClick: (row: CommissionsReceiptClosingSellerRow) => void;
  /** Competência do histórico Nomus: valores reconstruídos, nunca "final". */
  legacy?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum vendedor no período.</p>;
  }
  return (
    <CommissionsTableScroll>
      <table className="min-w-[1100px] text-xs" data-testid="commissions-receipt-closing-seller-table">
        <thead>
          <tr className="border-b text-left uppercase text-muted-foreground">
            <th className="px-2 py-2">Vendedor canônico</th>
            <th className="px-2 py-2 text-right">Recebido único</th>
            <th className="px-2 py-2 text-right">Base</th>
            <th className="px-2 py-2 text-right">Comissão bruta</th>
            <th className="px-2 py-2 text-right">Comissão excluída</th>
            <th className="px-2 py-2 text-right">
              {legacy ? "Comissão reconstruída" : "Comissão final"}
            </th>
            <th className="px-2 py-2 text-right">Exceções</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const rowKey = receiptClosingSellerRowKey(row);
            const isSelected = selectedKey === rowKey;
            return (
              <tr
                key={rowKey ?? idx}
                className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${
                  isSelected ? "bg-[#2563EB]/10 ring-1 ring-inset ring-[#2563EB]/30" : ""
                }`}
                onClick={() => onRowClick(row)}
                data-testid={`commissions-receipt-closing-seller-row-${rowKey}`}
                aria-selected={isSelected}
              >
                <td className="px-2 py-2 font-medium">
                  {row.sellerName ?? RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL}
                </td>
                <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
                <td className="px-2 py-2 text-right">
                  {formatFinanceCurrency(row.commissionableBase)}
                </td>
                <td className="px-2 py-2 text-right">{formatFinanceCurrency(row.grossCommission)}</td>
                <td className="px-2 py-2 text-right">
                  {formatFinanceCurrency(row.excludedCommission)}
                </td>
                <td className="px-2 py-2 text-right font-semibold">
                  {formatFinanceCurrency(row.releasedCommission)}
                </td>
                <td className="px-2 py-2 text-right">{row.exceptionCount}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr
            className="border-t-2 bg-muted/20 font-semibold"
            data-testid="commissions-receipt-closing-seller-totals"
          >
            <td className="px-2 py-2">Total geral</td>
            <td className="px-2 py-2 text-right">{formatFinanceCurrency(totals.receivedAmount)}</td>
            <td className="px-2 py-2 text-right">
              {formatFinanceCurrency(totals.commissionableBase)}
            </td>
            <td className="px-2 py-2 text-right">{formatFinanceCurrency(totals.grossCommission)}</td>
            <td className="px-2 py-2 text-right">
              {formatFinanceCurrency(totals.excludedCommission)}
            </td>
            <td className="px-2 py-2 text-right">{formatFinanceCurrency(totals.releasedCommission)}</td>
            <td className="px-2 py-2 text-right">{totals.exceptionCount}</td>
          </tr>
        </tfoot>
      </table>
    </CommissionsTableScroll>
  );
}

export function CommissionsReceiptClosingPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canClose =
    canCloseReceiptClosing(auth) ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.commissionsMonthlyClosing, "close");
  const canReprocess =
    canReprocessCommissions(auth) ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.commissionsReprocess, "reprocess") ||
    permissions.canPerformAction(ACTION_GATE_RESOURCES.commissionsMonthlyClosing, "reprocess");
  const canManage = canClose; // lotes / apply notes ainda alinhados a close/manage
  const initial = currentYearMonth();

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [nomusBase, setNomusBase] = useState("");
  const [nomusCommission, setNomusCommission] = useState("");
  const [data, setData] = useState<CommissionsReceiptClosingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingDetail, setExportingDetail] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState("");
  const [criticalConfirm, setCriticalConfirm] = useState("");
  const [applyNotes, setApplyNotes] = useState("");
  const [applying, setApplying] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessConfirm, setReprocessConfirm] = useState("");
  const [reprocessReason, setReprocessReason] = useState("");
  const [reprocessing, setReprocessing] = useState(false);
  const [sellerFilterKey, setSellerFilterKey] = useState<string | null>(null);
  const [showGroupCompanyAudit, setShowGroupCompanyAudit] = useState(false);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [printRequestId, setPrintRequestId] = useState(0);
  const [printingPdf, setPrintingPdf] = useState(false);
  /** Linhas marcadas no grid de pendências (ainda não enviadas ao servidor). */
  const [carryoverChecked, setCarryoverChecked] = useState<Set<string>>(() => new Set());
  /** Recebimentos incluídos na prévia atual (o servidor recalcula e revalida). */
  const [includedCarryoverIds, setIncludedCarryoverIds] = useState<number[]>([]);
  /** "TENHO CIÊNCIA" pendente (exportação/impressão de competência do histórico Nomus). */
  const [mirrorConfirm, setMirrorConfirm] = useState<{
    periodLabel: string;
    action: () => void | Promise<void>;
  } | null>(null);

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  useEffect(() => {
    if (printRequestId === 0 || !data || data.mode !== "CLOSED") return;

    document.body.classList.add("sales-orders-print-route");

    const style = document.createElement("style");
    style.setAttribute("data-commission-closing-print-page", "1");
    style.textContent = "@page { size: A4 portrait; margin: 8mm; }";
    document.head.appendChild(style);

    const onAfterPrint = () => {
      document.body.classList.remove("sales-orders-print-route");
      style.remove();
      setPrintRequestId(0);
      setPrintingPdf(false);
    };

    window.addEventListener("afterprint", onAfterPrint, { once: true });
    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", onAfterPrint);
      style.remove();
    };
  }, [printRequestId, data]);

  function requestCommissionClosingPrint() {
    if (!data || data.mode !== "CLOSED") return;
    setPrintingPdf(true);
    setPrintRequestId((n) => n + 1);
  }

  function clearSellerFilter() {
    setSellerFilterKey(null);
  }

  const detailSourceLines = useMemo(() => {
    if (!data) return [];
    if (!showGroupCompanyAudit || data.groupCompanyAuditLines.length === 0) {
      return data.lines;
    }
    return [...data.lines, ...data.groupCompanyAuditLines];
  }, [data, showGroupCompanyAudit]);

  const filteredDetailLines = useMemo(() => {
    return filterReceiptClosingLinesBySellerKey(
      detailSourceLines as ReceiptClosingPagePayload["lines"],
      sellerFilterKey
    ) as CommissionsReceiptClosingLine[];
  }, [detailSourceLines, sellerFilterKey]);

  function handleSellerRowClick(row: CommissionsReceiptClosingSellerRow) {
    const key = receiptClosingSellerRowKey(row);
    setSellerFilterKey((current) => (current === key ? null : key));
  }

  const detailTotals = useMemo(
    () => computeReceiptClosingDetailTotals(filteredDetailLines as ReceiptClosingPagePayload["lines"]),
    [filteredDetailLines]
  );

  const sellerTotals = useMemo(
    () =>
      computeReceiptClosingSellerTotals(
        (data?.bySeller ?? []) as ReceiptClosingPagePayload["bySeller"]
      ),
    [data?.bySeller]
  );

  const sellerFilterLabel = useMemo(() => {
    if (!sellerFilterKey || !data) return null;
    const row = findReceiptClosingSellerRowByKey(
      data.bySeller as ReceiptClosingPagePayload["bySeller"],
      sellerFilterKey
    );
    return row ? receiptClosingSellerFilterLabel(row) : sellerFilterKey;
  }, [data, sellerFilterKey]);

  function downloadDetailXlsxBuffer(buffer: ArrayBuffer, filename: string) {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function nomusQueryParams(): URLSearchParams {
    const qs = new URLSearchParams({ year, month });
    const base = nomusBase.trim().replace(",", ".");
    const commission = nomusCommission.trim().replace(",", ".");
    if (base) qs.set("nomusBase", base);
    if (commission) qs.set("nomusCommission", commission);
    return qs;
  }

  const loadClosed = useCallback(async (y: string, m: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = nomusQueryParams();
      qs.set("year", y);
      qs.set("month", m);
      const payload = await fetchJsonOk<CommissionsReceiptClosingPayload>(
        `/api/commissions/receipt-closing/${encodeURIComponent(y)}/${encodeURIComponent(m)}?${qs}`
      );
      setSellerFilterKey(null);
      setShowGroupCompanyAudit(false);
      setCarryoverChecked(new Set());
      setIncludedCarryoverIds([]);
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar o fechamento."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [nomusBase, nomusCommission]);

  const loadPreview = useCallback(async (
    carryoverIds: readonly number[] = [],
    options: { keepFilters?: boolean } = {}
  ) => {
    setLoading(true);
    setError(null);
    try {
      const qs = nomusQueryParams();
      // Só IDs de recebimento: valores, vendedor e competência vêm do servidor.
      if (carryoverIds.length > 0) qs.set("carryoverReceiptIds", carryoverIds.join(","));
      const payload = await fetchJsonOk<CommissionsReceiptClosingPayload>(
        `/api/commissions/receipt-closing/preview?${qs}`
      );
      if (!options.keepFilters) {
        setSellerFilterKey(null);
        setShowGroupCompanyAudit(false);
      }
      setCarryoverChecked(new Set());
      setIncludedCarryoverIds(
        (payload.pendingCarryover?.rows ?? [])
          .filter((row) => row.selected)
          .flatMap((row) => row.receiptExternalIds)
          .sort((a, b) => a - b)
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível gerar a prévia."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month, nomusBase, nomusCommission]);

  /** Competência exportada = a exibida (payload), não o que está digitado no filtro. */
  function exportTarget(): { year: string; month: string } {
    return data ? { year: String(data.year), month: String(data.month) } : { year, month };
  }

  /** Mesma prévia da tela: pendências incluídas vão junto (só IDs; o servidor recalcula). */
  function exportQueryParams(): URLSearchParams {
    const qs = nomusQueryParams();
    if (data?.mode === "PREVIEW" && includedCarryoverIds.length > 0) {
      qs.set("carryoverReceiptIds", includedCarryoverIds.join(","));
    }
    return qs;
  }

  async function exportDetailXlsxAll() {
    setExportingDetail(true);
    try {
      const target = exportTarget();
      const res = await fetch(
        `/api/commissions/receipt-closing/${encodeURIComponent(target.year)}/${encodeURIComponent(target.month)}/export-detail.xlsx?${exportQueryParams()}`
      );
      if (!res.ok) throw new Error("Falha ao exportar detalhamento.");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] ??
        buildReceiptClosingDetailExportFilename(
          Number(target.year),
          Number(target.month),
          data?.exportMode ?? "PREVIEW"
        );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar o detalhamento."));
    } finally {
      setExportingDetail(false);
    }
  }

  function exportDetailXlsxFiltered() {
    if (!data || filteredDetailLines.length === 0) return;
    setExportingDetail(true);
    try {
      const payload = data as unknown as ReceiptClosingPagePayload;
      const buffer = buildReceiptClosingDetailExportArrayBuffer(
        payload,
        filteredDetailLines as ReceiptClosingPagePayload["lines"]
      );
      const baseName = buildReceiptClosingDetailExportFilename(
        data.year,
        data.month,
        data.exportMode === "NONE" ? "PREVIEW" : data.exportMode
      );
      const suffix = sellerFilterLabel?.replace(/[^\w\-]+/g, "_") ?? "filtrado";
      const filename = baseName.replace(/\.xlsx$/, `-${suffix}.xlsx`);
      downloadDetailXlsxBuffer(buffer, filename);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar o detalhamento filtrado."));
    } finally {
      setExportingDetail(false);
    }
  }

  async function exportDetailXlsx() {
    if (sellerFilterKey || showGroupCompanyAudit) {
      exportDetailXlsxFiltered();
      return;
    }
    await exportDetailXlsxAll();
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const target = exportTarget();
      const res = await fetch(
        `/api/commissions/receipt-closing/${encodeURIComponent(target.year)}/${encodeURIComponent(target.month)}/export.csv?${exportQueryParams()}`
      );
      if (!res.ok) throw new Error("Falha ao exportar CSV.");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Nome definido pelo servidor (espelho técnico no histórico Nomus).
      a.download =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        `commission-receipt-closing-${target.year}-${target.month.padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível exportar CSV."));
    } finally {
      setExporting(false);
    }
  }

  async function applyClosing() {
    if (!canClose) return;
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
          criticalConfirm: data?.requiresCriticalConfirmation ? criticalConfirm : undefined,
          acknowledgeCriticalDivergence:
            data?.requiresCriticalConfirmation && criticalConfirm === "DIVERGENCIA CRITICA",
          notes: applyNotes || null,
          // Pendências escolhidas nesta prévia (mesma competência); o servidor revalida.
          carryoverReceiptIds: carryoverAppliesToForm ? includedCarryoverIds : [],
        }),
      });
      setApplyOpen(false);
      setApplyConfirm("");
      setCriticalConfirm("");
      setApplyNotes("");
      await loadClosed(year, month);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível fechar a comissão."));
    } finally {
      setApplying(false);
    }
  }

  async function reprocessClosing() {
    if (!canReprocess) return;
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

  const carryoverSection = data?.mode === "PREVIEW" ? data.pendingCarryover ?? null : null;
  const carryoverAppliesToForm =
    data != null && data.year === Number(year) && data.month === Number(month);

  const carryoverRows = useMemo(() => {
    const rows = carryoverSection?.rows ?? [];
    if (!sellerFilterKey) return rows;
    return rows.filter(
      (row) => receiptClosingLineSellerKey({ ...row, status: row.lineStatus }) === sellerFilterKey
    );
  }, [carryoverSection, sellerFilterKey]);

  const carryoverSummary = useMemo(() => summarizeCarryoverRows(carryoverRows), [carryoverRows]);

  function toggleCarryoverRow(row: ReceiptClosingCarryoverRow) {
    setCarryoverChecked((current) => {
      const next = new Set(current);
      if (next.has(row.rowKey)) next.delete(row.rowKey);
      else next.add(row.rowKey);
      return next;
    });
  }

  function selectEligibleCarryovers() {
    setCarryoverChecked(
      new Set(carryoverRows.filter((row) => row.includable && !row.selected).map((row) => row.rowKey))
    );
  }

  function includeCarryoverReceipts(receiptIds: readonly number[]) {
    if (receiptIds.length === 0) return;
    const next = [...new Set([...includedCarryoverIds, ...receiptIds])].sort((a, b) => a - b);
    void loadPreview(next, { keepFilters: true });
  }

  function includeCheckedCarryovers() {
    includeCarryoverReceipts(
      carryoverRows
        .filter((row) => carryoverChecked.has(row.rowKey) && row.includable && !row.selected)
        .flatMap((row) => row.receiptExternalIds)
    );
  }

  function removeCarryoverRow(row: ReceiptClosingCarryoverRow) {
    const drop = new Set(row.receiptExternalIds);
    void loadPreview(
      includedCarryoverIds.filter((id) => !drop.has(id)),
      { keepFilters: true }
    );
  }

  // Autoridade do relatório vem do servidor (helper central) — a tela não compara datas.
  const reportingAuthority = data?.reportingAuthority ?? null;
  const legacyPeriod = reportingAuthority?.isLegacyPeriod === true;
  const legacyText = COMMISSION_LEGACY_REPORT_TEXT;

  /**
   * Exportar/imprimir competência do histórico Nomus pede "TENHO CIÊNCIA" a cada vez
   * (não fica lembrado). Competência oficial segue direto.
   */
  function runWithLegacyAcknowledgement(action: () => void | Promise<void>) {
    if (!legacyPeriod || !data) {
      void action();
      return;
    }
    setMirrorConfirm({
      periodLabel: formatCommissionYearMonthLabel({ year: data.year, month: data.month }),
      action,
    });
  }

  const cards = data?.cards;
  const isClosed = data?.mode === "CLOSED";
  const applyReady =
    applyConfirm === "FECHAR COMISSAO" &&
    (!data?.requiresCriticalConfirmation || criticalConfirm === "DIVERGENCIA CRITICA");

  return (
    <div className="space-y-5" data-testid="commissions-receipt-closing-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Comissões
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            {legacyPeriod ? legacyText.screenTitle : "Fechamento por recebimento"}
          </h3>
          {legacyPeriod ? (
            <p
              className="mt-1 text-sm font-semibold text-amber-800"
              data-testid="commissions-receipt-closing-legacy-subtitle"
            >
              {legacyText.screenSubtitle}
            </p>
          ) : null}
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            {legacyPeriod ? "Reconstrução técnica" : "Fechamento oficial mensal"} com base nos
            recebimentos reais do mês (
            <code>receiptDate</code>) — a baixa do Contas a Receber (<code>settlementDate</code>)
            é informação administrativa e não define a competência. Valores vêm exclusivamente da
            API — sem recálculo no frontend.
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
            onClick={() => runWithLegacyAcknowledgement(exportCsv)}
            disabled={exporting || !data || data.lines.length === 0}
            title={legacyPeriod ? legacyText.exportTooltip : undefined}
            data-testid="commissions-receipt-closing-export-csv"
          >
            <Download className="mr-2 h-4 w-4" />
            {legacyPeriod ? `${legacyText.exportButton} (CSV)` : "Exportar CSV"}
          </button>
          <DiagnosticReportButton
            scope="COMMISSION_RECEIPT_CLOSING"
            size="sm"
            context={{
              year: Number(year),
              month: Number(month),
              screenTitle: "Fechamento por Recebimento",
              screenRoute: "/commissions/receipt-closing",
            }}
            data-testid="commission-receipt-closing-diagnostic-report"
          />
        </div>
      </div>

      <CommissionLegacyPeriodBanner
        authority={reportingAuthority}
        officialReport={data?.legacyOfficialReport}
        showOfficialReport
      />

      {isClosed && data?.closing ? (
        <ExecutiveAlert
          variant="info"
          density="compact"
          title={
            legacyPeriod
              ? "Registro técnico no IndusCost — NÃO OFICIAL (período Nomus)"
              : `Fechamento FECHADO — ${data.closing.closedAt ? formatDate(data.closing.closedAt) : ""}`
          }
          description={`Relatório lendo ledger gravado (id ${data.closing.closingId.slice(0, 8)}…). Hash: ${data.closing.calculationHash ?? "—"}`}
        />
      ) : data?.mode === "PREVIEW" && !legacyPeriod ? (
        <ExecutiveAlert
          variant="attention"
          density="compact"
          title="Prévia — não aplicada"
          description="Os valores abaixo são prévia calculada no backend. Exporte ou feche a comissão para gravar o ledger oficial."
        />
      ) : null}

      {data?.criticalDivergence ? (
        <ExecutiveAlert
          variant="warning"
          density="compact"
          title="Divergência crítica detectada"
          description={
            data.criticalDivergenceReason ??
            "Revise os títulos antes de fechar ou confirme explicitamente no fechamento."
          }
        />
      ) : null}

      {data?.materializationSummary?.pendingMaterialization ? (
        <ExecutiveAlert
          variant="attention"
          density="compact"
          title="Materialização pendente"
          description={
            <>
              <p data-testid="commissions-receipt-closing-materialization-pending">
                {data.materializationSummary.pendingMaterializationMessage}
              </p>
              <p className="mt-2 text-xs">
                {data.materializationSummary.receivablesWithoutScheduleCount} título(s) sem schedule
                {data.materializationSummary.staleScheduleCount > 0
                  ? ` · ${data.materializationSummary.staleScheduleCount} com schedule desatualizado`
                  : ""}
                {data.materializationSummary.sellerUnresolvedCount > 0
                  ? ` · ${data.materializationSummary.sellerUnresolvedCount} com vendedor não resolvido`
                  : ""}
              </p>
              {data.materializationSummary.rebuildScriptHint ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {data.materializationSummary.rebuildScriptHint}
                </p>
              ) : null}
            </>
          }
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
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Base Nomus (opcional)
          <input
            className={inputClass}
            value={nomusBase}
            onChange={(e) => setNomusBase(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Comissão Nomus (opcional)
          <input
            className={inputClass}
            value={nomusCommission}
            onChange={(e) => setNomusCommission(e.target.value)}
            placeholder="0,00"
          />
        </label>
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
        <button
          type="button"
          className={`${financeBiButtonOutlineClass} inline-flex items-center`}
          onClick={() => runWithLegacyAcknowledgement(exportDetailXlsx)}
          disabled={exportingDetail || !data || data.lines.length === 0}
          title={legacyPeriod ? legacyText.exportTooltip : undefined}
          data-testid="commissions-receipt-closing-export-detail"
        >
          {exportingDetail ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {legacyPeriod
            ? sellerFilterKey
              ? `${legacyText.exportButton} (${filteredDetailLines.length})`
              : legacyText.exportButton
            : sellerFilterKey
              ? `Exportar filtrado (${filteredDetailLines.length})`
              : "Exportar detalhamento"}
        </button>
        {sellerFilterKey ? (
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => runWithLegacyAcknowledgement(exportDetailXlsxAll)}
            disabled={exportingDetail || !data || data.lines.length === 0}
            title={legacyPeriod ? legacyText.exportTooltip : undefined}
            data-testid="commissions-receipt-closing-export-detail-all"
          >
            {legacyPeriod ? `${legacyText.exportButton} — tudo` : "Exportar tudo"}
          </button>
        ) : null}
        {canClose && data?.canApply && data.mode === "PREVIEW" ? (
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-[#111827] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f2937] disabled:opacity-50"
            onClick={() => setApplyOpen(true)}
            data-testid="commissions-receipt-closing-close"
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Fechar comissão
          </button>
        ) : null}
        {isClosed && data ? (
          <button
            type="button"
            className={`${financeBiButtonOutlineClass} inline-flex items-center`}
            onClick={() => runWithLegacyAcknowledgement(requestCommissionClosingPrint)}
            disabled={printingPdf}
            title={legacyPeriod ? legacyText.exportTooltip : undefined}
            data-testid="commissions-receipt-closing-print-pdf"
          >
            {printingPdf ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            {legacyPeriod ? legacyText.printButton : "Imprimir / PDF"}
          </button>
        ) : null}
        {canReprocess && isClosed && !legacyPeriod ? (
          <button
            type="button"
            className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            onClick={() => setReprocessOpen(true)}
            data-testid="commissions-receipt-closing-reprocess"
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

      {cards && data && data.mode !== "EMPTY" ? (
        <>
          <CommissionsKpiSection
            title={
              legacyPeriod
                ? "Resumo — reconstrução técnica (não oficial)"
                : "Resumo do fechamento por recebimento"
            }
            eyebrow={
              legacyPeriod
                ? `${legacyText.reconstructedValue} · ${legacyText.officialSourceLine}`
                : "Materialização e totais do período selecionado"
            }
            testId="commissions-receipt-closing-kpi"
            minColumnWidth={240}
          >
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Títulos recebidos"
              amount={data.materializationSummary.totalReceivablesCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Com schedule"
              amount={data.materializationSummary.receivablesWithScheduleCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Sem schedule"
              amount={data.materializationSummary.receivablesWithoutScheduleCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Clientes excluídos"
              amount={data.materializationSummary.excludedCustomerCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Empresas do grupo excluídas"
              amount={data.materializationSummary.groupCompanyExcludedCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Recebido grupo (auditoria)"
              amount={data.materializationSummary.groupCompanyExcludedReceivedAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Vendedor não resolvido"
              amount={data.materializationSummary.sellerUnresolvedCount}
              amountFormat="number"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label={legacyPeriod ? "Total recebido (reconstruído)" : "Total recebido gerencial"}
              amount={cards.totalReceivedAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Recebido com schedule"
              amount={cards.receivedWithScheduleAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Recebido cliente excluído"
              amount={cards.receivedExcludedCustomerAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Recebido sem schedule"
              amount={cards.receivedWithoutScheduleAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label={legacyPeriod ? "Base comissionável (reconstruída)" : "Base comissionável"}
              amount={cards.commissionableBaseAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label={legacyPeriod ? "Comissão bruta (reconstruída)" : "Comissão bruta"}
              amount={cards.grossCommissionAmount}
              amountFormat="currency"
              tone="money"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão excluída"
              amount={cards.excludedCommissionAmount}
              amountFormat="currency"
              tone="warning"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label={legacyPeriod ? "Comissão reconstruída" : "Comissão final a pagar"}
              amount={cards.finalCommissionAmount}
              amountFormat="currency"
              tone={legacyPeriod ? "warning" : "success"}
              helperText={
                legacyPeriod
                  ? `${legacyText.reconstructedTag} — não oficial. ${legacyText.officialSourceLine}`
                  : isClosed
                    ? legacyText.officialValue
                    : undefined
              }
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Diferença vs Nomus"
              amount={cards.nomusCommissionDiff ?? null}
              amountFormat={cards.nomusCommissionDiff != null ? "currency" : undefined}
              value={cards.nomusCommissionDiff != null ? undefined : "—"}
              helperText={cards.nomusDiffExplanation ?? undefined}
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Status"
              badge={{
                label: legacyPeriod
                  ? "Espelho técnico — não oficial"
                  : receiptClosingStatusBadgeLabel(cards.reportStatus),
                tone: legacyPeriod ? "warning" : receiptClosingStatusBadgeTone(cards.reportStatus),
                testId: "commissions-receipt-closing-status-badge",
              }}
            />
          </CommissionsKpiSection>

          {data.composition && reportingAuthority?.officialInIndusCost ? (
            <CommissionsKpiSection
              title="Composição da comissão"
              eyebrow="Competência atual + pendências de períodos anteriores = total do fechamento"
              testId="commissions-receipt-closing-composition"
              minColumnWidth={240}
            >
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="Comissão da competência"
                amount={data.composition.currentCompetenceCommission}
                amountFormat="currency"
                tone="money"
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="Pendências anteriores incluídas"
                amount={data.composition.carryoverCommission}
                amountFormat="currency"
                tone="money"
                helperText={`${data.composition.carryoverLineCount} linha(s) · recebido ${formatFinanceCurrency(
                  data.composition.carryoverReceivedAmount
                )}`}
              />
              <SystemTotalizerCard
                className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
                label="Total do fechamento"
                amount={data.composition.totalCommission}
                amountFormat="currency"
                tone="success"
              />
            </CommissionsKpiSection>
          ) : null}

          <section className="space-y-2">
            <h4 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Por vendedor
            </h4>
            <p className="text-xs text-muted-foreground">
              Clique em um vendedor para filtrar o detalhamento abaixo. Clique novamente para limpar.
            </p>
            <SellerTable
              rows={data.bySeller}
              totals={sellerTotals}
              selectedKey={sellerFilterKey}
              onRowClick={handleSellerRowClick}
              legacy={legacyPeriod}
            />
          </section>

          {carryoverSection && carryoverSection.rows.length > 0 ? (
            <CommissionsReceiptClosingCarryoverGrid
              section={carryoverSection}
              rows={carryoverRows}
              summary={carryoverSummary}
              checkedKeys={carryoverChecked}
              canInclude={canClose}
              busy={loading}
              onToggleRow={toggleCarryoverRow}
              onSelectEligible={selectEligibleCarryovers}
              onIncludeChecked={includeCheckedCarryovers}
              onIncludeRow={(row) => includeCarryoverReceipts(row.receiptExternalIds)}
              onRemoveRow={removeCarryoverRow}
            />
          ) : null}

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4
                className="text-sm font-bold uppercase tracking-wide text-muted-foreground"
                data-testid="commissions-receipt-closing-detail-heading"
              >
                {legacyPeriod ? "Detalhamento — espelho técnico" : "Detalhamento"} (
                {filteredDetailLines.length} linha
                {filteredDetailLines.length === 1 ? "" : "s"})
              </h4>
              {sellerFilterKey && sellerFilterLabel ? (
                <div
                  className="flex items-center gap-2"
                  data-testid="commissions-receipt-closing-seller-filter-chip"
                >
                  <span className="inline-flex items-center rounded-full bg-[#2563EB]/10 px-3 py-1 text-xs font-semibold text-[#2563EB]">
                    Filtro: {sellerFilterLabel}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-2 py-1 text-xs font-medium text-[#374151] hover:bg-muted/40"
                    onClick={clearSellerFilter}
                    data-testid="commissions-receipt-closing-seller-filter-clear"
                  >
                    <X className="h-3 w-3" />
                    Limpar
                  </button>
                </div>
              ) : null}
              {data.groupCompanyAuditLines.length > 0 ? (
                <label
                  className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                  data-testid="commissions-receipt-closing-show-group-audit"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[#E5E7EB]"
                    checked={showGroupCompanyAudit}
                    onChange={(e) => setShowGroupCompanyAudit(e.target.checked)}
                  />
                  Mostrar empresas do grupo na auditoria
                </label>
              ) : null}
            </div>
            <CommissionsReceiptClosingDetailTable rows={filteredDetailLines} totals={detailTotals} />
          </section>
        </>
      ) : null}

      <CommissionTechnicalMirrorConfirmDialog
        open={mirrorConfirm != null}
        periodLabel={mirrorConfirm?.periodLabel ?? ""}
        onCancel={() => setMirrorConfirm(null)}
        onConfirm={() => {
          const action = mirrorConfirm?.action;
          setMirrorConfirm(null);
          if (action) void action();
        }}
      />

      {applyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-lg font-bold">Fechar comissão do mês</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Esta ação grava o ledger oficial. Digite{" "}
              <strong>FECHAR COMISSAO</strong> para confirmar.
            </p>
            {carryoverAppliesToForm && carryoverSection && carryoverSection.summary.selectedCount > 0 ? (
              <p
                className="mt-2 text-sm text-[#111827]"
                data-testid="commissions-receipt-closing-apply-carryover"
              >
                Inclui {carryoverSection.summary.selectedCount} pendência(s) de períodos anteriores —
                comissão {formatFinanceCurrency(carryoverSection.summary.selectedCommissionAmount)}. O
                servidor recalcula e revalida cada recebimento antes de gravar.
              </p>
            ) : null}
            {data?.requiresCriticalConfirmation ? (
              <p className="mt-2 text-sm text-amber-800">
                Há divergência crítica ({data.criticalDivergenceReason}). Digite também{" "}
                <strong>DIVERGENCIA CRITICA</strong> para prosseguir.
              </p>
            ) : null}
            <input
              className={`${inputClass} mt-3 w-full`}
              value={applyConfirm}
              onChange={(e) => setApplyConfirm(e.target.value)}
              placeholder="FECHAR COMISSAO"
            />
            {data?.requiresCriticalConfirmation ? (
              <input
                className={`${inputClass} mt-2 w-full`}
                value={criticalConfirm}
                onChange={(e) => setCriticalConfirm(e.target.value)}
                placeholder="DIVERGENCIA CRITICA"
              />
            ) : null}
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
                disabled={applying || !applyReady}
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

      {printRequestId > 0 && data?.mode === "CLOSED"
        ? createPortal(
            <CommissionClosingReportPrintDocument payload={data} branding={branding} />,
            document.body
          )
        : null}
    </div>
  );
}
