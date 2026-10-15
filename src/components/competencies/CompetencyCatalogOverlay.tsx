import React, { useEffect, useState } from "react";
import { OverlayField, OverlayInput, OverlayTextarea } from "@/src/components/ui/overlay";
import { createCompetency } from "@/src/lib/competencies/competencyClient";
import {
  COMPETENCY_CATEGORIES,
  COMPETENCY_CATEGORY_LABELS,
  COMPETENCY_LEVEL_DESCRIPTIONS,
  COMPETENCY_LEVEL_LABELS,
  type CompetencyCategory,
} from "@/src/lib/competencies/competencyDomain";
import { CompetencyModalFrame } from "./CompetencyModalFrame";
import { LevelChip, SegmentedControl, ToggleSwitch } from "./competencyUi";

const CATEGORY_OPTIONS = COMPETENCY_CATEGORIES.map((c) => ({ value: c, label: COMPETENCY_CATEGORY_LABELS[c] }));

/** Nova competência — entra como nova coluna da matriz. */
export function CompetencyCatalogOverlay({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CompetencyCategory>("TECHNICAL");
  const [description, setDescription] = useState("");
  const [requiresRecycling, setRequiresRecycling] = useState(false);
  const [critical, setCritical] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCategory("TECHNICAL");
    setDescription("");
    setRequiresRecycling(false);
    setCritical(false);
  }, [open]);

  const save = async () => {
    await createCompetency({ name: name.trim(), category, description: description.trim() || null, requiresRecycling, critical });
    onSaved("Competência adicionada à matriz");
  };

  return (
    <CompetencyModalFrame
      open={open}
      size="md"
      testId="competency-catalog-overlay"
      title="Nova competência"
      subtitle="Entra como nova coluna na matriz de competências"
      saveLabel="Adicionar competência"
      footerHint="Escala padrão de 4 níveis"
      canSave={Boolean(name.trim())}
      onSave={save}
      onClose={onClose}
    >
      <OverlayField label="Nome" required>
        {(p) => <OverlayInput {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="competency-name" />}
      </OverlayField>
      <div>
        <p className="mb-1.5 text-xs font-semibold">Categoria</p>
        <SegmentedControl ariaLabel="Categoria" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} testId="competency-category" />
      </div>
      <OverlayField label="Descrição">
        {(p) => <OverlayTextarea {...p} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </OverlayField>
      <div>
        <p className="mb-1.5 text-xs font-semibold">Escala de proficiência</p>
        <ul className="space-y-1.5">
          {([1, 2, 3, 4] as const).map((n) => (
            <li key={n} className="flex items-center gap-2.5 text-sm">
              <LevelChip level={n} />
              <span className="font-semibold">{COMPETENCY_LEVEL_LABELS[n]}</span>
              <span className="text-muted-foreground">· {COMPETENCY_LEVEL_DESCRIPTIONS[n]}</span>
            </li>
          ))}
        </ul>
      </div>
      <ToggleSwitch
        checked={requiresRecycling}
        onChange={setRequiresRecycling}
        label="Exige reciclagem periódica"
        description="O nível expira sem um treinamento válido"
        testId="competency-recycling"
      />
      <ToggleSwitch
        checked={critical}
        onChange={setCritical}
        label="Competência crítica"
        description="Qualquer subida de nível fora de avaliação formal exige aprovação; lacunas são destacadas"
        testId="competency-critical"
      />
    </CompetencyModalFrame>
  );
}
