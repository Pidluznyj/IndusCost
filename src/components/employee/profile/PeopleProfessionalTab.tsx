import React from "react";
import { ProfileField, ProfileSection, ProfileState, formatProfileDate } from "./profileUi";

export function PeopleProfessionalTab({
  data,
  loading,
  error,
}: {
  data: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando dados profissionais…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  if (!data) return <ProfileState kind="empty" message="Não informado" />;
  return (
    <ProfileSection title="Estado atual do vínculo">
      <ProfileField label="Matrícula" value={String(data.registrationId ?? data.employeeId ?? "")} />
      <ProfileField label="Cargo" value={data.roleName as string} />
      <ProfileField label="Departamento" value={data.department as string} />
      <ProfileField label="Centro de custo" value={data.costCenterLabel as string} />
      <ProfileField label="Gestor" value={data.managerName as string} />
      <ProfileField label="Contrato" value={data.contractType as string} />
      <ProfileField label="Jornada" value={data.workSchedule as string} />
      <ProfileField label="Admissão" value={formatProfileDate(data.admissionDate as string)} />
      <ProfileField label="Desligamento" value={formatProfileDate(data.terminationDate as string)} />
      <ProfileField label="Status" value={data.statusLabel as string} />
      <ProfileField label="E-mail corporativo" value={data.corporateEmail as string} />
      <ProfileField label="Classificação" value={data.classification as string} />
      <ProfileField label="Observações profissionais" value={data.professionalNotes as string} />
    </ProfileSection>
  );
}
