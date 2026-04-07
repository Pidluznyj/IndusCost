export interface Role {
  id: string;
  name: string;
  baseSalary: number;
  monthlyHours: number;
}

export interface PayrollComponent {
  id: string;
  name: string;
  type: "BENEFIT" | "CHARGE" | "PROVISION";
  calculationType: "PERCENTAGE" | "FIXED";
  value: number;
}

export interface Employee {
  id: string;
  name: string;
  roleId: string;
  Role: Role;
  department: string;
  costCenter: string;
  classification: string;
  salary: number;
  monthlyHours: number;
  productivity: number;
  status: "ACTIVE" | "INACTIVE";
  EmployeePayrollComponent: { PayrollComponent: PayrollComponent }[];
  costs?: {
    salary: number;
    totalBenefits: number;
    totalCharges: number;
    totalProvisions: number;
    totalMonthlyCost: number;
    costPerContractedHour: number;
    costPerProductiveHour: number;
    productiveHours: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeInput {
  name: string;
  roleId: string;
  department: string;
  costCenter: string;
  classification: string;
  salary: number;
  monthlyHours: number;
  productivity: number;
  status?: "ACTIVE" | "INACTIVE";
  componentIds?: string[];
}
