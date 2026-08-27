import React from "react";
import { IdCard, Mail, TrendingUp, User } from "lucide-react";
import type { PeopleProfileSummaryDto } from "@/src/lib/peopleProfileTypes";
import { ProfileStatusPill, formatPercent, formatProfileDate, initialsFromName } from "./profileUi";

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string | null;
  accent?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-border bg-overlay-surface-muted px-4 py-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <span className="text-[15px] font-semibold text-foreground">
        {value}
        {accent ? <span className="ml-1.5 align-middle">{accent}</span> : null}
      </span>
      {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

export function ProfileHeader({ summary }: { summary: PeopleProfileSummaryDto }) {
  const { identity, kpis } = summary;
  const adjustmentPercent =
    kpis.lastAdjustmentPercentage != null ? formatPercent(kpis.lastAdjustmentPercentage) : null;

  return (
    <header className="shrink-0 border-b border-border bg-background px-6 py-5 flex flex-col gap-5">
      <div className="flex items-start gap-5">
        <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-full border-2 border-primary/25 bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
          {identity.photoUrl ? (
            <img src={identity.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initialsFromName(identity.fullName)
          )}
        </div>
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[22px] font-bold tracking-tight text-foreground truncate">
              {identity.fullName}
            </h2>
            <ProfileStatusPill status={identity.status} label={identity.statusLabel} />
            {identity.contractType ? (
              <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {identity.contractType}
              </span>
            ) : null}
          </div>
          {identity.socialName ? (
            <p className="text-sm text-muted-foreground">Nome social: {identity.socialName}</p>
          ) : null}
          <p className="text-[15px] text-foreground truncate">
            {identity.roleName ?? "Cargo não informado"}
            {identity.department ? (
              <span className="text-muted-foreground"> · {identity.department}</span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
            {identity.managerName ? (
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" aria-hidden />
                Gestão: {identity.managerName}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <IdCard className="h-3.5 w-3.5" aria-hidden />
              Matrícula {identity.registrationId}
            </span>
            {identity.corporateEmail ? (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" aria-hidden />
                {identity.corporateEmail}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Admissão" value={formatProfileDate(kpis.admissionDate)} />
        <KpiTile label="Tempo de casa" value={kpis.tenureLabel ?? "Não informado"} />
        <KpiTile
          label="Última promoção"
          value={formatProfileDate(kpis.lastPromotionDate)}
          sub={kpis.timeSinceLastPromotionLabel ? `há ${kpis.timeSinceLastPromotionLabel}` : null}
        />
        <KpiTile
          label="Último reajuste"
          value={formatProfileDate(kpis.lastAdjustmentDate)}
          accent={
            adjustmentPercent && adjustmentPercent !== "Não informado" ? (
              <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-700">
                <TrendingUp className="h-3 w-3" aria-hidden />
                {adjustmentPercent}
              </span>
            ) : null
          }
          sub={kpis.timeSinceLastAdjustmentLabel ? `há ${kpis.timeSinceLastAdjustmentLabel}` : null}
        />
      </div>
    </header>
  );
}
