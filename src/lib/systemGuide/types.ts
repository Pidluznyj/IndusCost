export type WikiBadge =
  | "operacional"
  | "administrativo"
  | "integracao"
  | "financeiro"
  | "frota"
  | "avancado";

export type WikiAlertType = "attention" | "tip" | "common-error" | "permission";

export type WikiAlert = {
  type: WikiAlertType;
  text: string;
};

export type SystemGuideEntry = {
  anchor: string;
  title: string;
  objective: string;
  badge?: WikiBadge;
  whoUses?: string;
  whereToAccess?: string;
  permissions?: string;
  features: string[];
  basicFlow: string[];
  importantFields?: string[];
  businessRules?: string[];
  commonErrors?: string[];
  examples?: string[];
  securityNotes?: string[];
  notes: string[];
  relatedModules?: string[];
  relatedAnchors?: string[];
  tags?: string[];
  /** Marca funcionalidade parcial ou restrita sem expor detalhes técnicos. */
  statusNote?: string;
  alerts?: WikiAlert[];
};

export type SystemGuideSection = {
  anchor: string;
  title: string;
  intro?: string;
  badge?: WikiBadge;
  entries: SystemGuideEntry[];
};

export type WikiModuleCard = {
  id: string;
  title: string;
  description: string;
  badge: WikiBadge;
  sectionAnchor: string;
  icon?: string;
};

export type WikiFlowStep = {
  title: string;
  steps: string[];
};

export type WikiGlossaryTerm = {
  term: string;
  definition: string;
  relatedAnchors?: string[];
};
