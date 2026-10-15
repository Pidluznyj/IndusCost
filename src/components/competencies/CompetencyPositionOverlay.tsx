import React, { useEffect, useMemo, useState } from "react";
import { OverlayField, OverlayFieldGrid, OverlayInput, OverlaySelect } from "@/src/components/ui/overlay";
import { createWorkPosition } from "@/src/lib/competencies/competencyClient";
import { SHIFT_PATTERNS, SHIFT_PATTERN_LABELS, competencyCategoryLabel, type ShiftPattern } from "@/src/lib/competencies/competencyDomain";
import type { CompetencyDepartmentOptionDto, CompetencyDto } from "@/src/lib/competencies/competencyTypes";
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { LevelButtons } from "./competencyUi";

/** Novo posto de trabalho: setor (departamento oficial), turno e nível mínimo por competência. */
export function CompetencyPositionOverlay({
  open,
  competencies,
  departments,
  onClose,
  onSaved,
}: {
  open: boolean;
  competencies: CompetencyDto[];
  departments: CompetencyDepartmentOptionDto[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [shift, setShift] = useState<ShiftPattern>("ONE_SHIFT");
  const [req, setReq] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    setName("");
    setDepartmentId("");
    setShift("ONE_SHIFT");
    setReq({});
  }, [open]);

  const requirements = useMemo(
    () => (Object.entries(req) as [string, number][]).filter(([, v]) => v > 0).map(([competencyId, minLevel]) => ({ competencyId, minLevel })),
    [req],
  );

  const save = async () => {
    await createWorkPosition({ name: name.trim(), departmentId: departmentId || null, shiftPattern: shift, requirements });
    onSaved("Posto cadastrado");
  };

  return (
    <CompetencyModalFrame
      open={open}
      testId="competency-position-overlay"
      title="Novo posto de trabalho"
      subtitle="Defina os níveis mínimos exigidos para atuar no posto"
      saveLabel="Cadastrar posto"
      footerHint={`${requirements.length} requisito(s) definidos`}
      canSave={Boolean(name.trim()) && requirements.length > 0}
      onSave={save}
      onClose={onClose}
    >
      <OverlayFieldGrid columns={3}>
        <OverlayField label="Nome" required>
          {(p) => <OverlayInput {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="position-name" />}
        </OverlayField>
        <OverlayField label="Setor">
          {(p) => (
            <OverlaySelect {...p} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} data-testid="position-department">
              <option value="">Sem setor</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
        <OverlayField label="Turno">
          {(p) => (
            <OverlaySelect {...p} value={shift} onChange={(e) => setShift(e.target.value as ShiftPattern)}>
              {SHIFT_PATTERNS.map((s) => (
                <option key={s} value={s}>
                  {SHIFT_PATTERN_LABELS[s]}
                </option>
              ))}
            </OverlaySelect>
          )}
        </OverlayField>
      </OverlayFieldGrid>
      <section aria-label="Requisitos mínimos" data-testid="position-requirements">
        <p className="mb-1.5 text-xs font-semibold">
          Requisitos mínimos <span className="font-normal text-muted-foreground">· 0 = não exigido</span>
        </p>
        {competencies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Cadastre competências antes de definir postos.</p>
        ) : (
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {competencies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{competencyCategoryLabel(c.category)}</p>
                </div>
                <LevelButtons
                  from={0}
                  value={req[c.id] ?? 0}
                  onChange={(n) => setReq((prev) => ({ ...prev, [c.id]: n }))}
                  ariaLabel={`Nível mínimo em ${c.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </CompetencyModalFrame>
  );
}
