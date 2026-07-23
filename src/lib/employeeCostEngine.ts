/**
 * Motor de custeio HH / referência RH — fórmula canônica usada na ficha
 * e no dashboard de pessoas. Não é folha oficial.
 */

export type EmployeePayrollComponentLike = {
  type: string;
  calculationType: string;
  value: number | string;
  id?: string;
  name?: string;
};

export type EmployeeCostBreakdown = {
  salary: number;
  totalBenefits: number;
  totalCharges: number;
  totalProvisions: number;
  totalMonthlyCost: number;
  costPerContractedHour: number;
  costPerProductiveHour: number;
  productiveHours: number;
};

export type EmployeeCostComponentLine = {
  componentId: string;
  name: string;
  type: "BENEFIT" | "CHARGE" | "PROVISION" | string;
  calculationType: "PERCENTAGE" | "FIXED" | string;
  value: number;
  amount: number;
};

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Valor mensal de uma verba sobre a referência salarial. */
export function computePayrollComponentAmount(
  salary: number,
  component: Pick<EmployeePayrollComponentLike, "calculationType" | "value">
): number {
  const raw = toFiniteNumber(component.value);
  if (component.calculationType === "PERCENTAGE") {
    return (salary * raw) / 100;
  }
  return raw;
}

export function buildEmployeeCosts(input: {
  salary: unknown;
  monthlyHours: unknown;
  productivity?: unknown;
  components: readonly EmployeePayrollComponentLike[];
}): EmployeeCostBreakdown {
  const salary = Math.max(0, toFiniteNumber(input.salary));
  const monthlyHours = Math.max(0, toFiniteNumber(input.monthlyHours));
  const productivity = Math.max(0, toFiniteNumber(input.productivity ?? 100));

  let totalBenefits = 0;
  let totalCharges = 0;
  let totalProvisions = 0;

  for (const comp of input.components) {
    const amount = computePayrollComponentAmount(salary, comp);
    if (comp.type === "BENEFIT") totalBenefits += amount;
    else if (comp.type === "CHARGE") totalCharges += amount;
    else if (comp.type === "PROVISION") totalProvisions += amount;
  }

  const totalMonthlyCost = salary + totalBenefits + totalCharges + totalProvisions;
  const productiveHours = monthlyHours * (productivity / 100);
  const costPerContractedHour =
    monthlyHours > 0 ? totalMonthlyCost / monthlyHours : 0;
  const costPerProductiveHour =
    productiveHours > 0 ? totalMonthlyCost / productiveHours : 0;

  return {
    salary,
    totalBenefits,
    totalCharges,
    totalProvisions,
    totalMonthlyCost,
    costPerContractedHour,
    costPerProductiveHour,
    productiveHours,
  };
}

export function buildEmployeeCostComponentLines(input: {
  salary: unknown;
  components: readonly EmployeePayrollComponentLike[];
}): EmployeeCostComponentLine[] {
  const salary = Math.max(0, toFiniteNumber(input.salary));
  return input.components.map((comp) => ({
    componentId: comp.id ?? "",
    name: (comp.name ?? "").trim() || "—",
    type: comp.type,
    calculationType: comp.calculationType,
    value: toFiniteNumber(comp.value),
    amount: computePayrollComponentAmount(salary, comp),
  }));
}
