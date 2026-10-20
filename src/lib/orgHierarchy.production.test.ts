/**
 * Hierarquia efetiva com a estrutura no formato da PRODUÇÃO (auditoria de 20/10/2026):
 * Conselho (Sidney) → Presidência (Paulo) → Administrativa (Paulo) e Fabricação (Carlos);
 * departamentos: Comercial (José), Compras/Financeiro/RH (Paulo), Engenharia e Ferramentaria (Carlos),
 * Fabricação (Alexsandro) → Montagem (Alexsandro) e Expedição (Andresa), Qualidade (Marister).
 * Nenhum nome real além dos cargos públicos da estrutura; liderados são fictícios.
 *
 * Regra: uma pessoa pode liderar várias unidades, mas cada colaborador tem UM superior direto
 * efetivo; camadas repetidas da mesma pessoa não criam outro nível.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrgHierarchy, type OrgDepartmentInput, type OrgDirectorateInput, type OrgEmployeeInput } from "./orgHierarchy";

const dirs: OrgDirectorateInput[] = [
  { id: "conselho", name: "Conselho", leaderEmployeeId: "sidney" },
  { id: "presidencia", name: "Presidência", leaderEmployeeId: "paulo", parentDirectorateId: "conselho" },
  { id: "adm", name: "Administrativa", leaderEmployeeId: "paulo", parentDirectorateId: "presidencia" },
  { id: "fab-dir", name: "Fabricação", leaderEmployeeId: "carlos", parentDirectorateId: "presidencia" },
];
const depts: OrgDepartmentInput[] = [
  { id: "comercial", name: "Comercial", directorateId: "adm", leaderEmployeeId: "jose" },
  { id: "compras", name: "Compras", directorateId: "adm", leaderEmployeeId: "paulo" },
  { id: "financeiro", name: "Financeiro/Fiscal", directorateId: "adm", leaderEmployeeId: "paulo" },
  { id: "rh", name: "RH", directorateId: "adm", leaderEmployeeId: "paulo" },
  { id: "engenharia", name: "Engenharia de produtos", directorateId: "fab-dir", leaderEmployeeId: "carlos" },
  { id: "ferramentaria", name: "Ferramentaria", directorateId: "fab-dir", leaderEmployeeId: "carlos" },
  { id: "fabricacao", name: "Fabricação", directorateId: "fab-dir", leaderEmployeeId: "alexsandro" },
  { id: "montagem", name: "Montagem", directorateId: "fab-dir", leaderEmployeeId: "alexsandro", parentDepartmentId: "fabricacao" },
  { id: "expedicao", name: "Expedição", directorateId: "fab-dir", leaderEmployeeId: "andresa", parentDepartmentId: "fabricacao" },
  { id: "qualidade", name: "Qualidade", directorateId: "fab-dir", leaderEmployeeId: "marister" },
];
const leaders: OrgEmployeeInput[] = ["sidney", "paulo", "carlos", "jose", "alexsandro", "andresa", "marister"].map((id) => ({ id, name: id }));
const members: OrgEmployeeInput[] = [
  { id: "joseane", name: "joseane", departmentId: "comercial" },
  { id: "op-fab-1", name: "op-fab-1", departmentId: "fabricacao" },
  { id: "op-fab-2", name: "op-fab-2", departmentId: "fabricacao", managerId: "alexsandro" },
  { id: "op-mont-1", name: "op-mont-1", departmentId: "montagem" },
  { id: "op-mont-2", name: "op-mont-2", departmentId: "montagem" },
  { id: "op-exp-1", name: "op-exp-1", departmentId: "expedicao" },
  { id: "comprador", name: "comprador", departmentId: "compras" },
  { id: "analista-rh", name: "analista-rh", departmentId: "rh" },
  { id: "desligado", name: "desligado", departmentId: "montagem", status: "INACTIVE" },
];
const build = (patch: { employees?: OrgEmployeeInput[]; directorates?: OrgDirectorateInput[]; departments?: OrgDepartmentInput[] } = {}) =>
  buildOrgHierarchy({ employees: patch.employees ?? [...leaders, ...members], directorates: patch.directorates ?? dirs, departments: patch.departments ?? depts });
const h = build();
const manager = (id: string) => h.resolve(id).managerId;
const sorted = (a: string[]) => [...a].sort();

describe("estrutura da produção: um superior efetivo por pessoa", () => {
  it("Fabricação e Montagem (Alexsandro): membros das duas têm Alexsandro, uma vez só", () => {
    for (const id of ["op-fab-1", "op-fab-2", "op-mont-1", "op-mont-2"]) assert.equal(manager(id), "alexsandro", id);
    assert.equal(h.resolve("op-fab-2").source, "DEPARTMENT_LEADER", "gestor explícito igual ao organograma mantém a origem do organograma");
    assert.deepEqual(sorted(h.directReports("alexsandro")), ["andresa", "op-fab-1", "op-fab-2", "op-mont-1", "op-mont-2"], "desligado não conta; ninguém repetido");
    assert.equal(h.resolve("alexsandro").managerId, "carlos", "Alexsandro não aponta para si: sobe da Fabricação para a diretoria");
    assert.deepEqual(h.resolve("alexsandro").ledUnits.map((u) => u.name).sort(), ["Fabricação", "Montagem"]);
  });

  it("Expedição (Andresa) dentro da Fabricação: equipe avalia Andresa; Andresa responde a Alexsandro", () => {
    assert.equal(manager("op-exp-1"), "andresa");
    assert.equal(manager("andresa"), "alexsandro");
    assert.equal(h.resolve("andresa").source, "PARENT_DEPARTMENT_LEADER");
    assert.equal(h.directReports("alexsandro").includes("op-exp-1"), false, "liderado da Expedição não é ligado direto a Alexsandro");
  });

  it("Presidência e Administrativa (Paulo), mais Compras, Financeiro e RH: Paulo responde ao Conselho, sem autogestão", () => {
    const r = h.resolve("paulo");
    assert.equal(r.status, "RESOLVED");
    assert.equal(r.managerId, "sidney");
    assert.equal(r.source, "PARENT_DIRECTORATE_LEADER");
    assert.deepEqual(r.candidates, []);
    assert.equal(manager("comprador"), "paulo");
    assert.equal(manager("analista-rh"), "paulo");
    assert.deepEqual(sorted(h.directReports("paulo")), ["analista-rh", "carlos", "comprador", "jose"]);
  });

  it("Comercial (José): Joseane → José → Paulo; José é líder", () => {
    assert.equal(manager("joseane"), "jose");
    assert.equal(manager("jose"), "paulo");
    assert.deepEqual(h.directReports("jose"), ["joseane"]);
  });

  it("Engenharia e Ferramentaria (Carlos) mais a diretoria Fabricação: Carlos responde a Paulo, uma vez", () => {
    const r = h.resolve("carlos");
    assert.equal(r.managerId, "paulo");
    assert.equal(r.status, "RESOLVED");
    assert.deepEqual(sorted(h.directReports("carlos")), ["alexsandro", "marister"]);
  });

  it("topo: Sidney sem superior, com motivo legítimo (não é inconsistência)", () => {
    const r = h.resolve("sidney");
    assert.equal(r.status, "TOP");
    assert.equal(r.managerId, null);
  });

  it("líder sem managerId não é erro; quem lidera é quem tem liderado direto ativo (fora de qualquer ciclo)", () => {
    for (const id of ["jose", "paulo", "carlos", "alexsandro", "andresa"]) assert.ok(h.directReports(id).length > 0, id);
    assert.equal(h.directReports("marister").length, 0, "Qualidade sem membros: Marister não é líder de pessoas");
    assert.equal(h.directReports("joseane").length, 0);
  });

  it("descendentes de Paulo cobrem a árvore inteira, cada pessoa uma vez", () => {
    const d = h.descendants("paulo");
    assert.equal(new Set(d).size, d.length);
    assert.ok(d.includes("op-mont-1") && d.includes("joseane") && d.includes("op-exp-1"));
    assert.equal(d.includes("sidney"), false);
  });

  it("pessoa que lidera diretoria e departamento de outra cadeia: a diretoria define o superior, com alerta", () => {
    // Carlos passa a liderar também um departamento da Administrativa: continua respondendo pela diretoria Fabricação.
    const extra = build({ departments: [...depts, { id: "ti", name: "TI", directorateId: "adm", leaderEmployeeId: "carlos" }] });
    const r = extra.resolve("carlos");
    assert.equal(r.managerId, "paulo");
    assert.ok(r.warnings.includes("LOWER_UNIT_CHAIN_IGNORED"));
    assert.equal(manager("op-fab-1"), "alexsandro");
  });

  it("dois departamentos irmãos com superiores diferentes, sem diretoria própria: ambíguo, sem escolher", () => {
    const g = build({
      directorates: [...dirs, { id: "outra", name: "Outra", leaderEmployeeId: "sidney" }],
      departments: [...depts, { id: "lab", name: "Laboratório", directorateId: "outra", leaderEmployeeId: "marister" }],
    });
    const r = g.resolve("marister");
    assert.equal(r.status, "AMBIGUOUS");
    assert.deepEqual(sorted(r.candidates.map((c) => c.managerId ?? "topo")), ["carlos", "sidney"]);
  });

  it("líder de departamento desligado: referência inválida, não se pula para o próximo", () => {
    const g = build({ employees: [...leaders.map((l) => (l.id === "andresa" ? { ...l, status: "INACTIVE" } : l)), ...members] });
    const r = g.resolve("op-exp-1");
    assert.equal(r.status, "UNRESOLVED");
    assert.equal(r.reason, "LEADER_INACTIVE");
  });

  it("ciclo entre unidades (Fabricação abaixo da Montagem) é detectado", () => {
    const g = build({ departments: depts.map((d) => (d.id === "fabricacao" ? { ...d, parentDepartmentId: "montagem" } : d)) });
    assert.equal(g.resolve("alexsandro").status, "CYCLE");
    assert.equal(g.resolve("op-mont-1").managerId, "alexsandro", "membros continuam com o líder da unidade");
  });

  it("gestor explícito diferente do organograma prevalece, com a divergência registrada", () => {
    const g = build({ employees: [...leaders, ...members.map((m) => (m.id === "op-mont-1" ? { ...m, managerId: "andresa" } : m))] });
    const r = g.resolve("op-mont-1");
    assert.equal(r.managerId, "andresa");
    assert.equal(r.source, "EXPLICIT_MANAGER");
    assert.ok(r.warnings.includes("EXPLICIT_DIVERGES_FROM_ORG"));
    assert.equal(g.directReports("alexsandro").includes("op-mont-1"), false, "liderados diretos seguem o superior efetivo");
  });
});
