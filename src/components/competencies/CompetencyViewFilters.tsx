import { COMPETENCY_SHIFTS, competencyShiftLabel } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDepartmentOptionDto } from "@/src/lib/competencies/competencyTypes";

export function CompetencyViewFilters({
  departmentId,
  departments,
  shifts,
  onDepartmentChange,
  onToggleShift,
  testId = "competency-view-filters",
  departmentTestId = "competency-filter-department",
  shiftTestId = (shift: string) => `competency-filter-shift-${shift}`,
}: {
  departmentId: string;
  departments: readonly CompetencyDepartmentOptionDto[];
  shifts: readonly string[];
  onDepartmentChange: (departmentId: string) => void;
  onToggleShift: (shift: string) => void;
  testId?: string;
  departmentTestId?: string;
  shiftTestId?: (shift: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid={testId}>
      <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold">
        Departamento
        <select
          value={departmentId}
          onChange={(event) => onDepartmentChange(event.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm font-normal"
          data-testid={departmentTestId}
        >
          <option value="">Todos</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
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
      <p className="max-w-xl text-xs text-muted-foreground">
        O departamento filtra colaboradores pelo vínculo oficial. O turno filtra as competências configuradas. Não há turno cadastrado no colaborador.
      </p>
    </div>
  );
}
