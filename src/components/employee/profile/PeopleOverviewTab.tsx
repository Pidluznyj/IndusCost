import React from "react";
import { ChevronRight, Mail } from "lucide-react";
import type { PeopleProfileSummaryDto } from "@/src/lib/peopleProfileTypes";
import { cn } from "@/src/lib/utils";
import {
  ProfileCard,
  ProfileGridField,
  formatPercent,
  formatProfileDate,
  initialsFromName,
} from "./profileUi";

function movementDotClass(eventType: string): string {
  if (eventType === "COMPENSATION_ADJUSTMENT") return "bg-emerald-600 border-emerald-200";
  if (eventType === "PROMOTION" || eventType === "ROLE_CHANGE") return "bg-primary border-primary/25";
  return "bg-muted-foreground border-muted";
}

export function PeopleOverviewTab({
  summary,
  onOpenHistory,
}: {
  summary: PeopleProfileSummaryDto;
  onOpenHistory?: () => void;
}) {
  const o = summary.overview;
  const { identity } = summary;
  const adjustmentPercent = formatPercent(o.lastAdjustmentPercentage);

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-5">
        <ProfileCard title="Dados profissionais">
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <ProfileGridField label="Situação" value={o.situationLabel} />
            <ProfileGridField label="Cargo atual" value={o.roleName} />
            <ProfileGridField label="Departamento" value={o.department} />
            <ProfileGridField label="Centro de custo" value={o.costCenterLabel} />
            <ProfileGridField label="Tipo de vínculo" value={o.contractType} />
            <ProfileGridField label="Jornada" value={identity.workSchedule} />
            <ProfileGridField label="Admissão" value={formatProfileDate(o.admissionDate)} />
            <ProfileGridField label="Tempo de empresa" value={o.tenureLabel} />
            <ProfileGridField
              label="Última promoção"
              value={formatProfileDate(o.lastPromotionDate)}
              sub={o.timeSinceLastPromotionLabel ? `há ${o.timeSinceLastPromotionLabel}` : null}
            />
            <ProfileGridField
              label="Último reajuste"
              value={
                o.lastAdjustmentDate
                  ? `${formatProfileDate(o.lastAdjustmentDate)}${
                      adjustmentPercent !== "Não informado" ? ` (${adjustmentPercent})` : ""
                    }`
                  : null
              }
              sub={o.timeSinceLastAdjustmentLabel ? `há ${o.timeSinceLastAdjustmentLabel}` : null}
            />
          </div>
        </ProfileCard>

        <ProfileCard
          title="Movimentações recentes"
          action={
            onOpenHistory ? (
              <button
                type="button"
                onClick={onOpenHistory}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                Ver histórico completo
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : undefined
          }
        >
          {o.recentMovements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
          ) : (
            <div className="flex flex-col">
              {o.recentMovements.map((m, idx) => {
                const last = idx === o.recentMovements.length - 1;
                return (
                  <div key={m.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3.5">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "mt-1 h-2.5 w-2.5 rounded-full border-2",
                          movementDotClass(m.eventType)
                        )}
                      />
                      {!last ? <span className="w-0.5 flex-1 bg-border" /> : null}
                    </div>
                    <div className={cn(!last && "pb-4")}>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span className="text-sm font-semibold text-foreground">{m.eventLabel}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatProfileDate(m.effectiveDate)}
                        </span>
                      </div>
                      {m.summary ? (
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{m.summary}</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ProfileCard>
      </div>

      <div className="flex flex-col gap-5">
        <ProfileCard title="Organização">
          {identity.managerName ? (
            <div className="flex items-center gap-3 rounded-[10px] bg-overlay-surface-muted p-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-bold text-muted-foreground">
                {initialsFromName(identity.managerName)}
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="truncate text-[13px] font-semibold text-foreground">
                  {identity.managerName}
                </span>
                <span className="text-xs text-muted-foreground">Gestão direta</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Gestor não informado.</p>
          )}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Setor</span>
              <span className="text-[13px] font-semibold text-foreground text-right">
                {identity.department ?? "Não informado"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Centro de custo</span>
              <span className="truncate text-[13px] font-semibold text-foreground text-right">
                {identity.costCenterLabel ?? "Não informado"}
              </span>
            </div>
          </div>
        </ProfileCard>

        <ProfileCard title="Contato">
          <div className="flex items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-[13px] text-foreground">
              {identity.corporateEmail ?? "E-mail corporativo não informado"}
            </span>
          </div>
        </ProfileCard>
      </div>
    </div>
  );
}
