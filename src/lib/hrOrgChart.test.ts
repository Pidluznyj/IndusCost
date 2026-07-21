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
    assert.equal(dept.members.length, 2); // diretor + vendedor (líder fora da lista)
    assert.ok(dept.members.every((m) => m.id !== "e-lead"));
    assert.equal(chart.unassigned.length, 1);
    assert.equal(chart.totals.people, 3);
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
});
