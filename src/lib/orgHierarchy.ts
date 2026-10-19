/**
 * Hierarquia efetiva entre pessoas — fonte única (pura, sem I/O).
 *
 * O cadastro guarda duas coisas: a árvore de unidades (diretoria → diretoria superior;
 * departamento → departamento superior → diretoria) com um líder por unidade, e o
 * `Employee.managerId`. Líderes de unidade não são membros de departamento e têm
 * `managerId` nulo (regra de 21/07/2026, `clearEmployeeMemberDepartmentForOrgLeader`).
 * Este módulo deriva o superior de qualquer pessoa a partir dessas duas fontes, sem gravar
 * nada no cadastro.
 *
 * Regras:
 * 1. `managerId` explícito válido tem precedência (ativo, existente, diferente da própria
 *    pessoa e sem formar ciclo). Se divergir do organograma, a divergência vira alerta.
 * 2. Membro de departamento: líder do departamento; se for a própria pessoa, sobe.
 * 3. Líder de unidade: sobe a partir de cada unidade que lidera — departamento superior,
 *    diretoria do departamento, diretoria superior — até achar outra pessoa.
 * 4. Quem lidera várias unidades: só contam as unidades que não estão abaixo de outra que
 *    a mesma pessoa lidera. Se elas apontam para superiores diferentes, a resolução é
 *    AMBÍGUA (nunca escolhe o primeiro).
 * 5. Topo: a cadeia acabou sem outra pessoa. Unidade superior inativa encerra a cadeia
 *    (mesma convenção do organograma), com alerta.
 * 6. Líder desligado ou inexistente na cadeia não é pulado: a resolução fica pendente com o
 *    motivo. Ciclos entre unidades ou entre pessoas são detectados e não resolvidos.
 */

export type OrgEmployeeInput = {
  id: string;
  name: string;
  socialName?: string | null;
  status?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
};

export type OrgDirectorateInput = {
  id: string;
  name: string;
  status?: string | null;
  leaderEmployeeId: string;
  parentDirectorateId?: string | null;
};

export type OrgDepartmentInput = {
  id: string;
  name: string;
  status?: string | null;
  directorateId: string;
  leaderEmployeeId: string;
  parentDepartmentId?: string | null;
};

export type OrgGraphInput = {
  employees: readonly OrgEmployeeInput[];
  directorates: readonly OrgDirectorateInput[];
  departments: readonly OrgDepartmentInput[];
};

export type OrgUnitRef = { kind: "directorate" | "department"; id: string; name: string };

export type ManagerResolutionStatus = "RESOLVED" | "TOP" | "UNRESOLVED" | "AMBIGUOUS" | "CYCLE";

export type ManagerResolutionSource =
  | "EXPLICIT_MANAGER"
  | "DEPARTMENT_LEADER"
  | "PARENT_DEPARTMENT_LEADER"
  | "DIRECTORATE_LEADER"
  | "PARENT_DIRECTORATE_LEADER"
  | "TOP"
  | "NONE";

export type ManagerResolutionReason =
  | "NO_PLACEMENT"
  | "DEPARTMENT_NOT_FOUND"
  | "DEPARTMENT_INACTIVE"
  | "LEADER_NOT_FOUND"
  | "LEADER_INACTIVE"
  | "UNIT_CYCLE"
  | "PERSON_CYCLE"
  | "MULTIPLE_SUPERIORS"
  | "EMPLOYEE_NOT_FOUND";

export type ManagerResolutionWarning =
  | "EXPLICIT_DIVERGES_FROM_ORG"
  | "EXPLICIT_SELF_IGNORED"
  | "EXPLICIT_NOT_FOUND_IGNORED"
  | "EXPLICIT_INACTIVE_IGNORED"
  | "EXPLICIT_CYCLE_IGNORED"
  | "LEADER_ALSO_MEMBER"
  | "PARENT_UNIT_INACTIVE";

export type ManagerCandidate = { managerId: string | null; managerName: string | null; via: OrgUnitRef; status: "RESOLVED" | "TOP" };

export type EffectiveManagerResolution = {
  employeeId: string;
  status: ManagerResolutionStatus;
  managerId: string | null;
  managerName: string | null;
  source: ManagerResolutionSource;
  /** Unidade cuja liderança definiu o superior (ou a última percorrida). */
  unit: OrgUnitRef | null;
  /** Unidades percorridas, da mais próxima para a mais alta. */
  path: OrgUnitRef[];
  reason: ManagerResolutionReason | null;
  message: string;
  warnings: ManagerResolutionWarning[];
  /** Só em AMBÍGUA: os superiores possíveis, um por unidade liderada. */
  candidates: ManagerCandidate[];
  /** Unidades ativas que a pessoa lidera. */
  ledUnits: OrgUnitRef[];
};

export type OrgHierarchy = {
  resolve(employeeId: string): EffectiveManagerResolution;
  resolveAll(): EffectiveManagerResolution[];
  directReports(managerId: string): string[];
  descendants(managerId: string): string[];
  /** Superiores em ordem, do imediato ao topo (para em ciclo ou pendência). */
  leadershipChain(employeeId: string): string[];
  ledUnits(employeeId: string): OrgUnitRef[];
};

const MAX_DEPTH = 64;

export const MANAGER_SOURCE_LABELS: Record<ManagerResolutionSource, string> = {
  EXPLICIT_MANAGER: "Gestor definido no cadastro",
  DEPARTMENT_LEADER: "Líder do departamento",
  PARENT_DEPARTMENT_LEADER: "Líder do departamento superior",
  DIRECTORATE_LEADER: "Líder da diretoria",
  PARENT_DIRECTORATE_LEADER: "Líder da diretoria superior",
  TOP: "Topo da estrutura",
  NONE: "Não definido",
};

export const MANAGER_REASON_LABELS: Record<ManagerResolutionReason, string> = {
  NO_PLACEMENT: "A pessoa não tem departamento oficial, não lidera unidade e não tem gestor no cadastro.",
  DEPARTMENT_NOT_FOUND: "O departamento da pessoa não existe mais no cadastro.",
  DEPARTMENT_INACTIVE: "O departamento da pessoa está inativo.",
  LEADER_NOT_FOUND: "O líder de uma unidade da cadeia não foi encontrado no cadastro.",
  LEADER_INACTIVE: "O líder de uma unidade da cadeia está desligado ou inativo.",
  UNIT_CYCLE: "A estrutura de unidades tem um ciclo (uma unidade aponta para si mesma pela cadeia).",
  PERSON_CYCLE: "Os gestores formam um ciclo entre pessoas.",
  MULTIPLE_SUPERIORS: "A pessoa lidera unidades em cadeias diferentes, com superiores diferentes. O RH precisa decidir.",
  EMPLOYEE_NOT_FOUND: "Colaborador não encontrado.",
};

export const MANAGER_WARNING_LABELS: Record<ManagerResolutionWarning, string> = {
  EXPLICIT_DIVERGES_FROM_ORG: "O gestor do cadastro é diferente do líder indicado pelo organograma.",
  EXPLICIT_SELF_IGNORED: "O cadastro apontava a própria pessoa como gestora; o valor foi ignorado.",
  EXPLICIT_NOT_FOUND_IGNORED: "O gestor do cadastro não existe mais; o valor foi ignorado.",
  EXPLICIT_INACTIVE_IGNORED: "O gestor do cadastro está desligado; o valor foi ignorado.",
  EXPLICIT_CYCLE_IGNORED: "O gestor do cadastro formaria um ciclo; o valor foi ignorado.",
  LEADER_ALSO_MEMBER: "A pessoa lidera uma unidade e ainda consta como membro de departamento; vale a liderança.",
  PARENT_UNIT_INACTIVE: "A unidade superior está inativa; a cadeia termina aqui.",
};

function isActive(status: string | null | undefined): boolean {
  return (status ?? "ACTIVE").trim().toUpperCase() !== "INACTIVE";
}

function personName(e: OrgEmployeeInput | undefined): string | null {
  if (!e) return null;
  return e.socialName?.trim() || e.name.trim() || null;
}

type Climb =
  | { kind: "FOUND"; managerId: string; source: ManagerResolutionSource; unit: OrgUnitRef; path: OrgUnitRef[]; warnings: ManagerResolutionWarning[] }
  | { kind: "TOP"; unit: OrgUnitRef | null; path: OrgUnitRef[]; warnings: ManagerResolutionWarning[] }
  | { kind: "FAIL"; reason: ManagerResolutionReason; unit: OrgUnitRef | null; path: OrgUnitRef[] };

export function buildOrgHierarchy(input: OrgGraphInput): OrgHierarchy {
  const employees = new Map(input.employees.map((e) => [e.id, e]));
  const directorates = new Map(input.directorates.map((d) => [d.id, d]));
  const departments = new Map(input.departments.map((d) => [d.id, d]));

  const ledByEmployee = new Map<string, OrgUnitRef[]>();
  for (const d of input.directorates) {
    if (!isActive(d.status)) continue;
    const list = ledByEmployee.get(d.leaderEmployeeId) ?? [];
    list.push({ kind: "directorate", id: d.id, name: d.name });
    ledByEmployee.set(d.leaderEmployeeId, list);
  }
  for (const d of input.departments) {
    if (!isActive(d.status)) continue;
    const list = ledByEmployee.get(d.leaderEmployeeId) ?? [];
    list.push({ kind: "department", id: d.id, name: d.name });
    ledByEmployee.set(d.leaderEmployeeId, list);
  }

  /** Unidades acima de `start` (exclusivo), na ordem da subida. Ciclo ou unidade inativa encerram. */
  function ancestors(start: OrgUnitRef): { units: OrgUnitRef[]; cycle: boolean; inactiveParent: boolean } {
    const units: OrgUnitRef[] = [];
    const seen = new Set<string>([`${start.kind}:${start.id}`]);
    let current: OrgUnitRef | null = start;
    let inactiveParent = false;
    for (let depth = 0; current && depth < MAX_DEPTH; depth += 1) {
      let next: OrgUnitRef | null = null;
      if (current.kind === "department") {
        const dept = departments.get(current.id);
        if (!dept) break;
        const parent = dept.parentDepartmentId ? departments.get(dept.parentDepartmentId) : undefined;
        if (parent && isActive(parent.status)) next = { kind: "department", id: parent.id, name: parent.name };
        else {
          if (parent) inactiveParent = true;
          const dir = directorates.get(dept.directorateId);
          if (dir && isActive(dir.status)) next = { kind: "directorate", id: dir.id, name: dir.name };
          else if (dir) inactiveParent = true;
        }
      } else {
        const dir = directorates.get(current.id);
        if (!dir) break;
        const parent = dir.parentDirectorateId ? directorates.get(dir.parentDirectorateId) : undefined;
        if (parent && isActive(parent.status)) next = { kind: "directorate", id: parent.id, name: parent.name };
        else if (parent) inactiveParent = true;
      }
      if (!next) return { units, cycle: false, inactiveParent };
      const key = `${next.kind}:${next.id}`;
      if (seen.has(key)) return { units, cycle: true, inactiveParent };
      seen.add(key);
      units.push(next);
      current = next;
    }
    return { units, cycle: units.length >= MAX_DEPTH, inactiveParent };
  }

  function leaderOf(unit: OrgUnitRef): string | null {
    return unit.kind === "department" ? departments.get(unit.id)?.leaderEmployeeId ?? null : directorates.get(unit.id)?.leaderEmployeeId ?? null;
  }

  /**
   * Sobe a partir de `origin`. `includeOrigin`: membro comum começa pelo líder da própria
   * unidade; líder começa pelas unidades acima da que lidera.
   */
  function climb(selfId: string, origin: OrgUnitRef, includeOrigin: boolean): Climb {
    const up = ancestors(origin);
    const chain = includeOrigin ? [origin, ...up.units] : up.units;
    const path: OrgUnitRef[] = [];
    const warnings: ManagerResolutionWarning[] = [];
    let passedDirectorate = origin.kind === "directorate";
    for (let i = 0; i < chain.length; i += 1) {
      const unit = chain[i];
      path.push(unit);
      const firstDirectorate = unit.kind === "directorate" && !passedDirectorate;
      if (unit.kind === "directorate") passedDirectorate = true;
      const leaderId = leaderOf(unit);
      if (!leaderId) return { kind: "FAIL", reason: "LEADER_NOT_FOUND", unit, path };
      if (leaderId === selfId) continue;
      const leader = employees.get(leaderId);
      if (!leader) return { kind: "FAIL", reason: "LEADER_NOT_FOUND", unit, path };
      if (!isActive(leader.status)) return { kind: "FAIL", reason: "LEADER_INACTIVE", unit, path };
      const source: ManagerResolutionSource =
        unit.kind === "department"
          ? includeOrigin && i === 0 ? "DEPARTMENT_LEADER" : "PARENT_DEPARTMENT_LEADER"
          : firstDirectorate ? "DIRECTORATE_LEADER" : "PARENT_DIRECTORATE_LEADER";
      return { kind: "FOUND", managerId: leaderId, source, unit, path, warnings };
    }
    if (up.cycle) return { kind: "FAIL", reason: "UNIT_CYCLE", unit: path[path.length - 1] ?? origin, path };
    if (up.inactiveParent) warnings.push("PARENT_UNIT_INACTIVE");
    return { kind: "TOP", unit: path[path.length - 1] ?? origin, path, warnings };
  }

  /** Unidades lideradas que não estão abaixo de outra unidade liderada pela mesma pessoa. */
  function topmostLed(selfId: string, led: OrgUnitRef[]): OrgUnitRef[] {
    const keys = new Set(led.map((u) => `${u.kind}:${u.id}`));
    return led.filter((unit) => !ancestors(unit).units.some((a) => keys.has(`${a.kind}:${a.id}`) && leaderOf(a) === selfId));
  }

  function base(employeeId: string): EffectiveManagerResolution {
    return {
      employeeId,
      status: "UNRESOLVED",
      managerId: null,
      managerName: null,
      source: "NONE",
      unit: null,
      path: [],
      reason: null,
      message: "",
      warnings: [],
      candidates: [],
      ledUnits: ledByEmployee.get(employeeId) ?? [],
    };
  }

  function fromClimb(result: EffectiveManagerResolution, c: Climb): EffectiveManagerResolution {
    if (c.kind === "FOUND") {
      return { ...result, status: "RESOLVED", managerId: c.managerId, managerName: personName(employees.get(c.managerId)), source: c.source, unit: c.unit, path: c.path, warnings: [...result.warnings, ...c.warnings] };
    }
    if (c.kind === "TOP") {
      return { ...result, status: "TOP", source: "TOP", unit: c.unit, path: c.path, warnings: [...result.warnings, ...c.warnings] };
    }
    return { ...result, status: c.reason === "UNIT_CYCLE" ? "CYCLE" : "UNRESOLVED", reason: c.reason, unit: c.unit, path: c.path };
  }

  /** Superior pelo organograma, ignorando `managerId`. */
  function orgDerived(employeeId: string): EffectiveManagerResolution {
    const employee = employees.get(employeeId);
    let result = base(employeeId);
    if (!employee) return { ...result, reason: "EMPLOYEE_NOT_FOUND" };
    const led = result.ledUnits;
    if (led.length > 0) {
      if (employee.departmentId) result.warnings.push("LEADER_ALSO_MEMBER");
      const topmost = topmostLed(employeeId, led);
      // Toda unidade liderada está abaixo de outra liderada pela mesma pessoa: só há ciclo.
      if (topmost.length === 0) return { ...result, status: "CYCLE", reason: "UNIT_CYCLE", unit: led[0] };
      const climbs = topmost.map((unit) => ({ unit, climb: climb(employeeId, unit, false) }));
      const failed = climbs.find((c) => c.climb.kind === "FAIL");
      if (failed) return fromClimb(result, failed.climb);
      const outcomes = new Set(climbs.map((c) => (c.climb.kind === "FOUND" ? c.climb.managerId : "TOP")));
      if (outcomes.size > 1) {
        return {
          ...result,
          status: "AMBIGUOUS",
          reason: "MULTIPLE_SUPERIORS",
          candidates: climbs.map(({ unit, climb: c }) => ({
            managerId: c.kind === "FOUND" ? c.managerId : null,
            managerName: c.kind === "FOUND" ? personName(employees.get(c.managerId)) : null,
            via: unit,
            status: c.kind === "FOUND" ? ("RESOLVED" as const) : ("TOP" as const),
          })),
        };
      }
      return fromClimb(result, climbs[0].climb);
    }
    if (employee.departmentId) {
      const dept = departments.get(employee.departmentId);
      if (!dept) return { ...result, reason: "DEPARTMENT_NOT_FOUND" };
      if (!isActive(dept.status)) return { ...result, reason: "DEPARTMENT_INACTIVE", unit: { kind: "department", id: dept.id, name: dept.name } };
      result = fromClimb(result, climb(employeeId, { kind: "department", id: dept.id, name: dept.name }, true));
      return result;
    }
    return { ...result, reason: "NO_PLACEMENT" };
  }

  // Primeira passada: explícito válido ou organograma.
  const resolved = new Map<string, EffectiveManagerResolution>();
  for (const employee of input.employees) {
    const org = orgDerived(employee.id);
    const explicitId = employee.managerId?.trim() || null;
    if (!explicitId) {
      resolved.set(employee.id, org);
      continue;
    }
    const explicit = employees.get(explicitId);
    const warning: ManagerResolutionWarning | null =
      explicitId === employee.id ? "EXPLICIT_SELF_IGNORED" : !explicit ? "EXPLICIT_NOT_FOUND_IGNORED" : !isActive(explicit.status) ? "EXPLICIT_INACTIVE_IGNORED" : null;
    if (warning) {
      resolved.set(employee.id, { ...org, warnings: [...org.warnings, warning] });
      continue;
    }
    const diverges = org.status === "RESOLVED" ? org.managerId !== explicitId : org.status !== "UNRESOLVED" || org.reason !== "NO_PLACEMENT";
    resolved.set(employee.id, {
      ...org,
      status: "RESOLVED",
      managerId: explicitId,
      managerName: personName(explicit),
      source: org.status === "RESOLVED" && org.managerId === explicitId ? org.source : "EXPLICIT_MANAGER",
      reason: null,
      candidates: [],
      warnings: diverges ? [...org.warnings, "EXPLICIT_DIVERGES_FROM_ORG"] : org.warnings,
    });
  }

  // Segunda passada: ciclos entre pessoas. Explícito que fecha ciclo volta ao organograma.
  for (let guard = 0; guard < input.employees.length + 1; guard += 1) {
    const cycleMembers = findCycle(resolved);
    if (!cycleMembers) break;
    const explicitInCycle = cycleMembers.filter((id) => resolved.get(id)?.source === "EXPLICIT_MANAGER");
    if (explicitInCycle.length > 0) {
      for (const id of explicitInCycle) {
        const org = orgDerived(id);
        resolved.set(id, { ...org, warnings: [...org.warnings, "EXPLICIT_CYCLE_IGNORED"] });
      }
      continue;
    }
    for (const id of cycleMembers) {
      const current = resolved.get(id)!;
      resolved.set(id, { ...current, status: "CYCLE", reason: "PERSON_CYCLE", managerId: null, managerName: null, source: "NONE" });
    }
  }

  for (const [id, r] of resolved) {
    resolved.set(id, { ...r, message: describe(r) });
  }

  const reports = new Map<string, string[]>();
  for (const r of resolved.values()) {
    if (r.status !== "RESOLVED" || !r.managerId) continue;
    const list = reports.get(r.managerId) ?? [];
    list.push(r.employeeId);
    reports.set(r.managerId, list);
  }

  return {
    resolve(employeeId) {
      return resolved.get(employeeId) ?? { ...base(employeeId), reason: "EMPLOYEE_NOT_FOUND", message: MANAGER_REASON_LABELS.EMPLOYEE_NOT_FOUND };
    },
    resolveAll() {
      return [...resolved.values()];
    },
    directReports(managerId) {
      return [...(reports.get(managerId) ?? [])];
    },
    descendants(managerId) {
      const out: string[] = [];
      const seen = new Set<string>([managerId]);
      const queue = [...(reports.get(managerId) ?? [])];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        queue.push(...(reports.get(id) ?? []));
      }
      return out;
    },
    leadershipChain(employeeId) {
      const chain: string[] = [];
      const seen = new Set<string>([employeeId]);
      let current = resolved.get(employeeId);
      while (current && current.status === "RESOLVED" && current.managerId && !seen.has(current.managerId) && chain.length < MAX_DEPTH) {
        chain.push(current.managerId);
        seen.add(current.managerId);
        current = resolved.get(current.managerId);
      }
      return chain;
    },
    ledUnits(employeeId) {
      return [...(ledByEmployee.get(employeeId) ?? [])];
    },
  };
}

function findCycle(resolved: Map<string, EffectiveManagerResolution>): string[] | null {
  const state = new Map<string, 1 | 2>();
  for (const start of resolved.keys()) {
    if (state.get(start) === 2) continue;
    const stack: string[] = [];
    let current: string | null = start;
    while (current && resolved.has(current)) {
      const s = state.get(current);
      if (s === 2) break;
      if (s === 1) {
        const index = stack.indexOf(current);
        return stack.slice(index);
      }
      state.set(current, 1);
      stack.push(current);
      const r = resolved.get(current)!;
      current = r.status === "RESOLVED" ? r.managerId : null;
    }
    for (const id of stack) state.set(id, 2);
  }
  return null;
}

function describe(r: EffectiveManagerResolution): string {
  const unitLabel = (u: OrgUnitRef | null) => (u ? `${u.kind === "directorate" ? "Diretoria" : "Departamento"} ${u.name}` : "");
  switch (r.status) {
    case "RESOLVED":
      if (r.source === "EXPLICIT_MANAGER") return `${MANAGER_SOURCE_LABELS.EXPLICIT_MANAGER}.`;
      return `${unitLabel(r.unit)} → ${MANAGER_SOURCE_LABELS[r.source].toLowerCase()}.`;
    case "TOP":
      return r.unit ? `${unitLabel(r.unit)} não tem unidade superior com outro líder: topo da estrutura.` : "Topo da estrutura.";
    case "AMBIGUOUS":
      return MANAGER_REASON_LABELS.MULTIPLE_SUPERIORS;
    default:
      return r.reason ? MANAGER_REASON_LABELS[r.reason] : MANAGER_SOURCE_LABELS.NONE;
  }
}

/** Forma enviada à tela: só nomes e textos, sem a cadeia completa de ids. */
export type EffectiveManagerView = {
  status: ManagerResolutionStatus;
  managerId: string | null;
  managerName: string | null;
  source: ManagerResolutionSource;
  sourceLabel: string;
  unitLabel: string | null;
  message: string;
  warnings: string[];
  candidates: { managerId: string | null; managerName: string | null; via: string }[];
};

function unitText(u: OrgUnitRef | null): string | null {
  return u ? `${u.kind === "directorate" ? "Diretoria" : "Departamento"} ${u.name}` : null;
}

export function toEffectiveManagerView(r: EffectiveManagerResolution): EffectiveManagerView {
  return {
    status: r.status,
    managerId: r.managerId,
    managerName: r.managerName,
    source: r.source,
    sourceLabel: MANAGER_SOURCE_LABELS[r.source],
    unitLabel: unitText(r.unit),
    message: r.message,
    warnings: r.warnings.map((w) => MANAGER_WARNING_LABELS[w]),
    candidates: r.candidates.map((c) => ({ managerId: c.managerId, managerName: c.managerName, via: unitText(c.via) ?? "" })),
  };
}
