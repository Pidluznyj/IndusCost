import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEmployeesDashboardSummary,
  DEFAULT_EMPLOYEES_DASHBOARD_FILTERS,
  employeeMatchesDashboardFilters,
  parseEmployeesDashboardFilters,
  type EmployeesDashboardEmployeeRow,
} from "./employeesDashboardSummary.ts";

function emp(
  partial: Partial<EmployeesDashboardEmployeeRow> & Pick<EmployeesDashboardEmployeeRow, "id" | "name">
): EmployeesDashboardEmployeeRow {
  return {
    socialName: null,
    corporateEmail: `${partial.id}@ex.com`,
    status: "ACTIVE",
    classification: "DIRETO",
    contractType: "CLT",
    salary: 5000,
    monthlyHours: 220,
    productivity: 100,
    admissionDate: "2024-01-15T00:00:00.000Z",
    terminationDate: null,
    costCenterId: "cc1",
    departmentId: "dep1",
    managerId: "mgr1",
    roleId: "role1",
    roleName: "Analista",
    costCenterCode: "CC01",
    costCenterName: "Admin",
    departmentName: "RH",
    directorateId: "dir1",
    directorateName: "Diretoria Admin",
    hasAppUser: true,
    components: [
      {
        id: "vr",
        name: "VR",
        type: "BENEFIT",
        calculationType: "FIXED",
        value: 500,
      },
    ],
    ...partial,
  };
}

describe("employeesDashboardSummary", () => {
  it("parseEmployeesDashboardFilters normaliza status e datas", () => {
    const f = parseEmployeesDashboardFilters({
      status: "inactive",
      classification: "direto",
      admissionFrom: "2026-01-01",
      q: " ana ",
    });
    assert.equal(f.status, "INACTIVE");
    assert.equal(f.classification, "DIRETO");
    assert.equal(f.admissionFrom, "2026-01-01");
    assert.equal(f.q, "ana");
  });

  it("filtra por status ACTIVE por padrão e agrega custos", () => {
    const summary = buildEmployeesDashboardSummary({
      includeCompensation: true,
      filters: { ...DEFAULT_EMPLOYEES_DASHBOARD_FILTERS },
      employees: [
        emp({ id: "a", name: "Ana", salary: 10000 }),
        emp({ id: "b", name: "Bruno", status: "INACTIVE", salary: 8000 }),
      ],
    });

    assert.equal(summary.headcount, 1);
    assert.equal(summary.activeCount, 1);
    assert.ok(summary.costs);
    assert.equal(summary.costs!.totalSalary, 10000);
    assert.equal(summary.costs!.totalBenefits, 500);
    assert.equal(summary.costs!.totalMonthlyCost, 10500);
    assert.equal(summary.payrollComponents?.length, 1);
    assert.equal(summary.payrollComponents?.[0].name, "VR");
    assert.equal(summary.payrollComponents?.[0].totalAmount, 500);
  });

  it("sem includeCompensation omite R$ e mantém headcount/qualidade", () => {
    const summary = buildEmployeesDashboardSummary({
      includeCompensation: false,
      filters: { ...DEFAULT_EMPLOYEES_DASHBOARD_FILTERS, status: "ALL" },
      employees: [
        emp({
          id: "a",
          name: "Ana",
          hasAppUser: false,
          corporateEmail: null,
          costCenterId: null,
          components: [],
          salary: 0,
        }),
      ],
    });

    assert.equal(summary.headcount, 1);
    assert.equal(summary.costs, null);
    assert.equal(summary.payrollComponents, null);
    assert.equal(summary.quality.withoutAppUser, 1);
    assert.equal(summary.quality.withoutCorporateEmail, 1);
    assert.equal(summary.quality.withoutCostCenter, 1);
    assert.equal(summary.quality.withoutSalary, 1);
    assert.equal(summary.quality.withoutPayrollComponents, 1);
  });

  it("movimentação ignora status ACTIVE e filtro de admissão do headcount", () => {
    const summary = buildEmployeesDashboardSummary({
      includeCompensation: false,
      filters: {
        ...DEFAULT_EMPLOYEES_DASHBOARD_FILTERS,
        status: "ACTIVE",
        admissionFrom: "2024-01-01",
        admissionTo: "2024-12-31",
      },
      employees: [
        emp({
          id: "a",
          name: "Ativo 2024",
          status: "ACTIVE",
          admissionDate: "2024-03-01T00:00:00.000Z",
        }),
        emp({
          id: "b",
          name: "Desligado 2024",
          status: "INACTIVE",
          admissionDate: "2020-01-01T00:00:00.000Z",
          terminationDate: "2024-06-15T00:00:00.000Z",
        }),
      ],
    });

    assert.equal(summary.headcount, 1);
    assert.equal(summary.movement.admissionsInPeriod, 1);
    assert.equal(summary.movement.terminationsInPeriod, 1);
  });

  it("employeeMatchesDashboardFilters respeita departamento e busca", () => {
    const row = emp({ id: "a", name: "Carla Silva", departmentId: "dep9" });
    assert.equal(
      employeeMatchesDashboardFilters(row, {
        ...DEFAULT_EMPLOYEES_DASHBOARD_FILTERS,
        departmentId: "dep9",
        q: "carla",
      }),
      true
    );
    assert.equal(
      employeeMatchesDashboardFilters(row, {
        ...DEFAULT_EMPLOYEES_DASHBOARD_FILTERS,
        departmentId: "outro",
      }),
      false
    );
  });

  it("UI wiring: página e rota usam dashboard-summary e permissão dedicada", async () => {
    const fs = await import("node:fs/promises");
    const page = await fs.readFile(
      new URL("../components/employee/EmployeesDashboardPage.tsx", import.meta.url),
      "utf8"
    );
    const routes = await fs.readFile(
      new URL("./employeesDashboardRoutes.ts", import.meta.url),
      "utf8"
    );
    const catalog = await fs.readFile(
      new URL("./permissionCatalog.ts", import.meta.url),
      "utf8"
    );
    assert.ok(page.includes("/api/employees/dashboard-summary"));
    assert.ok(page.includes("canViewEmployeesDashboard"));
    assert.ok(page.includes("canViewEmployeeCompensation"));
    assert.ok(routes.includes("EMPLOYEES_RESOURCE_KEYS.dashboard"));
    assert.ok(routes.includes("canViewEmployeesDashboard"));
    assert.ok(routes.includes("/api/employees/dashboard-summary"));
    assert.ok(catalog.includes("employees.dashboard.view"));
  });
});
