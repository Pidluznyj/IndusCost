/**
 * Scroll horizontal da worklist: barra nativa no topo só quando o grid transborda.
 * Sem overflow, nenhuma barra aparece.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/src/lib/utils";

export function SupplierEvaluationWorklistTableScroll({
  children,
  tableClassName,
}: {
  children: React.ReactNode;
  tableClassName?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [innerWidth, setInnerWidth] = useState(0);
  const [overflows, setOverflows] = useState(false);
  const syncing = useRef(false);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const update = () => {
      setInnerWidth(el.scrollWidth);
      setOverflows(el.scrollWidth > el.clientWidth + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [children]);

  const syncScroll = useCallback((source: "top" | "bottom") => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === "top" ? topRef.current : bottomRef.current;
    const to = source === "top" ? bottomRef.current : topRef.current;
    if (from && to) to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  return (
    <div data-testid="nse-grid-scroll-wrap">
      {overflows ? (
        <div
          ref={topRef}
          onScroll={() => syncScroll("top")}
          className="overflow-x-auto"
          style={{ height: 12, scrollbarWidth: "thin" }}
          aria-label="Rolagem horizontal do grid (topo)"
          data-testid="nse-grid-top-scroll"
        >
          <div style={{ width: innerWidth, height: 1 }} />
        </div>
      ) : null}
      <div
        ref={bottomRef}
        onScroll={() => syncScroll("bottom")}
        className="overflow-x-auto rounded-lg border border-border"
        data-testid="nse-grid-scroll"
      >
        <table className={cn("min-w-full w-full text-left text-xs", tableClassName)} data-testid="nse-grid">
          {children}
        </table>
      </div>
    </div>
  );
}
