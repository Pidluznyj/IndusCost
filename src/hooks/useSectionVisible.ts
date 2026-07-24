import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Marca a seção como visível na primeira interseção (lazy fetch de blocos abaixo da dobra).
 * rootMargin generoso para pré-carregar perto da viewport — sem mudar layout.
 */
export function useSectionVisible<T extends Element = HTMLElement>(
  rootMargin = "120px"
): { ref: RefObject<T | null>; visible: boolean } {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, visible]);

  return { ref, visible };
}
