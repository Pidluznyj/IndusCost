import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import type {
  FinanceSupplierSearchResult,
  SupplierCostCenterRuleDto,
  SupplierCostCenterRulePreviewPayload,
} from "@/src/lib/financeSupplierCostCenterRules";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  FinanceCostCenterGridActiveFilters,
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridSummary,
  FinanceCostCenterGridTableShell,
  FinanceCostCenterSortableTh,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  buildFinanceGridEmptyState,
  clampFinanceGridPage,
  DEFAULT_RULE_GRID_SORT,
  paginateFinanceGridRows,
  prepareRuleGridRows,
  readFinanceGridUrlInt,
  readFinanceGridUrlSort,
  readFinanceGridUrlString,
  RULE_GRID_SORT_ACCESSORS,
  toggleSortState,
  writeFinanceGridUrlParams,
  type RuleGridSortKey,
} from "@/src/lib/financeCostCenterGridKit";
import { getSortDefaultDirection } from "@/src/lib/soldProductsTableSort";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";

type Props = {
  canManage: boolean;
};

const PERCENTAGE_TOLERANCE = 0.01;

function formatSupplierMeta(supplier: FinanceSupplierSearchResult): string {
  const parts: string[] = [];
  if (supplier.document) parts.push(supplier.document);
  parts.push(`${formatFinanceInteger(supplier.titlesCount)} título(s)`);
  if (supplier.lastTitleDate) {
    parts.push(`último ${new Date(supplier.lastTitleDate).toLocaleDateString("pt-BR")}`);
  }
  if (supplier.externalCode) parts.push(`código ${supplier.externalCode}`);
  return parts.join(" · ");
}

export function FinanceSupplierRulesTab({ canManage }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rules, setRules] = useState<SupplierCostCenterRuleDto[]>([]);
  const [centers, setCenters] = useState<FinanceCostCenterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SupplierCostCenterRulePreviewPayload | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [lines, setLines] = useState([{ costCenterId: "", percentage: "100" }]);
  const [saving, setSaving] = useState(false);

  // Autocomplete de fornecedor
  const [selectedSupplier, setSelectedSupplier] = useState<FinanceSupplierSearchResult | null>(null);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<FinanceSupplierSearchResult[]>([]);
  const [supplierSearching, setSupplierSearching] = useState(false);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const searchSeq = useRef(0);

  const search = readFinanceGridUrlString(searchParams, "rule_q");
  const statusFilter = (readFinanceGridUrlString(searchParams, "rule_status", "all") ||
    "all") as "all" | "active" | "inactive";
  const costCenterFilter = readFinanceGridUrlString(searchParams, "rule_cc");
  const sort = readFinanceGridUrlSort(
    searchParams,
    "rule_sort",
    "rule_dir",
    ["supplier", "costCenter", "status", "percentage", "updatedAt"] as const,
    DEFAULT_RULE_GRID_SORT
  );
  const page = readFinanceGridUrlInt(searchParams, "rule_page", 1);
  const pageSize = readFinanceGridUrlInt(searchParams, "rule_limit", 50, 1, 500);

  const patchUrl = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      setSearchParams(writeFinanceGridUrlParams(searchParams, patch), { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesPayload, centersPayload] = await Promise.all([
        fetchJsonOk<{ items: SupplierCostCenterRuleDto[] }>(
          "/api/finance/supplier-cost-center-rules",
          { credentials: "include" }
        ),
        fetchJsonOk<{ items: FinanceCostCenterDto[] }>("/api/finance/cost-centers", {
          credentials: "include",
        }),
      ]);
      setRules(rulesPayload.items);
      setCenters(centersPayload.items.filter((row) => row.status === "ACTIVE"));
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar regras de classificação.", e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Busca de fornecedores com debounce, somente com o modal aberto e sem fornecedor selecionado.
  useEffect(() => {
    if (!formOpen || selectedSupplier) return;
    const term = supplierQuery.trim();
    if (term.length < 2) {
      setSupplierResults([]);
      setSupplierSearching(false);
      return;
    }
    setSupplierSearching(true);
    const seq = ++searchSeq.current;
    const handle = window.setTimeout(async () => {
      try {
        const payload = await fetchJsonOk<{ suppliers: FinanceSupplierSearchResult[] }>(
          `/api/finance/supplier-cost-center-rules/suppliers/search?search=${encodeURIComponent(
            term
          )}&limit=20`,
          { credentials: "include" }
        );
        if (seq !== searchSeq.current) return;
        setSupplierResults(payload.suppliers);
        setSupplierDropdownOpen(true);
      } catch {
        if (seq !== searchSeq.current) return;
        setSupplierResults([]);
      } finally {
        if (seq === searchSeq.current) setSupplierSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [supplierQuery, formOpen, selectedSupplier]);

  const supplierById = useMemo(() => {
    const map = new Map<string, { name: string | null; document: string | null; found: boolean }>();
    for (const rule of rules) {
      map.set(rule.supplierId, {
        name: rule.supplierName ?? null,
        document: rule.supplierDocument ?? null,
        found: rule.supplierFound !== false && Boolean(rule.supplierName),
      });
    }
    return map;
  }, [rules]);

  const centerName = (id: string) => {
    const cc = centers.find((row) => row.id === id);
    return cc ? `${cc.code} — ${cc.name}` : id.slice(0, 8);
  };

  const gridRows = useMemo(
    () =>
      prepareRuleGridRows(
        rules.map((row) => ({
          id: row.id,
          supplierId: row.supplierId,
          supplierName: row.supplierName ?? null,
          supplierDocument: row.supplierDocument ?? null,
          costCenterId: row.costCenterId,
          costCenterLabel: centerName(row.costCenterId),
          percentage: row.percentage,
          autoApply: row.autoApply,
          isActive: row.isActive,
          updatedAt: row.updatedAt ?? null,
        })),
        { search, status: statusFilter, costCenterId: costCenterFilter },
        sort
      ),
    [rules, centers, search, statusFilter, costCenterFilter, sort]
  );

  const { pageRows, totalPages, total } = useMemo(() => {
    const paged = paginateFinanceGridRows(gridRows, { page, pageSize });
    return { ...paged, page: clampFinanceGridPage(page, paged.totalPages) };
  }, [gridRows, page, pageSize]);

  const hasActiveFilters =
    Boolean(search.trim()) || statusFilter !== "all" || Boolean(costCenterFilter);
  const emptyCopy = buildFinanceGridEmptyState(
    rules.length > 0,
    hasActiveFilters,
    {
      title: "Nenhuma regra cadastrada",
      description:
        "Crie uma regra 100% ou um rateio para classificar títulos automaticamente por fornecedor.",
    },
    {
      title: "Nenhuma regra no filtro",
      description: "Ajuste busca, status ou centro de custo para ver outras regras.",
    }
  );

  const handleSort = (key: RuleGridSortKey) => {
    const next = toggleSortState(sort, key, getSortDefaultDirection(RULE_GRID_SORT_ACCESSORS, key));
    patchUrl({ rule_sort: next.key, rule_dir: next.direction, rule_page: 1 });
  };

  const filterChips = [
    ...(statusFilter !== "all"
      ? [
          {
            key: "status",
            label: statusFilter === "active" ? "Ativas" : "Inativas",
            onRemove: () => patchUrl({ rule_status: null, rule_page: 1 }),
          },
        ]
      : []),
    ...(costCenterFilter
      ? [
          {
            key: "cc",
            label: `Centro: ${centerName(costCenterFilter)}`,
            onRemove: () => patchUrl({ rule_cc: null, rule_page: 1 }),
          },
        ]
      : []),
    ...(search.trim()
      ? [{ key: "q", label: `Busca: ${search.trim()}`, onRemove: () => patchUrl({ rule_q: null, rule_page: 1 }) }]
      : []),
  ];

  const totalPercentage = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.percentage) || 0), 0),
    [lines]
  );
  const percentageValid = Math.abs(totalPercentage - 100) <= PERCENTAGE_TOLERANCE;
  const allLinesHaveCenter = lines.every((line) => line.costCenterId.trim().length > 0);
  const canSubmit = Boolean(selectedSupplier) && percentageValid && allLinesHaveCenter;

  const openForm = () => {
    setSelectedSupplier(null);
    setSupplierQuery("");
    setSupplierResults([]);
    setLines([{ costCenterId: "", percentage: "100" }]);
    setPreview(null);
    setFormOpen(true);
  };

  const clearSupplier = () => {
    setSelectedSupplier(null);
    setSupplierQuery("");
    setSupplierResults([]);
    setSupplierDropdownOpen(false);
    setPreview(null);
  };

  const runPreview = async () => {
    if (!selectedSupplier) return;
    if (!percentageValid || !allLinesHaveCenter) {
      setError("Selecione os centros de custo e garanta que o rateio some 100% antes do preview.");
      return;
    }
    try {
      const payload = await fetchJsonOk<SupplierCostCenterRulePreviewPayload>(
        "/api/finance/supplier-cost-center-rules/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: selectedSupplier.id,
            rules: lines.map((line) => ({
              costCenterId: line.costCenterId,
              percentage: Number(line.percentage),
            })),
          }),
        }
      );
      setPreview(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível gerar o preview da regra.", e));
    }
  };

  const saveRules = async () => {
    if (!canManage || !selectedSupplier || !canSubmit) return;
    setSaving(true);
    try {
      await fetchJsonOk("/api/finance/supplier-cost-center-rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: selectedSupplier.id,
          replaceExisting: true,
          rules: lines.map((line) => ({
            costCenterId: line.costCenterId,
            percentage: Number(line.percentage),
          })),
        }),
      });
      setFormOpen(false);
      setPreview(null);
      clearSupplier();
      await load();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível salvar a regra.", e));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (id: string) => {
    if (!canManage) return;
    try {
      await fetchJsonOk(`/api/finance/supplier-cost-center-rules/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await load();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível desativar a regra.", e));
    }
  };

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-rules-tab">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Defina regras de 100% ou rateio por fornecedor. O preview mostra o impacto antes de salvar.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FinanceCostCenterGridSearchBar
            value={search}
            onChange={(value) => patchUrl({ rule_q: value || null, rule_page: 1 })}
            placeholder="Fornecedor ou centro"
            testId="finance-rules-search"
          />
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Status</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={statusFilter}
              onChange={(e) =>
                patchUrl({
                  rule_status: e.target.value === "all" ? null : e.target.value,
                  rule_page: 1,
                })
              }
            >
              <option value="all">Todas</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Centro</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={costCenterFilter}
              onChange={(e) => patchUrl({ rule_cc: e.target.value || null, rule_page: 1 })}
            >
              <option value="">Todos</option>
              {centers.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              data-testid="finance-rules-create-button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              onClick={openForm}
            >
              <Plus className="h-4 w-4" />
              Nova regra
            </button>
          ) : null}
        </div>
      </div>

      <FinanceCostCenterGridActiveFilters
        chips={filterChips}
        onClear={
          hasActiveFilters
            ? () => patchUrl({ rule_q: null, rule_status: null, rule_cc: null, rule_page: 1 })
            : undefined
        }
      />

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando regras…" /> : null}

      {!loading && gridRows.length === 0 ? (
        <FinanceModuleEmptyState title={emptyCopy.title} description={emptyCopy.description} />
      ) : null}

      {!loading && gridRows.length > 0 ? (
        <>
          <FinanceCostCenterGridSummary
            totals={{ rowCount: total }}
            filteredCount={total}
            page={clampFinanceGridPage(page, totalPages)}
            totalPages={totalPages}
            amountLabel="Regras"
          />
          <FinanceCostCenterGridTableShell
            tableClassName="min-w-[720px]"
            head={
              <tr className="border-b border-border text-left">
                <FinanceCostCenterSortableTh label="Fornecedor" sortKey="supplier" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Centro" sortKey="costCenter" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="%" sortKey="percentage" sort={sort} onSort={handleSort} align="right" />
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Auto</th>
                <FinanceCostCenterSortableTh label="Status" sortKey="status" sort={sort} onSort={handleSort} />
                {canManage ? (
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Ações</th>
                ) : null}
              </tr>
            }
            footer={
              <FinanceCostCenterGridPagination
                page={clampFinanceGridPage(page, totalPages)}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={(nextPage) => patchUrl({ rule_page: nextPage })}
                onPageSizeChange={(nextSize) => patchUrl({ rule_limit: nextSize, rule_page: 1 })}
              />
            }
          >
            {pageRows.map((row) => {
              const supplier = supplierById.get(row.supplierId);
              const rule = rules.find((r) => r.id === row.id)!;
              return (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-3 py-2">
                    {supplier?.found ? (
                      <div className="flex flex-col">
                        <span className="font-semibold">{supplier.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {supplier.document ?? "Sem documento"}
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        <span className="font-semibold text-amber-700">Fornecedor não encontrado</span>
                        <span className="font-mono text-[10px] text-muted-foreground/70">
                          ID técnico: {row.supplierId.slice(0, 8)}…
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.costCenterLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.percentage}%</td>
                  <td className="px-3 py-2">{row.autoApply ? "Sim" : "Não"}</td>
                  <td className="px-3 py-2">{row.isActive ? "Ativa" : "Inativa"}</td>
                  {canManage && rule.isActive ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        data-testid="finance-rules-deactivate-button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"
                        onClick={() => void deactivate(row.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        Desativar
                      </button>
                    </td>
                  ) : canManage ? (
                    <td className="px-3 py-2">—</td>
                  ) : null}
                </tr>
              );
            })}
          </FinanceCostCenterGridTableShell>
        </>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn(financeBiCardClass, "w-full max-w-lg space-y-4")}>
            <h3 className="text-lg font-semibold">Nova regra de classificação</h3>

            <div className="space-y-1 text-sm">
              <span className="font-semibold">Fornecedor</span>
              {selectedSupplier ? (
                <div
                  className="rounded-lg border border-primary/40 bg-primary/5 p-3"
                  data-testid="finance-rules-selected-supplier"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Fornecedor selecionado
                      </p>
                      <p className="font-semibold">{selectedSupplier.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedSupplier.document ?? "Sem documento"}
                        {selectedSupplier.externalCode
                          ? ` · código ${selectedSupplier.externalCode}`
                          : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFinanceInteger(selectedSupplier.titlesCount)} título(s) encontrados
                        {selectedSupplier.totalValue != null
                          ? ` · ${formatFinanceCurrency(selectedSupplier.totalValue)}`
                          : ""}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground/70">
                        ID técnico: {selectedSupplier.id}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid="finance-rules-clear-supplier"
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
                      onClick={clearSupplier}
                    >
                      <X className="h-3 w-3" />
                      Limpar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      data-testid="finance-rules-supplier-search"
                      className="w-full bg-transparent text-sm outline-none"
                      value={supplierQuery}
                      onChange={(e) => {
                        setSupplierQuery(e.target.value);
                        setSupplierDropdownOpen(true);
                      }}
                      onFocus={() => setSupplierDropdownOpen(true)}
                      placeholder="Buscar fornecedor por nome, CNPJ, documento ou código..."
                    />
                  </div>
                  {supplierDropdownOpen && supplierQuery.trim().length >= 2 ? (
                    <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg">
                      {supplierSearching ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Buscando fornecedores…</p>
                      ) : supplierResults.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          Nenhum fornecedor encontrado para “{supplierQuery.trim()}”.
                        </p>
                      ) : (
                        supplierResults.map((supplier) => (
                          <button
                            key={supplier.id}
                            type="button"
                            data-testid="finance-rules-supplier-option"
                            className="block w-full border-b border-border/40 px-3 py-2 text-left hover:bg-muted/50"
                            onClick={() => {
                              setSelectedSupplier(supplier);
                              setSupplierDropdownOpen(false);
                              setPreview(null);
                            }}
                          >
                            <p className="text-sm font-semibold">{supplier.name}</p>
                            <p className="text-xs text-muted-foreground">{formatSupplierMeta(supplier)}</p>
                            <p className="font-mono text-[10px] text-muted-foreground/70">
                              ID técnico: {supplier.id.slice(0, 8)}…
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Digite ao menos 2 caracteres para buscar.
                  </p>
                </div>
              )}
            </div>

            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-2 gap-2">
                <select
                  className="rounded-lg border px-3 py-2 text-sm"
                  value={line.costCenterId}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, costCenterId: e.target.value } : row
                      )
                    )
                  }
                >
                  <option value="">Centro de custo</option>
                  {centers.map((cc) => (
                    <option key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border px-3 py-2 text-sm"
                  type="number"
                  min={0}
                  max={100}
                  value={line.percentage}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((row, i) =>
                        i === index ? { ...row, percentage: e.target.value } : row
                      )
                    )
                  }
                  placeholder="%"
                />
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-xs font-semibold text-primary"
                onClick={() => setLines((prev) => [...prev, { costCenterId: "", percentage: "0" }])}
              >
                + Adicionar linha de rateio
              </button>
              <span
                className={cn(
                  "text-xs font-semibold",
                  percentageValid ? "text-emerald-700" : "text-amber-700"
                )}
              >
                Total: {totalPercentage.toFixed(2)}%
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="finance-rules-preview-button"
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={!selectedSupplier}
                onClick={() => void runPreview()}
              >
                <Eye className="h-4 w-4" />
                Preview de impacto
              </button>
            </div>
            {preview ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                {preview.openTitlesCount === 0 && preview.historicalTitlesCount === 0 ? (
                  <p>Este fornecedor não possui títulos para classificar com os filtros atuais.</p>
                ) : (
                  <p>
                    Títulos em aberto: {formatFinanceInteger(preview.openTitlesCount)} · Bloqueados
                    manual: {formatFinanceInteger(preview.manualLockedTitlesCount)}
                  </p>
                )}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={saving || !canSubmit}
                onClick={() => void saveRules()}
              >
                {saving ? "Salvando…" : "Salvar regra"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
