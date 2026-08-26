import React from "react";
import { formatPercent, formatProfileDate, ProfileField, ProfileSection, ProfileState } from "./profileUi";

type CompItem = {
  id: string;
  effectiveDate: string;
  typeLabel?: string | null;
  percentage?: number | null;
  previousAmount?: number | null;
  newAmount?: number | null;
  differenceAmount?: number | null;
  reason?: string | null;
};

export function PeopleCompensationTab({
  data,
  loading,
  error,
  canViewValues,
}: {
  data: { currentSalary?: number | null; items?: CompItem[] } | null;
  loading: boolean;
  error: string | null;
  canViewValues: boolean;
}) {
  if (loading) return <ProfileState kind="loading" message="Carregando remuneração…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const items = data?.items ?? [];
  return (
    <div>
      <ProfileSection title="Posição atual">
        <ProfileField label="Salário atual" restricted={!canViewValues} value={
          canViewValues && data?.currentSalary != null
            ? data.currentSalary.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
            : null
        } />
      </ProfileSection>
      <ProfileSection title="Histórico de reajustes">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum reajuste registrado.</p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.id} className="text-sm border-b border-border/70 pb-3">
                <p className="text-muted-foreground">{formatProfileDate(item.effectiveDate)}</p>
                <p className="font-medium">
                  {item.typeLabel ?? "Reajuste"} · {formatPercent(item.percentage ?? null)}
                </p>
                {canViewValues ? (
                  <p className="text-muted-foreground mt-1">
                    {item.previousAmount != null && item.newAmount != null
                      ? `${item.previousAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} → ${item.newAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
                      : "Valores não informados"}
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-1">🔒 Informação restrita</p>
                )}
                {item.reason ? <p className="mt-1">{item.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>
    </div>
  );
}
