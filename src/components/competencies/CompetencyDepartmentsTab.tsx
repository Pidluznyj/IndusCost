import React, { useEffect, useMemo, useState } from "react";
import { fetchCompetencyCatalog, fetchDepartmentCompetencies, setDepartmentCompetencies } from "@/src/lib/competencies/competencyClient";
import {
  COMPETENCY_CATEGORIES,
  COMPETENCY_SHIFTS,
  competencyCategoryLabel,
  competencyShiftLabel,
} from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDto, DepartmentCompetencyBoard, DepartmentCompetencyLink } from "@/src/lib/competencies/competencyTypes";
import { BTN_GHOST, BTN_PRIMARY, PANEL, PanelState } from "./competencyUi";

/**
 * Associa competências já cadastradas a departamentos oficiais do RH.
 * Não cria departamento e não define nível mínimo.
 */
export function CompetencyDepartmentsTab({ canManage }: { canManage: boolean }) {
  const [board, setBoard] = useState<DepartmentCompetencyBoard | null>(null);
  const [catalog, setCatalog] = useState<CompetencyDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("ALL");
  const [pickedShifts, setPickedShifts] = useState<string[]>([...COMPETENCY_SHIFTS]);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextBoard, nextCatalog] = await Promise.all([fetchDepartmentCompetencies(), fetchCompetencyCatalog()]);
      setBoard(nextBoard);
      setCatalog(nextCatalog.competencies);
      setDepartmentId((current) => current ?? nextBoard.departments[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Não foi possível carregar os departamentos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const department = board?.departments.find((d) => d.id === departmentId) ?? null;
  const linkOf = useMemo(() => new Map((department?.links ?? []).map((link) => [link.competencyId, link])), [department]);
  const visible = catalog.filter((c) => {
    if (category !== "ALL" && c.category !== category) return false;
    const q = query.trim().toLocaleLowerCase("pt-BR");
    return !q || c.name.toLocaleLowerCase("pt-BR").includes(q);
  });

  const saveItems = async (items: { competencyId: string; shifts: string[] | null }[]) => {
    if (!department || !canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      setBoard(await setDepartmentCompetencies(department.id, items));
      setPickedIds([]);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Não foi possível atualizar a associação.");
    } finally {
      setSaving(false);
    }
  };

  const toItem = (link: DepartmentCompetencyLink) => ({
    competencyId: link.competencyId,
    shifts: link.appliesToAllShifts ? null : link.shifts,
  });

  const applyToShifts = () => {
    if (!department || pickedIds.length === 0 || pickedShifts.length === 0) return;
    const shifts = pickedShifts.length === COMPETENCY_SHIFTS.length ? null : [...pickedShifts].sort();
    const next = new Map<string, { competencyId: string; shifts: string[] | null }>();
    for (const link of department.links ?? []) next.set(link.competencyId, toItem(link));
    for (const competencyId of pickedIds) next.set(competencyId, { competencyId, shifts });
    void saveItems([...next.values()]);
  };

  const remove = (competencyId: string) => {
    if (!department) return;
    void saveItems((department.links ?? []).filter((link) => link.competencyId !== competencyId).map(toItem));
  };

  if (loading && !board) return <PanelState kind="loading" message="Carregando departamentos…" />;
  if (error && !board) return <PanelState kind="error" message={error} onRetry={() => void load()} />;
  if (!board || board.departments.length === 0) {
    return (
      <div className={PANEL}>
        <PanelState
          kind="empty"
          testId="competency-departments-empty"
          message="Nenhum departamento ativo. Cadastre-o na Estrutura Organizacional do RH."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]" data-testid="competency-departments">
      <section className={PANEL} aria-label="Departamentos">
        <header className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Departamentos</h3>
        </header>
        <ul className="max-h-[32rem] overflow-y-auto p-2">
          {board.departments.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={`w-full rounded-lg px-3 py-2 text-left text-sm ${d.id === departmentId ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}
                onClick={() => setDepartmentId(d.id)}
                data-testid="competency-department-option"
              >
                <span className="block truncate">{d.name}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {d.competencyIds.length} competência(s) · {d.employees.length} colaborador(es)
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {department ? (
        <section className={PANEL} aria-label={`Competências de ${department.name}`}>
          <header className="space-y-3 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">{department.name}</h3>
              <p className="text-xs text-muted-foreground">
                A mesma competência pode valer para um, vários ou todos os turnos. Isso não cria nível mínimo, não avalia ninguém e não altera o turno do colaborador.
              </p>
            </div>
            <fieldset className="flex flex-wrap items-center gap-3" data-testid="competency-shift-picker">
              <legend className="sr-only">Turnos da configuração</legend>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={pickedShifts.length === COMPETENCY_SHIFTS.length}
                  onChange={() => setPickedShifts(pickedShifts.length === COMPETENCY_SHIFTS.length ? [] : [...COMPETENCY_SHIFTS])}
                  data-testid="competency-shift-all"
                />
                Todos
              </label>
              {COMPETENCY_SHIFTS.map((shift) => (
                <label key={shift} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={pickedShifts.includes(shift)}
                    onChange={() =>
                      setPickedShifts((current) =>
                        current.includes(shift) ? current.filter((item) => item !== shift) : [...current, shift].sort(),
                      )
                    }
                    data-testid={`competency-shift-${shift}`}
                  />
                  {competencyShiftLabel(shift)}
                </label>
              ))}
              {canManage ? (
                <button type="button" className={BTN_PRIMARY} disabled={saving || pickedIds.length === 0 || pickedShifts.length === 0} onClick={applyToShifts} data-testid="competency-apply-shifts">
                  Vincular aos turnos selecionados
                </button>
              ) : null}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar competência"
                className="h-9 min-w-[12rem] flex-1 rounded-md border border-border bg-background px-3 text-sm"
                data-testid="competency-department-search"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                aria-label="Categoria"
              >
                <option value="ALL">Todas as categorias</option>
                {COMPETENCY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {competencyCategoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          </header>
          <ul className="max-h-[24rem] divide-y divide-border/70 overflow-y-auto" data-testid="competency-department-list">
            {visible.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">Nenhuma competência encontrada.</li>
            ) : (
              visible.map((c) => {
                const link = linkOf.get(c.id);
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <label className="flex min-w-0 items-start gap-2">
                      {canManage ? (
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={pickedIds.includes(c.id)}
                          onChange={() =>
                            setPickedIds((current) => (current.includes(c.id) ? current.filter((id) => id !== c.id) : [...current, c.id]))
                          }
                          data-testid="competency-department-pick"
                        />
                      ) : null}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {competencyCategoryLabel(c.category)}
                          {link ? ` · ${link.appliesToAllShifts ? "Todos os turnos" : link.shifts.map(competencyShiftLabel).join(", ")}` : ""}
                        </span>
                      </span>
                    </label>
                    {canManage && link ? (
                      <button type="button" className={BTN_GHOST} disabled={saving} onClick={() => remove(c.id)} data-testid="competency-department-remove">
                        Desassociar
                      </button>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-border px-4 py-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Colaboradores do departamento</h4>
            {department.employees.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nenhum colaborador deste departamento no seu escopo.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="competency-department-employees">
                {department.employees.map((e) => (
                  <li key={e.id} className="rounded-md border border-border px-2 py-1 text-sm">
                    {e.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
