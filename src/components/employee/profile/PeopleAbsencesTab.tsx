import React from "react";
import { HR_ABSENCE_STATUS_LABELS, HR_ABSENCE_TYPE_LABELS } from "@/src/lib/peopleProfileTypes";
import {
  formatProfileDate,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { AbsencesManageForm, type AbsenceRecord } from "./PeopleProfileManageForms";
import { LeaveInsightCard } from "@/src/components/employee/lifecycle/EmployeeSituationSection";
import { formatDateBr } from "@/src/lib/employeeLifecycle";

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
  items: AbsenceRecord[] | null;
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
                    {row.reason ? (
                      <p>
                        {row.legal ? <span className="text-muted-foreground">Justificativa: </span> : null}
                        {row.reason}
                      </p>
                    ) : null}
                    {row.inssBenefitNumber ? <p className="text-muted-foreground">Benefício INSS: {row.inssBenefitNumber}</p> : null}
                    {row.catNumber ? <p className="text-muted-foreground">CAT: {row.catNumber}</p> : null}
                    {row.legal ? (
                      row.status !== "COMPLETED" && row.status !== "CANCELLED" && !row.actualReturn ? (
                        <div className="mt-2">
                          <LeaveInsightCard insight={row.legal} title="Afastamento em andamento" withRecord={false} />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {row.legal.legalBasis}
                          {row.legal.stabilityUntil ? ` · Estabilidade até ${formatDateBr(row.legal.stabilityUntil)}` : ""}
                        </p>
                      )
                    ) : null}
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
