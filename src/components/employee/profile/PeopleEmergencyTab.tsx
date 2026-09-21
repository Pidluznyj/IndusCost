import React from "react";
import { PEOPLE_PRIMARY_EMERGENCY_CONTACT_ID } from "@/src/lib/peopleProfileTypes";
import {
  ProfileField,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { EmergencyManageForm, type EmergencyContactRecord } from "./PeopleProfileManageForms";

export function PeopleEmergencyTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
  hidePrimary,
}: {
  data: { redacted?: boolean; contacts?: Array<Record<string, unknown>>; hasContacts?: boolean } | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
  /** Oculta o contato principal (colunas do cadastro) — usado onde ele já é editado ao lado. */
  hidePrimary?: boolean;
}) {
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando emergência…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (data?.redacted) {
    return <ProfileState kind="forbidden" message="🔒 Informação restrita" />;
  }
  const manageable = Boolean(canManage && employeeId && onSaved);
  const contacts = ((data?.contacts ?? []) as unknown as EmergencyContactRecord[]).filter(
    (c) => !hidePrimary || String(c.id) !== PEOPLE_PRIMARY_EMERGENCY_CONTACT_ID
  );
  return (
    <div>
      {contacts.length === 0 ? (
        <ProfileState
          kind="empty"
          message={
            hidePrimary
              ? "Nenhum contato adicional cadastrado."
              : "Nenhum contato de emergência informado."
          }
        />
      ) : (
        <ProfileSection title={hidePrimary ? "Contatos adicionais" : "Contatos de emergência"}>
          {contacts.map((c) => {
            const contactId = String(c.id);
            // O contato principal vive nas colunas do colaborador: só o cadastro o altera.
            const isPrimary = contactId === PEOPLE_PRIMARY_EMERGENCY_CONTACT_ID;
            if (manageable && employeeId && !isPrimary && actions.editingId === contactId) {
              return (
                <div key={contactId} className="mb-4">
                  <EmergencyManageForm
                    employeeId={employeeId}
                    record={c}
                    onSaved={actions.finishEdit}
                    onCancel={actions.cancelEdit}
                  />
                </div>
              );
            }
            return (
              <div key={contactId} className="mb-4">
                <ProfileField label="Nome" value={c.name} />
                <ProfileField label="Relação" value={c.relationship} />
                <ProfileField label="Telefone" value={c.phone} />
                <ProfileField label="Telefone alternativo" value={c.alternatePhone} />
                <ProfileField label="Prioridade" value={c.priority != null ? String(c.priority) : null} />
                <ProfileField label="Observação" value={c.notes} />
                {manageable && employeeId && !isPrimary ? (
                  <ProfileRecordActions
                    className="mt-2"
                    itemLabel={`contato ${c.name}`}
                    onEdit={() => actions.startEdit(contactId)}
                    onDelete={() =>
                      void actions.remove(
                        contactId,
                        `/api/employees/${employeeId}/emergency-contacts/${contactId}`,
                        `Excluir o contato de emergência "${c.name}"?`
                      )
                    }
                    deleting={actions.deletingId === contactId}
                    error={actions.errorFor(contactId)}
                  />
                ) : null}
                {manageable && isPrimary ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Contato principal: editado no cadastro do colaborador (guia Emergência).
                  </p>
                ) : null}
              </div>
            );
          })}
        </ProfileSection>
      )}
      {canManage && employeeId && onSaved ? (
        <EmergencyManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
