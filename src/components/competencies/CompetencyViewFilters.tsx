import { Info } from "lucide-react";
import { COMPETENCY_SHIFTS, competencyShiftLabel } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDepartmentOptionDto } from "@/src/lib/competencies/competencyTypes";
import { cn } from "@/src/lib/utils";

const FILTER_HELP =
  "O departamento filtra colaboradores pelo vínculo oficial. O turno filtra as competências configuradas. Não há turno cadastrado no colaborador.";

/**
 * Filtros de departamento e turno. `toolbar` = versão compacta da matriz em tela cheia
 * (turnos como chips, explicação no ícone de ajuda); os controles e test ids são os mesmos.
 */
export function CompetencyViewFilters({
  departmentId,
  departments,
  shifts,
  onDepartmentChange,
  onToggleShift,
  variant = "default",
  testId = "competency-view-filters",
  departmentTestId = "competency-filter-department",
  shiftTestId = (shift: string) => `competency-filter-shift-${shift}`,
}: {
  departmentId: string;
  departments: readonly CompetencyDepartmentOptionDto[];
  shifts: readonly string[];
  onDepartmentChange: (departmentId: string) => void;
  onToggleShift: (shift: string) => void;
  variant?: "default" | "toolbar";
  testId?: string;
  departmentTestId?: string;
  shiftTestId?: (shift: string) => string;
}) {
  const departmentSelect = (
    <select
      value={departmentId}
      onChange={(event) => onDepartmentChange(event.target.value)}
      className={cn(
        "h-9 rounded-md border border-border bg-background px-2 text-sm font-normal",
        variant === "toolbar" && "min-w-[14rem] rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40",
      )}
      data-testid={departmentTestId}
    >
      <option value="">Todos os departamentos</option>
      {departments.map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </select>
  );

  if (variant === "toolbar") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid={testId}>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Departamento</span>
          {departmentSelect}
        </label>
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Turnos</legend>
          <span className="mr-1 text-xs font-medium text-muted-foreground" aria-hidden>
            Turnos
          </span>
          {COMPETENCY_SHIFTS.map((shift) => {
            const on = shifts.includes(shift);
            return (
              <label
                key={shift}
                className={cn(
                  "inline-flex h-8 cursor-pointer select-none items-center rounded-full border px-3 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-primary/40",
                  on
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-background text-foreground hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() => onToggleShift(shift)}
                  data-testid={shiftTestId(shift)}
                />
                {competencyShiftLabel(shift)}
              </label>
            );
          })}
          <span className="ml-1 inline-flex text-muted-foreground" title={FILTER_HELP} aria-label={FILTER_HELP} role="img">
            <Info className="h-4 w-4" aria-hidden />
          </span>
        </fieldset>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3" data-testid={testId}>
      <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold">
        Departamento
        {departmentSelect}
      </label>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="text-xs font-semibold">Turnos</legend>
        {COMPETENCY_SHIFTS.map((shift) => (
          <label key={shift} className="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={shifts.includes(shift)}
              onChange={() => onToggleShift(shift)}
              data-testid={shiftTestId(shift)}
            />
            {competencyShiftLabel(shift)}
          </label>
        ))}
      </fieldset>
      <p className="max-w-xl text-xs text-muted-foreground">{FILTER_HELP}</p>
    </div>
  );
}
