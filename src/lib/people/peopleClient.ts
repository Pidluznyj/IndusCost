/** Cliente HTTP do módulo Pessoas 360° (v1 consulta). */
import { fetchJsonOk } from "@/src/lib/http";
import type { EmployeeSystemLinksDto } from "@/src/lib/employeeSystemLinks";

export type PersonLinkState = "LINKED" | "NOT_LINKED" | "INACTIVE" | "PENDING_REVIEW" | "CONFLICT";

export type PeopleListRow = {
  id: string;
  shortId: string;
  displayName: string;
  civilName: string;
  socialName: string | null;
  status: string;
  origin: string;
  cpfMasked: string | null;
  updatedAt: string;
  links: { employee: PersonLinkState; appUser: PersonLinkState; fleetDriver: PersonLinkState; commissionPerson: PersonLinkState };
  documentsCount: number;
  flags: string[];
};

export type PeopleListResponse = {
  items: PeopleListRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export type PeopleListQuery = {
  q?: string;
  page?: number;
  limit?: number;
  status?: string;
  has?: string;
  missing?: string;
  pending?: string;
};

export type PendingLink = {
  kind: "employee" | "app_user" | "fleet_driver" | "commission_person" | "person";
  entityId: string;
  label: string;
  evidence: "CPF_EXACT" | "EMAIL_EXACT" | "EMPLOYEE_USER_LINK";
  currentPersonId: string | null;
  currentPersonLabel: string | null;
  severity: "PENDING" | "CONFLICT";
  hint: string;
};

export type PersonLinkEventDto = {
  id: string;
  eventKind: string;
  entityKind: string | null;
  entityId: string | null;
  fromPersonId: string | null;
  toPersonId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  reason: string | null;
  evidence: string | null;
  reversible: boolean;
  revertedAt: string | null;
  createdAt: string;
};

export type PersonProfile = {
  person: {
    id: string;
    shortId: string;
    displayName: string;
    civilName: string;
    socialName: string | null;
    status: string;
    origin: string;
    createdAt: string;
    updatedAt: string;
    cpfMasked: string | null;
    cpf: string | null;
    corporateEmailMasked: string | null;
    corporateEmail: string | null;
    personalEmailMasked: string | null;
    phoneMasked: string | null;
    mergedInto: { id: string; displayName: string } | null;
  };
  linkStates: { employee: PersonLinkState; appUser: PersonLinkState; fleetDriver: PersonLinkState; commissionPerson: PersonLinkState };
  documentsCount: number;
  flags: string[];
  cards: EmployeeSystemLinksDto;
  pending: PendingLink[];
  events: PersonLinkEventDto[];
  caps: {
    canViewPii: boolean;
    canManagePersonLink: boolean;
    canViewUsers: boolean;
    canViewFleet: boolean;
    canViewCommissions: boolean;
    canViewEmployees: boolean;
  };
};

export async function fetchPeople(query: PeopleListQuery): Promise<PeopleListResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  return fetchJsonOk<PeopleListResponse>(`/api/people?${qs.toString()}`);
}

export async function fetchPersonProfile(personId: string): Promise<PersonProfile> {
  return fetchJsonOk<PersonProfile>(`/api/people/${encodeURIComponent(personId)}`);
}

export const LINK_STATE_LABEL: Record<PersonLinkState, string> = {
  LINKED: "Vinculado",
  NOT_LINKED: "Não vinculado",
  INACTIVE: "Inativo",
  PENDING_REVIEW: "Pendente de revisão",
  CONFLICT: "Conflito de identidade",
};

export const PERSON_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
  MERGED: "Unificada",
  NEEDS_REVIEW: "Em revisão",
};

export const PERSON_FLAG_LABEL: Record<string, string> = {
  MERGED: "Unificada em outra Pessoa",
  NEEDS_REVIEW: "Identidade em revisão",
  USER_ON_OTHER_PERSON: "Conta do colaborador aponta para outra Pessoa",
  USER_WITHOUT_PERSON: "Conta do colaborador sem Pessoa",
  NO_LINKS: "Sem vínculos",
};

export const EVENT_KIND_LABEL: Record<string, string> = {
  PERSON_CREATED: "Pessoa criada",
  LINKED: "Vínculo criado",
  UNLINKED: "Vínculo removido",
  RELINKED: "Vínculo corrigido",
  MERGED: "Unificação",
  MERGE_REVERTED: "Unificação revertida",
  REVIEW_FLAGGED: "Marcada para revisão",
};
