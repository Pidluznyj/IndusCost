import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ClipboardList } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { INDUSCOST_CHAIN_VIEWS } from "@/src/components/supply-chain/PurchaseChainViewNav";

function isActiveIndusCostView(pathname: string, to: string): boolean {
  if (to === "/purchases") {
    return pathname === "/purchases";
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function PurchaseIndusCostRequestsMenuButton({ className }: { className?: string }) {
  const location = useLocation();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const anyInternalActive = INDUSCOST_CHAIN_VIEWS.some((view) =>
    isActiveIndusCostView(location.pathname, view.to)
  );

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="purchases-induscost-requests-menu"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent",
          (open || anyInternalActive) && "bg-accent"
        )}
      >
        <ClipboardList className="h-4 w-4 text-primary" />
        Solicitações IndusCost
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Solicitações IndusCost"
          data-testid="purchases-induscost-requests-menu-panel"
          className="absolute right-0 z-50 mt-2 min-w-[14rem] rounded-xl border border-border bg-card p-1 shadow-xl"
        >
          {INDUSCOST_CHAIN_VIEWS.map((view) => {
            const active = isActiveIndusCostView(location.pathname, view.to);
            return (
              <Link
                key={view.id}
                role="menuitem"
                to={view.to}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-accent",
                  active && "bg-accent"
                )}
              >
                {view.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
