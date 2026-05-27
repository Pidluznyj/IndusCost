/**
 * Painel agregador de status da Engenharia Nomus.
 *
 * Separa claramente:
 *  - Cadastro mestre / Igualar bases (diagnóstico existente);
 *  - BOM / auto apply ProductBOM (relatório oficial da rotina sync:nomus:all:apply).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  History,
  Layers,
  Loader2,
  PackagePlus,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchMasterDataImportDiagnostic } from "@/src/lib/nomusMasterDataImportClient";
import { fetchMasterDataEqualizePreview } from "@/src/lib/nomusMasterDataEqualizeClient";
import {
  fetchEngineeringRunsRecent,
  type EngineeringRunRecentItem,
} from "@/src/lib/nomusEngineeringRunsRecentClient";
import { fetchNomusAutoApplyBomDashboard } from "@/src/lib/nomusAutoApplyBomDashboardClient";
import type {
  AutoApplyBomDashboardProductRow,
  AutoApplyBomDashboardResult,
  AutoApplyDashboardFilter,
} from "@/src/lib/nomusAutoApplyBomDashboardTypes";
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

function summarizeActions(row: AutoApplyBomDashboardProductRow): string {
  const parts: string[] = [];
  if (row.quantityDiffCount > 0) parts.push(`${row.quantityDiffCount} qtd.`);
  if (row.metadataOnlyCount > 0) parts.push(`${row.metadataOnlyCount} metadata`);
  const preview = row.actionsPreview ?? [];
  const creates = preview.filter((a) => a.actionType === "CREATE_PRODUCT_BOM_LINE").length;
  const removes = preview.filter((a) => a.actionType === "REMOVE_PRODUCT_BOM_LINE").length;
  if (creates > 0) parts.push(`${creates} criar`);
  if (removes > 0) parts.push(`${removes} remover`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export const NomusEngineeringStatusBoard: React.FC<{
  disabled?: boolean;
  onOpenProduct?: (parentCode: string) => void;
}> = ({ disabled = false, onOpenProduct }) => {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AutoApplyDashboardFilter>("ALL");
  const [search, setSearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [masterData, equalize, autoApply, runs] = await Promise.all([
        fetchMasterDataImportDiagnostic({ limit: 1, includeExisting: true }).catch(() => null),
        fetchMasterDataEqualizePreview({ limit: 1, scope: "ACTIONABLE" }).catch(() => null),
        fetchNomusAutoApplyBomDashboard({ filter, search: search.trim() || undefined }).catch(
          () => null
        ),
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
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Tente novamente em alguns segundos.`
          : "Erro ao carregar visão geral da engenharia."
      );
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  const md = snapshot?.masterData ?? null;
  const eq = snapshot?.equalize ?? null;
  const autoApply = snapshot?.autoApply ?? null;
  const totals = autoApply?.totals ?? null;

  const lastEqualize = snapshot ? pickLastByOrigin(snapshot.runs, ["MASTER_DATA_EQUALIZE"]) : null;
  const lastAutoApply = snapshot
    ? pickLastByOrigin(snapshot.runs, ["NOMUS_SYNC"])
    : null;
  const lastManualBomApply = snapshot
    ? pickLastByOrigin(snapshot.runs, ["BOM_APPLY_AFTER_MASTER_DATA"])
    : null;
  const lastBackfill = snapshot
    ? pickLastByOrigin(snapshot.runs, ["MASTER_DATA_HISTORY_BACKFILL"])
    : null;

  const visibleProducts = useMemo(() => autoApply?.products ?? [], [autoApply?.products]);

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Database className="h-5 w-5 mt-0.5 text-primary shrink-0" />
        <div className="flex-1">
          <h3 className="text-base font-bold text-foreground">
            Central de Engenharia Nomus — Resumo
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read-only. Os números de <strong>BOM / auto apply</strong> vêm do relatório oficial da
            rotina <code className="font-mono">sync:nomus:all:apply</code>. Os números de{" "}
            <strong>Cadastro mestre</strong> vêm dos diagnósticos de Carga Mestre e Igualar bases.
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
                hint="Produtos/materiais controlados para Igualar bases."
              />
              <SummaryCard
                icon={<Database className="h-3.5 w-3.5" />}
                tone="neutral"
                label="Itens com histórico Nomus"
                value={
                  md ? md.totals.existingProducts + md.totals.existingMaterials : "—"
                }
                hint="Já cadastrados como Nomus no IndusCost."
              />
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={<Layers className="h-3.5 w-3.5" />} title="BOM / ProductBOM × Nomus (auto apply)" />
            {!autoApply?.hasReport ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                {autoApply?.emptyMessage ??
                  "Nenhuma rotina de auto apply BOM executada ainda."}
              </div>
            ) : (
              <>
                {autoApply.lastRun ? (
                  <p className="text-[11px] text-muted-foreground">
                    Última execução: {formatDateShort(autoApply.lastRun.finishedAt)} · modo{" "}
                    <code className="font-mono">{autoApply.lastRun.mode}</code> · por{" "}
                    {autoApply.lastRun.approvedBy}
                    {autoApply.source === "REPORT_FILE" ? " · relatório JSON" : " · run batch"}
                  </p>
                ) : null}
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  <SummaryCard
                    icon={<Database className="h-3.5 w-3.5" />}
                    tone="neutral"
                    label="Produtos avaliados"
                    value={totals?.parentsEvaluated ?? "—"}
                    hint="Total processado na última rotina."
                  />
                  <SummaryCard
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    tone="success"
                    label="Sem alteração"
                    value={totals?.parentsNoChanges ?? "—"}
                    hint="ProductBOM já alinhada com Nomus."
                  />
                  <SummaryCard
                    icon={<Wrench className="h-3.5 w-3.5" />}
                    tone="info"
                    label="Aplicados"
                    value={totals?.parentsApplied ?? "—"}
                    hint="Produtos com alteração aplicada."
                  />
                  <SummaryCard
                    icon={<ShieldAlert className="h-3.5 w-3.5" />}
                    tone="danger"
                    label="Bloqueados"
                    value={totals?.parentsBlocked ?? "—"}
                    hint="Pendências impedem apply automático."
                  />
                  <SummaryCard
                    icon={<AlertTriangle className="h-3.5 w-3.5" />}
                    tone="warn"
                    label="Ignorados"
                    value={totals?.parentsSkipped ?? "—"}
                    hint="Sem produto IndusCost ou fora do escopo."
                  />
                  <SummaryCard
                    icon={<ShieldAlert className="h-3.5 w-3.5" />}
                    tone="danger"
                    label="Erros"
                    value={totals?.parentsErrored ?? "—"}
                    hint="Falhas durante a rotina batch."
                  />
                </div>

                {autoApply.blockingReasonBuckets.length > 0 ? (
                  <div className="rounded-lg border border-border bg-card p-2.5 space-y-1">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">
                      Top motivos de bloqueio
                    </p>
                    <ul className="text-[11px] space-y-0.5">
                      {autoApply.blockingReasonBuckets.slice(0, 6).map((b) => (
                        <li key={b.key} className="flex justify-between gap-2">
                          <span>{b.label}</span>
                          <strong className="tabular-nums">{b.count}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Filtrar produtos
                      <select
                        value={filter}
                        disabled={disabled || loading}
                        onChange={(e) =>
                          setFilter(e.target.value as AutoApplyDashboardFilter)
                        }
                        className="mt-1 block h-8 w-full min-w-[160px] rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {FILTER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground flex-1 min-w-[180px]">
                      Buscar parentCode / motivo
                      <div className="relative mt-1">
                        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={search}
                          disabled={disabled || loading}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Ex.: 308.05AB"
                          className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs"
                        />
                      </div>
                    </label>
                    <button
                      type="button"
                      disabled={disabled || loading}
                      onClick={() => void loadAll()}
                      className="inline-flex h-8 items-center rounded-md border border-input bg-background px-2.5 text-xs font-semibold hover:bg-muted"
                    >
                      Aplicar filtros
                    </button>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Exibindo {autoApply.matchedCount} produto(s) neste filtro.
                  </p>

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-2 py-1.5 font-semibold">Produto</th>
                          <th className="px-2 py-1.5 font-semibold">Status</th>
                          <th className="px-2 py-1.5 font-semibold">Motivo principal</th>
                          <th className="px-2 py-1.5 font-semibold">Ações previstas</th>
                          <th className="px-2 py-1.5 font-semibold text-right">Abrir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleProducts.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-2 py-3 text-muted-foreground italic">
                              Nenhum produto neste filtro.
                            </td>
                          </tr>
                        ) : (
                          visibleProducts.slice(0, 200).map((row) => (
                            <tr key={row.parentCode} className="border-t border-border/70">
                              <td className="px-2 py-1.5 font-mono font-semibold">
                                {row.parentCode}
                              </td>
                              <td className="px-2 py-1.5">
                                <span
                                  className={cn(
                                    "inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                                    statusBadgeClass(row.status)
                                  )}
                                >
                                  {row.status}
                                </span>
                              </td>
                              <td className="px-2 py-1.5 max-w-[320px]">
                                <span className="line-clamp-2">{row.primaryReason}</span>
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                {summarizeActions(row)}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                {onOpenProduct ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenProduct(row.parentCode)}
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/10"
                                  >
                                    Manutenção
                                    <ArrowRight className="h-3 w-3" />
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {visibleProducts.length > 200 ? (
                    <p className="text-[10px] text-muted-foreground italic">
                      Mostrando os primeiros 200 de {visibleProducts.length}. Refine o filtro ou a
                      busca.
                    </p>
                  ) : null}
                </div>
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
          Clique em <strong>Atualizar painel da engenharia</strong> para carregar Cadastro mestre e
          o relatório de auto apply BOM.
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
}> = ({ icon, tone, label, value, hint }) => {
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
  return (
    <div className={cn("rounded-xl border p-2.5", toneClass)}>
      <p className="text-[10px] uppercase font-semibold opacity-80 flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      <p className="text-[10px] opacity-80 mt-0.5 leading-tight">{hint}</p>
    </div>
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
