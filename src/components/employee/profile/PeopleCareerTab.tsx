import React from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";

type CareerItem = {
  id: string;
  eventType: string;
  eventLabel: string;
  effectiveDate: string;
  summary: string;
};

export function PeopleCareerTab({
  items,
  loading,
  error,
}: {
  items: CareerItem[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando carreira…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!items || items.length === 0) {
    return (
      <ProfileState
        kind="empty"
        message="Não há linha do tempo de carreira além do estado atual. O baseline histórico só é criado por migração, sem inventar promoções."
      />
    );
  }
  return (
    <ProfileSection title="Evolução profissional">
      <ol className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="grid grid-cols-[7.5rem_1fr] gap-4 text-sm">
            <div className="text-muted-foreground">{formatProfileDate(item.effectiveDate)}</div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.eventLabel}</p>
              <p className="font-medium">{item.summary}</p>
            </div>
          </li>
        ))}
      </ol>
    </ProfileSection>
  );
}
