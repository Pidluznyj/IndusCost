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
        "flex min-w-[200px] max-w-[240px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm",
        tone === "root" && "border-slate-700 bg-slate-800 text-white",
        tone === "directorate" && "border-sky-200 bg-sky-50 text-sky-950",
        tone === "department" && "border-teal-200 bg-teal-50 text-teal-950",
        tone === "member" && "border-border bg-card text-foreground"
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold",
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

function ConnectorDown() {
  return <div className="mx-auto h-5 w-px bg-border" aria-hidden />;
}

function BranchBar({ count }: { count: number }) {
  if (count <= 1) return null;
  return (
    <div className="relative mx-auto h-px w-full max-w-full bg-border" aria-hidden>
      <div className="absolute inset-x-[12.5%] top-0 h-px bg-border" />
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
    if (!q) return chart.directorates;
    return chart.directorates.filter((dir) => {
      if (dir.name.toLowerCase().includes(q) || matchesPerson(dir.leader)) return true;
      return dir.departments.some(
        (dep) =>
          dep.name.toLowerCase().includes(q) ||
          matchesPerson(dep.leader) ||
          dep.members.some((m) => matchesPerson(m))
      );
    });
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
    const node = canvasRef.current;
    if (!node || !chart) return;
    const win = window.open("", "_blank", "noopener,noreferrer,width=1200,height=800");
    if (!win) {
      window.print();
      return;
    }
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Organograma — ${chart.name}</title>
  <style>
    @page { size: A3 landscape; margin: 12mm; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; margin: 0; background: #fff; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { font-size: 11px; color: #64748b; margin-bottom: 16px; }
    .org-root { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .row { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; }
    .col { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 10px 12px; min-width: 180px; max-width: 220px; }
    .card.dir { background: #f0f9ff; border-color: #bae6fd; }
    .card.dept { background: #f0fdfa; border-color: #99f6e4; }
    .card.member { background: #fff; }
    .card.root { background: #0f172a; color: #fff; border-color: #0f172a; }
    .name { font-size: 13px; font-weight: 600; }
    .sub { font-size: 10px; opacity: 0.75; margin-top: 2px; }
    .title-chip { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; opacity: 0.7; }
    .line { width: 1px; height: 14px; background: #cbd5e1; margin: 0 auto; }
    .members { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>Organograma — ${escapeHtml(chart.name)}</h1>
  <div class="meta">Gerado em ${new Date(chart.generatedAt).toLocaleString("pt-BR")} · ${chart.totals.directorates} diretorias · ${chart.totals.departments} departamentos · ${chart.totals.people} pessoas</div>
  <div class="org-root">
    <div class="card root"><div class="name">${escapeHtml(chart.name)}</div><div class="sub">Estrutura organizacional</div></div>
    <div class="line"></div>
    <div class="row">
      ${filteredDirectorates
        .map((dir) => renderDirectoratePrint(dir))
        .join("")}
    </div>
  </div>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
    win.document.write(html);
    win.document.close();
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
            Exportar PDF
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-border bg-gradient-to-b from-slate-50 to-white p-6 dark:from-slate-950 dark:to-background">
        <div
          ref={canvasRef}
          className="origin-top transition-transform duration-200"
          style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%` }}
        >
          <div className="flex flex-col items-center gap-2 pb-8">
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
              <>
                <ConnectorDown />
                <BranchBar count={filteredDirectorates.length} />
                <div className="flex flex-wrap justify-center gap-8">
                  {filteredDirectorates.map((dir) => (
                    <DirectorateBranch
                      key={dir.id}
                      node={dir}
                      collapsed={collapsedDirs.has(dir.id)}
                      collapsedDepts={collapsedDepts}
                      onToggle={() => toggleDir(dir.id)}
                      onToggleDept={toggleDept}
                      highlightQuery={q}
                      matchesPerson={matchesPerson}
                    />
                  ))}
                </div>
              </>
            )}

            {chart.unassigned.length > 0 ? (
              <div className="mt-10 w-full max-w-4xl">
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
  onToggle,
  onToggleDept,
  highlightQuery,
  matchesPerson,
}: {
  node: HrOrgChartDirectorateNode;
  collapsed: boolean;
  collapsedDepts: Set<string>;
  onToggle: () => void;
  onToggleDept: (id: string) => void;
  highlightQuery: string;
  matchesPerson: (p: HrOrgChartPerson | null | undefined) => boolean;
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
    );

  return (
    <div className={cn("flex flex-col items-center gap-2", dim && "opacity-30")}>
      <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700/80">Diretoria</p>
            <p className="text-sm font-semibold text-sky-950">{node.name}</p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1 text-sky-700 hover:bg-sky-100"
            title={collapsed ? "Expandir" : "Recolher"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
        {node.leader ? (
          <PersonCard person={node.leader} tone="directorate" subtitle="Líder da diretoria" />
        ) : (
          <p className="text-xs text-muted-foreground">Sem líder</p>
        )}
        <p className="mt-2 text-[10px] text-sky-800/70">
          {node.departments.length} dept. · {node.peopleCount} pessoas
        </p>
      </div>

      {!collapsed && node.departments.length > 0 ? (
        <>
          <ConnectorDown />
          <div className="flex flex-wrap justify-center gap-5">
            {node.departments.map((dep) => (
              <DepartmentBranch
                key={dep.id}
                node={dep}
                collapsed={collapsedDepts.has(dep.id)}
                onToggle={() => onToggleDept(dep.id)}
                highlightQuery={highlightQuery}
                matchesPerson={matchesPerson}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DepartmentBranch({
  node,
  collapsed,
  onToggle,
  highlightQuery,
  matchesPerson,
}: {
  node: HrOrgChartDepartmentNode;
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

  return (
    <div className={cn("flex flex-col items-center gap-2", dim && "opacity-30")}>
      <div className="rounded-2xl border border-teal-200 bg-teal-50/80 p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-teal-700/80">
              Departamento
            </p>
            <p className="text-sm font-semibold text-teal-950">{node.name}</p>
          </div>
          {node.members.length > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-teal-700 hover:bg-teal-100"
              title={collapsed ? "Ver equipe" : "Ocultar equipe"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : null}
        </div>
        {node.leader ? (
          <PersonCard person={node.leader} tone="department" subtitle="Líder do departamento" />
        ) : (
          <p className="text-xs text-muted-foreground">Sem líder</p>
        )}
        <p className="mt-2 text-[10px] text-teal-800/70">{node.memberCount} no time</p>
      </div>

      {!collapsed && node.members.length > 0 ? (
        <>
          <ConnectorDown />
          <div className="flex max-w-[520px] flex-wrap justify-center gap-2">
            {node.members.map((m) => (
              <PersonCard key={m.id} person={m} tone="member" />
            ))}
          </div>
        </>
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

function renderDirectoratePrint(dir: HrOrgChartDirectorateNode): string {
  return `<div class="col">
    <div class="card dir">
      <div class="title-chip">Diretoria</div>
      <div class="name">${escapeHtml(dir.name)}</div>
      ${
        dir.leader
          ? `<div class="sub">Líder: ${escapeHtml(hrOrgChartPersonLabel(dir.leader))}</div>`
          : ""
      }
    </div>
    <div class="line"></div>
    <div class="row">
      ${dir.departments
        .map(
          (dep) => `<div class="col">
        <div class="card dept">
          <div class="title-chip">Departamento</div>
          <div class="name">${escapeHtml(dep.name)}</div>
          ${
            dep.leader
              ? `<div class="sub">Líder: ${escapeHtml(hrOrgChartPersonLabel(dep.leader))}</div>`
              : ""
          }
        </div>
        ${
          dep.members.length
            ? `<div class="line"></div><div class="members">${dep.members
                .map(
                  (m) =>
                    `<div class="card member"><div class="name">${escapeHtml(
                      hrOrgChartPersonLabel(m)
                    )}</div><div class="sub">${escapeHtml(
                      m.roleName ?? "Colaborador"
                    )}</div></div>`
                )
                .join("")}</div>`
            : ""
        }
      </div>`
        )
        .join("")}
    </div>
  </div>`;
}
