import React, { useMemo } from "react";
import { Plus } from "lucide-react";
import { buildProjectStructureSnapshotGroups } from "@/src/lib/projectsStructureSnapshotGroups";
import { resolveStructureLineBadges } from "@/src/lib/projectsStructureLineBadges";
import { cn } from "@/src/lib/utils";
import type { ProjectDetail, ProjectMoldRow } from "@/src/types/projects";

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function GroupSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const isEmpty = React.Children.count(children) === 0;
  return (
    <div className="space-y-2">
      <h5 className="font-medium">{title}</h5>
      <div className="overflow-hidden rounded-xl border border-border">
        {isEmpty ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Código / nome</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Custo</th>
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type Props = {
  detail: ProjectDetail;
  canManage: boolean;
  onAddMold?: () => void;
};

export function ProjectMaterialsAndComponents({ detail, canManage, onAddMold }: Props) {
  const { snapshotGroups } = useMemo(
    () =>
      buildProjectStructureSnapshotGroups(detail.structureLines, {
        simulatedProducts: detail.simulatedProducts,
      }),
    [detail.structureLines, detail.simulatedProducts]
  );

  const officialMaterials = detail.structureLines.filter(
    (l) => l.sourceType === "EXISTING_MATERIAL" && !l.snapshotRootProductId
  );
  const officialComponents = detail.structureLines.filter(
    (l) =>
      l.sourceType === "EXISTING_PRODUCT" &&
      !l.snapshotRootProductId &&
      !l.notes?.includes("snapshot:")
  );
  const clonedItems = snapshotGroups;
  const localItems = detail.simulatedItems;
  const pendingItems = detail.simulatedItems.filter(
    (i) => i.canBecomeOfficial && (i.requiresQuotation || i.requiresEngineeringReview)
  );

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold">Materiais e Componentes</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Controle os insumos e componentes usados na engenharia deste projeto.
        </p>
      </div>

      <GroupSection title="Materiais oficiais reutilizados" empty="Nenhum material oficial referenciado.">
        {officialMaterials.map((l) => (
          <tr key={l.id} className="border-b border-border/60">
            <td className="px-3 py-2">{l.descriptionSnapshot}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap gap-1">
                {resolveStructureLineBadges(l).map((b) => (
                  <span key={b.key} className={cn("rounded px-2 py-0.5 text-xs", b.className)}>
                    {b.label}
                  </span>
                ))}
              </div>
            </td>
            <td className="px-3 py-2">{formatMoney(l.totalCost)}</td>
          </tr>
        ))}
      </GroupSection>

      <GroupSection
        title="Componentes oficiais reutilizados"
        empty="Nenhum componente oficial referenciado."
      >
        {officialComponents.map((l) => (
          <tr key={l.id} className="border-b border-border/60">
            <td className="px-3 py-2">{l.descriptionSnapshot}</td>
            <td className="px-3 py-2">{l.lineType}</td>
            <td className="px-3 py-2">{formatMoney(l.totalCost)}</td>
          </tr>
        ))}
      </GroupSection>

      <GroupSection title="Itens locais criados no projeto" empty="Nenhum item local cadastrado.">
        {localItems.map((i) => (
          <tr key={i.id} className="border-b border-border/60">
            <td className="px-3 py-2">
              {i.provisionalCode ? `${i.provisionalCode} — ` : ""}
              {i.description}
            </td>
            <td className="px-3 py-2">{i.itemType}</td>
            <td className="px-3 py-2">
              {formatMoney(i.quotedUnitCost ?? i.estimatedUnitCost)}
            </td>
          </tr>
        ))}
      </GroupSection>

      <GroupSection title="Itens clonados de oficiais" empty="Nenhum clone de item oficial.">
        {clonedItems.map((g) => (
          <tr key={g.groupKey} className="border-b border-border/60">
            <td className="px-3 py-2">
              {g.rootCode} — {g.rootDescription}
            </td>
            <td className="px-3 py-2">Clone local</td>
            <td className="px-3 py-2">{formatMoney(g.simulatedCost)}</td>
          </tr>
        ))}
      </GroupSection>

      <GroupSection title="Itens pendentes de cadastro" empty="Nenhum item pendente de cadastro futuro.">
        {pendingItems.map((i) => (
          <tr key={i.id} className="border-b border-border/60">
            <td className="px-3 py-2">{i.description}</td>
            <td className="px-3 py-2">
              {i.requiresQuotation ? "Cotação" : ""}
              {i.requiresEngineeringReview ? " Revisão eng." : ""}
            </td>
            <td className="px-3 py-2">{formatMoney(i.quotedUnitCost ?? i.estimatedUnitCost)}</td>
          </tr>
        ))}
      </GroupSection>

      {detail.molds.length > 0 || canManage ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="font-medium">Molde / Ferramental</h5>
            {canManage && onAddMold ? (
              <button
                type="button"
                onClick={onAddMold}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm"
              >
                <Plus className="h-4 w-4" />
                Adicionar molde
              </button>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Custo construção</th>
                  <th className="px-3 py-2">Custo/un. amortizado</th>
                </tr>
              </thead>
              <tbody>
                {detail.molds.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      Nenhum molde cadastrado.
                    </td>
                  </tr>
                ) : (
                  detail.molds.map((m: ProjectMoldRow) => (
                    <tr key={m.id} className="border-b border-border/60">
                      <td className="px-3 py-2">{m.name}</td>
                      <td className="px-3 py-2">{formatMoney(m.constructionCost)}</td>
                      <td className="px-3 py-2">{formatMoney(m.amortizedCostPerUnit)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
