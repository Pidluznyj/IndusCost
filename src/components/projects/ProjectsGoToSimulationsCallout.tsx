import React from "react";
import { Link } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import {
  buildSimulationsNewProductPath,
  PROJECTS_TO_SIMULATIONS_HINT,
} from "@/src/lib/simulationsNavigation";
import { cn } from "@/src/lib/utils";

type Variant = "banner" | "toolbar" | "inline";

export function ProjectsGoToSimulationsCallout({
  variant = "banner",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  if (variant === "toolbar") {
    return (
      <Link
        to={buildSimulationsNewProductPath()}
        data-testid="projects-go-to-simulations"
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10",
          className
        )}
      >
        <FlaskConical className="h-4 w-4 shrink-0" />
        Simular novo produto
      </Link>
    );
  }

  if (variant === "inline") {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {PROJECTS_TO_SIMULATIONS_HINT}{" "}
        <Link
          to={buildSimulationsNewProductPath()}
          data-testid="projects-go-to-simulations"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Ir para Simulações
        </Link>
      </p>
    );
  }

  return (
    <div
      data-testid="projects-go-to-simulations-callout"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{PROJECTS_TO_SIMULATIONS_HINT}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          O projeto não cria engenharia nova — simule em Simulações e depois adicione aqui.
        </p>
      </div>
      <Link
        to={buildSimulationsNewProductPath()}
        data-testid="projects-go-to-simulations"
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
      >
        <FlaskConical className="h-4 w-4" />
        Simular novo produto
      </Link>
    </div>
  );
}
