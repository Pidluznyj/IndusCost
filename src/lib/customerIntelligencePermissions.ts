/**
 * Permissões — Inteligência do Cliente (leitura e escrita CRM relacionada).
 */

export const CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS = [
  "crm.customer_cockpit.view",
  "customers.commercial360.view",
  "customers.view",
] as const;

export type CustomerIntelligenceViewPermission =
  (typeof CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS)[number];

export const CUSTOMER_INTELLIGENCE_CRM_ACTIVITY_CREATE_PERMISSION = "crm.activities.create";

export const CUSTOMER_INTELLIGENCE_CRM_PROFILE_EDIT_PERMISSION = "crm.profile.edit";
