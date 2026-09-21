import React from "react";
import { Gift, Lock, Percent, PiggyBank, type LucideIcon } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { HR_EMPLOYEE_BENEFIT_STATUS_LABELS } from "@/src/lib/peopleProfileTypes";
import {
  ProfileCard,
  ProfileRecordActions,
  ProfileState,
  formatProfileDate,
  useProfileRecordActions,
} from "./profileUi";
import { BenefitsManageForm } from "./PeopleProfileManageForms";

type BenefitItem = {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string | null;
  planName: string | null;
  notes?: string | null;
  amount?: number | null;
  isFinancial?: boolean;
  typeLabel?: string;
};

function benefitIcon(typeLabel: string | undefined): LucideIcon {
  if (typeLabel === "Encargo") return Percent;
  if (typeLabel === "Provisão") return PiggyBank;
  return Gift;
}

/** O banco grava ACTIVE/ENDED; o teste por "ativ" cobre registros antigos em português. */
function isActiveStatus(status: string): boolean {
  if (String(status).toUpperCase() === "ACTIVE") return true;
  return /ativ/i.test(status) && !/inativ/i.test(status);
}

function benefitStatusLabel(status: string): string {
  return (HR_EMPLOYEE_BENEFIT_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

function BenefitCard({
  item,
  canViewValues,
  actions,
}: {
  item: BenefitItem;
  canViewValues: boolean;
  actions?: React.ReactNode;
}) {
  const active = isActiveStatus(item.status);
  const Icon = benefitIcon(item.typeLabel);
  const period = item.endDate
    ? `${formatProfileDate(item.startDate)} — ${formatProfileDate(item.endDate)}`
    : `vigente desde ${formatProfileDate(item.startDate)}`;
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl px-5 py-4",
        active
          ? "border border-border bg-background shadow-sm"
          : "border border-dashed border-border bg-overlay-surface-muted"
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]",
          active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              "text-sm font-semibold",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {item.name}
          </span>
          {item.typeLabel ? (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {item.typeLabel}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {item.planName ? `${item.planName} · ` : ""}
          {period}
        </span>
        {item.notes ? (
          <span className="text-xs text-muted-foreground whitespace-pre-wrap">{item.notes}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.isFinancial ? (
          canViewValues && item.amount != null ? (
            <span className="text-[15px] font-bold text-foreground">
              {item.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              <span className="text-[11px] font-medium text-muted-foreground">/mês</span>
            </span>
          ) : canViewValues ? (
            <span className="text-xs font-semibold text-muted-foreground">Valor não informado</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Valor restrito ao seu perfil
            </span>
          )
        ) : null}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] font-semibold",
            active ? "text-emerald-700" : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              active ? "bg-emerald-600" : "bg-muted-foreground"
            )}
          />
          {benefitStatusLabel(item.status)}
        </span>
        {actions}
      </div>
    </div>
  );
}

export function PeopleBenefitsTab({
  items,
  loading,
  error,
  canViewValues,
  employeeId,
  canManage,
  onSaved,
}: {
  items: BenefitItem[] | null;
  loading: boolean;
  error: string | null;
  canViewValues: boolean;
  employeeId?: string;
  canManage?: boolean;
  onSaved?: () => void;
}) {
  const recordActions = useProfileRecordActions(onSaved);
  if (loading) return <ProfileState kind="loading" message="Carregando benefícios…" />;
  if (error) return <ProfileState kind="error" message={error} />;
  const list = items ?? [];
  const activeCount = list.filter((item) => isActiveStatus(item.status)).length;
  const endedCount = list.length - activeCount;
  const manageable = Boolean(canManage && employeeId && onSaved);

  return (
    <div className="flex max-w-[880px] flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-bold text-foreground">Benefícios</h3>
        <p className="text-[13px] text-muted-foreground">
          {list.length === 0
            ? "Nenhum benefício registrado para este colaborador."
            : `${activeCount} ativo(s)${endedCount > 0 ? ` · ${endedCount} encerrado(s)` : ""}`}
        </p>
      </div>

      {list.length > 0 ? (
        <div className="flex flex-col gap-3">
          {list.map((item) => (
            <div key={item.id}>
              {manageable && employeeId && recordActions.editingId === item.id ? (
                <BenefitsManageForm
                  employeeId={employeeId}
                  canViewValues={canViewValues}
                  record={item}
                  onSaved={recordActions.finishEdit}
                  onCancel={recordActions.cancelEdit}
                />
              ) : (
                <BenefitCard
                  item={item}
                  canViewValues={canViewValues}
                  actions={
                    manageable && employeeId ? (
                      <ProfileRecordActions
                        itemLabel={`benefício ${item.name}`}
                        onEdit={() => recordActions.startEdit(item.id)}
                        onDelete={() =>
                          void recordActions.remove(
                            item.id,
                            `/api/employees/${employeeId}/benefits/${item.id}`,
                            `Excluir o benefício "${item.name}" deste colaborador? Para apenas encerrar, use Editar e informe a data de fim.`
                          )
                        }
                        deleting={recordActions.deletingId === item.id}
                        error={recordActions.errorFor(item.id)}
                      />
                    ) : null
                  }
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-[10px] border border-primary/15 bg-primary/5 px-4 py-3">
        <p className="text-xs leading-relaxed text-secondary-foreground">
          A lista de benefícios disponíveis e seus nomes vêm do cadastro oficial de verbas em
          Administração → Configurações → Estrutura Operacional. Alterações aqui não afetam custos
          industriais nem cálculos de produtos.
        </p>
      </div>

      {canManage && employeeId && onSaved ? (
        <ProfileCard>
          <BenefitsManageForm employeeId={employeeId} canViewValues={canViewValues} onSaved={onSaved} />
        </ProfileCard>
      ) : null}
    </div>
  );
}
