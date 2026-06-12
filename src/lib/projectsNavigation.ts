export const PROJECTS_BASE_PATH = "/projects";

export const PROJECT_DETAIL_PATH = (projectId: string) => `${PROJECTS_BASE_PATH}/${projectId}`;

/** Abas principais do detalhe do projeto (menu reorganizado). */
export type ProjectTabId =
  | "summary"
  | "engineering"
  | "structure"
  | "costs"
  | "materials"
  | "timeline"
  | "documents"
  | "history";

/** Rotas legadas mantidas para compatibilidade — redirecionam para aba equivalente. */
export type LegacyProjectTabId =
  | "products"
  | "items"
  | "molds"
  | "versions"
  | "notes";

export const LEGACY_PROJECT_TAB_ALIASES: Record<LegacyProjectTabId, ProjectTabId> = {
  products: "engineering",
  items: "materials",
  molds: "materials",
  versions: "history",
  notes: "history",
};

export const PROJECT_TABS: { id: ProjectTabId; label: string }[] = [
  { id: "summary", label: "Visão Geral" },
  { id: "engineering", label: "Engenharia do Projeto" },
  { id: "structure", label: "Estrutura / Árvore" },
  { id: "costs", label: "Simulação de Custos" },
  { id: "materials", label: "Materiais e Componentes" },
  { id: "timeline", label: "Cronograma / Etapas" },
  { id: "documents", label: "Documentos" },
  { id: "history", label: "Histórico" },
];

const ALL_TAB_IDS = new Set<string>([
  ...PROJECT_TABS.map((t) => t.id),
  ...Object.keys(LEGACY_PROJECT_TAB_ALIASES),
]);

export function resolveProjectTabSegment(segment: string | undefined): ProjectTabId {
  if (!segment || segment === "summary") return "summary";
  if (segment in LEGACY_PROJECT_TAB_ALIASES) {
    return LEGACY_PROJECT_TAB_ALIASES[segment as LegacyProjectTabId];
  }
  if (PROJECT_TABS.some((t) => t.id === segment)) return segment as ProjectTabId;
  return "summary";
}

export function parseProjectTabFromPath(pathname: string): ProjectTabId {
  const segment = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (segment[0] !== "projects" || !segment[1]) return "summary";
  return resolveProjectTabSegment(segment[2]);
}

export function parseLegacyTabSegment(pathname: string): LegacyProjectTabId | null {
  const segment = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (segment[0] !== "projects" || !segment[1]) return null;
  const tab = segment[2];
  if (tab && tab in LEGACY_PROJECT_TAB_ALIASES) return tab as LegacyProjectTabId;
  return null;
}

export function getProjectTabPath(projectId: string, tab: ProjectTabId): string {
  if (tab === "summary") return PROJECT_DETAIL_PATH(projectId);
  return `${PROJECT_DETAIL_PATH(projectId)}/${tab}`;
}

export function isKnownProjectTabSegment(segment: string | undefined): boolean {
  if (!segment) return true;
  return ALL_TAB_IDS.has(segment);
}
