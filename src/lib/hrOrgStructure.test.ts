import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertHrDepartmentName,
  assertHrDirectorateName,
  assertHrDirectorateParentLink,
  assertHrOrgLeaderIsActive,
  assertHrOrgLeaderRequired,
  buildEmployeeOrgLeadershipSummary,
  buildHrHierarchicalViewerScope,
  HrOrgStructureError,
  normalizeHrOrgCode,
  normalizeHrOrgStatus,
  normalizeOptionalParentDirectorateId,
  resolveForcedManagerFromOrgDepartment,
} from "./hrOrgStructure.js";

describe("hrOrgStructure", () => {
  it("exige líder em diretoria e departamento", () => {
    assert.throws(
      () =>
        assertHrOrgLeaderRequired({
          leaderEmployeeId: "",
          status: "ACTIVE",
          unitLabel: "departamento",
        }),
      (err: unknown) =>
        err instanceof HrOrgStructureError && err.code === "LEADER_REQUIRED"
    );
    assert.equal(
      assertHrOrgLeaderRequired({
        leaderEmployeeId: "  leader-1  ",
        status: "ACTIVE",
        unitLabel: "diretoria",
      }),
      "leader-1"
    );
  });

  it("líder precisa estar ACTIVE", () => {
    assert.throws(
      () =>
        assertHrOrgLeaderIsActive({
          leaderStatus: "INACTIVE",
          unitLabel: "departamento",
        }),
      (err: unknown) =>
        err instanceof HrOrgStructureError && err.code === "LEADER_MUST_BE_ACTIVE"
    );
    assert.doesNotThrow(() =>
      assertHrOrgLeaderIsActive({
        leaderStatus: "ACTIVE",
        unitLabel: "diretoria",
      })
    );
  });

  it("normaliza nome, código e status", () => {
    assert.equal(assertHrDirectorateName("  Comercial  "), "Comercial");
    assert.equal(assertHrDepartmentName("  TI  "), "TI");
    assert.equal(normalizeHrOrgCode(" dir-01 "), "DIR-01");
    assert.equal(normalizeHrOrgStatus("inactive"), "INACTIVE");
    assert.equal(normalizeHrOrgStatus("x", "ACTIVE"), "ACTIVE");
  });

  it("escopo hierárquico une departamentos liderados e da diretoria", () => {
    const scope = buildHrHierarchicalViewerScope({
      viewerEmployeeId: "boss",
      ledDirectorateIds: ["dir-a"],
      ledDepartmentIds: ["dept-x"],
      departmentIdsInLedDirectorates: ["dept-a1", "dept-a2", "dept-x"],
    });
    assert.equal(scope.isHierarchicalLeader, true);
    assert.deepEqual(scope.directorateIds, ["dir-a"]);
    assert.deepEqual(scope.departmentIds.sort(), ["dept-a1", "dept-a2", "dept-x"]);
  });

  it("gestor forçado = líder do departamento (ou líder da diretoria se for o próprio líder)", () => {
    assert.deepEqual(
      resolveForcedManagerFromOrgDepartment({
        employeeId: "emp-1",
        departmentLeaderEmployeeId: "leader-dept",
        departmentLeaderName: "Ana Líder",
        directorateLeaderEmployeeId: "leader-dir",
        directorateLeaderName: "Bruno Diretor",
      }),
      { managerId: "leader-dept", managerName: "Ana Líder" }
    );
    assert.deepEqual(
      resolveForcedManagerFromOrgDepartment({
        employeeId: "leader-dept",
        departmentLeaderEmployeeId: "leader-dept",
        departmentLeaderName: "Ana Líder",
        directorateLeaderEmployeeId: "leader-dir",
        directorateLeaderName: "Bruno Diretor",
      }),
      { managerId: "leader-dir", managerName: "Bruno Diretor" }
    );
    assert.deepEqual(
      resolveForcedManagerFromOrgDepartment({
        employeeId: "leader-both",
        departmentLeaderEmployeeId: "leader-both",
        departmentLeaderName: "Ana",
        directorateLeaderEmployeeId: "leader-both",
        directorateLeaderName: "Ana",
      }),
      { managerId: null, managerName: null }
    );
  });

  it("vínculo opcional entre diretorias bloqueia auto-referência e ciclo", () => {
    const parentById = new Map<string, string | null>([
      ["dir-a", null],
      ["dir-b", "dir-a"],
      ["dir-c", "dir-b"],
    ]);
    assert.equal(
      assertHrDirectorateParentLink({
        directorateId: "dir-d",
        parentDirectorateId: "dir-a",
        parentById,
      }),
      "dir-a"
    );
    assert.equal(
      assertHrDirectorateParentLink({
        directorateId: "dir-a",
        parentDirectorateId: null,
        parentById,
      }),
      null
    );
    assert.throws(
      () =>
        assertHrDirectorateParentLink({
          directorateId: "dir-a",
          parentDirectorateId: "dir-a",
          parentById,
        }),
      (err: unknown) => err instanceof HrOrgStructureError && err.code === "PARENT_SELF"
    );
    assert.throws(
      () =>
        assertHrDirectorateParentLink({
          directorateId: "dir-a",
          parentDirectorateId: "dir-c",
          parentById,
        }),
      (err: unknown) => err instanceof HrOrgStructureError && err.code === "PARENT_CYCLE"
    );
    assert.equal(normalizeOptionalParentDirectorateId(""), null);
    assert.equal(normalizeOptionalParentDirectorateId("none"), null);
    assert.equal(normalizeOptionalParentDirectorateId("  uuid-1  "), "uuid-1");
  });

  it("resumo de liderança identifica líder de diretoria/departamento", () => {
    const empty = buildEmployeeOrgLeadershipSummary({
      employeeId: "e1",
      ledDirectorates: [],
      ledDepartments: [],
    });
    assert.equal(empty.isOrgLeader, false);
    const led = buildEmployeeOrgLeadershipSummary({
      employeeId: "e1",
      ledDirectorates: [{ id: "d1", name: "Administrativa" }],
      ledDepartments: [{ id: "p1", name: "Financeiro" }],
    });
    assert.equal(led.isOrgLeader, true);
    assert.match(led.label ?? "", /Administrativa/);
    assert.match(led.label ?? "", /Financeiro/);
  });

  it("rotas e UI de RH consomem a estrutura", () => {
    const root = process.cwd();
    const read = (rel: string) => readFileSync(join(root, rel), "utf8");
    assert.match(read("src/lib/hrOrgStructureRoutes.ts"), /\/api\/employees\/org\/directorates/);
    assert.match(read("src/lib/hrOrgStructureRoutes.ts"), /leaderEmployeeId/);
    assert.match(read("src/components/EmployeeModule.tsx"), /EmployeeOrgStructurePanel/);
    assert.match(read("src/components/EmployeeModule.tsx"), /org-departments/);
    assert.match(read("server.ts"), /registerHrOrgStructureRoutes/);
  });
});
