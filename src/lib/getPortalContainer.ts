/**
 * Retorna um container DOM seguro para ReactDOM.createPortal.
 * Preferência: #modal-root, fallback document.body.
 */
export function getPortalContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const modalRoot = document.getElementById("modal-root");
  if (modalRoot instanceof HTMLElement) return modalRoot;
  return document.body instanceof HTMLElement ? document.body : null;
}
