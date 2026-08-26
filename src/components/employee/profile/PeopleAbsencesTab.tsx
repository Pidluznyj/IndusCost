import React from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";

export function PeopleAbsencesTab({
  items,
  loading,
  error,
}: {
  items: Array<{
    id: string;
    type: string;
    startDate: string;
    endDate: string | null;
    status: string;
    reason: string | null;
  }> | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando férias e afastamentos…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!items || items.length === 0) {
    return <ProfileState kind="empty" message="Nenhum registro de férias ou afastamento." />;
  }
  return (
    <ProfileSection title="Férias e afastamentos">
      <ul className="space-y-3">
        {items.map((row) => (
          <li key={row.id} className="text-sm border-b border-border/70 pb-2">
            <p className="font-medium">
              {row.type} · {row.status}
            </p>
            <p className="text-muted-foreground">
              {formatProfileDate(row.startDate)}
              {row.endDate ? ` — ${formatProfileDate(row.endDate)}` : ""}
            </p>
            {row.reason ? <p>{row.reason}</p> : null}
          </li>
        ))}
      </ul>
    </ProfileSection>
  );
}
