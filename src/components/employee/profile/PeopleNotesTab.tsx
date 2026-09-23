import React from "react";
import { HR_NOTE_CATEGORY_LABELS } from "@/src/lib/peopleProfileTypes";
import {
  formatProfileDate,
  ProfileField,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { NotesManageForm } from "./PeopleProfileManageForms";

function noteCategoryLabel(category: string): string {
  return (HR_NOTE_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

export function PeopleNotesTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  canRestricted,
  onSaved,
  hideLegacy,
}: {
  data: {
    legacy?: { professionalNotes?: string | null; adminNotes?: string | null; adminNotesRedacted?: boolean };
    notes?: Array<{ id: string; category: string; body: string; createdAt: string; createdByName?: string | null }>;
  } | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  canRestricted?: boolean;
  onSaved?: () => void;
  /** Oculta "Observações do cadastro" (colunas do cadastro) — usado onde elas já são editadas ao lado. */
  hideLegacy?: boolean;
}) {
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando observações…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const notes = data?.notes ?? [];
  const manageable = Boolean(canManage && employeeId && onSaved);
  return (
    <div>
      {hideLegacy ? null : (
        <ProfileSection title="Observações do cadastro">
          <ProfileField label="Profissional" value={data?.legacy?.professionalNotes ?? null} />
          <ProfileField
            label="Administrativa"
            restricted={data?.legacy?.adminNotesRedacted === true}
            value={data?.legacy?.adminNotes ?? null}
          />
        </ProfileSection>
      )}
      <ProfileSection title="Registros">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma observação adicional.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => {
              if (manageable && employeeId && actions.editingId === n.id) {
                return (
                  <li key={n.id}>
                    <NotesManageForm
                      employeeId={employeeId}
                      canRestricted={Boolean(canRestricted)}
                      record={n}
                      onSaved={actions.finishEdit}
                      onCancel={actions.cancelEdit}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={n.id}
                  className="flex items-start justify-between gap-3 text-sm border-b border-border/70 pb-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {noteCategoryLabel(n.category)} · {formatProfileDate(n.createdAt)}
                      {n.createdByName ? ` · ${n.createdByName}` : ""}
                    </p>
                    <p className="whitespace-pre-wrap">{n.body}</p>
                  </div>
                  {manageable && employeeId ? (
                    <ProfileRecordActions
                      itemLabel={`observação de ${formatProfileDate(n.createdAt)}`}
                      onEdit={() => actions.startEdit(n.id)}
                      onDelete={() =>
                        void actions.remove(
                          n.id,
                          `/api/employees/${employeeId}/notes/${n.id}`,
                          `Excluir a observação de ${formatProfileDate(n.createdAt)}?`
                        )
                      }
                      deleting={actions.deletingId === n.id}
                      error={actions.errorFor(n.id)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </ProfileSection>
      {canManage && employeeId && onSaved ? (
        <NotesManageForm
          employeeId={employeeId}
          canRestricted={Boolean(canRestricted)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
