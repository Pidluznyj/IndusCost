/**
 * Camadas padrão de empilhamento de modais (Tailwind).
 * - base (z-50): modais principais da aplicação
 * - elevated (z-[60]): modais secundários acima do base (ex.: Visão comercial)
 * - stacked (z-[85]): modal filho acima de outro modal aberto
 */
export const MODAL_Z_INDEX_BASE = "z-50";
export const MODAL_Z_INDEX_ELEVATED = "z-[60]";
export const MODAL_Z_INDEX_STACKED = "z-[85]";

export function resolveModalStackZIndex(stacked = false): string {
  return stacked ? MODAL_Z_INDEX_STACKED : MODAL_Z_INDEX_BASE;
}
