import React, { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { COMPETENCY_LEVEL_LABELS, competencyLevelLabel, formatIsoDateBr } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyMatrixResponse } from "@/src/lib/competencies/competencyTypes";
import { cn } from "@/src/lib/utils";
import { groupMatrixCompetencies } from "./competencyMatrixGroups";
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

const NAME_COL = "w-36 min-w-36 max-w-36";
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

/** Uma tabela: coluna do colaborador e cabeçalho grudados no contêiner que rola. */
export function CompetencyMatrixGrid({
  matrix,
  canEdit,
  expandedKeys,
  onToggleGroup,
  onOpenCell,
  onRetry,
}: {
  matrix: { status: "loading" | "ready" | "error"; data: CompetencyMatrixResponse | null; message?: string };
  canEdit: boolean;
  expandedKeys: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  onOpenCell: (open: MatrixOpenCell) => void;
  onRetry: () => void;
}) {
  const data = matrix.data;
  const groups = useMemo(() => groupMatrixCompetencies(data?.competencies ?? []), [data?.competencies]);
  const cellsByEmployee = useMemo(() => {
    const byEmployee = new Map<string, Map<string, MatrixCell>>();
    for (const row of data?.rows ?? []) byEmployee.set(row.employeeId, new Map(row.cells.map((cell) => [cell.competencyId, cell])));
    return byEmployee;
  }, [data?.rows]);

  if (matrix.status === "error" && !data) {
    return <PanelState kind="error" message={matrix.message} onRetry={onRetry} testId="competency-matrix-error" />;
  }
  if (!data) return <PanelState kind="loading" message="Carregando matriz…" />;
  if (data.competencies.length === 0 || data.rows.length === 0) {
    return (
      <PanelState
        kind="empty"
        testId="competency-matrix-empty"
        message={
          data.competencies.length === 0
            ? "Nenhuma competência neste filtro. Ajuste o departamento ou os turnos."
            : "Nenhum colaborador ativo no seu escopo."
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
              "sticky left-0 top-0 z-40 border-b border-r border-border bg-card px-3 text-left text-xs font-semibold text-muted-foreground",
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
                colSpan={expanded ? group.competencies.length : 1}
                className={cn(
                  "sticky top-0 z-20 border-b border-r border-border bg-muted p-0",
                  expanded ? "left-auto h-9" : "w-9 min-w-9 max-w-9",
                )}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  title={expanded ? `Recolher ${group.label}` : `Expandir ${group.label}`}
                  className="flex h-full w-full items-center justify-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  onClick={() => onToggleGroup(group.key)}
                  data-testid={`competency-matrix-group-${group.key}`}
                >
                  {expanded ? (
                    <>
                      <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">
                        {group.label} ({group.competencies.length})
                      </span>
                    </>
                  ) : (
                    <span className="inline-block max-h-16 overflow-hidden py-1 [writing-mode:vertical-rl] rotate-180">
                      {group.label} ({group.competencies.length})
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
              ? group.competencies.map((competency) => (
                  <th
                    key={competency.id}
                    scope="col"
                    className={cn(
                      "sticky z-20 h-16 w-[7.25rem] min-w-[6.75rem] max-w-[8.5rem] border-b border-border bg-card px-1.5 py-1 text-center align-bottom",
                      COMPETENCY_ROW,
                    )}
                  >
                    <span className="line-clamp-3 text-xs font-semibold leading-tight text-foreground" title={competency.name}>
                      {competency.name}
                    </span>
                    {competency.critical ? (
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
            <tr key={row.employeeId} data-testid="competency-matrix-row">
              <th
                scope="row"
                className={cn(
                  "sticky left-0 z-30 border-b border-r border-border bg-card px-3 py-2 text-left font-normal",
                  NAME_COL,
                )}
              >
                <span className="block truncate text-sm font-semibold" title={row.employeeName}>
                  {row.employeeName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{row.departmentName ?? "Sem departamento"}</span>
              </th>
              {groups.map((group) => {
                if (!expandedKeys.has(group.key)) {
                  return (
                    <td
                      key={group.key}
                      className="border-b border-r border-border bg-muted"
                      data-testid="competency-matrix-group-collapsed"
                      data-group={group.key}
                    >
                      <span className="sr-only">
                        {group.label} recolhida, {group.competencies.length} competências
                      </span>
                    </td>
                  );
                }
                return group.competencies.map((competency) => {
                  const cell = cells?.get(competency.id);
                  return (
                    <td key={competency.id} className="border-b border-border/70 bg-card px-1.5 py-1.5">
                      {cell ? (
                        <LevelCell
                          row={row}
                          cell={cell}
                          competencyName={competency.name}
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
