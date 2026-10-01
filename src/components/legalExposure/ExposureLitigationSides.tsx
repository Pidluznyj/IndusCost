/**
 * Composição visual Autor vs Réus. Só parties confirmadas.
 */

import React from "react";
import {
  CASE_CLAIMANT_MISSING_COPY,
  CASE_POLE_UNCONFIRMED_COPY,
  GROUP_ENTITY_BADGE_COPY,
  PARTY_ROLE_CONFLICT_COPY,
  type ExposureCaseListItem,
} from "@/src/lib/legalExposure/legalExposureContracts";
import { confirmedClaimants, confirmedGroupDefendants } from "@/src/lib/legalExposure/legalExposureCoverage";
import { casePoleLabel } from "@/src/lib/legalExposure/legalExposureCaseListUi";

export function ExposureLitigationSides(props: {
  item: Pick<ExposureCaseListItem, "claimants" | "groupEntities" | "otherDefendants" | "coverage">;
  compact?: boolean;
  onCompleteData?: () => void;
}) {
  const conflict = props.item.coverage?.opposition.conflict ?? false;
  const claimants = confirmedClaimants(props.item.claimants);
  const groupDefendants = confirmedGroupDefendants(props.item.groupEntities);
  const otherDefendants = props.item.otherDefendants;
  const nameClass = props.compact ? "text-base font-semibold tracking-tight" : "text-xl font-semibold tracking-tight";

  return (
    <div className={`grid gap-4 ${props.compact ? "md:grid-cols-[1fr_auto_1fr]" : "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"} items-start`}>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Autor / reclamante</p>
        {conflict ? (
          <p className={`mt-2 ${nameClass} text-amber-900`}>{PARTY_ROLE_CONFLICT_COPY}</p>
        ) : claimants.length > 0 ? (
          claimants.map((row) => (
            <p key={row.name} className={`mt-2 ${nameClass}`}>
              {row.name}
            </p>
          ))
        ) : (
          <div className="mt-2">
            <p className={`${nameClass} text-muted-foreground`}>{CASE_CLAIMANT_MISSING_COPY}</p>
            {props.onCompleteData ? (
              <button type="button" className="mt-1 text-sm font-semibold underline" onClick={props.onCompleteData}>
                Completar dados
              </button>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Completar dados</p>
            )}
          </div>
        )}
      </div>
      <p className="self-center text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">VS</p>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Réus / empresas do grupo</p>
        {groupDefendants.length === 0 && otherDefendants.length === 0 ? (
          <p className={`mt-2 ${nameClass} text-muted-foreground`}>Réu ainda não identificado</p>
        ) : null}
        {groupDefendants.map((row) => (
          <div key={row.id} className="mt-2">
            <p className={nameClass}>{row.legalName}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {GROUP_ENTITY_BADGE_COPY} · {row.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(row.pole)}
              {row.displayCnpj ? ` · ${row.displayCnpj}` : ""}
            </p>
          </div>
        ))}
        {otherDefendants.map((row) => (
          <p key={row.name} className="mt-1 text-sm">
            {row.name}
          </p>
        ))}
      </div>
    </div>
  );
}
