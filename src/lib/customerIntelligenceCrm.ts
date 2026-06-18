/**
 * CRM / relacionamento — Inteligência do Cliente.
 * Fonte: CommercialActivity (+ CrmCustomerProfile opcional para notas).
 * Último contato = contactDate explícito (não usa data de pedido).
 */

import { daysBetweenDates, toIsoDateOnly } from "@/src/lib/customerIntelligenceUtils.js";
import {
  CUSTOMER_INTELLIGENCE_CRM_ACTIVITY_CREATE_PERMISSION,
  CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS,
} from "@/src/lib/customerIntelligencePermissions.js";
import type {
  CustomerIntelligenceActivityInput,
  CustomerIntelligenceCrm,
  CustomerIntelligenceCrmProfileInput,
  CustomerIntelligenceRelationshipStatus,
} from "@/src/lib/customerIntelligenceTypes.js";

/** Dias sem contactDate para classificar relacionamento como sem contato recente. */
export const CUSTOMER_INTELLIGENCE_CRM_NO_RECENT_CONTACT_DAYS = 90;

export const CUSTOMER_INTELLIGENCE_CRM_ACTIVITIES_LIMIT = 50;
export const CUSTOMER_INTELLIGENCE_CRM_TASKS_LIMIT = 20;
export const CUSTOMER_INTELLIGENCE_CRM_NOTES_LIMIT = 12;

export const CUSTOMER_INTELLIGENCE_CRM_VIEW_PERMISSIONS = CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS;

function activityTimelineDate(activity: CustomerIntelligenceActivityInput): Date {
  return (
    activity.contactDate ??
    activity.completedAt ??
    activity.scheduledAt ??
    activity.updatedAt ??
    activity.createdAt
  );
}

function isOpenCrmActivity(activity: CustomerIntelligenceActivityInput): boolean {
  const status = activity.status.trim().toUpperCase();
  return status === "OPEN" || status === "PENDING" || status === "SCHEDULED";
}

export function resolveCustomerIntelligenceRelationshipStatus(input: {
  activitiesCount: number;
  overdueTasksCount: number;
  daysSinceLastContact: number | null;
  hasPurchaseHistory: boolean;
  hasExplicitContact: boolean;
}): CustomerIntelligenceRelationshipStatus {
  if (input.activitiesCount === 0) {
    return "sem_historico";
  }
  if (input.overdueTasksCount > 0) {
    return "tarefa_vencida";
  }
  if (!input.hasExplicitContact) {
    return "sem_contato_recente";
  }
  if (
    input.daysSinceLastContact != null &&
    input.daysSinceLastContact > CUSTOMER_INTELLIGENCE_CRM_NO_RECENT_CONTACT_DAYS
  ) {
    return input.hasPurchaseHistory ? "reativacao" : "sem_contato_recente";
  }
  return "ativo";
}

export function buildCustomerIntelligenceCrmActions(customerId: string): CustomerIntelligenceCrm["actions"] {
  return [
    {
      id: "open-crm",
      label: "Abrir CRM Comercial",
      kind: "link",
      href: `/crm-commercial?customerId=${encodeURIComponent(customerId)}`,
      reason: null,
    },
    {
      id: "register-contact",
      label: "Registrar contato",
      kind: "disabled",
      href: null,
      reason: `Use o CRM Comercial (permissão ${CUSTOMER_INTELLIGENCE_CRM_ACTIVITY_CREATE_PERMISSION}).`,
    },
    {
      id: "create-task",
      label: "Criar tarefa / follow-up",
      kind: "disabled",
      href: null,
      reason: "Agendamento via CRM Comercial — escrita não exposta nesta tela.",
    },
    {
      id: "add-note",
      label: "Adicionar observação",
      kind: "disabled",
      href: null,
      reason: "Perfil de relacionamento editável em CRM Comercial (crm.profile.edit).",
    },
  ];
}

export function buildCustomerIntelligenceCrm(input: {
  customerId: string;
  commercialOwner: string | null;
  activities: CustomerIntelligenceActivityInput[];
  crmProfile: CustomerIntelligenceCrmProfileInput;
  hasPurchaseHistory: boolean;
  referenceDate: Date;
}): CustomerIntelligenceCrm {
  const now = input.referenceDate;
  const warnings: string[] = [];
  const sources = ["CommercialActivity"];

  const sortedActivities = [...input.activities].sort(
    (a, b) => activityTimelineDate(b).getTime() - activityTimelineDate(a).getTime()
  );

  const contactDates = input.activities
    .map((a) => a.contactDate)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime());

  const lastContactAt = contactDates[0]?.toISOString() ?? null;
  const lastActivityAt =
    sortedActivities.length > 0 ? activityTimelineDate(sortedActivities[0]!).toISOString() : null;

  const daysSinceLastContact =
    contactDates[0] != null ? daysBetweenDates(contactDates[0], now) : null;

  const openActivities = input.activities.filter(isOpenCrmActivity);
  const overdueTasks = openActivities.filter(
    (a) => a.nextActionAt != null && a.nextActionAt < now
  );

  const futureTasks = openActivities
    .filter((a) => a.nextActionAt != null && a.nextActionAt >= now)
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime());

  const nextTaskAt = futureTasks[0]?.nextActionAt?.toISOString() ?? null;

  const activities = sortedActivities.slice(0, CUSTOMER_INTELLIGENCE_CRM_ACTIVITIES_LIMIT).map(
    (a) => ({
      id: a.id,
      activityType: a.activityType,
      subject: a.subject,
      description: a.description,
      status: a.status,
      contactDate: a.contactDate?.toISOString() ?? null,
      scheduledAt: a.scheduledAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
      nextActionAt: a.nextActionAt?.toISOString() ?? null,
      nextActionDescription: a.nextActionDescription,
      channel: a.channel,
      outcome: a.outcome,
      assignedTo: a.assignedTo,
      createdAt: a.createdAt.toISOString(),
      isOverdue: a.nextActionAt != null && a.nextActionAt < now && isOpenCrmActivity(a),
    })
  );

  const tasks = openActivities
    .filter((a) => a.nextActionAt != null)
    .sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime())
    .slice(0, CUSTOMER_INTELLIGENCE_CRM_TASKS_LIMIT)
    .map((a) => ({
      id: a.id,
      subject: a.subject,
      nextActionAt: a.nextActionAt!.toISOString(),
      nextActionDescription: a.nextActionDescription,
      assignedTo: a.assignedTo,
      status: a.status,
      isOverdue: a.nextActionAt! < now,
    }));

  const notesFromActivities: CustomerIntelligenceCrm["notes"] = sortedActivities
    .flatMap((a) => {
      const parts: CustomerIntelligenceCrm["notes"] = [];
      const text = [a.subject, a.description, a.outcome].filter(Boolean).join(" — ").trim();
      if (text) {
        parts.push({
          text,
          source: "activity" as const,
          recordedAt: toIsoDateOnly(a.contactDate ?? a.createdAt),
        });
      }
      if (a.nextActionDescription?.trim()) {
        parts.push({
          text: a.nextActionDescription.trim(),
          source: "activity" as const,
          recordedAt: toIsoDateOnly(a.nextActionAt ?? a.createdAt),
        });
      }
      return parts;
    })
    .slice(0, CUSTOMER_INTELLIGENCE_CRM_NOTES_LIMIT);

  const notes = [...notesFromActivities];
  let profileLoaded = false;
  if (input.crmProfile?.relationshipNotes?.trim()) {
    profileLoaded = true;
    sources.push("CrmCustomerProfile");
    notes.unshift({
      text: input.crmProfile.relationshipNotes.trim(),
      source: "profile",
      recordedAt: null,
    });
  }

  if (input.activities.length === 0) {
    warnings.push("Nenhuma CommercialActivity registrada para este cliente.");
  } else if (contactDates.length === 0) {
    warnings.push(
      "Atividades existem, mas nenhuma possui contactDate — último contato não inferido de pedidos."
    );
  }

  const relationshipStatus = resolveCustomerIntelligenceRelationshipStatus({
    activitiesCount: input.activities.length,
    overdueTasksCount: overdueTasks.length,
    daysSinceLastContact,
    hasPurchaseHistory: input.hasPurchaseHistory,
    hasExplicitContact: contactDates.length > 0,
  });

  return {
    commercialOwner: input.commercialOwner?.trim() || null,
    lastContactAt,
    lastActivityAt,
    nextTaskAt,
    openTasksCount: openActivities.length,
    overdueTasksCount: overdueTasks.length,
    daysSinceLastContact,
    activities,
    tasks,
    notes: notes.slice(0, CUSTOMER_INTELLIGENCE_CRM_NOTES_LIMIT),
    relationshipStatus,
    dataQuality: {
      sources,
      warnings,
      activitiesLoaded: input.activities.length,
      profileLoaded,
    },
    actions: buildCustomerIntelligenceCrmActions(input.customerId),
  };
}
