export const SIMULATIONS_BASE_PATH = "/simulations";

/** Query `tab` para abrir diretamente Simular Novo Produto. */
export const SIMULATIONS_NEW_PRODUCT_TAB_PARAM = "new-product";

export type SimulationsWorkspaceTabParam = "scenarios" | typeof SIMULATIONS_NEW_PRODUCT_TAB_PARAM;

export function buildSimulationsNewProductPath(): string {
  return `${SIMULATIONS_BASE_PATH}?tab=${SIMULATIONS_NEW_PRODUCT_TAB_PARAM}`;
}

/** Mapeia query `tab` para o estado interno do SimulationModule. */
export function parseSimulationsWorkspaceTabParam(
  value: string | null | undefined
): "SCENARIOS" | "NEW_PRODUCT" {
  const raw = value?.trim().toLowerCase();
  if (raw === SIMULATIONS_NEW_PRODUCT_TAB_PARAM || raw === "new_product") {
    return "NEW_PRODUCT";
  }
  return "SCENARIOS";
}

export const SIMULATIONS_TO_PROJECTS_HINT =
  "Use as simulações salvas em Projetos para montar orçamentos." as const;

export const PROJECTS_TO_SIMULATIONS_HINT =
  "Precisa criar um produto novo? Crie primeiro em Simulações." as const;
