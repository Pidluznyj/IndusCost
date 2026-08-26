import React from "react";
import { ProfileField, ProfileSection, ProfileState } from "./profileUi";

export function PeopleEmergencyTab({
  data,
  loading,
  error,
}: {
  data: { redacted?: boolean; contacts?: Array<Record<string, unknown>>; hasContacts?: boolean } | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando emergência…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (data?.redacted) {
    return <ProfileState kind="forbidden" message="🔒 Informação restrita" />;
  }
  const contacts = data?.contacts ?? [];
  if (contacts.length === 0) {
    return <ProfileState kind="empty" message="Nenhum contato de emergência informado." />;
  }
  return (
    <ProfileSection title="Contatos de emergência">
      {contacts.map((c) => (
        <div key={String(c.id)} className="mb-4">
          <ProfileField label="Nome" value={c.name as string} />
          <ProfileField label="Relação" value={c.relationship as string} />
          <ProfileField label="Telefone" value={c.phone as string} />
          <ProfileField label="Telefone alternativo" value={c.alternatePhone as string} />
          <ProfileField label="Prioridade" value={c.priority != null ? String(c.priority) : null} />
          <ProfileField label="Observação" value={c.notes as string} />
        </div>
      ))}
    </ProfileSection>
  );
}
