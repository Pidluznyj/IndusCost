/**
 * Painel agregador de status da Engenharia Nomus.
 *
 * Separa claramente:
 *  - Cadastro mestre / Igualar bases (diagnóstico existente);
 *  - BOM / auto apply ProductBOM (relatório oficial da rotina sync:nomus:all:apply).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Database,
  Layers,
  Loader2,
  PackagePlus,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchMasterDataImportDiagnostic } from "@/src/lib/nomusMasterDataImportClient";
import { fetchMasterDataEqualizePreview } from "@/src/lib/nomusMasterDataEqualizeClient";
import {
  fetchEngineeringRunsRecent,
  type EngineeringRunRecentItem,
} from "@/src/lib/nomusEngineeringRunsRecentClient";
import { fetchNomusAutoApplyBomDashboard } from "@/src/lib/nomusAutoApplyBomDashboardClient";
import {
  filterDashboardProducts,
  sortDashboardProducts,
  type AutoApplyBlockBucketFilter,
} from "@/src/lib/nomusAutoApplyBomDashboardShared";
import type {
  AutoApplyBomDashboardProductRow,
  AutoApplyBomDashboardResult,
  AutoApplyDashboardFilter,
} from "@/src/lib/nomusAutoApplyBomDashboardTypes";
import type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { MasterDataImportDiagnosticResult } from "@/src/lib/nomusMasterDataImportTypes";
import type { EqualizePreviewResult } from "@/src/lib/nomusMasterDataEqualizeTypes";

type StatusSnapshot = {
  masterData: MasterDataImportDiagnosticResult | null;
  equalize: EqualizePreviewResult | null;
  autoApply: AutoApplyBomDashboardResult | null;
  runs: EngineeringRunRecentItem[];
  generatedAt: string;
};

const FILTER_OPTIONS: Array<{ value: AutoApplyDashboardFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "BLOCKED", label: "Bloqueados" },
  { value: "DIVERGENT", label: "Divergentes" },
  { value: "OPTIONAL_PENDING", label: "Opcionais pendentes" },
  { value: "LOCAL_PENDING", label: "Itens locais pendentes" },
  { value: "SKIPPED", label: "Ignorados" },
  { value: "NO_CHANGES", label: "Sem alteração" },
  { value: "APPLIED", label: "Aplicados" },
  { value: "ERROR", label: "Erros" },
];

const PAGE_SIZE = 50;

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function pickLastByOrigin(
  runs: EngineeringRunRecentItem[],
  origins: string[]
): EngineeringRunRecentItem | null {
  return runs.find((r) => r.origin != null && origins.includes(r.origin)) ?? null;
}

function statusBadgeClass(status: AutoApplyBomDashboardProductRow["status"]): string {
  switch (status) {
    case "BLOCKED":
      return "bg-red-100 text-red-900";
    case "ERROR":
      return "bg-red-200 text-red-950";
    case "SKIPPED":
      return "bg-amber-100 text-amber-900";
    case "APPLIED":
      return "bg-emerald-100 text-emerald-900";
    case "NO_CHANGES":
      return "bg-sky-100 text-sky-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function statusLabel(status: AutoApplyBomDashboardProductRow["status"]): string {
  switch (status) {
    case "BLOCKED":
      return "Bloqueado";
    case "ERROR":
      return "Erro";
    case "SKIPPED":
      return "Ignorado";
    case "APPLIED":
      return "Aplicado";
    case "NO_CHANGES":
      return "Sem alteração";
    default:
      return status;
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

export const NomusEngineeringStatusBoard: React.FC<{
  disabled?: boolean;
  onOpenProduct?: (parentCode: string, options?: { tab?: NomusMaintenanceTab }) => void;
}> = ({ disabled = false, onOpenProduct }) => {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AutoApplyDashboardFilter>("ALL");
  const [blockBucket, setBlockBucket] = useState<AutoApplyBlockBucketFilter>("ALL");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"product" | "severity">("severity");
  const [page, setPage] = useState(0);
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

  const debouncedSearch = useDebouncedValue(search, 300);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [masterData, equalize, autoApply, runs] = await Promise.all([
        fetchMasterDataImportDiagnostic({ limit: 1, includeExisting: true }).catch(() => null),
        fetchMasterDataEqualizePreview({ limit: 1, scope: "ACTIONABLE" }).catch(() => null),
        fetchNomusAutoApplyBomDashboard({ revalidate: true }).catch(() => null),
        fetchEngineeringRunsRecent(30).catch(() => ({
          mode: "READ_ONLY" as const,
          generatedAt: new Date().toISOString(),
          items: [],
        })),
      ]);
      setSnapshot({
        masterData,
        equalize,
        autoApply,
        runs: runs?.items ?? [],
        generatedAt: new Date().toISOString(),
      });
      setPage(0);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Tente novamente em alguns segundos.`
          : "Erro ao carregar visão geral da engenharia."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
  }, [filter, blockBucket, debouncedSearch, sortBy]);

  const md = snapshot?.masterData ?? null;
  const eq = snapshot?.equalize ?? null;
  const autoApply = snapshot?.autoApply ?? null;
  const totals = autoApply?.totals ?? null;
  const allProducts = autoApply?.products ?? [];

  const filteredProducts = useMemo(() => {
    const filtered = filterDashboardProducts(allProducts, {
      filter,
      search: debouncedSearch,
      blockBucket,
    });
    return sortDashboardProducts(filtered, sortBy);
  }, [allProducts, filter, debouncedSearch, blockBucket, sortBy]);

  const pagedProducts = useMemo(() => {
    const start = page * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, page]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));

  const lastEqualize = snapshot ? pickLastByOrigin(snapshot.runs, ["MASTER_DATA_EQUALIZE"]) : null;
  const lastAutoApply = snapshot ? pickLastByOrigin(snapshot.runs, ["NOMUS_SYNC"]) : null;
  const lastManualBomApply = snapshot
    ? pickLastByOrigin(snapshot.runs, ["BOM_APPLY_AFTER_MASTER_DATA"])
    : null;
  const lastBackfill = snapshot
    ? pickLastByOrigin(snapshot.runs, ["MASTER_DATA_HISTORY_BACKFILL"])
    : null;

  const applyCardFilter = (next: AutoApplyDashboardFilter) => {
    setFilter(next);
    setBlockBucket("ALL");
  };

  const clearFilters = () => {
    setFilter("ALL");
    setBlockBucket("ALL");
    setSearch("");
    setPage(0);
  };

  const toggleExpanded = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const openProduct = (row: AutoApplyBomDashboardProductRow) => {
    onOpenProduct?.(row.parentCode, { tab: row.recommendedTab });
  };

  const cardDefs: Array<{
    filter: AutoApplyDashboardFilter;
    icon: React.ReactNode;
    tone: "neutral" | "info" | "warn" | "danger" | "success";
    label: string;
    value: number | string;
    hint: string;
  }> = [
    {
      filter: "ALL",
      icon: <Database className="h-3.5 w-3.5" />,
      tone: "neutral",
      label: "Produtos avaliados",
      value: totals?.parentsEvaluated ?? "—",
      hint: "Total na lista atual (revalidada quando aplicável).",
    },
    {
      filter: "NO_CHANGES",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      tone: "success",
      label: "Sem alteração",
      value: totals?.parentsNoChanges ?? "—",
      hint: "ProductBOM já alinhada com Nomus.",
    },
    {
      filter: "APPLIED",
      icon: <Wrench className="h-3.5 w-3.5" />,
      tone: "info",
      label: "Aplicados",
      value: totals?.parentsApplied ?? "—",
      hint: "Produtos com alteração aplicada.",
    },
    {
      filter: "BLOCKED",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      tone: "danger",
      label: "Bloqueados",
      value: totals?.parentsBlocked ?? "—",
      hint: "Pendências impedem apply automático.",
    },
    {
      filter: "SKIPPED",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      tone: "warn",
      label: "Ignorados",
      value: totals?.parentsSkipped ?? "—",
      hint: "Sem produto IndusCost ou fora do escopo.",
    },
    {
      filter: "ERROR",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      tone: "danger",
      label: "Erros",
      value: totals?.parentsErrored ?? "—",
      hint: "Falhas reais de processamento/preview (não bloqueios operacionais).",
    },
  ];

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Database className="h-5 w-5 mt-0.5 text-primary shrink-0" />
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground">
            Central Engenharia Nomus — fila operacional principal
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Comece pelos <strong>bloqueados</strong> abaixo. Ao atualizar, a lista e os{" "}
            <strong>cards</strong> usam a mesma base revalidada (preview read-only). Totais da
            última execução batch APPLY aparecem separados quando diferentes.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void loadAll()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Atualizar painel da engenharia
        </button>
        {snapshot ? (
          <span className="text-[10px] text-muted-foreground">
            Atualizado em {formatDateShort(snapshot.generatedAt)}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-900 flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {snapshot ? (
        <>
          <section className="space-y-2">
            <SectionTitle icon={<Scale className="h-3.5 w-3.5" />} title="Cadastro mestre / Igualar bases" />
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              <SummaryCard
                icon={<PackagePlus className="h-3.5 w-3.5" />}
                tone="warn"
                label="Cadastro mestre faltante"
                value={md?.totals.missingTotal ?? "—"}
                hint="Códigos sem Product/Material. Use Carga Mestre."
              />
              <SummaryCard
                icon={<Scale className="h-3.5 w-3.5" />}
                tone="info"
                label="Bases com divergência (cadastro)"
                value={
                  eq
                    ? eq.totals.updateProducts +
                      eq.totals.updateMaterials +
                      eq.totals.deactivateProducts +
                      eq.totals.deactivateMaterials
                    : "—"
                }
                hint="Produtos/materiais controlados para Igualar bases — não confundir com bloqueios de BOM."
              />
              <SummaryCard
                icon={<Database className="h-3.5 w-3.5" />}
                tone="neutral"
                label="Itens com histórico Nomus"
                value={md ? md.totals.existingProducts + md.totals.existingMaterials : "—"}
                hint="Já cadastrados como Nomus no IndusCost."
              />
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={<Layers className="h-3.5 w-3.5" />} title="BOM / ProductBOM × Nomus (auto apply)" />
            {!autoApply?.hasReport ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                {autoApply?.emptyMessage ?? "Nenhuma rotina de auto apply BOM executada ainda."}
              </div>
            ) : (
              <>
                {autoApply.lastRun ? (
                  <p className="text-[11px] text-muted-foreground">
                    Última execução batch: {formatDateShort(autoApply.lastRun.finishedAt)} · modo{" "}
                    <code className="font-mono">{autoApply.lastRun.mode}</code> · por{" "}
                    {autoApply.lastRun.approvedBy}
                    {autoApply.lastRun.batchRunId ? (
                      <> · batch <code className="font-mono">{autoApply.lastRun.batchRunId.slice(0, 8)}…</code></>
                    ) : null}
                    {autoApply.source === "REPORT_FILE" ? " · relatório JSON" : " · run batch (fallback)"}
                    {autoApply.productListSource ? (
                      <> · lista em <code className="font-mono">{autoApply.productListSource}</code></>
                    ) : null}
                  </p>
                ) : null}

                {autoApply.statusRevalidatedAt ? (
                  <p className="text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    Lista revalidada em {formatDateShort(autoApply.statusRevalidatedAt)} (preview read-only,{" "}
                    {autoApply.revalidatedProductCount} produto(s)). Não altera ProductBOM.
                  </p>
                ) : null}

                {autoApply.batchTotalsNote ? (
                  <p className="text-[11px] text-muted-foreground">{autoApply.batchTotalsNote}</p>
                ) : null}

                {autoApply.batchTotals ? (
                  <p className="text-[10px] text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2">
                    <span className="font-semibold">Totais da última execução batch APPLY:</span>{" "}
                    avaliados {autoApply.batchTotals.parentsEvaluated}, sem alteração{" "}
                    {autoApply.batchTotals.parentsNoChanges}, aplicados {autoApply.batchTotals.parentsApplied},
                    bloqueados {autoApply.batchTotals.parentsBlocked}, ignorados{" "}
                    {autoApply.batchTotals.parentsSkipped}, erros {autoApply.batchTotals.parentsErrored}.
                  </p>
                ) : null}

                {autoApply.partialReportWarning ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950 space-y-2">
                    <p>{autoApply.partialReportWarning}</p>
                    {autoApply.regenerateReportCommand ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-amber-100 px-2 py-1 font-mono text-[10px]">
                          {autoApply.regenerateReportCommand}
                        </code>
                        <button
                          type="button"
                          onClick={() => void copyText(autoApply.regenerateReportCommand ?? "")}
                          className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-[10px] font-semibold hover:bg-amber-100"
                        >
                          <ClipboardCopy className="h-3 w-3" />
                          Copiar comando
                        </button>
                      </div>
                    ) : null}
                    <p className="text-[10px]">
                      Os cards refletem os totais da última rotina, mas a lista operacional só fica
                      disponível após regenerar o relatório completo.
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {cardDefs.map((card) => (
                    <SummaryCard
                      key={card.filter}
                      icon={card.icon}
                      tone={card.tone}
                      label={card.label}
                      value={card.value}
                      hint={
                        autoApply.hasProductList
                          ? card.hint
                          : `${card.hint} (filtro disponível após regenerar relatório)`
                      }
                      active={autoApply.hasProductList && filter === card.filter}
                      onClick={
                        autoApply.hasProductList ? () => applyCardFilter(card.filter) : undefined
                      }
                    />
                  ))}
                </div>

                {autoApply.checklistMdPath ? (
                  <p className="text-[10px] text-muted-foreground">
                    Checklist operacional gerado:{" "}
                    <code className="font-mono">docs/generated/nomus-engineering-validation-checklist.md</code>
                  </p>
                ) : null}

                {autoApply.hasProductList && autoApply.blockingReasonBuckets.length > 0 ? (
                  <div className="rounded-lg border border-border bg-card p-2.5 space-y-1.5">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">
                      Tipos de bloqueio (clique para filtrar)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {autoApply.blockingReasonBuckets.map((b) => (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() => {
                            setFilter("BLOCKED");
                            setBlockBucket(b.key as AutoApplyBlockBucketFilter);
                            setPage(0);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                            blockBucket === b.key
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-muted/40 hover:bg-muted"
                          )}
                        >
                          {b.label}
                          <span className="tabular-nums font-bold">{b.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {autoApply.hasProductList ? (
                <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Filtrar produtos
                      <select
                        value={filter}
                        disabled={disabled || loading}
                        onChange={(e) => setFilter(e.target.value as AutoApplyDashboardFilter)}
                        className="mt-1 block h-8 w-full min-w-[160px] rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {FILTER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground flex-1 min-w-[200px]">
                      Buscar produto, componente ou motivo
                      <div className="relative mt-1">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={search}
                          disabled={disabled || loading}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Ex.: 308.05, 115.01--, itens locais"
                          className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs"
                        />
                      </div>
                    </label>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Ordenar
                      <select
                        value={sortBy}
                        disabled={disabled || loading}
                        onChange={(e) => setSortBy(e.target.value as "product" | "severity")}
                        className="mt-1 block h-8 w-full min-w-[140px] rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="severity">Criticidade</option>
                        <option value="product">Produto (A–Z)</option>
                      </select>
                    </label>
                    {(filter !== "ALL" || blockBucket !== "ALL" || search.trim()) ? (
                      <button
                        type="button"
                        disabled={disabled || loading}
                        onClick={clearFilters}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-xs font-semibold hover:bg-muted"
                      >
                        <X className="h-3 w-3" />
                        Limpar filtros
                      </button>
                    ) : null}
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Exibindo {filteredProducts.length === 0 ? 0 : page * PAGE_SIZE + 1}–
                    {Math.min((page + 1) * PAGE_SIZE, filteredProducts.length)} de{" "}
                    {filteredProducts.length} produto(s) neste filtro
                    {autoApply.totalProducts > 0 ? ` (total no relatório: ${autoApply.totalProducts})` : ""}.
                  </p>

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-2 py-1.5 w-6" />
                          <th className="px-2 py-1.5 font-semibold">Produto</th>
                          <th className="px-2 py-1.5 font-semibold">Status</th>
                          <th className="px-2 py-1.5 font-semibold">Tipo pendência</th>
                          <th className="px-2 py-1.5 font-semibold">Motivo principal</th>
                          <th className="px-2 py-1.5 font-semibold">Ações</th>
                          <th className="px-2 py-1.5 font-semibold">Recomendação</th>
                          <th className="px-2 py-1.5 font-semibold text-right">Abrir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProducts.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-2 py-3 text-muted-foreground italic">
                              {autoApply.hasProductList
                                ? "Nenhum produto encontrado para este filtro."
                                : "Lista de produtos indisponível no relatório atual."}
                            </td>
                          </tr>
                        ) : (
                          pagedProducts.map((row) => {
                            const expanded = expandedCodes.has(row.parentCode);
                            return (
                              <React.Fragment key={row.parentCode}>
                                <tr className="border-t border-border/70 align-top">
                                  <td className="px-1 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() => toggleExpanded(row.parentCode)}
                                      className="rounded p-0.5 hover:bg-muted"
                                      aria-label={expanded ? "Recolher detalhes" : "Expandir detalhes"}
                                    >
                                      {expanded ? (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => openProduct(row)}
                                        className="font-mono font-semibold text-primary hover:underline"
                                      >
                                        {row.parentCode}
                                      </button>
                                      <button
                                        type="button"
                                        title="Copiar código"
                                        onClick={() => void copyText(row.parentCode)}
                                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                      >
                                        <ClipboardCopy className="h-3 w-3" />
                                      </button>
                                      {(row.status === "BLOCKED" || row.status === "ERROR") && (
                                        <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold uppercase text-red-800">
                                          Ação
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <span
                                      className={cn(
                                        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                                        statusBadgeClass(row.status)
                                      )}
                                    >
                                      {statusLabel(row.status)}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    {row.pendingTypeLabel}
                                  </td>
                                  <td className="px-2 py-1.5 max-w-[240px]">
                                    <span className="line-clamp-2">{row.primaryReason}</span>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <span className="font-semibold tabular-nums">{row.actionsCount}</span>
                                    {row.actionsSummaryLines.length > 0 ? (
                                      <span className="text-muted-foreground">
                                        {" "}
                                        · {row.actionsSummaryLines.slice(0, 2).join(" · ")}
                                        {row.actionsSummaryLines.length > 2 ? "…" : ""}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1.5 max-w-[220px]">
                                    <span className="line-clamp-2 text-[10px]">{row.recommendedAction}</span>
                                  </td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                    {onOpenProduct ? (
                                      <button
                                        type="button"
                                        onClick={() => openProduct(row)}
                                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/10"
                                      >
                                        Abrir ajuste
                                        <ArrowRight className="h-3 w-3" />
                                      </button>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                                {expanded ? (
                                  <tr className="border-t border-border/40 bg-muted/20">
                                    <td colSpan={8} className="px-3 py-2 space-y-2">
                                      {row.blockingReasons.length > 0 ? (
                                        <div>
                                          <p className="text-[10px] font-bold uppercase text-muted-foreground">
                                            Motivos de bloqueio
                                          </p>
                                          <ul className="list-disc pl-4 text-[11px]">
                                            {row.blockingReasons.map((r) => (
                                              <li key={r}>{r}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : null}
                                      {row.actionsPreview && row.actionsPreview.length > 0 ? (
                                        <div>
                                          <p className="text-[10px] font-bold uppercase text-muted-foreground">
                                            Ações previstas
                                          </p>
                                          <ul className="text-[11px] font-mono space-y-0.5">
                                            {row.actionsPreview.map((action, idx) => (
                                              <li key={`${action.componentCode}-${idx}`}>
                                                <strong>{action.actionType}</strong> {action.componentCode}
                                                {action.currentQuantity != null || action.effectiveQuantity != null
                                                  ? ` · ${action.currentQuantity ?? "—"} → ${action.effectiveQuantity ?? "—"}`
                                                  : ""}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : null}
                                      {row.localOnlyLineCodes.length > 0 ? (
                                        <p className="text-[11px]">
                                          Itens locais:{" "}
                                          <code className="font-mono">{row.localOnlyLineCodes.join(", ")}</code>
                                        </p>
                                      ) : null}
                                      {row.errorMessage ? (
                                        <p className="text-[11px] text-red-800">{row.errorMessage}</p>
                                      ) : null}
                                    </td>
                                  </tr>
                                ) : null}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {filteredProducts.length > PAGE_SIZE ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground">
                        Página {page + 1} de {totalPages}
                      </p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={page <= 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          className="rounded border border-input px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          disabled={page >= totalPages - 1}
                          onClick={() => setPage((p) => p + 1)}
                          className="rounded border border-input px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                ) : null}
              </>
            )}
          </section>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <LastRunCard
              title="Última Igualar bases"
              run={lastEqualize}
              emptyText="Ainda não há registro de Igualar bases."
              tone="info"
            />
            <LastRunCard
              title="Último auto apply BOM (batch)"
              run={lastAutoApply}
              emptyText="Ainda não há registro de auto apply BOM em lote."
              tone="success"
            />
            <LastRunCard
              title="Última aplicação BOM manual"
              run={lastManualBomApply}
              emptyText="Ainda não há registro de Aplicar BOM por produto."
              tone="neutral"
            />
            <LastRunCard
              title="Último backfill de histórico"
              run={lastBackfill}
              emptyText="Ainda não há registro de backfill."
              tone="neutral"
            />
          </div>
        </>
      ) : null}

      {!snapshot && !loading && !error ? (
        <p className="text-[11px] text-muted-foreground italic">
          Clique em <strong>Atualizar painel da engenharia</strong> para carregar Cadastro mestre e o
          relatório de auto apply BOM.
        </p>
      ) : null}
    </div>
  );
};

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <h4 className="text-xs font-bold uppercase tracking-wide text-foreground flex items-center gap-1.5">
    {icon}
    {title}
  </h4>
);

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  tone: "neutral" | "info" | "warn" | "danger" | "success";
  label: string;
  value: number | string;
  hint: string;
  active?: boolean;
  onClick?: () => void;
}> = ({ icon, tone, label, value, hint, active = false, onClick }) => {
  const toneClass =
    tone === "danger"
      ? "border-red-300 bg-red-50 text-red-900"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : tone === "info"
          ? "border-sky-300 bg-sky-50 text-sky-900"
          : tone === "success"
            ? "border-emerald-300 bg-emerald-50 text-emerald-900"
            : "border-border bg-card text-foreground";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-xl border p-2.5 text-left transition-all",
        toneClass,
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/30",
        active && "ring-2 ring-primary shadow-sm"
      )}
    >
      <p className="text-[10px] uppercase font-semibold opacity-80 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      <p className="text-[10px] opacity-80 mt-0.5 leading-tight">{hint}</p>
    </Tag>
  );
};

const LastRunCard: React.FC<{
  title: string;
  run: EngineeringRunRecentItem | null;
  emptyText: string;
  tone: "info" | "success" | "neutral";
}> = ({ title, run, emptyText, tone }) => {
  const toneClass =
    tone === "info"
      ? "border-sky-200 bg-sky-50"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50"
        : "border-border bg-card";
  return (
    <div className={cn("rounded-xl border p-2.5 text-xs space-y-0.5", toneClass)}>
      <p className="text-[10px] uppercase font-bold text-muted-foreground">{title}</p>
      {run ? (
        <>
          <p className="font-semibold">{run.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatDateShort(run.finishedAt ?? run.createdAt)} · status{" "}
            <code className="font-mono">{run.status}</code>
          </p>
          {run.approvedBy ? (
            <p className="text-[10px] text-muted-foreground">por {run.approvedBy}</p>
          ) : null}
        </>
      ) : (
        <p className="italic text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
};
