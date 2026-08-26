import React from "react";
import type { PeopleProfileSummaryDto } from "@/src/lib/peopleProfileTypes";
import { formatPercent, formatProfileDate, initialsFromName } from "./profileUi";
import { cn } from "@/src/lib/utils";

export function ProfileHeader({
  summary,
}: {
  summary: PeopleProfileSummaryDto;
}) {
  const { identity, kpis } = summary;
  const displayName = identity.socialName
    ? `${identity.fullName}`
    : identity.fullName;
  const meta = [identity.roleName, identity.department, identity.managerName]
    .filter(Boolean)
    .join(" • ");

  return (
    <header className="shrink-0 border-b border-border bg-background px-6 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Ficha funcional do colaborador
      </p>
      <div className="mt-3 flex items-start gap-4">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground flex items-center justify-center">
          {identity.photoUrl ? (
            <img src={identity.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initialsFromName(identity.fullName)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight text-foreground truncate">
                {displayName}
              </h2>
              {identity.socialName ? (
                <p className="text-sm text-muted-foreground">Nome social: {identity.socialName}</p>
              ) : null}
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{meta || "Não informado"}</p>
              <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                Matrícula: {identity.registrationId}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                identity.status === "ACTIVE"
                  ? "border-border text-foreground"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              {identity.statusLabel}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Admissão</dt>
              <dd>{formatProfileDate(kpis.admissionDate)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Tempo de casa</dt>
              <dd>{kpis.tenureLabel ?? "Não informado"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Última promoção</dt>
              <dd>{formatProfileDate(kpis.lastPromotionDate)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Último reajuste</dt>
              <dd>{formatProfileDate(kpis.lastAdjustmentDate)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Percentual</dt>
              <dd>{formatPercent(kpis.lastAdjustmentPercentage)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </header>
  );
}
