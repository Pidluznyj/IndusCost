import React from "react";
import {
  formatPercent,
  formatProfileDate,
  ProfileField,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { CompensationManageForm } from "./PeopleProfileManageForms";

type CompItem = {
  id: string;
  effectiveDate: string;
  type?: string | null;
  typeLabel?: string | null;
  percentage?: number | null;
  previousAmount?: number | null;
  newAmount?: number | null;
  differenceAmount?: number | null;
  reason?: string | null;
  notes?: string | null;
};

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function amountsLabel(item: CompItem): string {
  if (item.previousAmount != null && item.newAmount != null) {
    return `${formatBrl(item.previousAmount)} → ${formatBrl(item.newAmount)}`;
  }
  if (item.newAmount != null) return `Novo salário: ${formatBrl(item.newAmount)}`;
  return "Valores não informados";
}

export function PeopleCompensationTab({
  data,
  loading,
  error,
  canViewValues,
  employeeId,
  canManage,
  onSaved,
}: {
  data: { currentSalary?: number | null; items?: CompItem[] } | null;
  loading: boolean;
  error: string | null;
  canViewValues: boolean;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando remuneração…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const items = data?.items ?? [];
  const manageable = Boolean(canManage && employeeId && onSaved);
  return (
    <div>
      <ProfileSection title="Posição atual">
        <ProfileField label="Salário atual" restricted={!canViewValues} value={
          canViewValues && data?.currentSalary != null ? formatBrl(data.currentSalary) : null
        } />
      </ProfileSection>
      <ProfileSection title="Histórico de reajustes">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum reajuste registrado.</p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => {
              if (manageable && employeeId && actions.editingId === item.id) {
                return (
                  <li key={item.id}>
                    <CompensationManageForm
                      employeeId={employeeId}
                      canViewValues={canViewValues}
                      record={item}
                      onSaved={actions.finishEdit}
                      onCancel={actions.cancelEdit}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 text-sm border-b border-border/70 pb-3"
                >
                  <div className="min-w-0">
                    <p className="text-muted-foreground">{formatProfileDate(item.effectiveDate)}</p>
                    <p className="font-medium">
                      {item.typeLabel ?? "Reajuste"} · {formatPercent(item.percentage ?? null)}
                    </p>
                    {canViewValues ? (
                      <p className="text-muted-foreground mt-1">{amountsLabel(item)}</p>
                    ) : (
                      <p className="text-muted-foreground mt-1">🔒 Informação restrita</p>
                    )}
                    {item.reason ? <p className="mt-1">{item.reason}</p> : null}
                    {item.notes ? (
                      <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
                    ) : null}
                  </div>
                  {manageable && employeeId ? (
                    <ProfileRecordActions
                      itemLabel={`reajuste de ${formatProfileDate(item.effectiveDate)}`}
                      onEdit={() => actions.startEdit(item.id)}
                      onDelete={() =>
                        void actions.remove(
                          item.id,
                          `/api/employees/${employeeId}/compensation-adjustments/${item.id}`,
                          `Excluir o reajuste de ${formatProfileDate(item.effectiveDate)}? O registro sai do histórico; o salário atual do cadastro não é alterado.`
                        )
                      }
                      deleting={actions.deletingId === item.id}
                      error={actions.errorFor(item.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </ProfileSection>
      {canManage && canViewValues && employeeId && onSaved ? (
        <CompensationManageForm
          employeeId={employeeId}
          currentSalary={data?.currentSalary}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
