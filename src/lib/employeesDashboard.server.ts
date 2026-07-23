import type { PrismaClient } from "@prisma/client";
import {
  buildEmployeesDashboardSummary,
  parseEmployeesDashboardFilters,
  type EmployeesDashboardEmployeeRow,
  type EmployeesDashboardSummary,
} from "@/src/lib/employeesDashboardSummary.js";

export async function loadEmployeesDashboardSummary(
  prisma: PrismaClient,
  query: Record<string, unknown>,
  opts: { includeCompensation: boolean }
): Promise<EmployeesDashboardSummary> {
  const filters = parseEmployeesDashboardFilters(query);

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      socialName: true,
      corporateEmail: true,
      status: true,
      classification: true,
      contractType: true,
      salary: true,
      monthlyHours: true,
      productivity: true,
      admissionDate: true,
      terminationDate: true,
      costCenterId: true,
      departmentId: true,
      managerId: true,
      roleId: true,
      Role: { select: { id: true, name: true } },
      financialCostCenter: { select: { id: true, code: true, name: true } },
      orgDepartment: {
        select: {
          id: true,
          name: true,
          directorateId: true,
          directorate: { select: { id: true, name: true } },
        },
      },
      appUser: { select: { id: true } },
      EmployeePayrollComponent: {
        select: {
          PayrollComponent: {
            select: {
              id: true,
              name: true,
              type: true,
              calculationType: true,
              value: true,
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows: EmployeesDashboardEmployeeRow[] = employees.map((emp) => ({
    id: emp.id,
    name: emp.name,
    socialName: emp.socialName,
    corporateEmail: emp.corporateEmail,
    status: emp.status,
    classification: emp.classification,
    contractType: emp.contractType,
    salary: emp.salary,
    monthlyHours: emp.monthlyHours,
    productivity: emp.productivity,
    admissionDate: emp.admissionDate,
    terminationDate: emp.terminationDate,
    costCenterId: emp.costCenterId,
    departmentId: emp.departmentId,
    managerId: emp.managerId,
    roleId: emp.roleId,
    roleName: emp.Role?.name ?? null,
    costCenterCode: emp.financialCostCenter?.code ?? null,
    costCenterName: emp.financialCostCenter?.name ?? null,
    departmentName: emp.orgDepartment?.name ?? null,
    directorateId: emp.orgDepartment?.directorateId ?? emp.orgDepartment?.directorate?.id ?? null,
    directorateName: emp.orgDepartment?.directorate?.name ?? null,
    hasAppUser: Boolean(emp.appUser),
    components: emp.EmployeePayrollComponent.map((rel) => ({
      id: rel.PayrollComponent.id,
      name: rel.PayrollComponent.name,
      type: rel.PayrollComponent.type,
      calculationType: rel.PayrollComponent.calculationType,
      value: Number(rel.PayrollComponent.value),
    })),
  }));

  return buildEmployeesDashboardSummary({
    employees: rows,
    filters,
    includeCompensation: opts.includeCompensation,
  });
}
