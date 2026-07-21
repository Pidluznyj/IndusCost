import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHrOrgChart, hrOrgChartPersonLabel } from "./hrOrgChart.js";

describe("hrOrgChart", () => {
  it("monta árvore Diretoria → Departamento → pessoas com líderes destacados", () => {
    const chart = buildHrOrgChart({
      organizationName: "IndusCost",
      directorates: [
        {
          id: "dir-1",
          name: "Comercial",
          code: "COM",
          status: "ACTIVE",
          leaderEmployeeId: "e-dir",
        },
      ],
      departments: [
        {
          id: "dep-1",
          name: "Vendas",
          code: "VEN",
          status: "ACTIVE",
          directorateId: "dir-1",
          leaderEmployeeId: "e-lead",
        },
      ],
      employees: [
        {
          id: "e-dir",
          name: "Diretor",
          socialName: null,
          status: "ACTIVE",
          departmentId: "dep-1",
          roleName: "Diretor",
        },
        {
          id: "e-lead",
          name: "Líder Vendas",
          socialName: "Ana",
          status: "ACTIVE",
          departmentId: "dep-1",
          roleName: "Coordenador",
        },
        {
          id: "e-1",
          name: "Vendedor 1",
          socialName: null,
          status: "ACTIVE",
          departmentId: "dep-1",
          roleName: "Vendedor",
        },
        {
          id: "e-un",
          name: "Sem Depto",
          socialName: null,
          status: "ACTIVE",
          departmentId: null,
          roleName: null,
        },
      ],
    });

    assert.equal(chart.name, "IndusCost");
    assert.equal(chart.directorates.length, 1);
    assert.equal(chart.directorates[0].leader?.id, "e-dir");
    assert.equal(chart.directorates[0].departments.length, 1);
    const dept = chart.directorates[0].departments[0];
    assert.equal(dept.leader?.id, "e-lead");
    assert.equal(hrOrgChartPersonLabel(dept.leader!), "Ana");
    // Líderes de diretoria/departamento não entram como membros
    assert.equal(dept.members.length, 1);
    assert.equal(dept.members[0].id, "e-1");
    assert.ok(dept.members.every((m) => m.id !== "e-lead" && m.id !== "e-dir"));
    assert.equal(chart.unassigned.length, 1);
    assert.equal(chart.totals.people, 2);
    assert.equal(chart.totals.unassigned, 1);
  });

  it("omite unidades INACTIVE por padrão", () => {
    const chart = buildHrOrgChart({
      directorates: [
        {
          id: "d1",
          name: "Ativa",
          code: null,
          status: "ACTIVE",
          leaderEmployeeId: "a",
        },
        {
          id: "d2",
          name: "Inativa",
          code: null,
          status: "INACTIVE",
          leaderEmployeeId: "a",
        },
      ],
      departments: [],
      employees: [
        {
          id: "a",
          name: "A",
          socialName: null,
          status: "ACTIVE",
          departmentId: null,
          roleName: null,
        },
      ],
    });
    assert.equal(chart.directorates.length, 1);
    assert.equal(chart.directorates[0].name, "Ativa");
  });

  it("aninha diretoria filha sob a superior e mantém raiz sem vínculo", () => {
    const chart = buildHrOrgChart({
      directorates: [
        {
          id: "root",
          name: "Presidência",
          code: "PRE",
          status: "ACTIVE",
          leaderEmployeeId: "a",
          parentDirectorateId: null,
        },
        {
          id: "child",
          name: "Administrativa",
          code: "ADM",
          status: "ACTIVE",
          leaderEmployeeId: "a",
          parentDirectorateId: "root",
        },
        {
          id: "orphan",
          name: "Independente",
          code: "IND",
          status: "ACTIVE",
          leaderEmployeeId: "a",
          parentDirectorateId: null,
        },
      ],
      departments: [],
      employees: [
        {
          id: "a",
          name: "A",
          socialName: null,
          status: "ACTIVE",
          departmentId: null,
          roleName: null,
        },
      ],
    });
    assert.equal(chart.directorates.length, 2);
    const root = chart.directorates.find((d) => d.id === "root");
    assert.ok(root);
    assert.equal(root!.childDirectorates.length, 1);
    assert.equal(root!.childDirectorates[0].id, "child");
    assert.equal(chart.totals.directorates, 3);
  });

  it("líder de diretoria sem departamento não aparece em 'sem departamento'", () => {
    const chart = buildHrOrgChart({
      directorates: [
        {
          id: "root",
          name: "Presidência",
          code: null,
          status: "ACTIVE",
          leaderEmployeeId: "boss",
        },
      ],
      departments: [],
      employees: [
        {
          id: "boss",
          name: "Chefe",
          socialName: null,
          status: "ACTIVE",
          departmentId: null,
          roleName: "Diretor",
        },
        {
          id: "free",
          name: "Livre",
          socialName: null,
          status: "ACTIVE",
          departmentId: null,
          roleName: null,
        },
      ],
    });
    assert.equal(chart.directorates[0].leader?.id, "boss");
    assert.equal(chart.unassigned.length, 1);
    assert.equal(chart.unassigned[0].id, "free");
  });
});
