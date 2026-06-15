import React from "react";
import { Link } from "react-router-dom";
import { Box, Coins, Package, Plus, Wrench, FlaskConical } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  buildProjectGuidedItems,
  computeProjectGuidedCosts,
  PROJECT_GUIDED_HOME_INTRO,
  PROJECT_GUIDED_HOME_SUBTITLE,
  PROJECT_GUIDED_HOME_TITLE,
  PROJECT_GUIDED_MASTER_NOTICE,
  type ProjectGuidedItemRow,
} from "@/src/lib/projectsGuidedFlow";
import { formatProjectGuidedItemCost } from "@/src/lib/projectsUiUtils";
import {
  buildSimulationsNewProductPath,
  PROJECTS_TO_SIMULATIONS_HINT,
} from "@/src/lib/simulationsNavigation";
import type { ProjectDetail } from "@/src/types/projects";

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type ActionCardProps = {
  icon: typeof Package;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
  disabled?: boolean;
};

function ActionCard({ icon: Icon, title, description, buttonLabel, onClick, disabled }: ActionCardProps) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h5 className="font-semibold">{title}</h5>
      <p className="mt-2 flex-1 text-sm text-muted-foreground">{description}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
      >
        <Plus className="h-4 w-4" />
        {buttonLabel}
      </button>
    </div>
  );
}

type Props = {
  detail: ProjectDetail;
  canManage: boolean;
  onAddItem: () => void;
  onCreateMold: () => void;
  onCreateOtherCost: () => void;
  onOpenItem?: (item: ProjectGuidedItemRow) => void;
  onDeleteItem?: (item: ProjectGuidedItemRow) => void;
};

export function ProjectHomeAssistant({
  detail,
  canManage,
  onAddItem,
  onCreateMold,
  onCreateOtherCost,
  onOpenItem,
  onDeleteItem,
}: Props) {
  const items = buildProjectGuidedItems(detail);
  const costs = computeProjectGuidedCosts(detail);

  return (
    <div className="space-y-8">
      <div>
        <h4 className="text-xl font-semibold">{PROJECT_GUIDED_HOME_TITLE}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{PROJECT_GUIDED_HOME_SUBTITLE}</p>
        <p className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
          {PROJECT_GUIDED_HOME_INTRO}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{PROJECT_GUIDED_MASTER_NOTICE}</p>
      </div>

      <div>
        <h5 className="mb-3 text-sm font-medium text-muted-foreground">
          O que você deseja adicionar ao projeto?
        </h5>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            icon={Package}
            title="Itens existentes"
            description="Produto oficial, componente oficial ou produto simulado salvo em Simulações."
            buttonLabel="Adicionar item"
            onClick={onAddItem}
            disabled={!canManage}
          />
          <ActionCard
            icon={Wrench}
            title="Molde"
            description="Materiais, serviços e custos de construção ou alteração de molde."
            buttonLabel="Criar molde"
            onClick={onCreateMold}
            disabled={!canManage}
          />
          <ActionCard
            icon={Coins}
            title="Outros custos"
            description="Testes, desenvolvimento, dispositivos, frete ou serviços extras do projeto."
            buttonLabel="Adicionar custo"
            onClick={onCreateOtherCost}
            disabled={!canManage}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Produtos oficiais: cadastro de engenharia. Simulações: menu Simulações → Simular novo produto.
        </p>
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{PROJECTS_TO_SIMULATIONS_HINT}</p>
          <Link
            to={buildSimulationsNewProductPath()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/30 bg-background px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
            data-testid="projects-go-to-simulations"
          >
            <FlaskConical className="h-4 w-4" />
            Simular novo produto
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatMini label="Itens do projeto" value={String(costs.itemCount)} />
        <StatMini label="Produtos / simulações" value={String(costs.productCount)} />
        <StatMini label="Moldes" value={String(costs.moldCount)} />
        <StatMini label="Outros custos" value={String(costs.otherCostCount)} />
        <StatMini label="Itens pendentes" value={String(costs.pendingCount)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatMini label="Custo unitário estimado" value={formatMoney(costs.estimatedUnitCost)} />
        <StatMini label="Investimento inicial" value={formatMoney(costs.initialInvestment)} />
        <StatMini label="Outros custos do projeto" value={formatMoney(costs.otherProjectCosts)} />
        <StatMini label="Custo total do projeto" value={formatMoney(costs.totalProjectCost)} highlight />
      </div>

      <div className="space-y-3">
        <h5 className="font-medium">Itens já adicionados ao projeto</h5>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
            <Box className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Nenhum item adicionado ao projeto ainda.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione produtos oficiais, simulações existentes, moldes ou outros custos.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Custo estimado</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.entityKind}-${item.id}`} className="border-b border-border/60">
                    <td className="px-3 py-2">{item.itemTypeLabel}</td>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2">
                      {formatProjectGuidedItemCost(item.estimatedCost, item.status)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {onOpenItem ? (
                          <button
                            type="button"
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                            onClick={() => onOpenItem(item)}
                          >
                            Abrir
                          </button>
                        ) : null}
                        {canManage && onDeleteItem ? (
                          <button
                            type="button"
                            className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => onDeleteItem(item)}
                          >
                            Remover
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && items.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">O que deseja adicionar agora?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <QuickBtn label="Adicionar item" onClick={onAddItem} />
            <QuickBtn label="Criar molde" onClick={onCreateMold} />
            <QuickBtn label="Adicionar outros custos" onClick={onCreateOtherCost} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatMini({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", highlight && "border-primary/40")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", highlight && "text-primary")}>{value}</p>
    </div>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/50"
    >
      {label}
    </button>
  );
}
