import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { resolveAppHeaderBreadcrumb } from "@/src/lib/sidebarLabels";

export const APP_HEADER_BREADCRUMB_MARKER = "app-header-breadcrumb";

export function AppHeaderBreadcrumb({ pathname }: { pathname: string }) {
  const segments = resolveAppHeaderBreadcrumb(pathname);

  return (
    <nav
      aria-label="Localização atual"
      data-header-breadcrumb={APP_HEADER_BREADCRUMB_MARKER}
      className="min-w-0 max-w-full overflow-hidden"
    >
      <ol className="flex items-center gap-1 min-w-0 max-w-full">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li
              key={`${segment.label}-${index}`}
              className={cn(
                "flex items-center gap-1 min-w-0",
                !isLast && segments.length > 1 && "hidden sm:flex"
              )}
            >
              {index > 0 ? (
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground/70",
                    isLast && segments.length > 1 && "hidden sm:block"
                  )}
                  aria-hidden="true"
                />
              ) : null}
              {segment.path && !isLast ? (
                <Link
                  to={segment.path}
                  className="truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {segment.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    "truncate text-sm",
                    isLast
                      ? "font-semibold tracking-tight text-foreground"
                      : "text-muted-foreground"
                  )}
                  aria-current={isLast ? "page" : undefined}
                  title={
                    !isLast && !segment.path
                      ? "Grupo do menu — use a barra lateral"
                      : undefined
                  }
                >
                  {segment.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
