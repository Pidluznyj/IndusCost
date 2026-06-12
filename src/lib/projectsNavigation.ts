export const PROJECTS_BASE_PATH = "/projects";

export const PROJECT_DETAIL_PATH = (projectId: string) => `${PROJECTS_BASE_PATH}/${projectId}`;

/** Menu enxuto — fluxo guiado por criação de itens. */
export type ProjectTabId = "home" | "items" | "costs" | "documents" | "history";

/** Rotas antigas redirecionam para o fluxo guiado. */
export type LegacyProjectTabId =
  | "summary"
  | "engineering"
  | "structure"
  | "materials"
  | "timeline"
  | "products"
  | "items"
  | "molds"
  | "versions"
  | "notes";

export const LEGACY_PROJECT_TAB_ALIASES: Record<LegacyProjectTabId, ProjectTabId> = {
  summary: "home",
  engineering: "home",
  structure: "items",
  materials: "items",
  timeline: "home",
  products: "home",
  items: "items",
  molds: "home",
  versions: "history",
  notes: "history",
};

export const PROJECT_TABS: { id: ProjectTabId; label: string }[] = [
  { id: "home", label: "Início" },
  { id: "items", label: "Itens do Projeto" },
  { id: "costs", label: "Custos do Projeto" },
  { id: "documents", label: "Documentos" },
  { id: "history", label: "Histórico" },
];

const ALL_TAB_IDS = new Set<string>([
  ...PROJECT_TABS.map((t) => t.id),
  ...Object.keys(LEGACY_PROJECT_TAB_ALIASES),
]);

export function resolveProjectTabSegment(segment: string | undefined): ProjectTabId {
  if (!segment || segment === "home" || segment === "summary") return "home";
  if (segment in LEGACY_PROJECT_TAB_ALIASES) {
    return LEGACY_PROJECT_TAB_ALIASES[segment as LegacyProjectTabId];
  }
  if (PROJECT_TABS.some((t) => t.id === segment)) return segment as ProjectTabId;
  return "home";
}

export function parseProjectTabFromPath(pathname: string): ProjectTabId {
  const segment = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (segment[0] !== "projects" || !segment[1]) return "home";
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
  if (tab === "home") return PROJECT_DETAIL_PATH(projectId);
  return `${PROJECT_DETAIL_PATH(projectId)}/${tab}`;
}

export function isKnownProjectTabSegment(segment: string | undefined): boolean {
  if (!segment) return true;
  return ALL_TAB_IDS.has(segment);
}
