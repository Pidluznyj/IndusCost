/**
 * Tipos e constantes da Ficha Funcional Corporativa.
 * Browser-safe — sem Prisma/fs.
 */

export const PEOPLE_PROFILE_HISTORY_PAGE_SIZE = 50;

export const HR_EMPLOYEE_HISTORY_EVENT_TYPES = [
  "INITIAL_STATE",
  "ADMISSION",
  "PROMOTION",
  "ROLE_CHANGE",
  "DEPARTMENT_CHANGE",
  "COST_CENTER_CHANGE",
  "MANAGER_CHANGE",
  "CONTRACT_CHANGE",
  "WORK_SCHEDULE_CHANGE",
  "COMPENSATION_ADJUSTMENT",
  "BENEFIT_CHANGE",
  "VACATION_START",
  "VACATION_END",
  "LEAVE_START",
  "LEAVE_END",
  "RETURN_TO_WORK",
  "EPI_DELIVERY",
  "DOCUMENT_ADDED",
  "NOTE_ADDED",
  "TERMINATION",
  "REHIRE",
] as const;

export type HrEmployeeHistoryEventType = (typeof HR_EMPLOYEE_HISTORY_EVENT_TYPES)[number];

export const HR_HISTORY_EVENT_LABELS: Record<HrEmployeeHistoryEventType, string> = {
  INITIAL_STATE: "Estado inicial conhecido",
  ADMISSION: "Admissão",
  PROMOTION: "Promoção",
  ROLE_CHANGE: "Alteração de cargo",
  DEPARTMENT_CHANGE: "Movimentação de departamento",
  COST_CENTER_CHANGE: "Alteração de centro de custo",
  MANAGER_CHANGE: "Alteração de gestor",
  CONTRACT_CHANGE: "Alteração de contrato",
  WORK_SCHEDULE_CHANGE: "Alteração de jornada",
  COMPENSATION_ADJUSTMENT: "Reajuste",
  BENEFIT_CHANGE: "Alteração de benefício",
  VACATION_START: "Início de férias",
  VACATION_END: "Término de férias",
  LEAVE_START: "Início de afastamento",
  LEAVE_END: "Término de afastamento",
  RETURN_TO_WORK: "Retorno ao trabalho",
  EPI_DELIVERY: "Entrega de EPI",
  DOCUMENT_ADDED: "Documento anexado",
  NOTE_ADDED: "Observação registrada",
  TERMINATION: "Desligamento",
  REHIRE: "Reativação",
};

export const PEOPLE_CAREER_POST_EVENT_TYPES = [
  "PROMOTION",
  "ROLE_CHANGE",
  "DEPARTMENT_CHANGE",
  "COST_CENTER_CHANGE",
  "MANAGER_CHANGE",
  "CONTRACT_CHANGE",
  "WORK_SCHEDULE_CHANGE",
] as const;

export type PeopleCareerPostEventType = (typeof PEOPLE_CAREER_POST_EVENT_TYPES)[number];

export const HR_COMPENSATION_ADJUSTMENT_TYPES = [
  "MERIT",
  "COLLECTIVE",
  "PROMOTION",
  "MARKET",
  "CORRECTION",
  "MANUAL_EDIT",
  "OTHER",
] as const;

export type HrCompensationAdjustmentType = (typeof HR_COMPENSATION_ADJUSTMENT_TYPES)[number];

export const HR_COMPENSATION_TYPE_LABELS: Record<HrCompensationAdjustmentType, string> = {
  MERIT: "Mérito",
  COLLECTIVE: "Dissídio / coletivo",
  PROMOTION: "Promoção",
  MARKET: "Mercado",
  CORRECTION: "Correção",
  MANUAL_EDIT: "Edição administrativa",
  OTHER: "Outro",
};

export const HR_EMPLOYEE_STATUS_VALUES = [
  "ACTIVE",
  "INACTIVE",
  "ON_LEAVE",
  "VACATION",
  "TERMINATED",
] as const;

export type HrEmployeeStatus = (typeof HR_EMPLOYEE_STATUS_VALUES)[number];

export const HR_EMPLOYEE_STATUS_LABELS: Record<HrEmployeeStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  ON_LEAVE: "Afastado",
  VACATION: "Férias",
  TERMINATED: "Desligado",
};

export const HR_NOTE_CATEGORIES = [
  "GERAL",
  "PROFISSIONAL",
  "RH",
  "GESTAO",
  "RESTRITA",
] as const;

export type HrNoteCategory = (typeof HR_NOTE_CATEGORIES)[number];

export const HR_NOTE_CATEGORY_LABELS: Record<HrNoteCategory, string> = {
  GERAL: "Geral",
  PROFISSIONAL: "Profissional",
  RH: "RH",
  GESTAO: "Gestão",
  RESTRITA: "Restrita",
};

export const HR_ABSENCE_TYPES = [
  "VACATION",
  "LEAVE",
  "SICK_LEAVE",
  "ACCIDENT",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "OTHER",
] as const;

export type HrAbsenceType = (typeof HR_ABSENCE_TYPES)[number];

export const HR_ABSENCE_TYPE_LABELS: Record<HrAbsenceType, string> = {
  VACATION: "Férias",
  LEAVE: "Licença",
  SICK_LEAVE: "Afastamento médico",
  ACCIDENT: "Acidente",
  MATERNITY: "Maternidade",
  PATERNITY: "Paternidade",
  UNPAID: "Não remunerado",
  OTHER: "Outro",
};

export const HR_ABSENCE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type HrAbsenceStatus = (typeof HR_ABSENCE_STATUSES)[number];

export type PeopleAccessScope = "NONE" | "SELF" | "DIRECT_REPORTS" | "DESCENDANTS" | "ALL";

export type PeopleProfileCapabilities = {
  canViewProfile: boolean;
  canViewOverview: boolean;
  canViewProfessional: boolean;
  canManageProfessional: boolean;
  canViewCareer: boolean;
  canManageCareer: boolean;
  canViewCompensationEvents: boolean;
  canViewCompensationValues: boolean;
  canManageCompensation: boolean;
  canViewBenefits: boolean;
  canManageBenefits: boolean;
  canViewPersonal: boolean;
  canManagePersonal: boolean;
  canViewEmergency: boolean;
  canManageEmergency: boolean;
  canViewEpi: boolean;
  canManageEpi: boolean;
  canViewDocuments: boolean;
  canManageDocuments: boolean;
  canViewAbsences: boolean;
  canManageAbsences: boolean;
  canViewHistory: boolean;
  canViewNotes: boolean;
  canManageNotes: boolean;
  canViewRestrictedNotes: boolean;
  canViewAudit: boolean;
  accessScope: PeopleAccessScope;
};

export type PeopleProfileKpis = {
  admissionDate: string | null;
  tenureLabel: string | null;
  lastPromotionDate: string | null;
  lastPromotionLabel: string | null;
  timeSinceLastPromotionLabel: string | null;
  lastAdjustmentDate: string | null;
  lastAdjustmentPercentage: number | null;
  lastAdjustmentType: string | null;
  lastAdjustmentTypeLabel: string | null;
  timeSinceLastAdjustmentLabel: string | null;
};

export type PeopleProfileSummaryIdentity = {
  employeeId: string;
  personId: string | null;
  registrationId: string;
  fullName: string;
  socialName: string | null;
  photoUrl: string | null;
  status: string;
  statusLabel: string;
  roleName: string | null;
  department: string | null;
  costCenterLabel: string | null;
  managerName: string | null;
  managerId: string | null;
  contractType: string | null;
  workSchedule: string | null;
  corporateEmail: string | null;
  classification: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type PeopleProfileSummaryDto = {
  identity: PeopleProfileSummaryIdentity;
  kpis: PeopleProfileKpis;
  overview: {
    situation: string;
    situationLabel: string;
    roleName: string | null;
    department: string | null;
    costCenterLabel: string | null;
    managerName: string | null;
    contractType: string | null;
    admissionDate: string | null;
    tenureLabel: string | null;
    lastPromotionDate: string | null;
    timeSinceLastPromotionLabel: string | null;
    lastAdjustmentDate: string | null;
    lastAdjustmentPercentage: number | null;
    timeSinceLastAdjustmentLabel: string | null;
    recentMovements: Array<{
      id: string;
      eventType: string;
      eventLabel: string;
      effectiveDate: string;
      summary: string;
    }>;
  };
  capabilities: PeopleProfileCapabilities;
};

export type PeopleHistoryCursor = {
  effectiveDate: string;
  createdAt: string;
  id: string;
};

export type PeopleHistoryEventDto = {
  id: string;
  eventType: string;
  eventLabel: string;
  effectiveDate: string;
  createdAt: string;
  source: string;
  reason: string | null;
  notes: string | null;
  summary: string;
  fromLabel: string | null;
  toLabel: string | null;
  percentage: number | null;
  previousAmount: number | null;
  newAmount: number | null;
  differenceAmount: number | null;
  createdByUserId: string | null;
  createdByName: string | null;
};

export const PEOPLE_PROFILE_TAB_IDS = [
  "overview",
  "professional",
  "career",
  "compensation",
  "benefits",
  "personal",
  "emergency",
  "epi",
  "documents",
  "absences",
  "history",
  "notes",
  "links",
  "admin",
] as const;

export type PeopleProfileTabId = (typeof PEOPLE_PROFILE_TAB_IDS)[number];
