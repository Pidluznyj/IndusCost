import React from "react";
import { formatProfileDate, ProfileField, ProfileSection, ProfileState } from "./profileUi";

export function PeoplePersonalTab({
  data,
  loading,
  error,
}: {
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando dados pessoais…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!data) return <ProfileState kind="empty" message="Não informado" />;
  if (data.redacted === true) {
    return <ProfileState kind="forbidden" message="🔒 Informação restrita" />;
  }
  return (
    <ProfileSection title="Dados pessoais">
      <ProfileField label="Nome" value={data.fullName as string} />
      <ProfileField label="Nome social" value={data.socialName as string} />
      <ProfileField label="CPF" value={data.cpf as string} />
      <ProfileField label="RG" value={data.rg as string} />
      <ProfileField label="Nascimento" value={formatProfileDate(data.birthDate as string)} />
      <ProfileField label="Estado civil" value={data.maritalStatus as string} />
      <ProfileField label="Telefone" value={data.phone as string} />
      <ProfileField label="E-mail pessoal" value={data.personalEmail as string} />
      <ProfileField label="Endereço" value={data.address as string} />
      <ProfileField label="Cidade" value={data.city as string} />
      <ProfileField label="UF" value={data.state as string} />
      <ProfileField label="CEP" value={data.zipCode as string} />
    </ProfileSection>
  );
}
