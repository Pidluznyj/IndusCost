import React from "react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { formatProjectsNumberInput, parseProjectsNumberInput } from "@/src/lib/projectsUiUtils";
import type { ProjectStructureLineRow } from "@/src/types/projects";
import { PROJECT_SIMULATION_MODE } from "@/src/lib/projectSimulationMode";

type EditableLine = Pick<
  ProjectStructureLineRow,
  "id" | "descriptionSnapshot" | "quantity" | "lossPercent" | "unitCostSnapshot" | "unitSnapshot"
>;

type Props = {
  mode?: typeof PROJECT_SIMULATION_MODE;
  lines: EditableLine[];
  readOnly?: boolean;
  onLineChange: (lineId: string, patch: Partial<EditableLine>) => void;
};

export function ProjectBomSimulationTable({
  mode = PROJECT_SIMULATION_MODE,
  lines,
  readOnly,
  onLineChange,
}: Props) {
  if (mode !== PROJECT_SIMULATION_MODE) return null;

  if (readOnly) {
    return (
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qtd</th>
              <th className="px-3 py-2 text-right">Custo base</th>
              <th className="px-3 py-2 text-right">Custo un.</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const total =
                line.unitCostSnapshot *
                line.quantity *
                (1 + (line.lossPercent ?? 0) / 100);
              return (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="px-3 py-2.5">{line.descriptionSnapshot}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatNumber(line.quantity, 5)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatCurrency(line.unitCostSnapshot)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {formatCurrency(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const fieldClass = "w-full rounded border border-border bg-background px-2 py-1 text-sm";

  return (
    <div className="overflow-hidden rounded-xl border border-border" data-simulation-mode={mode}>
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2">Descrição (snapshot)</th>
            <th className="px-3 py-2">Un.</th>
            <th className="px-3 py-2">Qtd</th>
            <th className="px-3 py-2">Perda %</th>
            <th className="px-3 py-2">Custo un. (snapshot)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-border/60">
              <td className="px-3 py-2">{line.descriptionSnapshot}</td>
              <td className="px-3 py-2 text-muted-foreground">{line.unitSnapshot}</td>
              <td className="px-3 py-2">
                <input
                  className={fieldClass}
                  value={formatProjectsNumberInput(line.quantity)}
                  onChange={(e) =>
                    onLineChange(line.id, {
                      quantity: parseProjectsNumberInput(e.target.value) ?? 0,
                    })
                  }
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className={fieldClass}
                  value={formatProjectsNumberInput(line.lossPercent ?? 0)}
                  onChange={(e) =>
                    onLineChange(line.id, {
                      lossPercent: parseProjectsNumberInput(e.target.value) ?? 0,
                    })
                  }
                />
              </td>
              <td className="px-3 py-2">
                <input
                  className={fieldClass}
                  value={formatProjectsNumberInput(line.unitCostSnapshot)}
                  onChange={(e) =>
                    onLineChange(line.id, {
                      unitCostSnapshot: parseProjectsNumberInput(e.target.value) ?? 0,
                    })
                  }
                />
              </td>
            </tr>
          ))}
          {!lines.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                Nenhuma linha importada. Use &quot;Importar BOM&quot; para carregar a estrutura oficial
                como snapshot do projeto.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
