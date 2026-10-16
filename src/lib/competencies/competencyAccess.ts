/**
 * Competências e Desenvolvimento — recursos e ações do contrato de permissões.
 *
 * O perfil de acesso persiste 3 eixos por recurso (ver / executar / gerenciar), por isso
 * as 5 capacidades do módulo usam o recurso principal + duas abas próprias:
 *
 * | Capacidade                         | resourceKey                                 | ação     | legado                                   |
 * |------------------------------------|---------------------------------------------|----------|------------------------------------------|
 * | Ver o módulo                       | admin.employees.competencies                | view     | employees.competencies.view              |
 * | Editar a matriz (nível manual)     | admin.employees.competencies                | update   | employees.competencies.matrix.execute    |
 * | Gerenciar competências e postos    | admin.employees.competencies                | manage   | employees.competencies.manage            |
 * | Ver avaliações                     | admin.employees.competencies.assessments    | view     | employees.competencies.assessments.view  |
 * | Registrar avaliação                | admin.employees.competencies.assessments    | create   | employees.competencies.assessments.create|
 * | Ver treinamentos                   | admin.employees.competencies.trainings      | view     | employees.competencies.trainings.view    |
 * | Gerenciar treinamentos             | admin.employees.competencies.trainings      | manage   | employees.competencies.trainings.manage  |
 * | Ver aprovações de nível            | admin.employees.competencies.approvals      | view     | employees.competencies.approvals.view    |
 * | Aprovar níveis governados          | admin.employees.competencies.approvals      | manage   | employees.competencies.approvals.manage  |
 *
 * Prefixo `admin.employees.`: o "Editor de RH" passa no guard `requireResourceOrHrEditor`
 * quando não há grant próprio (nunca contra deny explícito).
 */

export const COMPETENCY_RESOURCE_KEYS = {
  module: "admin.employees.competencies",
  assessments: "admin.employees.competencies.assessments",
  trainings: "admin.employees.competencies.trainings",
  approvals: "admin.employees.competencies.approvals",
} as const;

export const COMPETENCY_MODULE_ID = "competencies" as const;
export const COMPETENCY_MODULE_PATH = "/competencies" as const;

export type CompetencyCapability =
  | "view"
  | "editMatrix"
  | "manageCatalog"
  | "viewAssessments"
  | "registerAssessment"
  | "viewTrainings"
  | "manageTrainings"
  | "viewApprovals"
  | "approveLevels";

export const COMPETENCY_CAPABILITY_GRANTS: Record<CompetencyCapability, { resourceKey: string; action: string }> = {
  view: { resourceKey: COMPETENCY_RESOURCE_KEYS.module, action: "view" },
  editMatrix: { resourceKey: COMPETENCY_RESOURCE_KEYS.module, action: "update" },
  manageCatalog: { resourceKey: COMPETENCY_RESOURCE_KEYS.module, action: "manage" },
  viewAssessments: { resourceKey: COMPETENCY_RESOURCE_KEYS.assessments, action: "view" },
  registerAssessment: { resourceKey: COMPETENCY_RESOURCE_KEYS.assessments, action: "create" },
  viewTrainings: { resourceKey: COMPETENCY_RESOURCE_KEYS.trainings, action: "view" },
  manageTrainings: { resourceKey: COMPETENCY_RESOURCE_KEYS.trainings, action: "manage" },
  viewApprovals: { resourceKey: COMPETENCY_RESOURCE_KEYS.approvals, action: "view" },
  approveLevels: { resourceKey: COMPETENCY_RESOURCE_KEYS.approvals, action: "manage" },
};

export const COMPETENCY_LEGACY_KEYS = {
  view: "employees.competencies.view",
  editMatrix: "employees.competencies.matrix.execute",
  manageCatalog: "employees.competencies.manage",
  viewAssessments: "employees.competencies.assessments.view",
  registerAssessment: "employees.competencies.assessments.create",
  viewTrainings: "employees.competencies.trainings.view",
  manageTrainings: "employees.competencies.trainings.manage",
  viewApprovals: "employees.competencies.approvals.view",
  approveLevels: "employees.competencies.approvals.manage",
} as const satisfies Record<CompetencyCapability, string>;

export type CompetencyCapabilities = Record<CompetencyCapability, boolean>;

/** Resolve as capacidades a partir de um verificador (ex.: `canPerformAction` do hook). */
export function resolveCompetencyCapabilities(
  can: (resourceKey: string, action: string) => boolean,
): CompetencyCapabilities {
  const out = {} as CompetencyCapabilities;
  for (const [cap, grant] of Object.entries(COMPETENCY_CAPABILITY_GRANTS) as [CompetencyCapability, { resourceKey: string; action: string }][]) {
    out[cap] = can(grant.resourceKey, grant.action);
  }
  // Ações de escrita pressupõem acesso de leitura ao módulo.
  if (!out.view) for (const cap of Object.keys(out) as CompetencyCapability[]) out[cap] = false;
  return out;
}

export const COMPETENCY_API_BASE = "/api/hr/competencies" as const;

/** Endpoints → recurso/ação (documentação + testes de guard). */
export const COMPETENCY_ENDPOINTS = [
  { method: "GET", path: "/api/hr/competencies/overview", capability: "view" },
  { method: "GET", path: "/api/hr/competencies/matrix", capability: "view" },
  { method: "GET", path: "/api/hr/competencies/catalog", capability: "view" },
  { method: "GET", path: "/api/hr/competencies/positions", capability: "view" },
  { method: "GET", path: "/api/hr/competencies/options", capability: "view" },
  { method: "GET", path: "/api/hr/competencies/departments", capability: "view" },
  { method: "PUT", path: "/api/hr/competencies/departments/:id/competencies", capability: "manageCatalog" },
  { method: "GET", path: "/api/hr/competencies/employees/:employeeId", capability: "view" },
  { method: "POST", path: "/api/hr/competencies/catalog", capability: "manageCatalog" },
  { method: "PUT", path: "/api/hr/competencies/catalog/:id", capability: "manageCatalog" },
  { method: "DELETE", path: "/api/hr/competencies/catalog/:id", capability: "manageCatalog" },
  { method: "POST", path: "/api/hr/competencies/positions", capability: "manageCatalog" },
  { method: "PUT", path: "/api/hr/competencies/positions/:id", capability: "manageCatalog" },
  { method: "PUT", path: "/api/hr/competencies/positions/:id/team", capability: "manageCatalog" },
  { method: "DELETE", path: "/api/hr/competencies/positions/:id", capability: "manageCatalog" },
  { method: "PUT", path: "/api/hr/competencies/levels/:employeeId/:competencyId", capability: "editMatrix" },
  { method: "GET", path: "/api/hr/competencies/approvals", capability: "viewApprovals" },
  { method: "POST", path: "/api/hr/competencies/approvals/:id/decision", capability: "approveLevels" },
  { method: "GET", path: "/api/hr/competencies/import/template", capability: "editMatrix" },
  { method: "POST", path: "/api/hr/competencies/import/preview", capability: "editMatrix" },
  { method: "POST", path: "/api/hr/competencies/import/apply", capability: "editMatrix" },
  { method: "GET", path: "/api/hr/competencies/assessments", capability: "viewAssessments" },
  { method: "POST", path: "/api/hr/competencies/assessments", capability: "registerAssessment" },
  { method: "PUT", path: "/api/hr/competencies/assessments/:id", capability: "registerAssessment" },
  { method: "DELETE", path: "/api/hr/competencies/assessments/:id", capability: "registerAssessment" },
  { method: "GET", path: "/api/hr/competencies/trainings", capability: "viewTrainings" },
  { method: "POST", path: "/api/hr/competencies/trainings", capability: "manageTrainings" },
  { method: "PUT", path: "/api/hr/competencies/trainings/:id", capability: "manageTrainings" },
  { method: "PATCH", path: "/api/hr/competencies/trainings/:id/status", capability: "manageTrainings" },
  { method: "DELETE", path: "/api/hr/competencies/trainings/:id", capability: "manageTrainings" },
  { method: "GET", path: "/api/hr/competencies/employees/:employeeId/certificates", capability: "viewTrainings" },
  { method: "GET", path: "/api/hr/competencies/certificate-settings", capability: "viewTrainings" },
  { method: "PUT", path: "/api/hr/competencies/certificate-settings", capability: "manageTrainings" },
  { method: "GET", path: "/api/hr/competencies/trainings/:id/certificates", capability: "viewTrainings" },
  { method: "PUT", path: "/api/hr/competencies/trainings/:id/certificate-content", capability: "manageTrainings" },
  { method: "POST", path: "/api/hr/competencies/trainings/:id/certificates", capability: "manageTrainings" },
  { method: "GET", path: "/api/hr/competencies/trainings/:id/certificates/document", capability: "viewTrainings" },
  { method: "POST", path: "/api/hr/competencies/certificates/:id/cancel", capability: "manageTrainings" },
] as const satisfies readonly { method: string; path: string; capability: CompetencyCapability }[];
