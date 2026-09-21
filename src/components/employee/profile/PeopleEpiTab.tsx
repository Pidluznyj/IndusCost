import React from "react";
import {
  formatProfileDate,
  ProfileField,
  ProfileRecordActions,
  ProfileSection,
  ProfileState,
  useProfileRecordActions,
} from "./profileUi";
import { EpiManageForm, type EpiDeliveryRecord } from "./PeopleProfileManageForms";

export function PeopleEpiTab({
  data,
  loading,
  error,
  employeeId,
  canManage,
  onSaved,
  hideSizes,
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
  /** Oculta "Tamanhos atuais" (colunas do cadastro) — usado onde eles já são editados ao lado. */
  hideSizes?: boolean;
}) {
  const actions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando EPI…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const sizes = data?.sizes ?? {};
  const deliveries = (data?.deliveries ?? []) as unknown as EpiDeliveryRecord[];
  const manageable = Boolean(canManage && employeeId && onSaved);
  return (
    <div>
      {hideSizes ? null : (
        <ProfileSection title="Tamanhos atuais">
          <ProfileField label="Camiseta" value={sizes.shirtSize} />
          <ProfileField label="Calça" value={sizes.pantsSize} />
          <ProfileField label="Jaqueta" value={sizes.jacketSize} />
          <ProfileField label="Luva" value={sizes.gloveSize} />
          <ProfileField label="Calçado" value={sizes.shoeSize} />
          <ProfileField label="Observações" value={sizes.epiNotes} />
        </ProfileSection>
      )}
      <ProfileSection title="Entregas">
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega registrada.</p>
        ) : (
          <ul className="space-y-3">
            {deliveries.map((d) => {
              const deliveryId = String(d.id);
              if (manageable && employeeId && actions.editingId === deliveryId) {
                return (
                  <li key={deliveryId}>
                    <EpiManageForm
                      employeeId={employeeId}
                      record={d}
                      onSaved={actions.finishEdit}
                      onCancel={actions.cancelEdit}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={deliveryId}
                  className="flex items-start justify-between gap-3 text-sm border-b border-border/70 pb-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {String(d.item)} · qtd. {String(d.quantity ?? 1)}
                    </p>
                    <p className="text-muted-foreground">
                      {formatProfileDate(d.deliveredAt)}
                      {d.size ? ` · ${d.size}` : ""}
                      {d.responsibleName ? ` · entregue por ${d.responsibleName}` : ""}
                    </p>
                    {d.validUntil ? (
                      <p className="text-muted-foreground">Validade: {formatProfileDate(d.validUntil)}</p>
                    ) : null}
                    {d.returnedAt ? (
                      <p className="text-muted-foreground">Devolvido em: {formatProfileDate(d.returnedAt)}</p>
                    ) : null}
                    {d.notes ? (
                      <p className="text-muted-foreground whitespace-pre-wrap">{d.notes}</p>
                    ) : null}
                  </div>
                  {manageable && employeeId ? (
                    <ProfileRecordActions
                      itemLabel={`entrega de ${String(d.item)}`}
                      onEdit={() => actions.startEdit(deliveryId)}
                      onDelete={() =>
                        void actions.remove(
                          deliveryId,
                          `/api/employees/${employeeId}/epi-deliveries/${deliveryId}`,
                          `Excluir a entrega de "${String(d.item)}" de ${formatProfileDate(d.deliveredAt)}?`
                        )
                      }
                      deleting={actions.deletingId === deliveryId}
                      error={actions.errorFor(deliveryId)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </ProfileSection>
      {canManage && employeeId && onSaved ? (
        <EpiManageForm employeeId={employeeId} onSaved={onSaved} />
      ) : null}
    </div>
  );
}
