/**
 * DTO executivo de “Vínculos no sistema” (ficha do colaborador).
 * Sem IDs técnicos na camada de apresentação — só em `audit`.
 */

export type SystemLinkKind =
  | "app_user"
  | "employee_self"
  | "employee_peer"
  | "manager"
  | "direct_report"
  | "commission_person"
  | "seller_alias"
  | "fleet_driver"
  | "customer_identity"
  | "customer_contact"
  | "portfolio_owner"
  | "other";

export type SystemLinkCard = {
  /** Chave estável só para UI (não é UUID de banco). */
  cardKey: string;
  kind: SystemLinkKind;
  typeLabel: string;
  entityLabel: string;
  entitySubtitle: string | null;
  statusLabel: string;
  originLabel: string;
  asOfLabel: string | null;
  alert: string | null;
  alertTone: "none" | "warning" | "conflict";
  action: {
    label: string;
    href: string | null;
    available: boolean;
    unavailableReason: string | null;
  } | null;
};

export type EmployeeSystemLinksDto = {
  employeeName: string;
  hasPerson: boolean;
  personDisplayName: string | null;
  personStatus: string | null;
  personOrigin: string | null;
  summary: {
    total: number;
    withAlert: number;
    byGroup: Record<string, number>;
  };
  groups: Array<{
    groupKey: string;
    groupLabel: string;
    cards: SystemLinkCard[];
  }>;
  emptyMessage: string | null;
};

export type EmployeeSystemLinksAudit = {
  employeeId: string;
  personId: string | null;
  generatedAt: string;
  technicalRefs: Array<{
    cardKey: string;
    kind: SystemLinkKind;
    entityTable: string;
    entityId: string;
  }>;
};

export const SYSTEM_LINK_GROUP_ORDER: Array<{ key: string; label: string }> = [
  { key: "access", label: "Acesso ao sistema" },
  { key: "hr", label: "RH e hierarquia" },
  { key: "commercial", label: "Comercial e comissões" },
  { key: "customers", label: "Clientes" },
  { key: "fleet", label: "Frota" },
  { key: "other", label: "Outros" },
];

export function groupKeyForKind(kind: SystemLinkKind): string {
  switch (kind) {
    case "app_user":
      return "access";
    case "employee_self":
    case "employee_peer":
    case "manager":
    case "direct_report":
      return "hr";
    case "commission_person":
    case "seller_alias":
    case "portfolio_owner":
      return "commercial";
    case "customer_identity":
    case "customer_contact":
      return "customers";
    case "fleet_driver":
      return "fleet";
    default:
      return "other";
  }
}

export function typeLabelForKind(kind: SystemLinkKind): string {
  switch (kind) {
    case "app_user":
      return "Usuário do sistema";
    case "employee_self":
      return "Colaborador (este cadastro)";
    case "employee_peer":
      return "Outro colaborador";
    case "manager":
      return "Gestor responsável";
    case "direct_report":
      return "Reporta a este colaborador";
    case "commission_person":
      return "Pessoa comissionada";
    case "seller_alias":
      return "Alias de vendedor (Nomus)";
    case "fleet_driver":
      return "Motorista";
    case "customer_identity":
      return "Cliente (identidade PF)";
    case "customer_contact":
      return "Contato de cliente";
    case "portfolio_owner":
      return "Responsável de carteira";
    default:
      return "Vínculo";
  }
}

/** Capacidades do visualizador — resolvidas pela auth; o agregador não inventa regras. */
export type SystemLinksViewerCaps = {
  canViewPii: boolean;
  canViewUsers: boolean;
  canViewCommissions: boolean;
  canViewCustomers: boolean;
  canViewFleet: boolean;
  canViewEmployees: boolean;
  canOpenAudit: boolean;
  canManagePersonLink: boolean;
};

export function buildSystemLinksViewerCaps(input: {
  role?: string | null;
  permissions?: string[] | null;
}): SystemLinksViewerCaps {
  const role = input.role ?? "";
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  const perms = new Set(input.permissions ?? []);
  const has = (p: string) => isAdmin || perms.has(p);

  return {
    canViewPii:
      has("employees.edit") ||
      has("employees.personal_data.view") ||
      has("people.pii.view") ||
      has("users.manage"),
    canViewUsers: has("users.manage") || has("settings.view"),
    canViewCommissions: has("commissions.view"),
    canViewCustomers: has("customers.view"),
    canViewFleet: has("fleet.view"),
    canViewEmployees:
      has("employees.view") || has("employees.edit") || has("costs.view"),
    canOpenAudit:
      has("employees.links.manage") ||
      has("people.link.manage") ||
      has("users.manage") ||
      has("employees.edit"),
    canManagePersonLink:
      has("employees.links.manage") ||
      has("people.link.manage") ||
      has("employees.edit") ||
      has("users.manage"),
  };
}

/** Filtra cards por texto (tipo, entidade, origem, status, alerta). */
export function filterSystemLinkDto(
  dto: EmployeeSystemLinksDto,
  query: string
): EmployeeSystemLinksDto {
  const q = query.trim().toLowerCase();
  if (!q) return dto;

  const groups = dto.groups
    .map((g) => ({
      ...g,
      cards: g.cards.filter((c) => {
        const hay = [
          c.typeLabel,
          c.entityLabel,
          c.entitySubtitle,
          c.statusLabel,
          c.originLabel,
          c.asOfLabel,
          c.alert,
          c.kind,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      }),
    }))
    .filter((g) => g.cards.length > 0);

  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  const byGroup: Record<string, number> = {};
  for (const g of groups) byGroup[g.groupKey] = g.cards.length;

  return {
    ...dto,
    groups,
    summary: {
      total,
      withAlert: groups
        .flatMap((g) => g.cards)
        .filter((c) => c.alertTone !== "none").length,
      byGroup,
    },
    emptyMessage:
      total === 0
        ? `Nenhum vínculo correspondente a “${query.trim()}”.`
        : null,
  };
}
