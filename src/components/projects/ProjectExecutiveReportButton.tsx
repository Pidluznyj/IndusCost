import React from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import {
  getProjectExecutiveReportPath,
  PROJECT_EXECUTIVE_REPORT_BUTTON_LABEL,
} from "@/src/lib/projectsExecutiveReport";

type Props = {
  projectId: string;
  className?: string;
  variant?: "primary" | "secondary";
};

export function ProjectExecutiveReportButton({
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
      to={getProjectExecutiveReportPath(projectId)}
      className={className ? `${baseClass} ${className}` : baseClass}
    >
      <FileText className="h-4 w-4" />
      {PROJECT_EXECUTIVE_REPORT_BUTTON_LABEL}
    </Link>
  );
}
