import { CreateEmployeeInput, Employee } from "@/src/types/employee";

export const CONTRACT_TYPE_OPTIONS = [
  { value: "CLT", label: "CLT", searchTerms: "CLT clt" },
  { value: "PJ", label: "PJ", searchTerms: "PJ pj" },
  { value: "ESTAGIO", label: "Estágio", searchTerms: "ESTAGIO estagio estágio" },
  { value: "TEMPORARIO", label: "Temporário", searchTerms: "TEMPORARIO temporario temporário" },
  { value: "APRENDIZ", label: "Aprendiz", searchTerms: "APRENDIZ aprendiz" },
  { value: "OUTRO", label: "Outro", searchTerms: "OUTRO outro" },
];

export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function formatEmployeeDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("pt-BR");
}

export function formatContractType(value: string | null | undefined): string {
  if (!value) return "—";
  return CONTRACT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function employeeToFormData(employee: Employee): CreateEmployeeInput {
  return {
    name: employee.name,
    socialName: employee.socialName ?? "",
    roleId: employee.roleId,
    department: employee.department,
    costCenter: employee.costCenter,
    classification: employee.classification,
    contractType: employee.contractType ?? "",
    admissionDate: toDateInputValue(employee.admissionDate),
    terminationDate: toDateInputValue(employee.terminationDate),
    managerName: employee.managerName ?? "",
    status: employee.status,
    cpf: employee.cpf ?? "",
    rg: employee.rg ?? "",
    birthDate: toDateInputValue(employee.birthDate),
    phone: employee.phone ?? "",
    personalEmail: employee.personalEmail ?? "",
    address: employee.address ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
    emergencyContactRelationship: employee.emergencyContactRelationship ?? "",
    shirtSize: employee.shirtSize ?? "",
    pantsSize: employee.pantsSize ?? "",
    jacketSize: employee.jacketSize ?? "",
    gloveSize: employee.gloveSize ?? "",
    shoeSize: employee.shoeSize ?? "",
    epiNotes: employee.epiNotes ?? "",
    professionalNotes: employee.professionalNotes ?? "",
    adminNotes: employee.adminNotes ?? "",
    salary: Number(employee.salary),
    monthlyHours: employee.monthlyHours,
    productivity: Number(employee.productivity),
    componentIds: employee.EmployeePayrollComponent.map((c) => c.PayrollComponent.id),
  };
}

export function createEmptyEmployeeForm(roleId = ""): CreateEmployeeInput {
  return {
    name: "",
    socialName: "",
    roleId,
    department: "",
    costCenter: "",
    classification: "DIRETO",
    contractType: "",
    admissionDate: "",
    terminationDate: "",
    managerName: "",
    cpf: "",
    rg: "",
    birthDate: "",
    phone: "",
    personalEmail: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelationship: "",
    shirtSize: "",
    pantsSize: "",
    jacketSize: "",
    gloveSize: "",
    shoeSize: "",
    epiNotes: "",
    professionalNotes: "",
    adminNotes: "",
    salary: 0,
    monthlyHours: 220,
    productivity: 100,
    status: "ACTIVE",
    componentIds: [],
  };
}

export function displayText(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "—";
}
