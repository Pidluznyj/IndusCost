import React from "react";
import { cn } from "@/src/lib/utils";
import type { ProjectDetail, ProjectStatus } from "@/src/types/projects";

type TimelineStage = {
  id: string;
  label: string;
  responsibleKey: "technicalOwner" | "commercialOwner" | null;
  statusKeys: ProjectStatus[];
};

const DEFAULT_STAGES: TimelineStage[] = [
  {
    id: "technical",
    label: "Levantamento técnico",
    responsibleKey: "technicalOwner",
    statusKeys: ["DRAFT", "TECHNICAL_ANALYSIS"],
  },
  {
    id: "component",
    label: "Desenvolvimento de componente",
    responsibleKey: "technicalOwner",
    statusKeys: ["TECHNICAL_ANALYSIS"],
  },
  {
    id: "cost",
    label: "Simulação de custo",
    responsibleKey: "technicalOwner",
    statusKeys: ["TECHNICAL_ANALYSIS", "WAITING_QUOTATION"],
  },
  {
    id: "internal",
    label: "Validação interna",
    responsibleKey: "technicalOwner",
    statusKeys: ["WAITING_INTERNAL_APPROVAL"],
  },
  {
    id: "quotation",
    label: "Cotação",
    responsibleKey: "commercialOwner",
    statusKeys: ["WAITING_QUOTATION"],
  },
  {
    id: "customer",
    label: "Aprovação do cliente",
    responsibleKey: "commercialOwner",
    statusKeys: ["SENT_TO_CUSTOMER", "NEGOTIATION", "APPROVED"],
  },
  {
    id: "promotion",
    label: "Liberação para cadastro mestre",
    responsibleKey: "technicalOwner",
    statusKeys: ["APPROVED", "CONVERTED"],
  },
];

function stageState(
  stage: TimelineStage,
  projectStatus: ProjectStatus
): "done" | "current" | "pending" {
  const order = [
    "DRAFT",
    "TECHNICAL_ANALYSIS",
    "WAITING_QUOTATION",
    "WAITING_INTERNAL_APPROVAL",
    "SENT_TO_CUSTOMER",
    "NEGOTIATION",
    "APPROVED",
    "CONVERTED",
  ];
  const projectIdx = order.indexOf(projectStatus);
  const stageIdx = Math.max(...stage.statusKeys.map((s) => order.indexOf(s)));
  if (projectIdx >= stageIdx && stage.statusKeys.includes(projectStatus)) return "current";
  if (projectIdx > stageIdx) return "done";
  if (stage.statusKeys.some((s) => order.indexOf(s) <= projectIdx)) return "done";
  return "pending";
}

type Props = {
  detail: ProjectDetail;
};

export function ProjectTimeline({ detail }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold">Cronograma / Etapas</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhamento simplificado das etapas do projeto.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Responsável</th>
              <th className="px-4 py-3">Prazo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Observações</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_STAGES.map((stage) => {
              const state = stageState(stage, detail.status);
              const responsible =
                stage.responsibleKey === "technicalOwner"
                  ? detail.technicalOwner
                  : stage.responsibleKey === "commercialOwner"
                    ? detail.commercialOwner
                    : null;
              return (
                <tr key={stage.id} className="border-b border-border/60">
                  <td className="px-4 py-3 font-medium">{stage.label}</td>
                  <td className="px-4 py-3">{responsible ?? "—"}</td>
                  <td className="px-4 py-3">—</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-xs",
                        state === "done"
                          ? "bg-emerald-100 text-emerald-900"
                          : state === "current"
                            ? "bg-blue-100 text-blue-900"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {state === "done" ? "Concluída" : state === "current" ? "Em andamento" : "Pendente"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {stage.id === "promotion"
                      ? "Promoção para cadastro mestre disponível futuramente."
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
