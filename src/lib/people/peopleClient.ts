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
  evidence: "CPF_EXACT" | "EMAIL_EXACT" | "EMPLOYEE_USER_LINK" | "ACCOUNT_WITHOUT_EMPLOYEE";
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
  linkedEntities: Array<{ kind: LinkEntityKind; id: string }>;
  pending: PendingLink[];
  events: PersonLinkEventDto[];
  caps: {
    canViewPii: boolean;
    canManagePersonLink: boolean;
    canViewUsers: boolean;
    canViewFleet: boolean;
    canViewCommissions: boolean;
    canViewEmployees: boolean;
    canMerge: boolean;
    canEditPerson: boolean;
    canManagePersonStatus: boolean;
    canCreateUsers: boolean;
    canManageDrivers: boolean;
    canAttachAccount: boolean;
  };
};

export type LinkEntityKind = "employee" | "app_user" | "fleet_driver" | "commission_person";

export type RelinkPreview = {
  entity: { kind: LinkEntityKind; id: string; label: string; detail: string | null; cpfMasked: string | null; emailMasked: string | null };
  currentPerson: { id: string; displayName: string; status: string } | null;
  targetPerson: { id: string; displayName: string; status: string };
  evidence: "CPF_EXACT" | "EMAIL_EXACT" | "MANUAL";
  decision: { ok: true; kind: "LINK" | "RELINK"; fromPersonId: string | null } | { ok: false; code: string; message: string; status: number };
  changes: string[];
  unchanged: string[];
  expectedCurrentPersonId: string | null;
};

export type MergePreview = {
  winner: MergeSide;
  loser: MergeSide;
  plan: {
    winnerId: string;
    loserId: string;
    evidence: "CPF_EXACT" | "EMAIL_EXACT" | "MANUAL";
    blockers: Array<{ code: string; message: string }>;
    moves: Array<{ entityKind: string; entityId: string }>;
    fillFromLoser: string[];
    unchanged: string[];
  };
};
export type MergeSide = {
  id: string;
  displayName: string;
  status: string;
  cpfMasked: string | null;
  emailMasked: string | null;
  counts: { employees: number; users: number; fleetDrivers: number; commissionPeople: number; customers: number };
};

const json = { "Content-Type": "application/json" };

export function previewRelink(personId: string, body: { entityKind: LinkEntityKind; entityId: string }) {
  return fetchJsonOk<RelinkPreview>(`/api/people/${encodeURIComponent(personId)}/links/preview`, { method: "POST", headers: json, body: JSON.stringify(body) });
}
export function relinkEntity(personId: string, body: { entityKind: LinkEntityKind; entityId: string; expectedCurrentPersonId: string | null; reason: string }) {
  return fetchJsonOk<{ eventId: string; kind: string }>(`/api/people/${encodeURIComponent(personId)}/links`, { method: "POST", headers: json, body: JSON.stringify(body) });
}
export function unlinkEntity(personId: string, entityKind: LinkEntityKind, entityId: string, reason: string) {
  return fetchJsonOk<{ eventId: string }>(`/api/people/${encodeURIComponent(personId)}/links/${entityKind}/${encodeURIComponent(entityId)}`, { method: "DELETE", headers: json, body: JSON.stringify({ reason }) });
}
export function previewMerge(winnerId: string, loserPersonId: string) {
  return fetchJsonOk<MergePreview>(`/api/people/${encodeURIComponent(winnerId)}/merge/preview`, { method: "POST", headers: json, body: JSON.stringify({ loserPersonId }) });
}
export function executeMerge(winnerId: string, body: { loserPersonId: string; reason: string; expectedMoveCount: number }) {
  return fetchJsonOk<{ eventId: string; moved: number }>(`/api/people/${encodeURIComponent(winnerId)}/merge`, { method: "POST", headers: json, body: JSON.stringify(body) });
}
export function revertMerge(winnerId: string, body: { eventId: string; reason: string }) {
  return fetchJsonOk<{ eventId: string; restored: number }>(`/api/people/${encodeURIComponent(winnerId)}/merge/revert`, { method: "POST", headers: json, body: JSON.stringify(body) });
}

// ---- Cadastro mestre (criar/editar/situação) ----
export type PersonIdentityForm = { displayName: string; socialName: string | null; corporateEmail: string | null; personalEmail: string | null; cpf: string | null; phone: string | null };
export type PersonIdentityEdit = PersonIdentityForm & { id: string; status: string; origin: string; cpfMasked: string | null; corporateEmailMasked: string | null; personalEmailMasked: string | null; piiVisible: boolean; editable: boolean };

export function createPerson(body: PersonIdentityForm) {
  return fetchJsonOk<{ id: string; displayName: string }>("/api/people", { method: "POST", headers: json, body: JSON.stringify(body) });
}
export function fetchPersonIdentity(personId: string) {
  return fetchJsonOk<PersonIdentityEdit>(`/api/people/${encodeURIComponent(personId)}/identity`);
}
export function updatePerson(personId: string, body: Partial<PersonIdentityForm> & { reason?: string }) {
  return fetchJsonOk<{ id: string; changed: string[]; eventId: string | null }>(`/api/people/${encodeURIComponent(personId)}`, { method: "PATCH", headers: json, body: JSON.stringify(body) });
}
export function setPersonStatus(personId: string, body: { status: "ACTIVE" | "INACTIVE"; reason: string }) {
  return fetchJsonOk<{ id: string; status: string; eventId: string }>(`/api/people/${encodeURIComponent(personId)}/status`, { method: "POST", headers: json, body: JSON.stringify(body) });
}

// ---- Habilitar acesso (criar conta) ----
export type EnableAccessBody = { name?: string; email?: string; password: string; mustChangePassword?: boolean };
export function enableAccess(personId: string, body: EnableAccessBody) {
  return fetchJsonOk<{ user: { id: string; email: string; name: string; role: string; employeeId: string | null; personId: string | null } }>(`/api/people/${encodeURIComponent(personId)}/access`, { method: "POST", headers: json, body: JSON.stringify(body) });
}

// ---- Regularizar vínculo existente (conta legada) ----
export type CandidateAccount = { id: string; name: string; role: string; isActive: boolean; emailMasked: string | null; email: string | null; personId: string | null; employee: { id: string; name: string; belongsToThisPerson: boolean } | null; evidence: "EMPLOYEE_LINK" | "EMAIL_EXACT" | "MANUAL" };
export type AttachPreview = {
  account: { id: string; name: string; role: string; isActive: boolean; emailMasked: string | null; currentPerson: { id: string; displayName: string } | null; currentEmployee: { id: string; name: string } | null };
  employee: { id: string; name: string; status: string; personId: string | null; emailMasked: string | null } | null;
  targetPerson: { id: string; displayName: string; status: string };
  emailMismatch: boolean;
  evidence: string | null;
  decision: { ok: true; kind: "LINK" | "RELINK"; setEmployeeId: string | null; setEmployeePersonId: boolean; touchesSuperAdmin: boolean } | { ok: false; code: string; status: number; message: string };
  changes: string[];
  unchanged: string[];
  expected: { personId: string | null; employeeId: string | null; linkEmployeeId?: string | null };
};
export function fetchCandidateAccounts(personId: string, q: string) {
  return fetchJsonOk<{ items: CandidateAccount[] }>(`/api/people/${encodeURIComponent(personId)}/access/candidates?q=${encodeURIComponent(q)}`);
}
export function previewAttachAccount(personId: string, body: { appUserId: string; employeeId?: string | null }) {
  return fetchJsonOk<AttachPreview>(`/api/people/${encodeURIComponent(personId)}/access/attach/preview`, { method: "POST", headers: json, body: JSON.stringify(body) });
}
export function attachAccount(personId: string, body: { appUserId: string; employeeId?: string | null; expected: { personId: string | null; employeeId: string | null; linkEmployeeId?: string | null }; confirmEmailMismatch: boolean; reason: string }) {
  return fetchJsonOk<{ eventId: string; kind: string }>(`/api/people/${encodeURIComponent(personId)}/access/attach`, { method: "POST", headers: json, body: JSON.stringify(body) });
}

// ---- Habilitar motorista ----
export type DriverEnablePreview = {
  person: { id: string; displayName: string; status: string; cpfMasked: string | null; hasPhone: boolean; hasEmail: boolean };
  plan: { action: "CREATE" | "LINK" | "REACTIVATE" | "ALREADY_ENABLED" | "CONFLICT" | "BLOCKED"; driverId: string | null; blockers: Array<{ code: string; message: string }> };
  candidates: Array<{ id: string; name: string; status: string; linkedToThisPerson: boolean; linkedToOtherPerson: boolean; cpfMasked: string | null; hasCnh: boolean; createdFromPublicReservation: boolean }>;
  fromPerson: string[];
  fleetFields: string[];
};
export type DriverFleetForm = { cnhNumber: string | null; cnhCategory: string | null; cnhExpirationDate: string | null; unit: string | null; costCenter: string | null; notes: string | null };
export function previewDriverEnable(personId: string) {
  return fetchJsonOk<DriverEnablePreview>(`/api/people/${encodeURIComponent(personId)}/driver/preview`);
}
export function enableDriver(personId: string, body: DriverFleetForm & { action: string; reason: string }) {
  return fetchJsonOk<{ action: string; driverId: string; eventId: string }>(`/api/people/${encodeURIComponent(personId)}/driver`, { method: "POST", headers: json, body: JSON.stringify(body) });
}

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
  USER_WITHOUT_EMPLOYEE_LINK: "Conta sem vínculo ao colaborador (não avalia a equipe)",
  PERSON_INACTIVE_WITH_ACTIVE_LINKS: "Pessoa inativa com vínculos ativos (reative ou corrija)",
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
  IDENTITY_UPDATED: "Dados da identidade alterados",
  PERSON_INACTIVATED: "Pessoa inativada",
  PERSON_REACTIVATED: "Pessoa reativada",
};
