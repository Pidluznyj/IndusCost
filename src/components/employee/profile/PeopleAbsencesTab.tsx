import React from "react";
import { HR_ABSENCE_STATUS_LABELS, HR_ABSENCE_TYPE_LABELS } from "@/src/lib/peopleProfileTypes";
import {
  formatProfileDate,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { AbsencesManageForm } from "./PeopleProfileManageForms";

function absenceTypeLabel(type: string): string {
  return (HR_ABSENCE_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

function absenceStatusLabel(status: string): string {
  return (HR_ABSENCE_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

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
    notes?: string | null;
  }> | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando férias e afastamentos…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const manageable = Boolean(canManage && employeeId && onSaved);
  return (
    <div>
      {!items || items.length === 0 ? (
        <ProfileState kind="empty" message="Nenhum registro de férias ou afastamento." />
      ) : (
        <ProfileSection title="Férias e afastamentos">
          <ul className="space-y-3">
            {items.map((row) => {
              if (manageable && employeeId && actions.editingId === row.id) {
                return (
                  <li key={row.id}>
                    <AbsencesManageForm
                      employeeId={employeeId}
                      record={row}
                      onSaved={actions.finishEdit}
                      onCancel={actions.cancelEdit}
                    />
                  </li>
                );
              }
              const itemLabel = `${absenceTypeLabel(row.type)} de ${formatProfileDate(row.startDate)}`;
              return (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 text-sm border-b border-border/70 pb-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {absenceTypeLabel(row.type)} · {absenceStatusLabel(row.status)}
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
                    {row.notes ? (
                      <p className="text-muted-foreground whitespace-pre-wrap">{row.notes}</p>
                    ) : null}
                  </div>
                  {manageable && employeeId ? (
                    <ProfileRecordActions
                      itemLabel={itemLabel}
                      onEdit={() => actions.startEdit(row.id)}
                      onDelete={() =>
                        void actions.remove(
                          row.id,
                          `/api/employees/${employeeId}/absences/${row.id}`,
                          `Excluir o registro "${itemLabel}"?`
                        )
                      }
                      deleting={actions.deletingId === row.id}
                      error={actions.errorFor(row.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ProfileSection>
      )}
      {canManage && employeeId && onSaved ? (
        <AbsencesManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
