import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Network,
  Search,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  HrOrgChartDepartmentNode,
  HrOrgChartDirectorateNode,
  HrOrgChartPerson,
  HrOrgChartRoot,
} from "@/src/lib/hrOrgChart";
import { hrOrgChartPersonLabel } from "@/src/lib/hrOrgChart";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function PersonCard({
  person,
  tone,
  subtitle,
}: {
  person: HrOrgChartPerson;
  tone: "root" | "directorate" | "department" | "member";
  subtitle?: string;
}) {
  const label = hrOrgChartPersonLabel(person);
  return (
    <div
      className={cn(
        "flex min-w-[180px] max-w-[220px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm",
        tone === "root" && "border-slate-700 bg-slate-800 text-white",
        tone === "directorate" && "border-sky-200 bg-sky-50 text-sky-950",
        tone === "department" && "border-teal-200 bg-teal-50 text-teal-950",
        tone === "member" && "border-border bg-card text-foreground"
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          tone === "root" && "bg-white/15 text-white",
          tone === "directorate" && "bg-sky-600/15 text-sky-800",
          tone === "department" && "bg-teal-600/15 text-teal-800",
          tone === "member" && "bg-muted text-muted-foreground"
        )}
      >
        {initials(label)}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">{label}</p>
        <p
          className={cn(
            "truncate text-[11px] leading-tight",
            tone === "root" ? "text-white/70" : "text-muted-foreground"
          )}
        >
          {subtitle || person.roleName || (person.isLeader ? "Líder" : "Colaborador")}
        </p>
      </div>
    </div>
  );
}

/**
 * Filhos em linha única (sem wrap) + conectores em T clássicos de organograma.
 * Garante que o 1º e o último filho continuem ligados à barra horizontal do pai.
 */
function OrgTreeChildren({
  children,
  lineClassName = "bg-slate-300 dark:bg-slate-600",
}: {
  children: React.ReactNode;
  lineClassName?: string;
}) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;

  const only = items.length === 1;

  return (
    <div className="flex flex-col items-center" data-org-tree-children="">
      {/* Haste do pai → barra dos filhos */}
      <div className={cn("h-5 w-px shrink-0", lineClassName)} aria-hidden />
      <ul className="relative flex flex-nowrap items-start justify-center">
        {items.map((child, index) => {
          const isFirst = index === 0;
          const isLast = index === items.length - 1;
          return (
            <li
              key={index}
              className="relative flex flex-col items-center px-3 pt-5"
              data-org-tree-child=""
            >
              {/* Barra horizontal do nível */}
              {!only ? (
                <span
                  className={cn(
                    "pointer-events-none absolute top-0 h-px",
                    lineClassName,
                    isFirst && isLast && "hidden",
                    isFirst && !isLast && "left-1/2 right-0",
                    isLast && !isFirst && "left-0 right-1/2",
                    !isFirst && !isLast && "left-0 right-0"
                  )}
                  aria-hidden
                />
              ) : null}
              {/* Haste vertical até o card */}
              <span
                className={cn(
                  "pointer-events-none absolute left-1/2 top-0 h-5 w-px -translate-x-1/2",
                  lineClassName
                )}
                aria-hidden
              />
              {child}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HrOrgChartPage() {
  const [chart, setChart] = useState<HrOrgChartRoot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.9);
  const [query, setQuery] = useState("");
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [showUnassigned, setShowUnassigned] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJsonOk<{ chart: HrOrgChartRoot }>("/api/employees/org/chart");
      setChart(res.chart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar organograma.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();

  const matchesPerson = useCallback(
    (person: HrOrgChartPerson | null | undefined) => {
      if (!q || !person) return !q;
      const hay = `${person.name} ${person.socialName ?? ""} ${person.roleName ?? ""}`.toLowerCase();
      return hay.includes(q);
    },
    [q]
  );

  const filteredDirectorates = useMemo(() => {
    if (!chart) return [];

    const nodeMatches = (dir: HrOrgChartDirectorateNode): boolean => {
      if (!q) return true;
      if (dir.name.toLowerCase().includes(q) || matchesPerson(dir.leader)) return true;
      if (
        dir.departments.some(
          (dep) =>
            dep.name.toLowerCase().includes(q) ||
            matchesPerson(dep.leader) ||
            dep.members.some((m) => matchesPerson(m))
        )
      ) {
        return true;
      }
      return dir.childDirectorates.some((child) => nodeMatches(child));
    };

    const filterTree = (nodes: HrOrgChartDirectorateNode[]): HrOrgChartDirectorateNode[] => {
      if (!q) return nodes;
      const out: HrOrgChartDirectorateNode[] = [];
      for (const dir of nodes) {
        const children = filterTree(dir.childDirectorates);
        if (nodeMatches(dir) || children.length > 0) {
          out.push({ ...dir, childDirectorates: children });
        }
      }
      return out;
    };

    return filterTree(chart.directorates);
  }, [chart, q, matchesPerson]);

  function toggleDir(id: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDept(id: string) {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportPdf() {
    if (!chart) return;

    const html = buildHrOrgChartPrintHtml({
      chart,
      directorates: filteredDirectorates,
    });

    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Organograma PDF");
    iframe.setAttribute("aria-hidden", "true");
    // Fora da tela, mas com área real — iframe 0x0 gera PDF em branco em vários browsers
    iframe.style.cssText =
      "position:fixed;left:-12000px;top:0;width:1200px;height:850px;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      // Fallback: Blob URL (sem noopener — evita janela nula/em branco)
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        URL.revokeObjectURL(url);
        window.alert("Permita pop-ups para exportar o PDF do organograma.");
        return;
      }
      const revoke = () => URL.revokeObjectURL(url);
      win.addEventListener("beforeunload", revoke, { once: true });
      window.setTimeout(revoke, 120_000);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    };

    const runPrint = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      fitPrintRootToA4Landscape(doc);
      const onAfter = () => {
        win.removeEventListener("afterprint", onAfter);
        cleanup();
      };
      win.addEventListener("afterprint", onAfter);
      // Segurança: remove iframe mesmo se afterprint não disparar
      window.setTimeout(cleanup, 60_000);
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
        window.alert("Não foi possível abrir a impressão/PDF. Tente novamente.");
      }
    };

    // Aguarda layout/fonts antes de medir e imprimir
    window.setTimeout(runPrint, 250);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-16 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Montando organograma...
      </div>
    );
  }

  if (error || !chart) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {error ?? "Organograma indisponível."}
        <button type="button" className="ml-3 font-semibold underline" onClick={() => void load()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="hr-org-chart-page">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Organograma</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Hierarquia oficial: Diretoria → Departamento → pessoas (líderes e equipe).
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {chart.totals.directorates} diretorias · {chart.totals.departments} departamentos ·{" "}
              {chart.totals.people} pessoas
              {chart.totals.unassigned > 0
                ? ` · ${chart.totals.unassigned} sem departamento`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar pessoa ou área..."
              className="h-9 w-56 rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
            <button
              type="button"
              className="rounded-md p-2 hover:bg-accent"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
              title="Diminuir zoom"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[3rem] text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="rounded-md p-2 hover:bg-accent"
              onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
              title="Aumentar zoom"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded-md p-2 hover:bg-accent"
              onClick={() => setZoom(0.9)}
              title="Ajustar"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={exportPdf}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            data-testid="hr-org-chart-export-pdf"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar PDF (A4 paisagem)          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-border bg-gradient-to-b from-slate-50 to-white p-6 dark:from-slate-950 dark:to-background">
        <div
          ref={canvasRef}
          className="origin-top transition-transform duration-200"
          style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}
        >
          <div className="inline-flex min-w-full flex-col items-center pb-10">
            <div className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-3 text-center text-white shadow-md">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Organização</p>
              <p className="text-base font-semibold">{chart.name}</p>
            </div>

            {filteredDirectorates.length === 0 ? (
              <div className="mt-8 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
                {q
                  ? "Nenhum resultado para a busca."
                  : "Cadastre diretorias e departamentos em Pessoas / RH → Estrutura organizacional."}
              </div>
            ) : (
              <OrgTreeChildren lineClassName="bg-slate-400 dark:bg-slate-500">
                {filteredDirectorates.map((dir) => (
                  <DirectorateBranch
                    key={dir.id}
                    node={dir}
                    collapsed={collapsedDirs.has(dir.id)}
                    collapsedDepts={collapsedDepts}
                    collapsedDirs={collapsedDirs}
                    onToggleDir={toggleDir}
                    onToggleDept={toggleDept}
                    highlightQuery={q}
                    matchesPerson={matchesPerson}
                  />
                ))}
              </OrgTreeChildren>
            )}

            {chart.unassigned.length > 0 ? (
              <div className="mt-10 w-full max-w-4xl px-4">
                <button
                  type="button"
                  onClick={() => setShowUnassigned((v) => !v)}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  {showUnassigned ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Users className="h-3.5 w-3.5" />
                  )}
                  Sem departamento oficial ({chart.unassigned.length})
                  {showUnassigned ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                {showUnassigned ? (
                  <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-4">
                    {chart.unassigned.map((p) => (
                      <PersonCard key={p.id} person={p} tone="member" />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Diretoria
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-teal-400" /> Departamento
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> Colaborador
        </span>
      </div>
    </div>
  );
}

function DirectorateBranch({
  node,
  collapsed,
  collapsedDepts,
  onToggleDir,
  onToggleDept,
  highlightQuery,
  matchesPerson,
  collapsedDirs,
}: {
  node: HrOrgChartDirectorateNode;
  collapsed: boolean;
  collapsedDepts: Set<string>;
  onToggleDir: (id: string) => void;
  onToggleDept: (id: string) => void;
  highlightQuery: string;
  matchesPerson: (p: HrOrgChartPerson | null | undefined) => boolean;
  collapsedDirs: Set<string>;
}) {
  const dim =
    highlightQuery &&
    !node.name.toLowerCase().includes(highlightQuery) &&
    !matchesPerson(node.leader) &&
    !node.departments.some(
      (d) =>
        d.name.toLowerCase().includes(highlightQuery) ||
        matchesPerson(d.leader) ||
        d.members.some((m) => matchesPerson(m))
    ) &&
    node.childDirectorates.length === 0;

  const hasChildren =
    node.departments.length > 0 || node.childDirectorates.length > 0;

  return (
    <div className={cn("flex flex-col items-center", dim && "opacity-35")}>
      <div className="rounded-2xl border border-sky-300/80 bg-sky-50 p-3 shadow-sm dark:border-sky-800 dark:bg-sky-950/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700/80 dark:text-sky-300/80">
              Diretoria
            </p>
            <p className="text-sm font-semibold text-sky-950 dark:text-sky-50">{node.name}</p>
          </div>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleDir(node.id)}
              className="rounded-md p-1 text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900"
              title={collapsed ? "Expandir" : "Recolher"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
        {node.leader ? (
          <PersonCard person={node.leader} tone="directorate" subtitle="Líder da diretoria" />
        ) : (
          <p className="text-xs text-muted-foreground">Sem líder</p>
        )}
        <p className="mt-2 text-[10px] text-sky-800/70 dark:text-sky-200/70">
          {node.departments.length} dept.
          {node.childDirectorates.length > 0
            ? ` · ${node.childDirectorates.length} diretoria(s)`
            : ""}{" "}
          · {node.peopleCount} pessoas
        </p>
      </div>

      {!collapsed && hasChildren ? (
        <div className="flex flex-col items-center">
          <OrgTreeChildren lineClassName="bg-sky-400/80 dark:bg-sky-500/70">
            {node.childDirectorates.map((child) => (
              <DirectorateBranch
                key={child.id}
                node={child}
                collapsed={collapsedDirs.has(child.id)}
                collapsedDepts={collapsedDepts}
                collapsedDirs={collapsedDirs}
                onToggleDir={onToggleDir}
                onToggleDept={onToggleDept}
                highlightQuery={highlightQuery}
                matchesPerson={matchesPerson}
              />
            ))}
            {node.departments.map((dep) => (
              <DepartmentBranch
                key={dep.id}
                node={dep}
                parentDirectorateName={node.name}
                parentLeaderId={node.leader?.id ?? null}
                collapsed={collapsedDepts.has(dep.id)}
                onToggle={() => onToggleDept(dep.id)}
                highlightQuery={highlightQuery}
                matchesPerson={matchesPerson}
              />
            ))}
          </OrgTreeChildren>
        </div>
      ) : null}
    </div>
  );
}

function DepartmentBranch({
  node,
  parentDirectorateName,
  parentLeaderId,
  collapsed,
  onToggle,
  highlightQuery,
  matchesPerson,
}: {
  node: HrOrgChartDepartmentNode;
  parentDirectorateName?: string;
  parentLeaderId?: string | null;
  collapsed: boolean;
  onToggle: () => void;
  highlightQuery: string;
  matchesPerson: (p: HrOrgChartPerson | null | undefined) => boolean;
}) {
  const dim =
    highlightQuery &&
    !node.name.toLowerCase().includes(highlightQuery) &&
    !matchesPerson(node.leader) &&
    !node.members.some((m) => matchesPerson(m));

  const leaderSameAsDirectorate =
    Boolean(node.leader?.id) &&
    Boolean(parentLeaderId) &&
    node.leader!.id === parentLeaderId;

  return (
    <div className={cn("flex flex-col items-center", dim && "opacity-35")}>
      <div className="rounded-2xl border border-teal-300/80 bg-teal-50 p-3 shadow-sm dark:border-teal-800 dark:bg-teal-950/40">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700/80 dark:text-teal-300/80">
              Departamento
            </p>
            <p className="text-sm font-semibold text-teal-950 dark:text-teal-50">{node.name}</p>
            {parentDirectorateName ? (
              <p className="mt-0.5 text-[10px] text-teal-800/60 dark:text-teal-200/60">
                ⊂ {parentDirectorateName}
              </p>
            ) : null}
          </div>
          {node.members.length > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900"
              title={collapsed ? "Ver equipe" : "Ocultar equipe"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
        {node.leader ? (
          leaderSameAsDirectorate ? (
            <p className="rounded-lg border border-teal-200/80 bg-white/70 px-2.5 py-1.5 text-[11px] text-teal-900/80 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-100/80">
              Líder: mesmo da diretoria ({hrOrgChartPersonLabel(node.leader)})
            </p>
          ) : (
            <PersonCard person={node.leader} tone="department" subtitle="Líder do departamento" />
          )
        ) : (
          <p className="text-xs text-muted-foreground">Sem líder</p>
        )}
        <p className="mt-2 text-[10px] text-teal-800/70 dark:text-teal-200/70">
          {node.memberCount} no time
        </p>
      </div>

      {!collapsed && node.members.length > 0 ? (
        <OrgTreeChildren lineClassName="bg-teal-400/70 dark:bg-teal-500/60">
          <div className="flex max-w-[280px] flex-col items-center gap-2">
            {node.members.map((m) => (
              <PersonCard key={m.id} person={m} tone="member" />
            ))}
          </div>
        </OrgTreeChildren>
      ) : null}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Área útil aproximada de A4 paisagem com margem 8mm (em px @96dpi). */
const A4_LANDSCAPE_PRINTABLE = { widthPx: 1060, heightPx: 700 };

function fitPrintRootToA4Landscape(doc: Document): void {
  const root = doc.getElementById("fit-root");
  if (!root) return;
  // Reset before measuring natural size
  root.style.transform = "none";
  root.style.transformOrigin = "top center";
  const width = Math.max(root.scrollWidth, root.getBoundingClientRect().width);
  const height = Math.max(root.scrollHeight, root.getBoundingClientRect().height);
  if (width <= 0 || height <= 0) return;
  const scale = Math.min(
    1,
    A4_LANDSCAPE_PRINTABLE.widthPx / width,
    A4_LANDSCAPE_PRINTABLE.heightPx / height
  );
  root.style.transform = `scale(${scale})`;
  // Reserva altura visual para o conteúdo escalado (evita corte na impressão)
  const host = doc.getElementById("fit-host");
  if (host) {
    host.style.height = `${Math.ceil(height * scale)}px`;
    host.style.width = "100%";
    host.style.overflow = "hidden";
  }
}

function buildHrOrgChartPrintHtml(input: {
  chart: HrOrgChartRoot;
  directorates: HrOrgChartDirectorateNode[];
}): string {
  const { chart, directorates } = input;
  const generated = new Date(chart.generatedAt).toLocaleString("pt-BR");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Organograma — ${escapeHtml(chart.name)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #0f172a;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    #fit-host { display: flex; justify-content: center; }
    #fit-root { display: inline-block; transform-origin: top center; }
    .header { text-align: center; margin-bottom: 6px; }
    h1 { font-size: 13px; margin: 0 0 2px; font-weight: 700; }
    .meta { font-size: 9px; color: #64748b; margin: 0; }
    .org-root { display: flex; flex-direction: column; align-items: center; }
    .tree { display: flex; flex-direction: column; align-items: center; }
    .tree > .stem { width: 1px; height: 10px; background: #94a3b8; }
    .row {
      display: flex;
      flex-wrap: nowrap;
      justify-content: center;
      align-items: flex-start;
    }
    .col {
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
      padding: 10px 6px 0;
    }
    .col::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      border-top: 1px solid #94a3b8;
    }
    .col::after {
      content: "";
      position: absolute;
      top: 0;
      left: 50%;
      width: 1px;
      height: 10px;
      background: #94a3b8;
      transform: translateX(-50%);
    }
    .col:first-child::before { left: 50%; }
    .col:last-child::before { right: 50%; }
    .col:only-child::before { display: none; }
    .card {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 5px 7px;
      min-width: 96px;
      max-width: 130px;
      text-align: left;
    }
    .card.dir { background: #f0f9ff; border-color: #7dd3fc; }
    .card.dept { background: #f0fdfa; border-color: #5eead4; }
    .card.root {
      background: #0f172a;
      color: #fff;
      border-color: #0f172a;
      text-align: center;
      min-width: 120px;
      max-width: 180px;
    }
    .name { font-size: 10px; font-weight: 700; line-height: 1.2; }
    .sub { font-size: 8px; opacity: 0.8; margin-top: 1px; line-height: 1.2; }
    .title-chip {
      font-size: 7px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
      opacity: 0.7;
    }
    .parent-tag { font-size: 7px; color: #0f766e; margin-top: 1px; }
    .members {
      margin-top: 4px;
      max-width: 130px;
      font-size: 7.5px;
      line-height: 1.25;
      color: #334155;
      text-align: center;
    }
    .members strong { font-weight: 600; color: #0f172a; }
  </style>
</head>
<body>
  <div id="fit-host">
    <div id="fit-root">
      <div class="header">
        <h1>Organograma — ${escapeHtml(chart.name)}</h1>
        <p class="meta">${escapeHtml(generated)} · ${chart.totals.directorates} diretorias · ${chart.totals.departments} departamentos · ${chart.totals.people} pessoas</p>
      </div>
      <div class="org-root">
        <div class="card root">
          <div class="title-chip" style="opacity:.55;color:#fff">Organizacao</div>
          <div class="name">${escapeHtml(chart.name)}</div>
        </div>
        ${
          directorates.length
            ? `<div class="tree"><div class="stem"></div><div class="row">${directorates
                .map((dir) => renderDirectoratePrint(dir))
                .join("")}</div></div>`
            : `<p class="meta" style="margin-top:12px">Nenhuma diretoria para exibir.</p>`
        }
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderDirectoratePrint(dir: HrOrgChartDirectorateNode): string {
  const childDirs = dir.childDirectorates.map((c) => renderDirectoratePrint(c)).join("");
  const depts = dir.departments
    .map((dep) => {
      const leaderLabel = dep.leader ? hrOrgChartPersonLabel(dep.leader) : null;
      const memberNames = dep.members.map((m) => hrOrgChartPersonLabel(m));
      const teamLine = [
        leaderLabel ? `Lider: ${leaderLabel}` : null,
        memberNames.length ? memberNames.join(", ") : null,
      ]
        .filter(Boolean)
        .join(" · ");

      return `<div class="col">
        <div class="card dept">
          <div class="title-chip">Departamento</div>
          <div class="name">${escapeHtml(dep.name)}</div>
          <div class="parent-tag">de ${escapeHtml(dir.name)}</div>
          ${teamLine ? `<div class="members">${escapeHtml(teamLine)}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  return `<div class="col">
    <div class="card dir">
      <div class="title-chip">Diretoria</div>
      <div class="name">${escapeHtml(dir.name)}</div>
      ${
        dir.leader
          ? `<div class="sub">Lider: ${escapeHtml(hrOrgChartPersonLabel(dir.leader))}</div>`
          : ""
      }
    </div>
    ${
      childDirs || depts
        ? `<div class="tree"><div class="stem"></div><div class="row">${childDirs}${depts}</div></div>`
        : ""
    }
  </div>`;
}
