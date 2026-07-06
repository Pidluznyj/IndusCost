import { useEffect, useState } from "react";
import { getPortalContainer } from "@/src/lib/getPortalContainer";

/**
 * Garante que createPortal só rode após o DOM estar disponível no cliente.
 */
export function usePortalContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(() => getPortalContainer());

  useEffect(() => {
    setContainer(getPortalContainer());
  }, []);

  return container;
}
