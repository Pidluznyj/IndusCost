/**
 * Nine-Box: desempenho (horizontal) × potencial (vertical). Cultura é indicador ao lado,
 * nunca eixo. Sem evidência suficiente a pessoa fica fora da grade. Antes da
 * homologação tudo é preliminar. A matriz não aplica promoção, salário ou penalidade.
 */
import React, { useEffect, useMemo, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import { NINE_BOX_BAND_LABELS, UNCLASSIFIED_QUADRANT, type NineBoxBand } from "@/src/lib/hrPerformance/performanceDomain";
import { fetchPerformanceDashboard, performanceExportUrl, performanceReportPrintUrl, type CycleDashboard, type NineBoxCell } from "@/src/lib/hrPerformance/performanceClient";
import { BTN_SECONDARY, CultureBadge, ErrorBanner, InfoBanner, OfficialBadge, PANEL, PanelState, ValidationBadge } from "./performanceUi";
import { cn } from "@/src/lib/utils";

const ROWS: NineBoxBand[] = ["HIGH", "MID", "LOW"];
const COLS: NineBoxBand[] = ["LOW", "MID", "HIGH"];

export function PerformanceNineBoxTab({ cycleId, canReport }: { cycleId: string | null; canReport: boolean }) {
  const [board, setBoard] = useState<CycleDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ department: "", role: "", manager: "" });
  const [view, setView] = useState<"official" | "preliminary">("official");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!cycleId) return;
    const params: Record<string, string> = {};
    for (const [field, value] of Object.entries(filters) as [string, string][]) if (value) params[field] = value;
    void fetchPerformanceDashboard(cycleId, params)
      .then((next) => {
        setBoard(next);
        setError(null);
        if (!next.cells.some((c) => c.official)) setView("preliminary");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar a Nine-Box."));
  }, [cycleId, filters]);

  const cells = useMemo(() => (board?.cells ?? []).filter((c) => (view === "official" ? c.official : true)), [board, view]);
  const placed = cells.filter((c) => c.quadrant !== UNCLASSIFIED_QUADRANT && c.nineX && c.nineY);
  const unplaced = cells.filter((c) => !placed.includes(c));
  const inCell = (x: NineBoxBand, y: NineBoxBand) => placed.filter((c) => c.nineX === x && c.nineY === y);
  const key = (x: NineBoxBand, y: NineBoxBand) => `${x}-${y}`;
  const selectedPeople = selected ? (selected === "none" ? unplaced : placed.filter((c) => key(c.nineX as NineBoxBand, c.nineY as NineBoxBand) === selected)) : [];

  if (!cycleId) return <div className={PANEL}><PanelState kind="empty" message="Escolha um ciclo na aba Ciclos." /></div>;
  if (!board) return <div className={PANEL}>{error ? <PanelState kind="error" message={error} /> : <PanelState kind="loading" message="Carregando…" />}</div>;

  const officialCount = board.cells.filter((c) => c.official).length;

  return (
    <section className="space-y-4" data-testid="perf-ninebox-tab">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Horizontal: desempenho técnico validado. Vertical: potencial. Cultura aparece ao lado de cada pessoa e não muda a posição. Ninguém é posicionado sem evidência suficiente.
        </p>
        {canReport ? (
          <div className="flex flex-wrap gap-2">
            <a className={BTN_SECONDARY} href={performanceReportPrintUrl(cycleId, "ninebox")} target="_blank" rel="noopener" data-testid="perf-ninebox-report">
              <Printer className="h-4 w-4" aria-hidden /> Relatório da Nine-Box
            </a>
            <a className={BTN_SECONDARY} href={performanceExportUrl(cycleId)}>
              <FileDown className="h-4 w-4" aria-hidden /> CSV
            </a>
          </div>
        ) : null}
      </div>
      <ErrorBanner message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Situação" className="inline-flex rounded-md border border-border bg-muted/60 p-0.5">
          {(
            [
              ["official", `Oficial (${officialCount})`],
              ["preliminary", `Preliminar e oficial (${board.cells.length})`],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={view === value} onClick={() => setView(value)} className={cn("rounded px-3 py-1.5 text-sm font-medium", view === value ? "bg-card shadow-sm" : "text-muted-foreground")} data-testid={`perf-ninebox-view-${value}`}>
              {label}
            </button>
          ))}
        </div>
        {(["department", "role", "manager"] as const).map((field) => {
          const options = field === "department" ? board.filters.departments : field === "role" ? board.filters.roles : board.filters.managers;
          const label = field === "department" ? "setor" : field === "role" ? "cargo" : "líder";
          return (
            <select key={field} className="h-9 rounded-lg border border-border bg-card px-2 text-sm" aria-label={`Filtrar ${label}`} value={filters[field]} onChange={(e) => setFilters({ ...filters, [field]: e.target.value })} data-testid={`perf-ninebox-filter-${field}`}>
              <option value="">{`Todos: ${label}`}</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          );
        })}
      </div>
      {view === "preliminary" ? <InfoBanner tone="amber">Visão preliminar: inclui posições ainda não homologadas. Não use para decisão.</InfoBanner> : null}
      {board.lowSample ? <InfoBanner tone="amber">Amostra pequena ({cells.length} pessoa(s), menos de {board.lowSampleThreshold}). Leia como casos individuais, não como distribuição.</InfoBanner> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className={`${PANEL} p-3`}>
          <div className="grid grid-cols-[28px_repeat(3,minmax(0,1fr))] gap-2">
            <div />
            {COLS.map((x) => (
              <p key={x} className="text-center text-xs font-semibold uppercase text-muted-foreground">
                Desempenho {NINE_BOX_BAND_LABELS[x]}
              </p>
            ))}
            {ROWS.map((y) => (
              <React.Fragment key={y}>
                <p className="flex items-center justify-center text-xs font-semibold uppercase text-muted-foreground [writing-mode:vertical-rl] rotate-180">Potencial {NINE_BOX_BAND_LABELS[y]}</p>
                {COLS.map((x) => {
                  const people = inCell(x, y);
                  const id = key(x, y);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelected(selected === id ? null : id)}
                      aria-pressed={selected === id}
                      className={cn("flex min-h-24 flex-col rounded-lg border p-2 text-left transition-colors", selected === id ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
                      data-testid={`perf-ninebox-cell-${id}`}
                    >
                      <span className="text-2xl font-bold tabular-nums">{people.length}</span>
                      <span className="mt-auto line-clamp-3 text-xs text-muted-foreground">{people.map((p) => p.name).join(", ")}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <button type="button" onClick={() => setSelected(selected === "none" ? null : "none")} className={cn("mt-3 w-full rounded-lg border px-3 py-2 text-left text-sm", selected === "none" ? "border-primary bg-primary/10" : "border-dashed border-border")} data-testid="perf-ninebox-unplaced">
            Sem classificação (evidência insuficiente ou técnico não validado): <strong>{unplaced.length}</strong>
          </button>
        </div>
        <aside className={`${PANEL} p-3`} data-testid="perf-ninebox-detail">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Toque em um quadrante para ver as pessoas, as notas e a cultura.</p>
          ) : selectedPeople.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguém neste quadrante.</p>
          ) : (
            <ul className="space-y-3">
              {selectedPeople.map((cell) => (
                <React.Fragment key={cell.participantId}>
                  <PersonCard cell={cell} />
                </React.Fragment>
              ))}
            </ul>
          )}
        </aside>
      </div>
      <div className={`${PANEL} p-3`}>
        <p className="mb-2 text-sm font-semibold">Cultura e comportamento (independente da matriz)</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(board.culture).map(([band, count]) => (
            <span key={band} className="inline-flex items-center gap-2">
              {band === "NONE" ? <span className="text-xs text-muted-foreground">Sem avaliação</span> : <CultureBadge band={band} />}
              <strong className="tabular-nums">{count}</strong>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonCard({ cell }: { cell: NineBoxCell }) {
  return (
    <li className="rounded-lg border border-border p-2 text-sm" data-testid={`perf-ninebox-person-${cell.name}`}>
      <p className="font-semibold">{cell.name}</p>
      <p className="text-xs text-muted-foreground">
        {cell.roleName} · {cell.departmentName} · líder {cell.managerName ?? "—"}
      </p>
      <p className="mt-1 text-xs">
        Técnico <strong>{cell.technical ?? "—"}</strong> · Potencial <strong>{cell.potential ?? "—"}</strong> · Cultura {cell.culture ?? "—"}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        <OfficialBadge official={cell.official} adjusted={cell.adjusted} />
        <CultureBadge band={cell.cultureBand} />
        <ValidationBadge value={cell.technicalValidation} />
      </div>
    </li>
  );
}
