import React from "react";
import { ProfileField, ProfileSection, ProfileState, formatProfileDate } from "./profileUi";
import type { EmployeeLifecycleDto } from "@/src/lib/employeeLifecycle";
import { LeaveInsightCard, TerminationInsightCard } from "@/src/components/employee/lifecycle/EmployeeSituationSection";

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
  const lifecycle = (data.lifecycle as EmployeeLifecycleDto | undefined) ?? null;
  const situationLabel = lifecycle?.situation.since
    ? `${data.statusLabel as string} desde ${formatProfileDate(lifecycle.situation.since)}`
    : (data.statusLabel as string);
  return (
    <>
    <ProfileSection title="Estado atual do vínculo">
      <ProfileField label="Matrícula" value={String(data.registrationId ?? data.employeeId ?? "")} />
      <ProfileField label="Cargo" value={data.roleName as string} />
      <ProfileField label="Departamento" value={data.department as string} />
      <ProfileField label="Centro de custo" value={data.costCenterLabel as string} />
      <ProfileField label="Gestor" value={data.managerName as string} />
      <ProfileField label="Contrato" value={data.contractType as string} />
      <ProfileField label="Jornada" value={data.workSchedule as string} />
      <ProfileField label="Admissão" value={formatProfileDate(data.admissionDate as string)} />
      <ProfileField label="Data de demissão" value={formatProfileDate(data.terminationDate as string)} />
      <ProfileField label="Situação" value={situationLabel} />
      <ProfileField label="E-mail corporativo" value={data.corporateEmail as string} />
      <ProfileField label="Classificação" value={data.classification as string} />
      <ProfileField label="Observações profissionais" value={data.professionalNotes as string} />
    </ProfileSection>
    {lifecycle?.situation.leave ? (
      <div className="mb-8">
        <LeaveInsightCard insight={lifecycle.situation.leave} title="Afastamento em andamento" />
      </div>
    ) : null}
    {lifecycle?.termination ? (
      <div className="mb-8">
        <TerminationInsightCard
          insight={lifecycle.termination}
          terminationDate={lifecycle.termination.terminationDate}
          details={lifecycle.termination.details}
        />
      </div>
    ) : null}
    </>
  );
}
