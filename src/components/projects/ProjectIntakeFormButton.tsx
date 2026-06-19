import React from "react";
import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import {
  getProjectIntakeFormPath,
  PROJECT_INTAKE_FORM_BUTTON_LABEL,
} from "@/src/lib/projectsIntakeForm";

type Props = {
  projectId: string;
  className?: string;
  variant?: "primary" | "secondary";
};

export function ProjectIntakeFormButton({
  projectId,
  className,
  variant = "secondary",
}: Props) {
  const baseClass =
    variant === "primary"
      ? "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      : "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted";

  return (
    <Link
      to={getProjectIntakeFormPath(projectId)}
      className={className ? `${baseClass} ${className}` : baseClass}
    >
      <ClipboardList className="h-4 w-4" />
      {PROJECT_INTAKE_FORM_BUTTON_LABEL}
    </Link>
  );
}
