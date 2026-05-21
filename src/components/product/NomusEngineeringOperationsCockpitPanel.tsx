/**
 * Central de Atualização Nomus — painel operacional (read-only).
 *
 * Fase NOMUS-ENGINEERING-OPERATIONS-COCKPIT-A.
 * - Fila de trabalho com status em linguagem de negócio.
 * - Sem botão "Aplicar todos". Nenhuma mutação. Apenas diagnóstico.
 * - Atalhos para as abas técnicas existentes (BOM efetiva, impacto, plano, diagnóstico, etc.).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Layers,
  Loader2,
  Package,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CockpitOperatorStatus,
  CockpitResult,
  CockpitRow,
  CockpitScope,
  CockpitTechnicalRef,
} from "@/src/lib/nomusEngineeringOperationsCockpitTypes";
import type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";

type Props = {
  /** Abre o produto no workspace técnico, opcionalmente já em uma aba específica. */
  onOpenProduct: (parentCode: string, options?: { tab?: NomusMaintenanceTab }) => void;
  disabled?: boolean;
};

const STATUS_TONE: Record<
  CockpitOperatorStatus,
  { bg: string; text: string; ring: string; icon: React.ComponentType<{ className?: string }> }
> = {
  OK: {
    bg: "bg-emerald-50",
    text: "text-emerald-900",
    ring: "ring-emerald-200",
    icon: CircleCheck,
  },
  READY: {
    bg: "bg-sky-50",
    text: "text-sky-900",
    ring: "ring-sky-200",
    icon: Layers,
  },
  REVIEW: {
    bg: "bg-amber-50",
    text: "text-amber-900",
    ring: "ring-amber-200",
    icon: AlertTriangle,
  },
  BLOCKED: {
    bg: "bg-red-50",
    text: "text-red-900",
    ring: "ring-red-200",
    icon: ShieldAlert,
  },
  NEW: {
    bg: "bg-violet-50",
    text: "text-violet-900",
    ring: "ring-violet-200",
    icon: PackagePlus,
  },
  LOCAL: {
    bg: "bg-teal-50",
    text: "text-teal-900",
    ring: "ring-teal-200",
    icon: Wrench,
  },
  OPTIONAL: {
    bg: "bg-orange-50",
    text: "text-orange-900",
    ring: "ring-orange-200",
    icon: CircleHelp,
  },
  AMBIGUOUS: {
    bg: "bg-fuchsia-50",
    text: "text-fuchsia-900",
    ring: "ring-fuchsia-200",
    icon: AlertTriangle,
  },
};

const SUMMARY_CARDS: Array<{
  key: keyof CockpitResult["totals"];
  title: string;
  description: string;
  tone: "neutral" | "info" | "warn" | "danger" | "success";
}> = [
  {
    key: "ready",
    title: "Prontos",
    description: "Alterações simples para revisar antes de aplicar.",
    tone: "info",
  },
  {
    key: "needsReview",
    title: "Precisam revisão",
    description: "Diferenças que exigem decisão humana.",
    tone: "warn",
  },
  {
    key: "blocked",
    title: "Bloqueados",
    description: "Pendências impedem atualização segura.",
    tone: "danger",
  },
  {
    key: "newProducts",
    title: "Produtos novos",
    description: "Existem no Nomus, ainda não no IndusCost.",
    tone: "info",
  },
  {
    key: "bomChanged",
    title: "BOM alterada",
    description: "Estrutura ou quantidade mudou no Nomus.",
    tone: "info",
  },
  {
    key: "optionalPending",
    title: "Opcionais pendentes",
    description: "Falta escolher qual opcional entra no custo.",
    tone: "warn",
  },
  {
    key: "localExceptions",
    title: "Exceções locais",
    description: "Itens locais legítimos que devem ser preservados.",
    tone: "neutral",
  },
  {
    key: "noChanges",
    title: "Sem alteração",
    description: "Produtos já alinhados com o Nomus.",
    tone: "success",
  },
];

const SCOPE_OPTIONS: Array<{ value: CockpitScope; label: string }> = [
  { value: "CHANGED_ONLY", label: "Só com alterações" },
  { value: "ALL", label: "Todos" },
];

function severityRingClass(severity: CockpitRow["severity"]): string {
  switch (severity) {
    case "BLOCKED":
      return "ring-red-300";
    case "HIGH":
      return "ring-amber-300";
    case "MEDIUM":
      return "ring-yellow-200";
    default:
      return "ring-border";
  }
}

export const NomusEngineeringOperationsCockpitPanel: React.FC<Props> = ({
  onOpenProduct,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CockpitResult | null>(null);
  const [scope, setScope] = useState<CockpitScope>("CHANGED_ONLY");
  const [search, setSearch] = useState("");
  const [expandedParentCode, setExpandedParentCode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CockpitOperatorStatus | "ALL">("ALL");

  const loadCockpit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scope,
        limit: "100",
      });
      const data = await fetchJsonOk<CockpitResult>(
        `/api/nomus/engineering-operations-cockpit?${params.toString()}`
      );
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Erro ao gerar diagnóstico.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Não carrega automaticamente: respeita a regra "Gerar diagnóstico" como botão principal,
  // para deixar claro ao operador que a tela é leitura e nada acontece sozinho.
  useEffect(() => {
    setResult(null);
    setExpandedParentCode(null);
  }, [scope]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    return result.rows.filter((r) => {
      if (statusFilter !== "ALL" && r.operatorStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        r.parentCode.toLowerCase().includes(q) ||
        (r.parentDescription?.toLowerCase().includes(q) ?? false) ||
        (r.productName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [result, search, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div>
          <h3 className="text-base font-bold text-foreground">Central de Atualização Nomus</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Revise alterações de engenharia vindas do Nomus antes de atualizar o IndusCost.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            Esta tela <strong>não altera ProductBOM, custo, preço, propostas ou pedidos</strong>.
            Ela apenas mostra o diagnóstico. Toda mutação continua sendo feita produto a produto, com
            confirmação textual nas abas técnicas.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] font-semibold uppercase text-muted-foreground block">
              Escopo
            </label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as CockpitScope)}
              className="mt-1 h-9 rounded-lg border border-border bg-background px-2 text-xs"
              disabled={disabled || loading}
            >
              {SCOPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={disabled || loading}
            onClick={() => void loadCockpit()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Gerar diagnóstico
          </button>
          <button
            type="button"
            disabled={disabled || loading || !result}
            onClick={() => void loadCockpit()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar lista
          </button>
          {result ? (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {result.comparedCount} de {result.totalParentsInStage} produtos no stage Nomus ·{" "}
              {new Date(result.generatedAt).toLocaleString("pt-BR")}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}

      {!result && !loading && !error ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          Clique em <strong>Gerar diagnóstico</strong> para listar os produtos Nomus e a próxima ação
          recomendada para cada um.
        </div>
      ) : null}

      {result ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
            {SUMMARY_CARDS.map((card) => {
              const value = result.totals[card.key];
              const toneClass =
                card.tone === "danger"
                  ? "border-red-300 bg-red-50"
                  : card.tone === "warn"
                    ? "border-amber-300 bg-amber-50"
                    : card.tone === "info"
                      ? "border-sky-300 bg-sky-50"
                      : card.tone === "success"
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-border bg-card";
              const valueClass =
                card.tone === "danger"
                  ? "text-red-800"
                  : card.tone === "warn"
                    ? "text-amber-800"
                    : card.tone === "info"
                      ? "text-sky-800"
                      : card.tone === "success"
                        ? "text-emerald-800"
                        : "text-foreground";
              return (
                <button
                  key={card.key}
                  type="button"
                  className={cn(
                    "text-left rounded-xl border p-3 transition-shadow hover:shadow-sm",
                    toneClass
                  )}
                  onClick={() => {
                    if (card.key === "ready") setStatusFilter("READY");
                    else if (card.key === "needsReview") setStatusFilter("REVIEW");
                    else if (card.key === "blocked") setStatusFilter("BLOCKED");
                    else if (card.key === "newProducts") setStatusFilter("NEW");
                    else if (card.key === "optionalPending") setStatusFilter("OPTIONAL");
                    else if (card.key === "localExceptions") setStatusFilter("LOCAL");
                    else if (card.key === "noChanges") setStatusFilter("OK");
                    else setStatusFilter("ALL");
                  }}
                >
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">
                    {card.title}
                  </p>
                  <p className={cn("text-2xl font-bold tabular-nums mt-1", valueClass)}>{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    {card.description}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-2 pt-1">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block">
                Buscar (código, produto)
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ex.: 611.48"
                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as CockpitOperatorStatus | "ALL")
                }
                className="mt-1 h-9 rounded-lg border border-border bg-background px-2 text-xs"
              >
                <option value="ALL">Todos</option>
                <option value="OK">Sem alteração</option>
                <option value="READY">Pronto para revisar</option>
                <option value="REVIEW">Precisa análise</option>
                <option value="BLOCKED">Bloqueado</option>
                <option value="NEW">Produto novo</option>
                <option value="LOCAL">Tem item local</option>
                <option value="OPTIONAL">Opcional pendente</option>
                <option value="AMBIGUOUS">Código ambíguo</option>
              </select>
            </div>
            <span className="text-[10px] text-muted-foreground ml-auto">
              Mostrando {filteredRows.length} produto(s)
            </span>
          </div>

          {filteredRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhum produto com os filtros atuais.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-2 w-8"></th>
                    <th className="text-left px-2 py-2">Status</th>
                    <th className="text-left px-2 py-2">Código</th>
                    <th className="text-left px-2 py-2">Produto</th>
                    <th className="text-left px-2 py-2">Situação</th>
                    <th className="text-left px-2 py-2">O que mudou</th>
                    <th className="text-left px-2 py-2">Risco</th>
                    <th className="text-left px-2 py-2">Próxima ação</th>
                    <th className="text-left px-2 py-2">Abrir</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const tone = STATUS_TONE[row.operatorStatus];
                    const Icon = tone.icon;
                    const isExpanded = expandedParentCode === row.parentCode;
                    return (
                      <React.Fragment key={row.parentCode}>
                        <tr
                          className={cn(
                            "border-t border-border/60 hover:bg-accent/30 ring-1 ring-inset",
                            severityRingClass(row.severity)
                          )}
                        >
                          <td className="px-2 py-2 align-top">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedParentCode(isExpanded ? null : row.parentCode)
                              }
                              className="p-1 rounded hover:bg-accent"
                              aria-label={isExpanded ? "Recolher detalhes" : "Ver detalhes"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                                tone.bg,
                                tone.text
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {row.operatorStatusLabel}
                            </span>
                          </td>
                          <td className="px-2 py-2 align-top font-mono font-bold">
                            {row.parentCode}
                          </td>
                          <td className="px-2 py-2 align-top max-w-[220px]">
                            <p className="font-medium truncate">
                              {row.productName ?? row.parentDescription ?? "—"}
                            </p>
                            {row.parentDescription && row.productName !== row.parentDescription ? (
                              <p className="text-[10px] text-muted-foreground truncate">
                                Nomus: {row.parentDescription}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-2 align-top max-w-[200px]">
                            {row.situationLabels.length > 0 ? (
                              <ul className="space-y-0.5">
                                {row.situationLabels.slice(0, 3).map((lab) => (
                                  <li key={lab.kind} className="text-[10px] leading-tight">
                                    · {lab.label}
                                  </li>
                                ))}
                                {row.situationLabels.length > 3 ? (
                                  <li className="text-[10px] text-muted-foreground">
                                    + {row.situationLabels.length - 3} outra(s)
                                  </li>
                                ) : null}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top max-w-[260px] text-muted-foreground">
                            <span className="line-clamp-2">{row.whatChangedSummary}</span>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                                row.severity === "BLOCKED" && "bg-red-100 text-red-900",
                                row.severity === "HIGH" && "bg-amber-100 text-amber-900",
                                row.severity === "MEDIUM" && "bg-yellow-100 text-yellow-900",
                                row.severity === "LOW" && "bg-emerald-100 text-emerald-900"
                              )}
                            >
                              {row.severity === "BLOCKED"
                                ? "Bloqueado"
                                : row.severity === "HIGH"
                                  ? "Alto"
                                  : row.severity === "MEDIUM"
                                    ? "Médio"
                                    : "Baixo"}
                            </span>
                          </td>
                          <td className="px-2 py-2 align-top max-w-[240px] text-[11px]">
                            {row.nextRecommendedAction}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <button
                              type="button"
                              onClick={() => {
                                const primary = row.technicalRefs.find((r) => r.primary);
                                onOpenProduct(row.parentCode, {
                                  tab: primary?.tab ?? "overview",
                                });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                            >
                              <Package className="h-3 w-3" />
                              Abrir produto
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="border-t border-border/60 bg-accent/20">
                            <td colSpan={9} className="px-3 py-3">
                              <ExpandedRowDetail row={row} onOpenProduct={onOpenProduct} />
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {result.warnings.length > 0 ? (
            <ul className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

const ExpandedRowDetail: React.FC<{
  row: CockpitRow;
  onOpenProduct: (parentCode: string, options?: { tab?: NomusMaintenanceTab }) => void;
}> = ({ row, onOpenProduct }) => {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3 text-xs space-y-1.5">
          <p className="font-bold text-[11px] uppercase text-muted-foreground">Resumo</p>
          <p>
            <strong>Status:</strong> {row.operatorStatusLabel}
          </p>
          <p>
            <strong>Risco:</strong>{" "}
            {row.severity === "BLOCKED"
              ? "Bloqueado"
              : row.severity === "HIGH"
                ? "Alto"
                : row.severity === "MEDIUM"
                  ? "Médio"
                  : "Baixo"}
          </p>
          <p>
            <strong>O que mudou:</strong> {row.whatChangedSummary}
          </p>
          <p>
            <strong>Próxima ação:</strong> {row.nextRecommendedAction}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3 text-xs space-y-1.5">
          <p className="font-bold text-[11px] uppercase text-muted-foreground">Situações</p>
          {row.situationLabels.length === 0 ? (
            <p className="text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-0.5 list-disc list-inside">
              {row.situationLabels.map((lab) => (
                <li key={lab.kind}>{lab.label}</li>
              ))}
            </ul>
          )}
          {row.hasAssemblyLocalException ? (
            <p className="rounded-md bg-teal-50 border border-teal-200 px-2 py-1 text-[11px] text-teal-900 mt-2">
              ✓ Item de montagem local (800.xx) será preservado.
            </p>
          ) : null}
        </div>
      </div>

      {row.blockingDetails.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-900">
          <p className="font-bold">Pendências bloqueantes</p>
          <ul className="mt-1 space-y-0.5 list-disc list-inside">
            {row.blockingDetails.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {row.warnings.length > 0 ? (
        <ul className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
          {row.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {row.technicalRefs.map((ref) => (
          <button
            key={`${ref.tab}-${ref.label}`}
            type="button"
            onClick={() => onOpenProduct(row.parentCode, { tab: ref.tab })}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold",
              ref.primary
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border bg-background hover:bg-accent"
            )}
          >
            {techTabIcon(ref)}
            {ref.label}
          </button>
        ))}
      </div>
    </div>
  );
};

function techTabIcon(ref: CockpitTechnicalRef): React.ReactNode {
  switch (ref.tab) {
    case "effective-pricing-bom":
      return <Layers className="h-3 w-3" />;
    case "cost-impact":
      return <CircleHelp className="h-3 w-3" />;
    case "apply-plan":
      return <Wrench className="h-3 w-3" />;
    case "diagnostic":
      return <Search className="h-3 w-3" />;
    case "product-import":
      return <PackagePlus className="h-3 w-3" />;
    default:
      return null;
  }
}
