import React, { useEffect, useState } from "react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (description: string) => Promise<void>;
};

export function ProjectSimpleDescriptionModal({
  open,
  title,
  subtitle,
  label,
  placeholder,
  submitLabel,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) setDescription("");
  }, [open]);

  if (!open) return null;

  return (
    <ProjectModalShell
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !description.trim()}
            onClick={() => onSubmit(description.trim())}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </>
      }
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <label className="text-sm font-medium">{label}</label>
      <input
        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
        placeholder={placeholder}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus
      />
    </ProjectModalShell>
  );
}
