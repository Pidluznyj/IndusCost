import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrgHierarchy, type OrgDepartmentInput, type OrgDirectorateInput, type OrgEmployeeInput } from "./orgHierarchy";

// Estrutura fictícia no formato da homologação: Conselho → Presidência → Diretorias → Departamentos.
const people: OrgEmployeeInput[] = [
  { id: "carla", name: "Carla Conselho" },
  { id: "paulo", name: "Paulo Presidente" },
  { id: "jose", name: "José Comercial" },
  { id: "joseane", name: "Joseane Vendas", departmentId: "comercial", managerId: "jose" },
  { id: "ivo", name: "Ivo Industrial" },
  { id: "fabio", name: "Fábio Fabricação" },
  { id: "elisa", name: "Elisa Expedição" },
  { id: "marcos", name: "Marcos Montagem", departmentId: "expedicao", managerId: "elisa" },
  { id: "pedro", name: "Pedro Pintura", departmentId: "pintura", managerId: "fabio" },
  { id: "quintino", name: "Quintino Qualidade", departmentId: "qualidade", managerId: "ivo" },
];
const directorates: OrgDirectorateInput[] = [
  { id: "conselho", name: "Conselho", leaderEmployeeId: "carla" },
  { id: "presidencia", name: "Presidência", leaderEmployeeId: "paulo", parentDirectorateId: "conselho" },
  { id: "adm", name: "Diretoria Administrativa", leaderEmployeeId: "paulo", parentDirectorateId: "presidencia" },
  { id: "ind", name: "Diretoria Industrial", leaderEmployeeId: "ivo", parentDirectorateId: "presidencia" },
];
const departments: OrgDepartmentInput[] = [
  { id: "comercial", name: "Comercial", directorateId: "adm", leaderEmployeeId: "jose" },
  { id: "fabricacao", name: "Fabricação", directorateId: "ind", leaderEmployeeId: "fabio" },
  { id: "pintura", name: "Pintura", directorateId: "ind", leaderEmployeeId: "fabio" },
  { id: "expedicao", name: "Expedição", directorateId: "ind", leaderEmployeeId: "elisa", parentDepartmentId: "fabricacao" },
  { id: "qualidade", name: "Qualidade", directorateId: "ind", leaderEmployeeId: "ivo" },
];

function graph(patch: { people?: OrgEmployeeInput[]; directorates?: OrgDirectorateInput[]; departments?: OrgDepartmentInput[] } = {}) {
  return buildOrgHierarchy({
    employees: patch.people ?? people,
    directorates: patch.directorates ?? directorates,
    departments: patch.departments ?? departments,
  });
}

describe("hierarquia efetiva — casos da estrutura real", () => {
  const h = graph();

  it("José Eduardo (líder do Comercial) responde ao líder da Diretoria Administrativa", () => {
    const r = h.resolve("jose");
    assert.equal(r.status, "RESOLVED");
    assert.equal(r.managerId, "paulo");
    assert.equal(r.source, "DIRECTORATE_LEADER");
    assert.deepEqual(r.unit, { kind: "directorate", id: "adm", name: "Diretoria Administrativa" });
    assert.match(r.message, /Diretoria Administrativa/);
  });

  it("Joseane (membro do Comercial) responde a José Eduardo", () => {
    const r = h.resolve("joseane");
    assert.equal(r.status, "RESOLVED");
    assert.equal(r.managerId, "jose");
    assert.equal(r.source, "DEPARTMENT_LEADER");
    assert.deepEqual(r.warnings, []);
  });

  it("Paulo lidera Presidência e Diretoria Administrativa: sobe até o Conselho, nunca a si mesmo", () => {
    const r = h.resolve("paulo");
    assert.equal(r.status, "RESOLVED");
    assert.equal(r.managerId, "carla");
    assert.equal(r.source, "PARENT_DIRECTORATE_LEADER");
    assert.equal(r.ledUnits.length, 2);
  });

  it("topo efetivo fica sem superior", () => {
    const r = h.resolve("carla");
    assert.equal(r.status, "TOP");
    assert.equal(r.managerId, null);
    assert.equal(r.source, "TOP");
  });

  it("sem Conselho cadastrado, Paulo é o topo (não se deduz o topo pelo nome)", () => {
    const r = graph({ directorates: directorates.filter((d) => d.id !== "conselho").map((d) => (d.id === "presidencia" ? { ...d, parentDirectorateId: null } : d)) }).resolve("paulo");
    assert.equal(r.status, "TOP");
  });

  it("líder de diretoria responde ao líder da diretoria superior", () => {
    const r = h.resolve("ivo");
    assert.equal(r.managerId, "paulo");
    assert.equal(r.source, "PARENT_DIRECTORATE_LEADER");
  });

  it("líder de departamento dentro de outro departamento responde ao líder do superior", () => {
    const r = h.resolve("elisa");
    assert.equal(r.managerId, "fabio");
    assert.equal(r.source, "PARENT_DEPARTMENT_LEADER");
  });

  it("quem lidera dois departamentos da mesma diretoria tem um único superior", () => {
    const r = h.resolve("fabio");
    assert.equal(r.status, "RESOLVED");
    assert.equal(r.managerId, "ivo");
  });

  it("quem lidera diretoria e um departamento dela não aponta para si mesmo", () => {
    const r = h.resolve("ivo");
    assert.notEqual(r.managerId, "ivo");
    assert.equal(h.resolve("quintino").managerId, "ivo");
  });

  it("equipe direta e descendentes seguem a hierarquia efetiva", () => {
    assert.deepEqual(h.directReports("paulo").sort(), ["ivo", "jose"]);
    assert.deepEqual(h.directReports("jose"), ["joseane"]);
    const all = h.descendants("paulo").sort();
    assert.deepEqual(all, ["elisa", "fabio", "ivo", "joseane", "jose", "marcos", "pedro", "quintino"].sort());
    assert.ok(!all.includes("paulo"));
    assert.deepEqual(h.leadershipChain("joseane"), ["jose", "paulo", "carla"]);
  });
});

describe("hierarquia efetiva — exceções", () => {
  it("unidade com líder inexistente: pendência com motivo", () => {
    const r = graph({ departments: departments.map((d) => (d.id === "comercial" ? { ...d, leaderEmployeeId: "fantasma" } : d)) }).resolve("joseane");
    // Joseane tem managerId explícito = José; sem José como líder, o explícito continua válido.
    assert.equal(r.status, "RESOLVED");
    assert.equal(r.source, "EXPLICIT_MANAGER");
    assert.ok(r.warnings.includes("EXPLICIT_DIVERGES_FROM_ORG"));
    const semExplicito = graph({
      people: people.map((p) => (p.id === "joseane" ? { ...p, managerId: null } : p)),
      departments: departments.map((d) => (d.id === "comercial" ? { ...d, leaderEmployeeId: "fantasma" } : d)),
    }).resolve("joseane");
    assert.equal(semExplicito.status, "UNRESOLVED");
    assert.equal(semExplicito.reason, "LEADER_NOT_FOUND");
  });

  it("líder desligado não é pulado: relação inválida sinalizada", () => {
    const h = graph({ people: people.map((p) => (p.id === "jose" ? { ...p, status: "INACTIVE" } : p.id === "joseane" ? { ...p, managerId: null } : p)) });
    const r = h.resolve("joseane");
    assert.equal(r.status, "UNRESOLVED");
    assert.equal(r.reason, "LEADER_INACTIVE");
    assert.equal(r.managerId, null);
  });

  it("gestor explícito desligado é ignorado e cai no organograma", () => {
    const h = graph({ people: [...people.map((p) => (p.id === "joseane" ? { ...p, managerId: "ex" } : p)), { id: "ex", name: "Ex Gestor", status: "INACTIVE" }] });
    const r = h.resolve("joseane");
    assert.equal(r.managerId, "jose");
    assert.ok(r.warnings.includes("EXPLICIT_INACTIVE_IGNORED"));
  });

  it("ciclo entre diretorias é detectado e não resolvido", () => {
    const h = graph({
      directorates: [
        { id: "a", name: "A", leaderEmployeeId: "paulo", parentDirectorateId: "b" },
        { id: "b", name: "B", leaderEmployeeId: "paulo", parentDirectorateId: "a" },
      ],
      departments: [],
    });
    const r = h.resolve("paulo");
    assert.equal(r.status, "CYCLE");
    assert.equal(r.reason, "UNIT_CYCLE");
  });

  it("managerId explícito válido tem precedência e a divergência fica registrada", () => {
    const r = graph({ people: people.map((p) => (p.id === "joseane" ? { ...p, managerId: "paulo" } : p)) }).resolve("joseane");
    assert.equal(r.managerId, "paulo");
    assert.equal(r.source, "EXPLICIT_MANAGER");
    assert.ok(r.warnings.includes("EXPLICIT_DIVERGES_FROM_ORG"));
  });

  it("managerId apontando para a própria pessoa é rejeitado", () => {
    const r = graph({ people: people.map((p) => (p.id === "joseane" ? { ...p, managerId: "joseane" } : p)) }).resolve("joseane");
    assert.equal(r.managerId, "jose");
    assert.ok(r.warnings.includes("EXPLICIT_SELF_IGNORED"));
  });

  it("gestor explícito incompatível (fecharia ciclo) volta para o organograma", () => {
    // José (líder) com managerId explícito = Joseane, que responde a José: ciclo.
    const r = graph({ people: people.map((p) => (p.id === "jose" ? { ...p, managerId: "joseane" } : p)) }).resolve("jose");
    assert.equal(r.managerId, "paulo");
    assert.ok(r.warnings.includes("EXPLICIT_CYCLE_IGNORED"));
  });

  it("ciclo só de gestores explícitos, fora do organograma, fica bloqueado", () => {
    const h = buildOrgHierarchy({
      employees: [
        { id: "a", name: "A", managerId: "b" },
        { id: "b", name: "B", managerId: "a" },
      ],
      directorates: [],
      departments: [],
    });
    for (const id of ["a", "b"]) {
      const r = h.resolve(id);
      assert.notEqual(r.status, "RESOLVED");
      assert.ok(r.warnings.includes("EXPLICIT_CYCLE_IGNORED"));
    }
  });

  it("quem lidera unidades em cadeias com superiores diferentes fica AMBÍGUO, sem escolher o primeiro", () => {
    const h = graph({ departments: [...departments, { id: "compras", name: "Compras", directorateId: "ind", leaderEmployeeId: "jose" }] });
    const r = h.resolve("jose");
    assert.equal(r.status, "AMBIGUOUS");
    assert.equal(r.managerId, null);
    assert.equal(r.reason, "MULTIPLE_SUPERIORS");
    assert.deepEqual(r.candidates.map((c) => c.managerId).sort(), ["ivo", "paulo"]);
    assert.ok(!h.directReports("paulo").includes("jose"));
  });

  it("pessoa sem departamento, sem liderança e sem gestor: pendência explícita", () => {
    const r = graph({ people: [...people, { id: "solto", name: "Sem Lugar" }] }).resolve("solto");
    assert.equal(r.status, "UNRESOLVED");
    assert.equal(r.reason, "NO_PLACEMENT");
    assert.match(r.message, /não tem departamento oficial/);
  });

  it("líder que ainda consta como membro: vale a liderança, com alerta", () => {
    const r = graph({ people: people.map((p) => (p.id === "jose" ? { ...p, departmentId: "comercial" } : p)) }).resolve("jose");
    assert.equal(r.managerId, "paulo");
    assert.ok(r.warnings.includes("LEADER_ALSO_MEMBER"));
  });

  it("diretoria superior inativa encerra a cadeia com alerta", () => {
    const r = graph({ directorates: directorates.map((d) => (d.id === "conselho" ? { ...d, status: "INACTIVE" } : d)) }).resolve("paulo");
    assert.equal(r.status, "TOP");
    assert.ok(r.warnings.includes("PARENT_UNIT_INACTIVE"));
  });

  it("departamento inativo ou inexistente: pendência", () => {
    const inactive = graph({
      people: people.map((p) => (p.id === "joseane" ? { ...p, managerId: null } : p)),
      departments: departments.map((d) => (d.id === "comercial" ? { ...d, status: "INACTIVE" } : d)),
    }).resolve("joseane");
    assert.equal(inactive.reason, "DEPARTMENT_INACTIVE");
    const missing = graph({ people: people.map((p) => (p.id === "joseane" ? { ...p, managerId: null, departmentId: "x" } : p)) }).resolve("joseane");
    assert.equal(missing.reason, "DEPARTMENT_NOT_FOUND");
  });

  it("colaborador desconhecido", () => {
    assert.equal(graph().resolve("ninguem").reason, "EMPLOYEE_NOT_FOUND");
  });
});
