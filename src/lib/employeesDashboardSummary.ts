/**
 * Agregação do Dashboard de Pessoas / RH.
 * Headcount sempre; custos só quando includeCompensation=true.
 */

import {
  buildEmployeeCostComponentLines,
  buildEmployeeCosts,
  type EmployeeCostBreakdown,
  type EmployeePayrollComponentLike,
} from "@/src/lib/employeeCostEngine";

export type EmployeesDashboardStatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

export type EmployeesDashboardFilters = {
  status: EmployeesDashboardStatusFilter;
  classification: string;
  contractType: string;
  costCenterId: string;
  departmentId: string;
  directorateId: string;
  q: string;
  admissionFrom: string | null;
  admissionTo: string | null;
};

export type EmployeesDashboardEmployeeRow = {
  id: string;
  name: string;
  socialName: string | null;
  corporateEmail: string | null;
  status: string | null;
  classification: string | null;
  contractType: string | null;
  salary: unknown;
  monthlyHours: unknown;
  productivity: unknown;
  admissionDate: Date | string | null;
  terminationDate: Date | string | null;
  costCenterId: string | null;
  departmentId: string | null;
  managerId: string | null;
  roleId: string | null;
  roleName: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  departmentName: string | null;
  directorateId: string | null;
  directorateName: string | null;
  hasAppUser: boolean;
  components: readonly EmployeePayrollComponentLike[];
};

export type NamedCountBucket = {
  key: string;
  label: string;
  count: number;
  totalMonthlyCost: number | null;
};

export type PayrollComponentAggregateRow = {
  componentId: string;
  name: string;
  type: string;
  calculationType: string;
  value: number;
  peopleCount: number;
  totalAmount: number;
  shareOfTotalCost: number | null;
};

export type EmployeesDashboardQualityGaps = {
  withoutAppUser: number;
  withoutCorporateEmail: number;
  withoutCostCenter: number;
  withoutDepartment: number;
  withoutManager: number;
  withoutSalary: number;
  withoutPayrollComponents: number;
};

export type EmployeesDashboardCostTotals = {
  totalSalary: number;
  totalBenefits: number;
  totalCharges: number;
  totalProvisions: number;
  totalMonthlyCost: number;
  averageCostPerPerson: number;
  totalContractedHours: number;
  totalProductiveHours: number;
  averageCostPerProductiveHour: number;
  salaryCoverageCount: number;
  salaryCoverageRatio: number;
};

export type EmployeesDashboardSummary = {
  filtersApplied: EmployeesDashboardFilters;
  includeCompensation: boolean;
  headcount: number;
  activeCount: number;
  inactiveCount: number;
  costs: EmployeesDashboardCostTotals | null;
  costComposition: Array<{ key: string; label: string; amount: number }> | null;
  byCostCenter: NamedCountBucket[];
  byDepartment: NamedCountBucket[];
  byClassification: NamedCountBucket[];
  byContractType: NamedCountBucket[];
  payrollComponents: PayrollComponentAggregateRow[] | null;
  quality: EmployeesDashboardQualityGaps;
  movement: {
    admissionsInPeriod: number;
    terminationsInPeriod: number;
  };
  filterOptions: {
    costCenters: Array<{ id: string; label: string }>;
    departments: Array<{ id: string; label: string; directorateId: string | null }>;
    directorates: Array<{ id: string; label: string }>;
    classifications: string[];
    contractTypes: string[];
  };
};

export const DEFAULT_EMPLOYEES_DASHBOARD_FILTERS: EmployeesDashboardFilters = {
  status: "ACTIVE",
  classification: "",
  contractType: "",
  costCenterId: "",
  departmentId: "",
  directorateId: "",
  q: "",
  admissionFrom: null,
  admissionTo: null,
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  DIRETO: "Direto",
  INDIRETO: "Indireto",
  APOIO: "Apoio",
};

const CONTRACT_LABELS: Record<string, string> = {
  CLT: "CLT",
  PJ: "PJ",
  ESTAGIO: "Estágio",
  TEMPORARIO: "Temporário",
  APRENDIZ: "Aprendiz",
  OUTRO: "Outro",
};

function parseDayBound(value: string | null, endOfDay: boolean): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}

function asTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function parseEmployeesDashboardFilters(
  query: Record<string, unknown>
): EmployeesDashboardFilters {
  const statusRaw = String(query.status ?? "ACTIVE").trim().toUpperCase();
  const status: EmployeesDashboardStatusFilter =
    statusRaw === "INACTIVE" || statusRaw === "ALL" ? statusRaw : "ACTIVE";

  const admissionFrom =
    typeof query.admissionFrom === "string" && query.admissionFrom.trim()
      ? query.admissionFrom.trim().slice(0, 10)
      : null;
  const admissionTo =
    typeof query.admissionTo === "string" && query.admissionTo.trim()
      ? query.admissionTo.trim().slice(0, 10)
      : null;

  return {
    status,
    classification: String(query.classification ?? "").trim().toUpperCase(),
    contractType: String(query.contractType ?? "").trim().toUpperCase(),
    costCenterId: String(query.costCenterId ?? "").trim(),
    departmentId: String(query.departmentId ?? "").trim(),
    directorateId: String(query.directorateId ?? "").trim(),
    q: String(query.q ?? "").trim(),
    admissionFrom,
    admissionTo,
  };
}

export function employeeMatchesDashboardFilters(
  row: EmployeesDashboardEmployeeRow,
  filters: EmployeesDashboardFilters
): boolean {
  const status = (row.status ?? "ACTIVE").toUpperCase();
  if (filters.status !== "ALL" && status !== filters.status) return false;

  if (
    filters.classification &&
    (row.classification ?? "").toUpperCase() !== filters.classification
  ) {
    return false;
  }

  if (
    filters.contractType &&
    (row.contractType ?? "").toUpperCase() !== filters.contractType
  ) {
    return false;
  }

  if (filters.costCenterId && row.costCenterId !== filters.costCenterId) {
    return false;
  }

  if (filters.departmentId && row.departmentId !== filters.departmentId) {
    return false;
  }

  if (filters.directorateId && row.directorateId !== filters.directorateId) {
    return false;
  }

  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const hay = [
      row.name,
      row.socialName ?? "",
      row.corporateEmail ?? "",
      row.roleName ?? "",
      row.departmentName ?? "",
      row.costCenterName ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }

  const fromTs = parseDayBound(filters.admissionFrom, false);
  const toTs = parseDayBound(filters.admissionTo, true);
  if (fromTs != null || toTs != null) {
    const admissionTs = asTime(row.admissionDate);
    if (admissionTs == null) return false;
    if (fromTs != null && admissionTs < fromTs) return false;
    if (toTs != null && admissionTs > toTs) return false;
  }

  return true;
}

function bumpNamed(
  map: Map<string, NamedCountBucket>,
  key: string,
  label: string,
  cost: number | null
) {
  const prev = map.get(key);
  if (!prev) {
    map.set(key, {
      key,
      label,
      count: 1,
      totalMonthlyCost: cost,
    });
    return;
  }
  prev.count += 1;
  if (cost != null) {
    prev.totalMonthlyCost = (prev.totalMonthlyCost ?? 0) + cost;
  }
}

function sortBuckets(rows: NamedCountBucket[]): NamedCountBucket[] {
  return [...rows].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

function classificationLabel(key: string): string {
  return CLASSIFICATION_LABELS[key] ?? (key || "—");
}

function contractLabel(key: string): string {
  return CONTRACT_LABELS[key] ?? (key || "—");
}

export function buildEmployeesDashboardSummary(input: {
  employees: readonly EmployeesDashboardEmployeeRow[];
  filters: EmployeesDashboardFilters;
  includeCompensation: boolean;
}): EmployeesDashboardSummary {
  const { filters, includeCompensation } = input;
  const all = input.employees;

  const filterOptions = {
    costCenters: uniqueOptions(
      all
        .filter((e) => e.costCenterId)
        .map((e) => ({
          id: e.costCenterId as string,
          label: [e.costCenterCode, e.costCenterName].filter(Boolean).join(" — ") || "Centro de custo",
        }))
    ),
    departments: uniqueDeptOptions(
      all
        .filter((e) => e.departmentId)
        .map((e) => ({
          id: e.departmentId as string,
          label: e.departmentName || "Departamento",
          directorateId: e.directorateId,
        }))
    ),
    directorates: uniqueOptions(
      all
        .filter((e) => e.directorateId)
        .map((e) => ({
          id: e.directorateId as string,
          label: e.directorateName || "Diretoria",
        }))
    ),
    classifications: [
      ...new Set(
        all
          .map((e) => (e.classification ?? "").toUpperCase())
          .filter(Boolean)
      ),
    ].sort(),
    contractTypes: [
      ...new Set(
        all
          .map((e) => (e.contractType ?? "").toUpperCase())
          .filter(Boolean)
      ),
    ].sort(),
  };

  const filtered = all.filter((row) => employeeMatchesDashboardFilters(row, filters));

  let activeCount = 0;
  let inactiveCount = 0;
  for (const row of filtered) {
    if ((row.status ?? "ACTIVE").toUpperCase() === "ACTIVE") activeCount += 1;
    else inactiveCount += 1;
  }

  const costsAcc = {
    totalSalary: 0,
    totalBenefits: 0,
    totalCharges: 0,
    totalProvisions: 0,
    totalMonthlyCost: 0,
    totalContractedHours: 0,
    totalProductiveHours: 0,
    salaryCoverageCount: 0,
  };

  const byCostCenter = new Map<string, NamedCountBucket>();
  const byDepartment = new Map<string, NamedCountBucket>();
  const byClassification = new Map<string, NamedCountBucket>();
  const byContractType = new Map<string, NamedCountBucket>();

  const payrollMap = new Map<
    string,
    {
      componentId: string;
      name: string;
      type: string;
      calculationType: string;
      value: number;
      peopleCount: number;
      totalAmount: number;
      peopleSeen: Set<string>;
    }
  >();

  const quality: EmployeesDashboardQualityGaps = {
    withoutAppUser: 0,
    withoutCorporateEmail: 0,
    withoutCostCenter: 0,
    withoutDepartment: 0,
    withoutManager: 0,
    withoutSalary: 0,
    withoutPayrollComponents: 0,
  };

  const movementFrom = parseDayBound(filters.admissionFrom, false);
  const movementTo = parseDayBound(filters.admissionTo, true);
  const hasMovementWindow = movementFrom != null || movementTo != null;

  /**
   * Movimentação usa o mesmo recorte estrutural (CC/dept/classificação/busca),
   * mas ignora status e filtro de admissão — senão INACTIVE/desligados somem
   * com status=ACTIVE e admissões viram eco do headcount.
   */
  const movementUniverse = hasMovementWindow
    ? all.filter((row) =>
        employeeMatchesDashboardFilters(row, {
          ...filters,
          status: "ALL",
          admissionFrom: null,
          admissionTo: null,
        })
      )
    : [];

  let admissionsInPeriod = 0;
  let terminationsInPeriod = 0;
  if (hasMovementWindow) {
    for (const row of movementUniverse) {
      const admissionTs = asTime(row.admissionDate);
      if (
        admissionTs != null &&
        (movementFrom == null || admissionTs >= movementFrom) &&
        (movementTo == null || admissionTs <= movementTo)
      ) {
        admissionsInPeriod += 1;
      }
      const termTs = asTime(row.terminationDate);
      if (
        termTs != null &&
        (movementFrom == null || termTs >= movementFrom) &&
        (movementTo == null || termTs <= movementTo)
      ) {
        terminationsInPeriod += 1;
      }
    }
  }

  for (const row of filtered) {
    const costs: EmployeeCostBreakdown | null = includeCompensation
      ? buildEmployeeCosts({
          salary: row.salary,
          monthlyHours: row.monthlyHours,
          productivity: row.productivity,
          components: row.components,
        })
      : null;

    const monthly = costs?.totalMonthlyCost ?? null;

    if (includeCompensation && costs) {
      costsAcc.totalSalary += costs.salary;
      costsAcc.totalBenefits += costs.totalBenefits;
      costsAcc.totalCharges += costs.totalCharges;
      costsAcc.totalProvisions += costs.totalProvisions;
      costsAcc.totalMonthlyCost += costs.totalMonthlyCost;
      costsAcc.totalContractedHours += Number(row.monthlyHours) || 0;
      costsAcc.totalProductiveHours += costs.productiveHours;
      if (costs.salary > 0) costsAcc.salaryCoverageCount += 1;

      for (const line of buildEmployeeCostComponentLines({
        salary: row.salary,
        components: row.components,
      })) {
        if (!line.componentId && !line.name) continue;
        const key = line.componentId || `${line.type}:${line.name}`;
        const prev = payrollMap.get(key);
        if (!prev) {
          payrollMap.set(key, {
            componentId: line.componentId,
            name: line.name,
            type: line.type,
            calculationType: line.calculationType,
            value: line.value,
            peopleCount: 1,
            totalAmount: line.amount,
            peopleSeen: new Set([row.id]),
          });
        } else {
          if (!prev.peopleSeen.has(row.id)) {
            prev.peopleSeen.add(row.id);
            prev.peopleCount += 1;
          }
          prev.totalAmount += line.amount;
        }
      }
    }

    bumpNamed(
      byCostCenter,
      row.costCenterId ?? "__none__",
      row.costCenterId
        ? [row.costCenterCode, row.costCenterName].filter(Boolean).join(" — ") ||
            "Centro de custo"
        : "Sem centro de custo",
      monthly
    );

    bumpNamed(
      byDepartment,
      row.departmentId ?? "__none__",
      row.departmentId ? row.departmentName || "Departamento" : "Sem departamento",
      monthly
    );

    const classKey = (row.classification ?? "").toUpperCase() || "__none__";
    bumpNamed(
      byClassification,
      classKey,
      classKey === "__none__" ? "Sem classificação" : classificationLabel(classKey),
      monthly
    );

    const contractKey = (row.contractType ?? "").toUpperCase() || "__none__";
    bumpNamed(
      byContractType,
      contractKey,
      contractKey === "__none__" ? "Sem contrato" : contractLabel(contractKey),
      monthly
    );

    if (!row.hasAppUser) quality.withoutAppUser += 1;
    if (!row.corporateEmail?.trim()) quality.withoutCorporateEmail += 1;
    if (!row.costCenterId) quality.withoutCostCenter += 1;
    if (!row.departmentId) quality.withoutDepartment += 1;
    if (!row.managerId) quality.withoutManager += 1;
    if (!(Number(row.salary) > 0)) quality.withoutSalary += 1;
    if (!row.components.length) quality.withoutPayrollComponents += 1;
  }

  const headcount = filtered.length;
  const costs: EmployeesDashboardCostTotals | null = includeCompensation
    ? {
        totalSalary: costsAcc.totalSalary,
        totalBenefits: costsAcc.totalBenefits,
        totalCharges: costsAcc.totalCharges,
        totalProvisions: costsAcc.totalProvisions,
        totalMonthlyCost: costsAcc.totalMonthlyCost,
        averageCostPerPerson: headcount > 0 ? costsAcc.totalMonthlyCost / headcount : 0,
        totalContractedHours: costsAcc.totalContractedHours,
        totalProductiveHours: costsAcc.totalProductiveHours,
        averageCostPerProductiveHour:
          costsAcc.totalProductiveHours > 0
            ? costsAcc.totalMonthlyCost / costsAcc.totalProductiveHours
            : 0,
        salaryCoverageCount: costsAcc.salaryCoverageCount,
        salaryCoverageRatio:
          headcount > 0 ? costsAcc.salaryCoverageCount / headcount : 0,
      }
    : null;

  const costComposition =
    costs == null
      ? null
      : [
          { key: "salary", label: "Referência salarial", amount: costs.totalSalary },
          { key: "benefits", label: "Benefícios", amount: costs.totalBenefits },
          { key: "charges", label: "Encargos", amount: costs.totalCharges },
          { key: "provisions", label: "Provisões", amount: costs.totalProvisions },
        ];

  const payrollComponents: PayrollComponentAggregateRow[] | null =
    includeCompensation
      ? [...payrollMap.values()]
          .map((row) => ({
            componentId: row.componentId,
            name: row.name,
            type: row.type,
            calculationType: row.calculationType,
            value: row.value,
            peopleCount: row.peopleCount,
            totalAmount: row.totalAmount,
            shareOfTotalCost:
              costs && costs.totalMonthlyCost > 0
                ? row.totalAmount / costs.totalMonthlyCost
                : null,
          }))
          .sort((a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name, "pt-BR"))
      : null;

  return {
    filtersApplied: filters,
    includeCompensation,
    headcount,
    activeCount,
    inactiveCount,
    costs,
    costComposition,
    byCostCenter: sortBuckets([...byCostCenter.values()]),
    byDepartment: sortBuckets([...byDepartment.values()]),
    byClassification: sortBuckets([...byClassification.values()]),
    byContractType: sortBuckets([...byContractType.values()]),
    payrollComponents,
    quality,
    movement: {
      admissionsInPeriod: hasMovementWindow ? admissionsInPeriod : 0,
      terminationsInPeriod: hasMovementWindow ? terminationsInPeriod : 0,
    },
    filterOptions,
  };
}

function uniqueOptions<T extends { id: string; label: string }>(
  rows: T[]
): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

function uniqueDeptOptions(
  rows: Array<{ id: string; label: string; directorateId: string | null }>
): Array<{ id: string; label: string; directorateId: string | null }> {
  return uniqueOptions(rows);
}
