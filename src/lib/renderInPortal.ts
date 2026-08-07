import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { getPortalContainer } from "@/src/lib/getPortalContainer.js";

/**
 * Renderiza `node` via portal para fora da árvore local (escapa de qualquer
 * ancestral com `transform`/stacking context que prenda `position: fixed`
 * — causa comum de modal/drawer aparecendo atrás do header).
 *
 * Sem `document` (SSR/testes com `renderToStaticMarkup`, sem jsdom),
 * `getPortalContainer` devolve `null` e o node é retornado inline, sem
 * quebrar snapshots/asserts existentes.
 */
export function renderInPortal(node: ReactNode): ReactNode {
  const container = getPortalContainer();
  return container ? createPortal(node, container) : node;
}
