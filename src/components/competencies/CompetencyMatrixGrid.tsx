import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { COMPETENCY_LEVEL_LABELS, competencyLevelLabel, formatIsoDateBr } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";
import { cn } from "@/src/lib/utils";
import type { MatrixCompetencyGroup } from "./competencyMatrixGroups";
import { LevelChip, PanelState, levelToneClass } from "./competencyUi";

type MatrixRow = CompetencyMatrixResponse["rows"][number];
type MatrixCell = MatrixRow["cells"][number];

export type MatrixOpenCell = {
  row: MatrixRow;
  cell: MatrixCell;
  competencyName: string;
  rect: DOMRect;
};

export function MatrixLevelLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Legenda dos níveis">
      {([1, 2, 3, 4] as const).map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5">
          <LevelChip level={level} /> {COMPETENCY_LEVEL_LABELS[level]}
        </span>
      ))}
    </div>
  );
}

/** Largura que cabe o nome completo em até duas linhas (sem reticências). */
const NAME_COL = "w-44 min-w-44 max-w-44 sm:w-72 sm:min-w-72 sm:max-w-72";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
const COMPETENCY_ROW = "top-9";

function cellTitle(row: MatrixRow, competencyName: string, cell: MatrixCell): string {
  const parts = [`${row.employeeName} · ${competencyName}: ${competencyLevelLabel(cell.level)}`];
  if (cell.pending) parts.push(`— aguardando aprovação para ${cell.pending.toLevel}`);
  if (cell.recycling === "EXPIRED") {
    parts.push(`— reciclagem vencida em ${formatIsoDateBr(cell.recyclingExpiresOn)}; nível registrado ${cell.storedLevel}`);
  }
  return parts.join(" ");
}

function LevelCell({
  row,
  cell,
  competencyName,
  canEdit,
  onOpenCell,
}: {
  row: MatrixRow;
  cell: MatrixCell;
  competencyName: string;
  canEdit: boolean;
  onOpenCell: (open: MatrixOpenCell) => void;
}) {
  const content = (
    <>
      <span className="text-sm font-bold tabular-nums">{cell.level > 0 ? cell.level : "—"}</span>
      {cell.pending ? (
        <span className="text-[10px] font-semibold text-amber-800" data-testid="competency-matrix-pending">
          aprovação → {cell.pending.toLevel}
        </span>
      ) : null}
    </>
  );
  const cls = cn(
    "mx-auto flex h-11 w-full max-w-[96px] flex-col items-center justify-center rounded-lg",
    levelToneClass(cell.level),
    cell.recycling === "EXPIRED" && "underline decoration-dotted",
  );
  if (canEdit && row.writable) {
    return (
      <button
        type="button"
        className={cn(cls, "transition-shadow hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary")}
        title={cellTitle(row, competencyName, cell)}
        data-below-minimum={cell.belowMinimum || undefined}
        data-testid="competency-matrix-cell"
        onClick={(event) => onOpenCell({ row, cell, competencyName, rect: event.currentTarget.getBoundingClientRect() })}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={cls} title={cellTitle(row, competencyName, cell)} data-below-minimum={cell.belowMinimum || undefined} data-testid="competency-matrix-cell">
      {content}
    </div>
  );
}

function GroupCount({ n }: { n: number }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border">
      {n}
    </span>
  );
}

/** Uma tabela: coluna do colaborador e cabeçalho grudados no contêiner que rola. */
export function CompetencyMatrixGrid({
  matrix,
  groups,
  groupingStatus = "ready",
  groupingMessage,
  canEdit,
  expandedKeys,
  onToggleGroup,
  onOpenCell,
  onRetry,
}: {
  matrix: { status: "loading" | "ready" | "error"; data: CompetencyMatrixResponse | null; message?: string };
  groups: readonly MatrixCompetencyGroup<CompetencyMatrixResponse["competencies"][number]>[];
  groupingStatus?: "loading" | "ready" | "error";
  groupingMessage?: string;
  canEdit: boolean;
  expandedKeys: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  onOpenCell: (open: MatrixOpenCell) => void;
  onRetry: () => void;
}) {
  const data = matrix.data;
  const cellsByEmployee = useMemo(() => {
    const byEmployee = new Map<string, Map<string, MatrixCell>>();
    for (const row of data?.rows ?? []) byEmployee.set(row.employeeId, new Map(row.cells.map((cell) => [cell.competencyId, cell])));
    return byEmployee;
  }, [data?.rows]);

  if (matrix.status === "error" && !data) {
    return <PanelState kind="error" message={matrix.message} onRetry={onRetry} testId="competency-matrix-error" />;
  }
  if (!data) return <PanelState kind="loading" message="Carregando matriz…" />;
  if (groupingStatus === "loading") return <PanelState kind="loading" message="Carregando departamentos…" />;
  if (groupingStatus === "error") {
    return (
      <PanelState
        kind="error"
        message={groupingMessage ?? "Não foi possível carregar os departamentos."}
        onRetry={onRetry}
        testId="competency-matrix-grouping-error"
      />
    );
  }
  if (data.rows.length === 0 || groups.length === 0) {
    return (
      <PanelState
        kind="empty"
        testId="competency-matrix-empty"
        message={
          data.rows.length === 0
            ? "Nenhum colaborador ativo no seu escopo."
            : data.competencies.length === 0
              ? "Nenhuma competência neste filtro. Ajuste o departamento ou os turnos."
              : "Nenhuma competência associada a este departamento no turno selecionado."
        }
      />
    );
  }

  return (
    <table className="w-max border-separate border-spacing-0 text-sm" data-testid="competency-matrix-grid">
      <thead>
        <tr>
          <th
            scope="col"
            rowSpan={2}
            className={cn(
              "sticky left-0 top-0 z-40 border-b border-r border-border bg-card px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
              NAME_COL,
            )}
          >
            Colaborador
          </th>
          {groups.map((group) => {
            const expanded = expandedKeys.has(group.key);
            return (
              <th
                key={group.key}
                scope="colgroup"
                rowSpan={expanded ? 1 : 2}
                colSpan={expanded ? group.columns.length : 1}
                className={cn(
                  "sticky top-0 z-20 border-b border-r border-border p-0",
                  // Opaco: o cabeçalho é sticky e não pode deixar as células aparecerem por trás.
                  expanded ? "bg-[color-mix(in_srgb,var(--color-primary)_7%,var(--color-card))]" : "bg-muted",
                  expanded ? "left-auto h-9" : "w-9 min-w-9 max-w-9",
                )}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  title={`${expanded ? "Recolher" : "Expandir"} ${group.label} (${group.columns.length})`}
                  className={cn(
                    "flex h-full w-full items-center justify-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                    expanded ? "text-primary hover:bg-primary/10" : "text-foreground hover:bg-background",
                  )}
                  onClick={() => onToggleGroup(group.key)}
                  data-testid={`competency-matrix-group-${group.key}`}
                >
                  {expanded ? (
                    <>
                      <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{group.label}</span>
                      <GroupCount n={group.columns.length} />
                    </>
                  ) : (
                    <span className="flex flex-col items-center gap-1.5 py-2">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="inline-block max-h-44 overflow-hidden text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] rotate-180">
                        {group.label}
                      </span>
                      <GroupCount n={group.columns.length} />
                    </span>
                  )}
                </button>
              </th>
            );
          })}
        </tr>
        <tr>
          {groups.map((group) =>
            expandedKeys.has(group.key)
              ? group.columns.map((column) => (
                  <th
                    key={column.columnKey}
                    scope="col"
                    data-column={column.columnKey}
                    data-competency-id={column.competency.id}
                    className={cn(
                      "sticky z-20 h-16 w-[7.25rem] min-w-[6.75rem] max-w-[8.5rem] border-b border-border bg-card px-1.5 py-1 text-center align-bottom",
                      COMPETENCY_ROW,
                    )}
                  >
                    <span className="line-clamp-3 text-xs font-semibold leading-tight text-foreground" title={column.competency.name}>
                      {column.competency.name}
                    </span>
                    {column.competency.critical ? (
                      <span className="mt-0.5 block text-[10px] font-semibold text-rose-700">Crítica</span>
                    ) : null}
                  </th>
                ))
              : null,
          )}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => {
          const cells = cellsByEmployee.get(row.employeeId);
          return (
            <tr key={row.employeeId} className="group" data-testid="competency-matrix-row">
              <th
                scope="row"
                className={cn(
                  "sticky left-0 z-30 border-b border-r border-border bg-card px-3 py-2 text-left font-normal transition-colors group-hover:bg-muted sm:px-4",
                  NAME_COL,
                )}
              >
                <span className="flex items-center gap-3">
                  <span
                    className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary sm:flex"
                    aria-hidden
                  >
                    {initials(row.employeeName)}
                  </span>
                  <span className="min-w-0">
                    <span className="block whitespace-normal break-words text-sm font-semibold leading-snug text-foreground" data-testid="competency-matrix-employee-name">
                      {row.employeeName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{row.departmentName ?? "Sem departamento"}</span>
                  </span>
                </span>
              </th>
              {groups.map((group) => {
                if (!expandedKeys.has(group.key)) {
                  return (
                    <td
                      key={group.key}
                      className="border-b border-r border-border bg-muted/70 bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,rgba(148,163,184,0.12)_6px,rgba(148,163,184,0.12)_7px)]"
                      data-testid="competency-matrix-group-collapsed"
                      data-group={group.key}
                    >
                      <span className="sr-only">
                        {group.label} recolhida, {group.columns.length} competências
                      </span>
                    </td>
                  );
                }
                return group.columns.map((column) => {
                  const cell = cells?.get(column.competency.id);
                  return (
                    <td
                      key={column.columnKey}
                      data-column={column.columnKey}
                      data-competency-id={column.competency.id}
                      className="border-b border-border/70 bg-card px-1.5 py-1.5 transition-colors group-hover:bg-muted/50"
                    >
                      {cell ? (
                        <LevelCell
                          row={row}
                          cell={cell}
                          competencyName={column.competency.name}
                          canEdit={canEdit}
                          onOpenCell={onOpenCell}
                        />
                      ) : null}
                    </td>
                  );
                });
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
