import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sincroniza uma barra de rolagem horizontal "espelho" (sticky no topo) com o
 * container principal que rola a tabela. Padrão único adotado em toda a
 * Auditoria Pedido → Caixa / Status Pedidos.
 *
 * Uso:
 *
 * ```tsx
 * const {
 *   topScrollRef,
 *   mainScrollRef,
 *   tableRef,
 *   handleTopScroll,
 *   handleMainScroll,
 *   scrollContentWidth,
 * } = useTableHorizontalScrollSync({ minWidth: 1680, deps: [rows] });
 * ```
 *
 * Retorna refs para os três elementos e handlers `onScroll` já com anti-loop.
 * Não renderiza slider nem setas — deixa a scrollbar nativa aparecer.
 */
export function useTableHorizontalScrollSync(options: {
  minWidth: number;
  deps: ReadonlyArray<unknown>;
}) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const syncingRef = useRef(false);
  const [scrollContentWidth, setScrollContentWidth] = useState(options.minWidth);

  const sync = useCallback((source: "top" | "main") => {
    if (syncingRef.current) return;
    const top = topScrollRef.current;
    const main = mainScrollRef.current;
    if (!top || !main) return;
    syncingRef.current = true;
    if (source === "top") {
      main.scrollLeft = top.scrollLeft;
    } else {
      top.scrollLeft = main.scrollLeft;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }, []);

  const handleTopScroll = useCallback(() => sync("top"), [sync]);
  const handleMainScroll = useCallback(() => sync("main"), [sync]);

  // Recalcula largura do trilho superior conforme a tabela cresce/encolhe.
  useEffect(() => {
    const main = mainScrollRef.current;
    const table = tableRef.current;
    if (!main || !table) return;

    const updateScrollMetrics = () => {
      const width = Math.max(table.scrollWidth, main.scrollWidth, options.minWidth);
      setScrollContentWidth(width);
      const top = topScrollRef.current;
      if (top && !syncingRef.current) top.scrollLeft = main.scrollLeft;
    };

    updateScrollMetrics();
    const raf = requestAnimationFrame(updateScrollMetrics);
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollMetrics) : null;
    ro?.observe(table);
    ro?.observe(main);
    window.addEventListener("resize", updateScrollMetrics);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", updateScrollMetrics);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.minWidth, ...options.deps]);

  return {
    topScrollRef,
    mainScrollRef,
    tableRef,
    handleTopScroll,
    handleMainScroll,
    scrollContentWidth,
  };
}

/**
 * Classe única do trilho superior — scrollbar nativa fina cinza, sem
 * bordas azuis / setas / slider. Aplicar sobre um `<div>` que envolve um
 * `<div style={{ width: scrollContentWidth, height: 12 }} />`.
 */
export const TABLE_HORIZONTAL_TOP_SCROLL_CLASS =
  "sticky top-0 z-40 w-full overflow-x-scroll overflow-y-hidden overscroll-x-contain " +
  "border-b border-[#E5E7EB] bg-white " +
  "[scrollbar-width:auto] [scrollbar-color:#98A2B3_#F2F4F7] " +
  "[&::-webkit-scrollbar]:h-3 " +
  "[&::-webkit-scrollbar-track]:bg-[#F2F4F7] " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#98A2B3] " +
  "[&::-webkit-scrollbar-thumb:hover]:bg-[#667085]";
