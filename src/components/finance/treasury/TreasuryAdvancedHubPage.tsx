import React from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/src/lib/utils";
import type { TreasuryFeatureFlagsMap } from "@/src/lib/treasury/treasuryRollout.js";
import { filterTreasuryUiSections } from "@/src/lib/treasury/treasuryRollout.js";
import { TREASURY_UI_ADVANCED_SECTIONS } from "./treasuryFeatureUi.js";

/**
 * Hub secundário — Recursos avançados (ADMIN / SUPER_ADMIN).
 * Não é a experiência inicial; preserva deep-links técnicos.
 */
export function TreasuryAdvancedHubPage(props: {
  flags: TreasuryFeatureFlagsMap | null;
}) {
  const sections = filterTreasuryUiSections(
    TREASURY_UI_ADVANCED_SECTIONS,
    props.flags
  );

  return (
    <div className="space-y-4" data-testid="treasury-advanced-hub">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          Recursos avançados
        </h2>
        <p className="text-sm text-muted-foreground">
          Ferramentas técnicas preservadas. A rotina diária continua em Hoje,
          Contas, Conferir banco e Fluxo Gerencial.
        </p>
      </div>

      {sections.length === 0 ? (
        <p
          className="rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground"
          data-testid="treasury-advanced-hub-empty"
        >
          Nenhuma ferramenta avançada liberada pelas feature flags neste
          ambiente.
        </p>
      ) : (
        <ul
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="treasury-advanced-hub-list"
        >
          {sections.map((section) => (
            <li key={section.id}>
              <NavLink
                to={section.path}
                className={({ isActive }) =>
                  cn(
                    "flex h-full flex-col rounded-lg border border-border px-4 py-3 text-sm transition-colors",
                    isActive
                      ? "border-primary bg-primary/5 text-foreground"
                      : "bg-background text-foreground hover:bg-accent"
                  )
                }
              >
                <span className="font-semibold">{section.label}</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  {section.path}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
