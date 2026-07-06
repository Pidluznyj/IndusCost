import { useCallback, useEffect, useRef } from "react";

export function usePrintRouteBodyClass(bodyClass: string): void {
  useEffect(() => {
    document.body.classList.add(bodyClass);
    return () => {
      document.body.classList.remove(bodyClass);
    };
  }, [bodyClass]);
}

export function triggerBrowserPrint(delayMs = 0): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (delayMs > 0) {
        window.setTimeout(() => window.print(), delayMs);
      } else {
        window.print();
      }
    });
  });
}

export function usePrintDocumentRoute(options: {
  bodyClass: string;
  onAfterPrint?: () => void;
}): {
  beginPrint: (delayMs?: number) => void;
} {
  const cleanupRef = useRef<number | null>(null);

  usePrintRouteBodyClass(options.bodyClass);

  const beginPrint = useCallback(
    (delayMs = 200) => {
      const onAfterPrint = () => {
        if (cleanupRef.current != null) {
          window.clearTimeout(cleanupRef.current);
          cleanupRef.current = null;
        }
        options.onAfterPrint?.();
      };

      window.addEventListener("afterprint", onAfterPrint, { once: true });
      cleanupRef.current = window.setTimeout(() => {
        window.removeEventListener("afterprint", onAfterPrint);
      }, 60_000);

      triggerBrowserPrint(delayMs);
    },
    [options]
  );

  return { beginPrint };
}
