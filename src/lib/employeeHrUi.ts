import { CreateEmployeeInput, Employee } from "@/src/types/employee";
import {
  BRAZIL_UF_CODES,
  formatCpfMask,
  formatPhoneBrMask,
  formatZipCodeMask,
} from "@/src/lib/employeePersonalHr";

export type EmployeeFichaTabId =
  | "professional"
  | "personal"
  | "emergency"
  | "career"
  | "compensation"
  | "benefits"
  | "absences"
  | "epi"
  | "documents"
  | "admin"
  | "notes"
  | "links";

export const EMPLOYEE_FICHA_TABS: { id: EmployeeFichaTabId; label: string }[] = [
  { id: "professional", label: "Profissional" },
  { id: "personal", label: "Pessoal" },
  { id: "emergency", label: "Emergência" },
  { id: "career", label: "Carreira" },
  { id: "compensation", label: "Remuneração" },
  { id: "benefits", label: "Benefícios" },
  { id: "absences", label: "Férias & afastamentos" },
  { id: "epi", label: "EPI / Uniformes" },
  { id: "documents", label: "Documentos" },
  { id: "admin", label: "Referência administrativa" },
  { id: "notes", label: "Observações" },
  { id: "links", label: "Vínculos no sistema" },
];

/**
 * Guias só de registros da ficha (sem campos do cadastro): salvam na hora,
 * fora do "Salvar alterações", e só existem para colaborador já criado.
 */
export const EMPLOYEE_FICHA_RECORD_TABS: readonly EmployeeFichaTabId[] = [
  "career",
  "compensation",
  "benefits",
  "absences",
  "documents",
];

/** Estado civil — texto persistido = rótulo (valor legado fora da lista é tolerado). */
export const MARITAL_STATUS_OPTIONS = [
  "Solteiro(a)",
  "Casado(a)",
  "União estável",
  "Divorciado(a)",
  "Separado(a)",
  "Viúvo(a)",
] as const;

/** 27 UFs — mesma lista validada no servidor. */
export const BRAZIL_UF_OPTIONS = BRAZIL_UF_CODES;

export const EPI_TOP_SIZE_OPTIONS = [
  "PP",
  "P",
  "M",
  "G",
  "GG",
  "XGG",
  "EXGG",
  "Sob medida",
  "Não se aplica",
] as const;

export const EPI_PANTS_SIZE_OPTIONS = [
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
  "46",
  "48",
  "50",
  "52",
  "54",
  "56",
  "58",
  "60",
  "Sob medida",
  "Não se aplica",
] as const;

export const EPI_GLOVE_SIZE_OPTIONS = [
  "6 / PP",
  "7 / P",
  "8 / M",
  "9 / G",
  "10 / GG",
  "11 / XGG",
  "Único",
  "Não se aplica",
] as const;

export const EPI_SHOE_SIZE_OPTIONS = [
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "Sob medida",
  "Não se aplica",
] as const;

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

/** CEP com 8 dígitos ganha máscara; legado fora do padrão fica como está (servidor tolera se inalterado). */
function zipCodeToFormValue(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\D/g, "").length === 8 ? formatZipCodeMask(raw) : raw;
}

export function employeeToFormData(employee: Employee): CreateEmployeeInput {
  return {
    name: employee.name,
    socialName: employee.socialName ?? "",
    corporateEmail: employee.corporateEmail ?? "",
    roleId: employee.roleId,
    department: employee.department,
    departmentId: employee.departmentId ?? employee.orgDepartment?.id ?? "",
    costCenter: employee.costCenter,
    costCenterId: employee.costCenterId ?? employee.financialCostCenter?.id ?? "",
    classification: employee.classification,
    contractType: employee.contractType ?? "",
    admissionDate: toDateInputValue(employee.admissionDate),
    terminationDate: toDateInputValue(employee.terminationDate),
    managerName: employee.managerName ?? "",
    managerId: employee.managerId ?? employee.manager?.id ?? "",
    personId: employee.personId ?? employee.person?.id ?? "",
    personSourceKind: null,
    personSourceId: null,
    createNewPerson: false,
    personFieldResolutions: undefined,
    status: employee.status,
    cpf: employee.cpf ? formatCpfMask(employee.cpf) : "",
    rg: employee.rg ?? "",
    birthDate: toDateInputValue(employee.birthDate),
    phone: employee.phone ? formatPhoneBrMask(employee.phone) : "",
    personalEmail: employee.personalEmail ?? "",
    address: employee.address ?? "",
    maritalStatus: employee.maritalStatus ?? "",
    city: employee.city ?? "",
    state: employee.state ?? "",
    zipCode: zipCodeToFormValue(employee.zipCode),
    workSchedule: employee.workSchedule ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactPhone: employee.emergencyContactPhone
      ? formatPhoneBrMask(employee.emergencyContactPhone)
      : "",
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
    corporateEmail: "",
    roleId,
    department: "",
    departmentId: "",
    costCenter: "",
    costCenterId: "",
    classification: "DIRETO",
    contractType: "",
    admissionDate: "",
    terminationDate: "",
    managerName: "",
    managerId: "",
    personId: "",
    personSourceKind: null,
    personSourceId: null,
    createNewPerson: true,
    personFieldResolutions: undefined,
    cpf: "",
    rg: "",
    birthDate: "",
    phone: "",
    personalEmail: "",
    address: "",
    maritalStatus: "",
    city: "",
    state: "",
    zipCode: "",
    workSchedule: "",
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
