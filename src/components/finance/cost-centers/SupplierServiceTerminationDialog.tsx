import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calculator,
  FileDown,
  Link2,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildCommissionsYearOptions,
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
} from "@/src/lib/commissionsPeriodFilter";
import type { CommissionReportsMonthsFilter } from "@/src/lib/commissions/commissionReports.shared";
import { CommissionsMonthsMultiSelect } from "@/src/components/commissions/CommissionsMonthsMultiSelect";
import { formatSalesOrderDisplayCode } from "@/src/lib/salesOrderListUi";
import { cn } from "@/src/lib/utils";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import {
  calculateServiceTermination,
  formatProportionalRestDaysLabel,
} from "@/src/lib/suppliers/supplierServiceTerminationCalc";
import type {
  ServiceTerminationCalcModeDto,
  ServiceTerminationCommissionLinkDto,
  ServiceTerminationCommissionOrderRow,
  ServiceTerminationCommissionSearchResult,
  ServiceTerminationCommissionSellerOption,
  ServiceTerminationDto,
} from "@/src/lib/suppliers/supplierServiceTerminationTypes";

type Props = {
  open: boolean;
  supplierId: string;
  supplierName: string;
  onClose: () => void;
  canCreate: boolean;
  canFinalize: boolean;
  canExport: boolean;
};

function money(n: number): string {
  return formatFinanceCurrency(n);
}

export function SupplierServiceTerminationDialog({
  open,
  supplierId,
  supplierName,
  onClose,
  canCreate,
  canFinalize,
  canExport,
}: Props) {
  const portal = usePortalContainer();
  const [personName, setPersonName] = useState("");
  const [personDocument, setPersonDocument] = useState("");
  const [serviceRole, setServiceRole] = useState("");
  const [contractStartDate, setContractStartDate] = useState("");
  const [contractEndDate, setContractEndDate] = useState("");
  const [monthlyServiceAmount, setMonthlyServiceAmount] = useState("6000");
  const [monthlyHours, setMonthlyHours] = useState("160");
  const [restDaysPerYear, setRestDaysPerYear] = useState("20");
  const [calculationMode, setCalculationMode] =
    useState<ServiceTerminationCalcModeDto>("WORKED_MONTHS");
  const [workedMonths, setWorkedMonths] = useState("");
  const [workedDays, setWorkedDays] = useState("");
  const [otherCredits, setOtherCredits] = useState("0");
  const [otherDiscounts, setOtherDiscounts] = useState("0");
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<ServiceTerminationCommissionLinkDto[]>([]);
  const now = useMemo(() => new Date(), []);
  const [commissionYear, setCommissionYear] = useState(String(now.getFullYear()));
  const [commissionMonths, setCommissionMonths] =
    useState<CommissionReportsMonthsFilter>([now.getMonth() + 1]);
  const [commissionSellerId, setCommissionSellerId] = useState("all");
  const [commissionSearch, setCommissionSearch] = useState("");
  const [sellerOptions, setSellerOptions] = useState<
    ServiceTerminationCommissionSellerOption[]
  >([{ value: "all", label: "Todos os vendedores" }]);
  const [commissionRecords, setCommissionRecords] = useState<
    ServiceTerminationCommissionOrderRow[]
  >([]);
  const [commissionSummary, setCommissionSummary] = useState<{
    totalCommission: number;
    recordCount: number;
  } | null>(null);
  const [selectedLineKeys, setSelectedLineKeys] = useState<Set<string>>(new Set());
  const [searchingCommission, setSearchingCommission] = useState(false);
  const yearOptions = useMemo(
    () => buildCommissionsYearOptions(Number.parseInt(commissionYear, 10) || now.getFullYear()),
    [commissionYear, now]
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ServiceTerminationDto[]>([]);

  const calc = useMemo(() => {
    return calculateServiceTermination({
      monthlyServiceAmount: Number(monthlyServiceAmount) || 0,
      monthlyHours: Number(monthlyHours) || 0,
      restDaysPerYear: Number(restDaysPerYear) || 20,
      calculationMode,
      workedMonths: workedMonths.trim() ? Number(workedMonths) : null,
      workedDays: workedDays.trim() ? Number(workedDays) : null,
      contractStartDate: contractStartDate || null,
      contractEndDate: contractEndDate || null,
      commissionReportTotal: links.reduce((s, l) => s + (l.commissionAmount || 0), 0),
      otherCredits: Number(otherCredits) || 0,
      otherDiscounts: Number(otherDiscounts) || 0,
    });
  }, [
    monthlyServiceAmount,
    monthlyHours,
    restDaysPerYear,
    calculationMode,
    workedMonths,
    workedDays,
    contractStartDate,
    contractEndDate,
    links,
    otherCredits,
    otherDiscounts,
  ]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchJsonOk<{ ok: boolean; items: ServiceTerminationDto[] }>(
        `/api/suppliers/${supplierId}/service-terminations`
      );
      setHistory(data.items ?? []);
    } catch {
      /* lista opcional */
    }
  }, [supplierId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMessage(null);
    void loadHistory();
  }, [open, loadHistory]);

  const buildBody = () => ({
    personName,
    personDocument: personDocument || null,
    serviceRole: serviceRole || null,
    contractStartDate,
    contractEndDate,
    monthlyServiceAmount: Number(monthlyServiceAmount) || 0,
    monthlyHours: Number(monthlyHours) || 0,
    restDaysPerYear: Number(restDaysPerYear) || 20,
    calculationMode,
    workedMonths: workedMonths.trim() ? Number(workedMonths) : null,
    workedDays: workedDays.trim() ? Number(workedDays) : null,
    commissionReportTotal: calc.commissionReportTotal,
    otherCredits: Number(otherCredits) || 0,
    otherDiscounts: Number(otherDiscounts) || 0,
    notes: notes || null,
    adjustmentNotes: adjustmentNotes || null,
    commissionLinks: links,
  });

  const buildCommissionQuery = useCallback(
    (opts?: { sellerId?: string; pageSize?: number }) => {
      const q = new URLSearchParams();
      q.set("year", commissionYear || String(now.getFullYear()));
      if (
        commissionMonths === "all" ||
        (Array.isArray(commissionMonths) && commissionMonths.length === 0)
      ) {
        q.set("months", "all");
      } else {
        q.set("months", commissionMonths.join(","));
      }
      q.set("sellerId", opts?.sellerId ?? commissionSellerId ?? "all");
      const search = commissionSearch.trim() || personName.trim();
      if (search) q.set("search", search);
      q.set("page", "1");
      q.set("pageSize", String(opts?.pageSize ?? 100));
      return q;
    },
    [
      commissionYear,
      commissionMonths,
      commissionSellerId,
      commissionSearch,
      personName,
      now,
    ]
  );

  const loadSellerOptions = useCallback(async () => {
    try {
      const q = buildCommissionQuery({ sellerId: "all", pageSize: 1 });
      const data = await fetchJsonOk<ServiceTerminationCommissionSearchResult & { ok: boolean }>(
        `/api/suppliers/service-terminations/commission-reports/search?${q}`
      );
      const opts = data.sellerOptions?.length
        ? data.sellerOptions
        : [{ value: "all", label: "Todos os vendedores" }];
      setSellerOptions(opts);
      setCommissionSellerId((current) => {
        if (current !== "all") return current;
        const needle = (personName || supplierName).trim().toLowerCase();
        if (!needle) return current;
        const match = opts.find(
          (o) =>
            o.value !== "all" &&
            (o.label.toLowerCase().includes(needle) ||
              needle.includes(o.label.toLowerCase().slice(0, 12)))
        );
        return match?.value ?? current;
      });
    } catch {
      /* opções opcionais */
    }
  }, [buildCommissionQuery, personName, supplierName]);

  useEffect(() => {
    if (!open) return;
    void loadSellerOptions();
  }, [open, commissionYear, commissionMonths, loadSellerOptions]);

  const searchCommissions = async () => {
    if (commissionSellerId === "all") {
      setError("Selecione um vendedor na lista (igual a Comissões → Relatórios).");
      return;
    }
    setSearchingCommission(true);
    setError(null);
    setMessage(null);
    try {
      const q = buildCommissionQuery();
      const data = await fetchJsonOk<ServiceTerminationCommissionSearchResult & { ok: boolean }>(
        `/api/suppliers/service-terminations/commission-reports/search?${q}`
      );
      if (data.sellerOptions?.length) setSellerOptions(data.sellerOptions);
      setCommissionRecords(data.records ?? []);
      setCommissionSummary({
        totalCommission: data.summary?.totalCommission ?? 0,
        recordCount: data.summary?.recordCount ?? 0,
      });
      setSelectedLineKeys(new Set());
      if (!(data.records ?? []).length) {
        setMessage(
          "Nenhum relatório de comissão encontrado para este vendedor/período."
        );
      }
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Falha ao buscar comissões.");
      setCommissionRecords([]);
      setCommissionSummary(null);
    } finally {
      setSearchingCommission(false);
    }
  };

  const toLinkDto = (
    row: ServiceTerminationCommissionOrderRow
  ): ServiceTerminationCommissionLinkDto => ({
    commissionReportKey: row.lineKey,
    commissionPersonId: row.sellerId,
    commissionPersonName: row.sellerName,
    periodLabel: `${row.orderCode ? formatSalesOrderDisplayCode(row.orderCode) : "Sem pedido"} · ${String(row.month).padStart(2, "0")}/${row.year}`,
    commissionAmount: row.finalCommissionAmount,
    source: row.source || "COMMISSION_REPORTS",
    statusLabel: row.lineStatus,
    commissionsHref: row.commissionsHref,
  });

  const linkFromRecord = (row: ServiceTerminationCommissionOrderRow) => {
    setLinks((prev) => {
      if (prev.some((l) => l.commissionReportKey === row.lineKey)) return prev;
      return [...prev, toLinkDto(row)];
    });
  };

  const linkSelectedRecords = () => {
    const rows = commissionRecords.filter((r) => selectedLineKeys.has(r.lineKey));
    setLinks((prev) => {
      const existing = new Set(prev.map((l) => l.commissionReportKey));
      const add = rows.filter((r) => !existing.has(r.lineKey)).map(toLinkDto);
      return add.length ? [...prev, ...add] : prev;
    });
    setSelectedLineKeys(new Set());
  };

  const linkAllListed = () => {
    setLinks((prev) => {
      const existing = new Set(prev.map((l) => l.commissionReportKey));
      const add = commissionRecords
        .filter((r) => !existing.has(r.lineKey))
        .map(toLinkDto);
      return add.length ? [...prev, ...add] : prev;
    });
    setSelectedLineKeys(new Set());
  };

  const saveDraft = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      if (savedId) {
        const data = await fetchJsonOk<{ ok: boolean; item: ServiceTerminationDto }>(
          `/api/suppliers/${supplierId}/service-terminations/${savedId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBody()),
          }
        );
        setStatus(data.item.status);
        setMessage("Encerramento atualizado.");
      } else {
        const data = await fetchJsonOk<{ ok: boolean; item: ServiceTerminationDto }>(
          `/api/suppliers/${supplierId}/service-terminations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBody()),
          }
        );
        setSavedId(data.item.id);
        setStatus(data.item.status);
        setMessage("Prévia salva.");
      }
      void loadHistory();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    if (!canFinalize || !savedId) {
      setError("Salve a prévia antes de finalizar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ ok: boolean; item: ServiceTerminationDto }>(
        `/api/suppliers/${supplierId}/service-terminations/${savedId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      setStatus(data.item.status);
      setMessage("Encerramento finalizado (valores travados).");
      void loadHistory();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Falha ao finalizar.");
    } finally {
      setSaving(false);
    }
  };

  const download = async (kind: "pdf" | "xlsx") => {
    if (!savedId || !canExport) {
      setError("Salve o encerramento antes de exportar.");
      return;
    }
    try {
      const res = await fetch(
        `/api/suppliers/${supplierId}/service-terminations/${savedId}/${kind}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Erro ao gerar ${kind.toUpperCase()}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `encerramento-prestacao.${kind === "pdf" ? "pdf" : "xlsx"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na exportação.");
    }
  };

  const copySummary = async () => {
    const text = [
      `Encerramento de Prestação de Serviço — ${supplierName}`,
      `Prestador: ${personName}`,
      `Período: ${contractStartDate} a ${contractEndDate}`,
      `Descanso proporcional: ${formatProportionalRestDaysLabel(calc.proportionalRestDays)} dias · ${money(calc.proportionalRestAmount)}`,
      `Comissão vinculada: ${money(calc.commissionReportTotal)}`,
      `Total a pagar: ${money(calc.totalTerminationAmount)}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Resumo copiado.");
    } catch {
      setError("Não foi possível copiar o resumo.");
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3"
      data-testid="supplier-service-termination-dialog"
    >
      <div
        className={cn(
          financeBiCardClass,
          "flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl"
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Encerramento de Prestação de Serviço
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Fornecedor · Prestador · Período — cálculo gerencial/contratual (não é rescisão CLT)
            </p>
            <p className="text-sm font-medium mt-1">{supplierName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {message}
            </div>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              1. Dados do prestador
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold text-muted-foreground">Nome da pessoa</span>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  disabled={status === "FINALIZED"}
                  data-testid="sst-person-name"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Documento</span>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={personDocument}
                  onChange={(e) => setPersonDocument(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Função / serviço</span>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={serviceRole}
                  onChange={(e) => setServiceRole(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Data início</span>
                <input
                  type="date"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={contractStartDate}
                  onChange={(e) => setContractStartDate(e.target.value)}
                  disabled={status === "FINALIZED"}
                  data-testid="sst-start-date"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Data fim</span>
                <input
                  type="date"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={contractEndDate}
                  onChange={(e) => setContractEndDate(e.target.value)}
                  disabled={status === "FINALIZED"}
                  data-testid="sst-end-date"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold text-muted-foreground">Observações</span>
                <textarea
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              2. Dados financeiros
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Valor mensal</span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={monthlyServiceAmount}
                  onChange={(e) => setMonthlyServiceAmount(e.target.value)}
                  disabled={status === "FINALIZED"}
                  data-testid="sst-monthly-amount"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Horas por mês</span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={monthlyHours}
                  onChange={(e) => setMonthlyHours(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  Descanso dias/ano
                </span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={restDaysPerYear}
                  onChange={(e) => setRestDaysPerYear(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Modo de cálculo</span>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={calculationMode}
                  onChange={(e) =>
                    setCalculationMode(e.target.value as ServiceTerminationCalcModeDto)
                  }
                  disabled={status === "FINALIZED"}
                >
                  <option value="WORKED_MONTHS">Por meses trabalhados</option>
                  <option value="WORKED_DAYS">Por dias corridos</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  Meses trabalhados (opcional)
                </span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={workedMonths}
                  onChange={(e) => setWorkedMonths(e.target.value)}
                  placeholder="Auto pelas datas"
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  Dias trabalhados (opcional)
                </span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={workedDays}
                  onChange={(e) => setWorkedDays(e.target.value)}
                  placeholder="Auto pelas datas"
                  disabled={status === "FINALIZED"}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Valor hora" value={money(calc.hourlyServiceAmount)} />
              <Stat label="Valor dia" value={money(calc.dailyServiceAmount)} />
              <Stat
                label="Meses (calc.)"
                value={String(calc.workedMonths)}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              3. Descanso remunerado contratual
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Meses trabalhados" value={String(calc.workedMonths)} />
              <Stat label="Dias trabalhados" value={String(calc.workedDays)} />
              <Stat label="Descanso anual" value={`${calc.restDaysPerYear} dias`} />
              <Stat
                label="Dias proporcionais"
                value={`${formatProportionalRestDaysLabel(calc.proportionalRestDays)} dias`}
                emphasize
              />
              <Stat label="Valor do dia" value={money(calc.dailyServiceAmount)} />
              <Stat
                label="Valor descanso proporcional"
                value={money(calc.proportionalRestAmount)}
                emphasize
              />
            </div>
          </section>

          <section className="space-y-3" data-testid="service-termination-commissions">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              4. Comissões vinculadas (somente leitura)
            </h3>
            <p className="text-xs text-muted-foreground">
              Mesma fonte de Comissões → Relatórios. Selecione vendedor e período, busque os
              pedidos/comissões devidas e vincule. Não recalcula comissão neste módulo.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1">
                <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Ano</span>
                <select
                  className={COMMISSIONS_FILTER_FIELD_CLASS}
                  value={commissionYear}
                  disabled={status === "FINALIZED"}
                  onChange={(e) => setCommissionYear(e.target.value)}
                  aria-label="Ano das comissões"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
              <CommissionsMonthsMultiSelect
                value={commissionMonths}
                disabled={status === "FINALIZED"}
                onChange={setCommissionMonths}
              />
              <label className="space-y-1 sm:col-span-2 lg:col-span-1">
                <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Vendedor</span>
                <select
                  className={COMMISSIONS_FILTER_FIELD_CLASS}
                  value={commissionSellerId}
                  disabled={status === "FINALIZED"}
                  onChange={(e) => setCommissionSellerId(e.target.value)}
                  aria-label="Vendedor"
                  data-testid="service-termination-commission-seller"
                >
                  {sellerOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2 lg:col-span-1">
                <span className={COMMISSIONS_FILTER_LABEL_CLASS}>Busca (opcional)</span>
                <input
                  className={COMMISSIONS_FILTER_FIELD_CLASS}
                  placeholder="Cliente, pedido, NF-e…"
                  value={commissionSearch}
                  onChange={(e) => setCommissionSearch(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold"
                onClick={() => void searchCommissions()}
                disabled={searchingCommission || status === "FINALIZED"}
                data-testid="service-termination-commission-search"
              >
                {searchingCommission ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Buscar relatório
              </button>
              {commissionRecords.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold text-primary"
                    onClick={linkSelectedRecords}
                    disabled={status === "FINALIZED" || selectedLineKeys.size === 0}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Vincular selecionadas ({selectedLineKeys.size})
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
                    onClick={linkAllListed}
                    disabled={status === "FINALIZED"}
                  >
                    Vincular todas listadas
                  </button>
                </>
              ) : null}
              {commissionSummary ? (
                <span className="text-xs text-muted-foreground">
                  {commissionSummary.recordCount} registro(s) · comissão devida{" "}
                  <strong className="text-foreground tabular-nums">
                    {money(commissionSummary.totalCommission)}
                  </strong>
                </span>
              ) : null}
            </div>
            {commissionRecords.length > 0 ? (
              <div className="max-h-72 overflow-auto rounded-lg border">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/80 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 w-8" />
                      <th className="px-2 py-2">Mês</th>
                      <th className="px-2 py-2">Pedido</th>
                      <th className="px-2 py-2">Cliente</th>
                      <th className="px-2 py-2">NF-e</th>
                      <th className="px-2 py-2">Recebido</th>
                      <th className="px-2 py-2">Base</th>
                      <th className="px-2 py-2">Comissão devida</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {commissionRecords.map((row) => {
                      const linked = links.some(
                        (l) => l.commissionReportKey === row.lineKey
                      );
                      return (
                        <tr key={row.lineKey} className="hover:bg-muted/30">
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={selectedLineKeys.has(row.lineKey)}
                              disabled={status === "FINALIZED" || linked}
                              onChange={(e) => {
                                setSelectedLineKeys((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(row.lineKey);
                                  else next.delete(row.lineKey);
                                  return next;
                                });
                              }}
                              aria-label={`Solicitar ${row.orderCode ?? row.lineKey}`}
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {String(row.month).padStart(2, "0")}/{row.year}
                          </td>
                          <td className="px-2 py-1.5 font-medium">
                            {row.orderCode
                              ? formatSalesOrderDisplayCode(row.orderCode)
                              : "—"}
                          </td>
                          <td className="max-w-[10rem] truncate px-2 py-1.5" title={row.customerName ?? undefined}>
                            {row.customerName ?? "—"}
                          </td>
                          <td className="px-2 py-1.5">{row.nfeNumber ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                            {money(row.receivedAmount)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                            {money(row.commissionableBaseAmount)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-semibold tabular-nums text-primary">
                            {money(row.finalCommissionAmount)}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className="block truncate" title={row.statusReason ?? undefined}>
                              {row.lineStatus}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-40"
                              onClick={() => linkFromRecord(row)}
                              disabled={status === "FINALIZED" || linked}
                            >
                              <Link2 className="h-3 w-3" />
                              {linked ? "Vinculada" : "Vincular"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {links.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {links.map((l) => (
                  <li
                    key={l.commissionReportKey}
                    className="flex items-center justify-between gap-2 rounded border px-2 py-1"
                  >
                    <span>
                      {l.periodLabel} · {l.commissionPersonName} · {money(l.commissionAmount)}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-red-700"
                      disabled={status === "FINALIZED"}
                      onClick={() =>
                        setLinks((prev) =>
                          prev.filter((x) => x.commissionReportKey !== l.commissionReportKey)
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              5. Ajustes manuais
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Outros créditos</span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={otherCredits}
                  onChange={(e) => setOtherCredits(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground">Outros descontos</span>
                <input
                  type="number"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={otherDiscounts}
                  onChange={(e) => setOtherDiscounts(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Observação do ajuste
                </span>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={adjustmentNotes}
                  onChange={(e) => setAdjustmentNotes(e.target.value)}
                  disabled={status === "FINALIZED"}
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              6. Resumo final
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Descanso proporcional" value={money(calc.proportionalRestAmount)} />
              <Stat label="Comissão vinculada" value={money(calc.commissionReportTotal)} />
              <Stat label="Outros créditos" value={money(calc.otherCredits)} />
              <Stat label="Outros descontos" value={money(calc.otherDiscounts)} />
              <Stat label="Status" value={status} />
              <Stat
                label="Total a pagar"
                value={money(calc.totalTerminationAmount)}
                emphasize
              />
            </div>
          </section>

          {history.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Histórico deste fornecedor
              </h3>
              <ul className="text-xs space-y-1">
                {history.slice(0, 8).map((h) => (
                  <li key={h.id} className="flex justify-between gap-2 border-b py-1">
                    <span>
                      {h.personName} · {h.contractStartDate}→{h.contractEndDate} · {h.status}
                    </span>
                    <span className="tabular-nums font-semibold">
                      {money(h.totalTerminationAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            className="rounded-lg border px-3 py-2 text-sm"
            onClick={() => void copySummary()}
          >
            Copiar resumo
          </button>
          {canExport ? (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
                onClick={() => void download("pdf")}
              >
                <FileDown className="h-4 w-4" />
                Gerar PDF
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
                onClick={() => void download("xlsx")}
              >
                Exportar XLSX
              </button>
            </>
          ) : null}
          {canCreate && status !== "FINALIZED" ? (
            <button
              type="button"
              data-testid="sst-save-draft"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={saving}
              onClick={() => void saveDraft()}
            >
              {saving ? "Salvando…" : "Salvar prévia"}
            </button>
          ) : null}
          {canFinalize && status !== "FINALIZED" ? (
            <button
              type="button"
              data-testid="sst-finalize"
              className="rounded-lg border border-amber-600 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
              disabled={saving || !savedId}
              onClick={() => void finalize()}
            >
              Finalizar encerramento
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    portal
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        emphasize ? "border-primary/40 bg-primary/5" : "bg-muted/30"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
