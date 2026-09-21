import React from "react";
import { PEOPLE_CAREER_EDITABLE_EVENT_TYPES } from "@/src/lib/peopleProfileTypes";
import {
  formatProfileDate,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { CareerManageForm } from "./PeopleProfileManageForms";

type CareerItem = {
  id: string;
  eventType: string;
  eventLabel: string;
  effectiveDate: string;
  summary: string;
  reason?: string | null;
  notes?: string | null;
  /** false = registro travado pelo servidor (estado inicial, reajuste etc.). */
  editable?: boolean;
};

function isEditableCareerItem(item: CareerItem): boolean {
  if (item.editable === false) return false;
  return (PEOPLE_CAREER_EDITABLE_EVENT_TYPES as readonly string[]).includes(item.eventType);
}

export function PeopleCareerTab({
  items,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
}: {
  items: CareerItem[] | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando carreira…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const manageable = Boolean(canManage && employeeId && onSaved);
  return (
    <div>
      {!items || items.length === 0 ? (
        <ProfileState
          kind="empty"
          message="Não há linha do tempo de carreira além do estado atual. O baseline histórico só é criado por migração, sem inventar promoções."
        />
      ) : (
        <ProfileSection title="Evolução profissional">
          <ol className="space-y-4">
            {items.map((item) => {
              const canEditItem = manageable && isEditableCareerItem(item);
              if (canEditItem && employeeId && actions.editingId === item.id) {
                return (
                  <li key={item.id}>
                    <CareerManageForm
                      employeeId={employeeId}
                      record={item}
                      onSaved={actions.finishEdit}
                      onCancel={actions.cancelEdit}
                    />
                  </li>
                );
              }
              const itemLabel = `${item.eventLabel} de ${formatProfileDate(item.effectiveDate)}`;
              return (
                <li key={item.id} className="grid grid-cols-[7.5rem_1fr_auto] gap-4 text-sm">
                  <div className="text-muted-foreground">{formatProfileDate(item.effectiveDate)}</div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.eventLabel}</p>
                    <p className="font-medium">{item.summary}</p>
                    {item.reason ? <p className="text-muted-foreground">{item.reason}</p> : null}
                    {item.notes ? (
                      <p className="text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
                    ) : null}
                  </div>
                  {canEditItem && employeeId ? (
                    <ProfileRecordActions
                      itemLabel={itemLabel}
                      onEdit={() => actions.startEdit(item.id)}
                      onDelete={() =>
                        void actions.remove(
                          item.id,
                          `/api/employees/${employeeId}/career-events/${item.id}`,
                          `Excluir o registro "${itemLabel}" da linha do tempo? O cadastro atual do colaborador não é alterado.`
                        )
                      }
                      deleting={actions.deletingId === item.id}
                      error={actions.errorFor(item.id)}
                    />
                  ) : (
                    <span aria-hidden />
                  )}
                </li>
              );
            })}
          </ol>
        </ProfileSection>
      )}
      {canManage && employeeId && onSaved ? (
        <CareerManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
