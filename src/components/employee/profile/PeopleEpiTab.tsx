import React from "react";
import { formatProfileDate, ProfileField, ProfileSection, ProfileState } from "./profileUi";
import { EpiManageForm } from "./PeopleProfileManageForms";

export function PeopleEpiTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
}: {
  data: {
    sizes?: Record<string, string | null>;
    deliveries?: Array<Record<string, unknown>>;
  } | null;
  loading: boolean;
  error: string | null;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando EPI…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const sizes = data?.sizes ?? {};
  const deliveries = data?.deliveries ?? [];
  return (
    <div>
      <ProfileSection title="Tamanhos atuais">
        <ProfileField label="Camiseta" value={sizes.shirtSize} />
        <ProfileField label="Calça" value={sizes.pantsSize} />
        <ProfileField label="Jaqueta" value={sizes.jacketSize} />
        <ProfileField label="Luva" value={sizes.gloveSize} />
        <ProfileField label="Calçado" value={sizes.shoeSize} />
        <ProfileField label="Observações" value={sizes.epiNotes} />
      </ProfileSection>
      <ProfileSection title="Entregas">
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega registrada.</p>
        ) : (
          <ul className="space-y-3">
            {deliveries.map((d) => (
              <li key={String(d.id)} className="text-sm border-b border-border/70 pb-2">
                <p className="font-medium">
                  {String(d.item)} · qtd. {String(d.quantity ?? 1)}
                </p>
                <p className="text-muted-foreground">
                  {formatProfileDate(d.deliveredAt as string)}
                  {d.size ? ` · ${d.size}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>
      {canManage && employeeId && onSaved ? (
        <EpiManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
