/**
 * Tipos / DTOs da Pessoa Canônica (núcleo).
 * Sem dados de domínio (salário, senha, comissão, etc.).
 */

export const PERSON_ORIGINS = [
  "MANUAL",
  "EMPLOYEE",
  "APP_USER",
  "COMMISSION",
  "SYSTEM",
  "BACKFILL",
] as const;

export type PersonOrigin = (typeof PERSON_ORIGINS)[number];

export const PERSON_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

/** Payload de criação/atualização (identidade apenas). */
export type PersonWriteInput = {
  displayName: string;
  socialName?: string | null;
  /** E-mail principal (mapeado para corporateEmail). */
  primaryEmail?: string | null;
  corporateEmail?: string | null;
  personalEmail?: string | null;
  cpf?: string | null;
  phone?: string | null;
  origin?: PersonOrigin;
  createdByUserId?: string | null;
};

/** DTO público: sem CPF completo / e-mails mascarados. */
export type PersonPublicDto = {
  id: string;
  displayName: string;
  socialName: string | null;
  primaryEmailMasked: string | null;
  status: string;
  origin: string;
};

/** DTO administrativo (exige permissão PII). */
export type PersonAdminDto = {
  id: string;
  displayName: string;
  socialName: string | null;
  primaryEmail: string | null;
  personalEmail: string | null;
  cpfNormalized: string | null;
  phoneNormalized: string | null;
  status: string;
  origin: string;
  createdByUserId: string | null;
  inactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  linksSummary: {
    employeeId: string | null;
    appUserId: string | null;
    commissionPersonIds: string[];
  };
};

export type PersonStage1Role = "employee" | "app_user" | "commission_person";
