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

export interface EmployeeHrProfileFields {
  socialName?: string | null;
  cpf?: string | null;
  rg?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  personalEmail?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
  admissionDate?: string | null;
  terminationDate?: string | null;
  contractType?: string | null;
  managerName?: string | null;
  professionalNotes?: string | null;
  address?: string | null;
  adminNotes?: string | null;
  shirtSize?: string | null;
  pantsSize?: string | null;
  jacketSize?: string | null;
  gloveSize?: string | null;
  shoeSize?: string | null;
  epiNotes?: string | null;
}

export interface Employee extends EmployeeHrProfileFields {
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

export interface CreateEmployeeInput extends EmployeeHrProfileFields {
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
