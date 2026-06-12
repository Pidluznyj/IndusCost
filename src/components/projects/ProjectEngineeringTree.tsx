import React from "react";
import { ProjectStructureSnapshotAccordion } from "@/src/components/projects/ProjectStructureSnapshotAccordion";
import type { ProjectStructureSnapshotGroup } from "@/src/lib/projectsStructureSnapshotGroups";
import type {
  ProjectDetail,
  ProjectStructureLineRow,
  ProjectStructureSourceType,
} from "@/src/types/projects";

type Props = {
  detail: ProjectDetail;
  canManage: boolean;
  onAddLine: (sourceType: ProjectStructureSourceType) => void;
  onAddToSimulatedProduct: (
    productId: string,
    sourceType: "EXISTING_MATERIAL" | "SIMULATED_ITEM" | "MANUAL",
    parentLineId?: string | null
  ) => void;
  onAddLabor: () => void;
  onEditLine: (line: ProjectStructureLineRow) => void;
  onDeleteLine: (line: ProjectStructureLineRow) => void;
  onOpenProductSimulation: (productId: string) => void;
  onReimportSnapshot: (productId: string) => void;
  onDeleteSnapshot: (group: ProjectStructureSnapshotGroup) => void;
};

export function ProjectEngineeringTree({
  detail,
  canManage,
  onAddLine,
  onAddToSimulatedProduct,
  onAddLabor,
  onEditLine,
  onDeleteLine,
  onOpenProductSimulation,
  onReimportSnapshot,
  onDeleteSnapshot,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold">Estrutura / Árvore</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Visualize a composição completa do projeto, misturando itens locais e itens oficiais.
        </p>
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Local do projeto, clones e referências oficiais são identificados por badges em cada nó.
          Alterações locais não afetam o cadastro mestre.
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 text-sm"
            onClick={() => onAddLine("EXISTING_MATERIAL")}
          >
            + Material oficial
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 text-sm"
            onClick={() => onAddLine("SIMULATED_ITEM")}
          >
            + Item local
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 text-sm"
            onClick={() => onAddLine("MANUAL")}
          >
            + Serviço / manual
          </button>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onAddLabor}>
            + Processo / HH
          </button>
        </div>
      ) : null}

      <ProjectStructureSnapshotAccordion
        structureLines={detail.structureLines}
        simulatedProducts={detail.simulatedProducts}
        canManage={canManage}
        onEditSimulation={onOpenProductSimulation}
        onReimport={onReimportSnapshot}
        onDeleteSnapshot={onDeleteSnapshot}
        onEditLine={onEditLine}
        onDeleteLine={onDeleteLine}
        onAddToSimulatedProduct={onAddToSimulatedProduct}
      />
    </div>
  );
}
