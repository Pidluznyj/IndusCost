import React from "react";
import { Link } from "react-router-dom";
import { FileBadge } from "lucide-react";
import { PROJECT_CLIENT_REPORT_PATH } from "@/src/lib/projectsNavigation";
import { PROJECT_CLIENT_REPORT_BUTTON_LABEL } from "@/src/lib/projectsClientReportShared";

type Props = {
  projectId: string;
  className?: string;
  variant?: "primary" | "secondary";
};

export function ProjectClientReportButton({
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
      to={PROJECT_CLIENT_REPORT_PATH(projectId)}
      className={className ? `${baseClass} ${className}` : baseClass}
      data-testid="project-client-report-button"
    >
      <FileBadge className="h-4 w-4" />
      {PROJECT_CLIENT_REPORT_BUTTON_LABEL}
    </Link>
  );
}
