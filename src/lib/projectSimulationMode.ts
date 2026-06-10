/** Modo explícito: edição isolada no projeto — nunca grava cadastro oficial. */
export const PROJECT_SIMULATION_MODE = "project-simulation" as const;

export type ProjectSimulationMode = typeof PROJECT_SIMULATION_MODE;

export const PROJECT_SIMULATION_BANNER_TITLE = "Snapshot editável do produto para orçamento";

export const PROJECT_SIMULATION_BANNER_SUBTITLE =
  "Esta edição é uma simulação do projeto. Nenhuma alteração será salva no cadastro oficial de produto, material ou BOM.";

/** Endpoints/padrões proibidos para gravação a partir do módulo Projetos. */
export const BLOCKED_OFFICIAL_WRITE_PATTERNS = [
  "updateProduct",
  "updateMaterial",
  "updateProductBOM",
  "deleteProduct",
  "deleteMaterial",
  "deleteProductBOM",
  "createProductBOM",
  "prisma.product.update",
  "prisma.product.create",
  "prisma.material.update",
  "prisma.material.create",
  "prisma.productBOM.update",
  "prisma.productBOM.create",
  "prisma.productBOM.delete",
  "prisma.productRouting.update",
  "prisma.productRouting.create",
  "prisma.productRouting.delete",
] as const;

export function assertProjectSimulationSaveTarget(endpoint: string): void {
  const lower = endpoint.toLowerCase();
  if (
    lower.includes("/api/products/") &&
    (lower.includes("method: 'patch'") ||
      lower.includes('method: "patch"') ||
      lower.includes("method: 'put'") ||
      lower.includes('method: "put"') ||
      lower.includes("method: 'delete'") ||
      lower.includes('method: "delete"') ||
      lower.includes("method: 'post'") && !lower.includes("/lookup/"))
  ) {
    throw new Error("Gravação em cadastro oficial de produto bloqueada no modo simulação.");
  }
}

export function isOfficialProductWriteFetch(url: string, method?: string): boolean {
  const m = (method ?? "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return false;
  return /\/api\/products(\/|$)/.test(url) && !/\/api\/projects\//.test(url);
}
