import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { resolveAppHeaderBreadcrumb } from "@/src/lib/sidebarLabels";

export const APP_HEADER_BREADCRUMB_MARKER = "app-header-breadcrumb";

export function AppHeaderBreadcrumb({ pathname }: { pathname: string }) {
  const segments = resolveAppHeaderBreadcrumb(pathname);

  return (
    <nav aria-label="Localização atual" data-header-breadcrumb={APP_HEADER_BREADCRUMB_MARKER}>
      <ol className="flex items-center gap-1 min-w-0">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li key={`${segment.label}-${index}`} className="flex items-center gap-1 min-w-0">
              {index > 0 ? (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
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
                    isLast ? "font-semibold tracking-tight text-foreground" : "text-muted-foreground"
                  )}
                  aria-current={isLast ? "page" : undefined}
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
