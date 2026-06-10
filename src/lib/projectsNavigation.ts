export const PROJECTS_BASE_PATH = "/projects";

export const PROJECT_DETAIL_PATH = (projectId: string) => `${PROJECTS_BASE_PATH}/${projectId}`;

export type ProjectTabId =
  | "summary"
  | "products"
  | "structure"
  | "items"
  | "molds"
  | "costs"
  | "versions"
  | "notes";

export const PROJECT_TABS: { id: ProjectTabId; label: string }[] = [
  { id: "summary", label: "Resumo" },
  { id: "products", label: "Produtos simulados" },
  { id: "structure", label: "Estrutura / Componentes" },
  { id: "items", label: "Itens simulados" },
  { id: "molds", label: "Molde / Ferramental" },
  { id: "costs", label: "Custos e preço" },
  { id: "versions", label: "Versões" },
  { id: "notes", label: "Observações" },
];

export function parseProjectTabFromPath(pathname: string): ProjectTabId {
  const segment = pathname.replace(/^\//, "").split("/").filter(Boolean);
  if (segment[0] !== "projects" || !segment[1]) return "summary";
  const tab = segment[2] as ProjectTabId | undefined;
  if (tab && PROJECT_TABS.some((t) => t.id === tab)) return tab;
  return "summary";
}

export function getProjectTabPath(projectId: string, tab: ProjectTabId): string {
  if (tab === "summary") return PROJECT_DETAIL_PATH(projectId);
  return `${PROJECT_DETAIL_PATH(projectId)}/${tab}`;
}
