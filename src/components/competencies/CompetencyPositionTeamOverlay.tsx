import React, { useEffect, useMemo, useState } from "react";
import { OverlayField, OverlayInput } from "@/src/components/ui/overlay";
import { setWorkPositionTeam } from "@/src/lib/competencies/competencyClient";
import type { CompetencyEmployeeOptionDto, WorkPositionDto } from "@/src/lib/competencies/competencyTypes";
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { ChipToggle } from "./competencyUi";

/**
 * Equipe do posto (alocação colaborador → posto). Quem está em outro posto é transferido;
 * o histórico de alocações é preservado no servidor.
 */
export function CompetencyPositionTeamOverlay({
  position,
  positions,
  employees,
  onClose,
  onSaved,
}: {
  position: WorkPositionDto | null;
  positions: WorkPositionDto[];
  employees: CompetencyEmployeeOptionDto[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!position) return;
    setSelected(position.team.map((t) => t.employeeId));
    setQuery("");
  }, [position]);

  const positionName = useMemo(() => new Map(positions.map((p) => [p.id, p.name])), [positions]);
  const q = query.trim().toLocaleLowerCase("pt-BR");
  const visible = employees.filter((e) => e.writable || selected.includes(e.id)).filter(
    (e) => !q || e.name.toLocaleLowerCase("pt-BR").includes(q) || (e.departmentName ?? "").toLocaleLowerCase("pt-BR").includes(q),
  );

  const save = async () => {
    if (!position) return;
    await setWorkPositionTeam(position.id, selected);
    onSaved("Equipe do posto atualizada");
  };

  return (
    <CompetencyModalFrame
      open={Boolean(position)}
      testId="competency-team-overlay"
      title={position ? `Equipe — ${position.name}` : "Equipe"}
      subtitle="Colaboradores alocados no posto entram na matriz e nos indicadores"
      saveLabel="Salvar equipe"
      footerHint={`${selected.length} colaborador(es)`}
      canSave={Boolean(position)}
      onSave={save}
      onClose={onClose}
    >
      <OverlayField label="Buscar colaborador">
        {(p) => <OverlayInput {...p} value={query} placeholder="Nome ou setor" onChange={(e) => setQuery(e.target.value)} />}
      </OverlayField>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum colaborador ativo encontrado.</p>
      ) : (
        <div className="flex flex-wrap gap-2" data-testid="team-chips">
          {visible.map((e) => {
            const elsewhere = e.positionId && e.positionId !== position?.id ? positionName.get(e.positionId) : null;
            return (
              <ChipToggle
                key={e.id}
                label={`${e.name}${elsewhere ? ` · hoje em ${elsewhere}` : ""}${e.writable ? "" : " · fora da sua equipe"}`}
                selected={selected.includes(e.id)}
                onToggle={() => {
                  if (!e.writable) return; // fixo: o servidor recusaria a alteração
                  setSelected((prev) => (prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id]));
                }}
              />
            );
          })}
        </div>
      )}
    </CompetencyModalFrame>
  );
}
