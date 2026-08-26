import React from "react";
import type { PeopleProfileSummaryDto } from "@/src/lib/peopleProfileTypes";
import { ProfileField, ProfileSection, formatPercent, formatProfileDate } from "./profileUi";

export function PeopleOverviewTab({ summary }: { summary: PeopleProfileSummaryDto }) {
  const o = summary.overview;
  return (
    <div>
      <ProfileSection title="Dados profissionais">
        <ProfileField label="Situação" value={o.situationLabel} />
        <ProfileField label="Cargo atual" value={o.roleName} />
        <ProfileField label="Departamento" value={o.department} />
        <ProfileField label="Centro de custo" value={o.costCenterLabel} />
        <ProfileField label="Gestor" value={o.managerName} />
        <ProfileField label="Tipo de vínculo" value={o.contractType} />
        <ProfileField label="Admissão" value={formatProfileDate(o.admissionDate)} />
        <ProfileField label="Tempo de empresa" value={o.tenureLabel} />
        <ProfileField label="Última promoção" value={formatProfileDate(o.lastPromotionDate)} />
        <ProfileField label="Tempo desde a promoção" value={o.timeSinceLastPromotionLabel} />
        <ProfileField label="Último reajuste" value={formatProfileDate(o.lastAdjustmentDate)} />
        <ProfileField
          label="Percentual do último reajuste"
          value={formatPercent(o.lastAdjustmentPercentage)}
        />
        <ProfileField label="Tempo desde o reajuste" value={o.timeSinceLastAdjustmentLabel} />
      </ProfileSection>
      <ProfileSection title="Últimas movimentações">
        {o.recentMovements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
        ) : (
          <ul className="space-y-2">
            {o.recentMovements.map((m) => (
              <li key={m.id} className="text-sm grid grid-cols-[7rem_1fr] gap-3">
                <span className="text-muted-foreground">{formatProfileDate(m.effectiveDate)}</span>
                <span>
                  <span className="font-medium">{m.eventLabel}</span>
                  {m.summary ? ` — ${m.summary}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>
    </div>
  );
}
