/**
 * Cliente HTTP do módulo de Satisfação (frontend administrativo).
 *
 * Todos os números exibidos vêm prontos do backend — esta camada não calcula
 * média, percentual nem taxa. Se a UI precisar de um indicador novo, ele nasce
 * no `satisfactionMetrics`/`satisfactionAnalytics`, não aqui.
 */

import { fetchJsonOk } from "@/src/lib/http.js";

const BASE = "/api/commercial/satisfaction";

export type SatisfactionCampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "OPEN"
  | "CLOSED"
  | "ARCHIVED";

export type SatisfactionCampaignRow = {
  id: string;
  code: string;
  name: string;
  status: SatisfactionCampaignStatus;
  referenceStart: string;
  referenceEnd: string;
  opensAt: string | null;
  closesAt: string | null;
  publishedAt: string | null;
  invitedCount: number;
  activeInvitationCount: number;
  responseCount: number;
  responseRate: number | null;
  averageRating: number | null;
  positiveCount: number;
  criticalCount: number;
};

export type SatisfactionDashboard = {
  kpis: {
    responseCount: number;
    averageRating: number | null;
    positiveCount: number;
    positivePercent: number | null;
    criticalCount: number;
    criticalPercent: number | null;
    responseRate: number | null;
    alertCustomerCount: number;
  };
  funnel: {
    invited: number;
    opened: number;
    started: number;
    completed: number;
    openRate: number | null;
    startRate: number | null;
    completionRate: number | null;
    abandonmentRate: number | null;
  };
  criteria: Array<{
    questionCode: string;
    label: string;
    average: number | null;
    count: number;
    positivePercent: number | null;
    criticalPercent: number | null;
    distribution: Record<string, number>;
    trend: "UP" | "DOWN" | "STABLE" | "UNKNOWN";
    trendDelta: number | null;
  }>;
  distribution: Record<string, number>;
  evolution: Array<{
    campaignId: string;
    campaignName: string;
    referenceStart: string;
    averageRating: number | null;
    responseCount: number;
  }>;
  attentionPoints: Array<{
    responseId: string;
    customerName: string;
    questionCode: string;
    criterion: string;
    rating: number;
    submittedAt: string | null;
    responsibleCommercialName: string | null;
  }>;
};

export type SatisfactionInvitationRow = {
  id: string;
  customerId: string;
  customerName: string;
  responsibleCommercialName: string | null;
  status: "NOT_OPENED" | "OPENED" | "STARTED" | "COMPLETED" | "REVOKED";
  firstOpenedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  revokedAt: string | null;
  hasActiveLink: boolean;
  linkPrefix: string | null;
  responseId: string | null;
};

export type SatisfactionCustomerOption = {
  id: string;
  companyName: string;
  taxId: string;
  responsibleCommercialName: string | null;
};

export type SatisfactionResponseRow = {
  id: string;
  customerName: string;
  respondentName: string | null;
  submittedAt: string | null;
  averageRating: number | null;
  lowestRating: number | null;
  alertLevel: "NONE" | "ATTENTION" | "CRITICAL";
  matchStatus: "MATCHED" | "UNMATCHED" | null;
  source: string;
};

export type Paginated<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const satisfactionApi = {
  dashboard(params: {
    campaignIds?: string | null;
    from?: string | null;
    to?: string | null;
    customerId?: string | null;
  }) {
    return fetchJsonOk<SatisfactionDashboard>(`${BASE}/dashboard${query(params)}`);
  },

  listCampaigns(params: { page?: number; pageSize?: number; status?: string | null; search?: string | null }) {
    return fetchJsonOk<Paginated<SatisfactionCampaignRow>>(`${BASE}/campaigns${query(params)}`);
  },

  getCampaign(id: string) {
    return fetchJsonOk<{ campaign: Record<string, unknown> }>(`${BASE}/campaigns/${id}`);
  },

  createCampaign(body: Record<string, unknown>) {
    return fetchJsonOk<{ campaign: SatisfactionCampaignRow }>(`${BASE}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  setAudience(id: string, customerIds: string[]) {
    return fetchJsonOk<{ added: number; removed: number; total: number }>(
      `${BASE}/campaigns/${id}/audience`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds }),
      }
    );
  },

  publish(id: string) {
    return fetchJsonOk<{ questionCount: number; invitationCount: number }>(
      `${BASE}/campaigns/${id}/publish`,
      { method: "POST" }
    );
  },

  close(id: string) {
    return fetchJsonOk(`${BASE}/campaigns/${id}/close`, { method: "POST" });
  },

  archive(id: string) {
    return fetchJsonOk(`${BASE}/campaigns/${id}/archive`, { method: "POST" });
  },

  duplicate(id: string) {
    return fetchJsonOk<{ campaign: SatisfactionCampaignRow }>(
      `${BASE}/campaigns/${id}/duplicate`,
      { method: "POST" }
    );
  },

  listCustomers(params: { search?: string | null; onlyWithOrders?: boolean; from?: string | null; to?: string | null }) {
    return fetchJsonOk<{ customers: SatisfactionCustomerOption[] }>(
      `${BASE}/customers${query({
        search: params.search,
        onlyWithOrders: params.onlyWithOrders ? "true" : null,
        from: params.from,
        to: params.to,
      })}`
    );
  },

  listInvitations(campaignId: string, params: { page?: number; pageSize?: number; status?: string | null; search?: string | null }) {
    return fetchJsonOk<Paginated<SatisfactionInvitationRow>>(
      `${BASE}/campaigns/${campaignId}/invitations${query(params)}`
    );
  },

  /** Devolve o link em claro UMA vez; chamar de novo ROTACIONA o token. */
  issueLink(invitationId: string) {
    return fetchJsonOk<{ url: string; tokenPrefix: string; rotated: boolean }>(
      `${BASE}/invitations/${invitationId}/link`,
      { method: "POST" }
    );
  },

  revokeInvitation(invitationId: string) {
    return fetchJsonOk(`${BASE}/invitations/${invitationId}/revoke`, { method: "POST" });
  },

  issueGeneralLink(campaignId: string) {
    return fetchJsonOk<{ url: string; tokenPrefix: string; rotated: boolean }>(
      `${BASE}/campaigns/${campaignId}/general-link`,
      { method: "POST" }
    );
  },

  results(campaignId: string) {
    return fetchJsonOk<SatisfactionDashboard & { campaign: SatisfactionCampaignRow }>(
      `${BASE}/campaigns/${campaignId}/results`
    );
  },

  listResponses(campaignId: string, params: { page?: number; pageSize?: number; onlyCritical?: boolean }) {
    return fetchJsonOk<Paginated<SatisfactionResponseRow>>(
      `${BASE}/campaigns/${campaignId}/responses${query({
        page: params.page,
        pageSize: params.pageSize,
        onlyCritical: params.onlyCritical ? "true" : null,
      })}`
    );
  },

  getResponse(id: string) {
    return fetchJsonOk<{ response: Record<string, any>; history: any[] }>(
      `${BASE}/responses/${id}`
    );
  },

  exportResults(campaignId: string) {
    return fetchJsonOk<{ rows: Record<string, unknown>[] }>(
      `${BASE}/campaigns/${campaignId}/export`
    );
  },
};

/** Rótulos de status — mesma nomenclatura do backend, sem inventar variação. */
export const CAMPAIGN_STATUS_LABELS: Record<SatisfactionCampaignStatus, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  OPEN: "Aberta",
  CLOSED: "Encerrada",
  ARCHIVED: "Arquivada",
};

export const INVITATION_STATUS_LABELS: Record<
  SatisfactionInvitationRow["status"],
  string
> = {
  NOT_OPENED: "Não abriu",
  OPENED: "Abriu",
  STARTED: "Começou",
  COMPLETED: "Respondeu",
  REVOKED: "Revogado",
};

/** Ações válidas por estado — a UI nunca oferece o que o backend recusaria. */
export function campaignActions(status: SatisfactionCampaignStatus) {
  return {
    canEdit: status === "DRAFT",
    canSetAudience: status === "DRAFT",
    canPublish: status === "DRAFT" || status === "SCHEDULED",
    canClose: status === "OPEN" || status === "SCHEDULED",
    canArchive: status === "CLOSED",
    canManageInvites: status !== "ARCHIVED",
    canSeeResults: status !== "DRAFT",
  };
}

export function formatRating(value: number | null): string {
  return value == null ? "—" : value.toFixed(2).replace(".", ",");
}

/** `null` significa "sem denominador confiável" e é mostrado como —, nunca 0%. */
export function formatPercent(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1).replace(".", ",")}%`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}
