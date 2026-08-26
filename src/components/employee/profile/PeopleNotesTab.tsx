import React from "react";
import { formatProfileDate, ProfileField, ProfileSection, ProfileState } from "./profileUi";
import { NotesManageForm } from "./PeopleProfileManageForms";

export function PeopleNotesTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  canRestricted,
  onSaved,
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
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando observações…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const notes = data?.notes ?? [];
  return (
    <div>
      <ProfileSection title="Observações do cadastro">
        <ProfileField label="Profissional" value={data?.legacy?.professionalNotes ?? null} />
        <ProfileField
          label="Administrativa"
          restricted={data?.legacy?.adminNotesRedacted === true}
          value={data?.legacy?.adminNotes ?? null}
        />
      </ProfileSection>
      <ProfileSection title="Registros">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma observação adicional.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="text-sm border-b border-border/70 pb-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {n.category} · {formatProfileDate(n.createdAt)}
                  {n.createdByName ? ` · ${n.createdByName}` : ""}
                </p>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
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
