/** Quando true, bloqueia criação de ProjectSimulatedProduct e BOM in-project via API/UI. */
export const PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION = true;

export const PROJECT_IN_PROJECT_PRODUCT_CREATION_DISABLED_MESSAGE =
  "Criação de produto ou componente dentro do projeto foi descontinuada. Crie em Simulações → Simular novo produto e adicione a simulação ao projeto, ou selecione um item oficial existente.";

export function projectInProjectProductCreationDisabledPayload() {
  return {
    error: PROJECT_IN_PROJECT_PRODUCT_CREATION_DISABLED_MESSAGE,
    code: "PROJECT_IN_PROJECT_PRODUCT_CREATION_DISABLED",
  };
}
