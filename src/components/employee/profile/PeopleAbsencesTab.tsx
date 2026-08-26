import React from "react";
import { formatProfileDate, ProfileSection, ProfileState } from "./profileUi";
import { AbsencesManageForm } from "./PeopleProfileManageForms";

export function PeopleAbsencesTab({
  items,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
}: {
  items: Array<{
    id: string;
    type: string;
    startDate: string;
    endDate: string | null;
    expectedReturn?: string | null;
    actualReturn?: string | null;
    status: string;
    reason: string | null;
  }> | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando férias e afastamentos…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  return (
    <div>
      {!items || items.length === 0 ? (
        <ProfileState kind="empty" message="Nenhum registro de férias ou afastamento." />
      ) : (
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
                {row.expectedReturn ? (
                  <p className="text-muted-foreground">Retorno previsto: {formatProfileDate(row.expectedReturn)}</p>
                ) : null}
                {row.actualReturn ? (
                  <p className="text-muted-foreground">Retorno real: {formatProfileDate(row.actualReturn)}</p>
                ) : null}
                {row.reason ? <p>{row.reason}</p> : null}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}
      {canManage && employeeId && onSaved ? (
        <AbsencesManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
