import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Plus, Save, Users } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { SearchableSelect } from "@/src/components/shared/SearchableSelect";

type LeaderOption = { value: string; label: string; searchTerms?: string };

export type HrDirectorateRow = {
  id: string;
  code: string | null;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  leaderEmployeeId: string;
  notes: string | null;
  leader: { id: string; name: string; socialName: string | null; status: string | null } | null;
  departmentCount: number;
  departments: { id: string; name: string; status: string }[];
};

export type HrDepartmentRow = {
  id: string;
  code: string | null;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  directorateId: string;
  leaderEmployeeId: string;
  notes: string | null;
  leader: { id: string; name: string; socialName: string | null; status: string | null } | null;
  directorate: { id: string; name: string; status: string; code: string | null } | null;
  employeeCount: number;
};

type Props = {
  canManage: boolean;
  managerOptions: LeaderOption[];
  onRequestManagers: (term: string) => void;
  searchingManagers: boolean;
};

const INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20";

function emptyDirectorateForm() {
  return { name: "", code: "", leaderEmployeeId: "", notes: "", status: "ACTIVE" as const };
}

function emptyDepartmentForm() {
  return {
    name: "",
    code: "",
    directorateId: "",
    leaderEmployeeId: "",
    notes: "",
    status: "ACTIVE" as const,
  };
}

export function EmployeeOrgStructurePanel({
  canManage,
  managerOptions,
  onRequestManagers,
  searchingManagers,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directorates, setDirectorates] = useState<HrDirectorateRow[]>([]);
  const [departments, setDepartments] = useState<HrDepartmentRow[]>([]);
  const [selectedDirectorateId, setSelectedDirectorateId] = useState<string | null>(null);
  const [dirForm, setDirForm] = useState(emptyDirectorateForm());
  const [editingDirId, setEditingDirId] = useState<string | null>(null);
  const [deptForm, setDeptForm] = useState(emptyDepartmentForm());
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dirs, depts] = await Promise.all([
        fetchJsonOk<{ rows: HrDirectorateRow[] }>("/api/employees/org/directorates"),
        fetchJsonOk<{ rows: HrDepartmentRow[] }>("/api/employees/org/departments"),
      ]);
      setDirectorates(dirs.rows ?? []);
      setDepartments(depts.rows ?? []);
      if (!selectedDirectorateId && (dirs.rows?.length ?? 0) > 0) {
        setSelectedDirectorateId(dirs.rows[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar estrutura.");
    } finally {
      setLoading(false);
    }
  }, [selectedDirectorateId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const departmentsOfSelected = useMemo(
    () =>
      departments.filter((d) =>
        selectedDirectorateId ? d.directorateId === selectedDirectorateId : true
      ),
    [departments, selectedDirectorateId]
  );

  const directorateOptions = useMemo(
    () =>
      directorates
        .filter((d) => d.status === "ACTIVE" || d.id === deptForm.directorateId)
        .map((d) => ({
          value: d.id,
          label: d.name,
          searchTerms: `${d.name} ${d.code ?? ""}`,
        })),
    [directorates, deptForm.directorateId]
  );

  async function saveDirectorate() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      if (editingDirId) {
        await fetchJsonOk(`/api/employees/org/directorates/${editingDirId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dirForm),
        });
      } else {
        await fetchJsonOk("/api/employees/org/directorates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dirForm),
        });
      }
      setDirForm(emptyDirectorateForm());
      setEditingDirId(null);
      await load();
    } catch (err) {
      setError(
        err instanceof HttpError
          ? String((err.body as { error?: string })?.error ?? err.message)
          : err instanceof Error
            ? err.message
            : "Erro ao salvar diretoria."
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveDepartment() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      if (editingDeptId) {
        await fetchJsonOk(`/api/employees/org/departments/${editingDeptId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deptForm),
        });
      } else {
        await fetchJsonOk("/api/employees/org/departments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deptForm),
        });
      }
      setDeptForm(emptyDepartmentForm());
      setEditingDeptId(null);
      await load();
    } catch (err) {
      setError(
        err instanceof HttpError
          ? String((err.body as { error?: string })?.error ?? err.message)
          : err instanceof Error
            ? err.message
            : "Erro ao salvar departamento."
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditDirectorate(row: HrDirectorateRow) {
    setEditingDirId(row.id);
    setDirForm({
      name: row.name,
      code: row.code ?? "",
      leaderEmployeeId: row.leaderEmployeeId,
      notes: row.notes ?? "",
      status: row.status,
    });
    setSelectedDirectorateId(row.id);
  }

  function startEditDepartment(row: HrDepartmentRow) {
    setEditingDeptId(row.id);
    setDeptForm({
      name: row.name,
      code: row.code ?? "",
      directorateId: row.directorateId,
      leaderEmployeeId: row.leaderEmployeeId,
      notes: row.notes ?? "",
      status: row.status,
    });
    setSelectedDirectorateId(row.directorateId);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Carregando estrutura organizacional...
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="employee-org-structure-panel">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Estrutura organizacional</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Cadastre diretorias e departamentos com líder obrigatório. Essa hierarquia será a base
              para liberar visões de pessoas por nível (diretoria → departamento → colaboradores).
            </p>
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Diretorias</h3>
            {canManage ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                onClick={() => {
                  setEditingDirId(null);
                  setDirForm(emptyDirectorateForm());
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Nova
              </button>
            ) : null}
          </div>

          {canManage ? (
            <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <input
                className={INPUT}
                placeholder="Nome da diretoria *"
                value={dirForm.name}
                onChange={(e) => setDirForm((p) => ({ ...p, name: e.target.value }))}
              />
              <input
                className={INPUT}
                placeholder="Código (opcional)"
                value={dirForm.code}
                onChange={(e) => setDirForm((p) => ({ ...p, code: e.target.value }))}
              />
              <SearchableSelect
                placeholder="Líder da diretoria *"
                options={managerOptions}
                value={dirForm.leaderEmployeeId}
                onChange={(v) => setDirForm((p) => ({ ...p, leaderEmployeeId: v }))}
                remoteSearch
                searching={searchingManagers}
                onSearchTermChange={onRequestManagers}
                unknownSelectionLabel="Selecione o líder"
              />
              <select
                className={INPUT}
                value={dirForm.status}
                onChange={(e) =>
                  setDirForm((p) => ({
                    ...p,
                    status: e.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE",
                  }))
                }
              >
                <option value="ACTIVE">Ativa</option>
                <option value="INACTIVE">Inativa</option>
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDirectorate()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editingDirId ? "Salvar diretoria" : "Criar diretoria"}
              </button>
            </div>
          ) : null}

          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {directorates.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nenhuma diretoria cadastrada.
              </li>
            ) : (
              directorates.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedDirectorateId(row.id)}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-accent/40",
                      selectedDirectorateId === row.id && "bg-accent/50"
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium">{row.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Líder: {row.leader?.name ?? "—"} · {row.departmentCount} dept.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          row.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {row.status === "ACTIVE" ? "Ativa" : "Inativa"}
                      </span>
                      {canManage ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditDirectorate(row);
                          }}
                        >
                          Editar
                        </button>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Departamentos</h3>
            </div>
            {canManage ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                onClick={() => {
                  setEditingDeptId(null);
                  setDeptForm({
                    ...emptyDepartmentForm(),
                    directorateId: selectedDirectorateId ?? "",
                  });
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Novo
              </button>
            ) : null}
          </div>

          {canManage ? (
            <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <SearchableSelect
                placeholder="Diretoria *"
                options={directorateOptions}
                value={deptForm.directorateId}
                onChange={(v) => {
                  setDeptForm((p) => ({ ...p, directorateId: v }));
                  setSelectedDirectorateId(v || null);
                }}
                unknownSelectionLabel="Selecione a diretoria"
              />
              <input
                className={INPUT}
                placeholder="Nome do departamento *"
                value={deptForm.name}
                onChange={(e) => setDeptForm((p) => ({ ...p, name: e.target.value }))}
              />
              <input
                className={INPUT}
                placeholder="Código (opcional)"
                value={deptForm.code}
                onChange={(e) => setDeptForm((p) => ({ ...p, code: e.target.value }))}
              />
              <SearchableSelect
                placeholder="Líder do departamento *"
                options={managerOptions}
                value={deptForm.leaderEmployeeId}
                onChange={(v) => setDeptForm((p) => ({ ...p, leaderEmployeeId: v }))}
                remoteSearch
                searching={searchingManagers}
                onSearchTermChange={onRequestManagers}
                unknownSelectionLabel="Selecione o líder"
              />
              <select
                className={INPUT}
                value={deptForm.status}
                onChange={(e) =>
                  setDeptForm((p) => ({
                    ...p,
                    status: e.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE",
                  }))
                }
              >
                <option value="ACTIVE">Ativo</option>
                <option value="INACTIVE">Inativo</option>
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDepartment()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editingDeptId ? "Salvar departamento" : "Criar departamento"}
              </button>
            </div>
          ) : null}

          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {departmentsOfSelected.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nenhum departamento nesta diretoria.
              </li>
            ) : (
              departmentsOfSelected.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{row.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.directorate?.name ?? "—"} · Líder: {row.leader?.name ?? "—"} ·{" "}
                      {row.employeeCount} colaborador(es)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        row.status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {row.status === "ACTIVE" ? "Ativo" : "Inativo"}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-primary"
                        onClick={() => startEditDepartment(row)}
                      >
                        Editar
                      </button>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
