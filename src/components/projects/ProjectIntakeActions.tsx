import React from "react";
import { Link } from "react-router-dom";
import { ClipboardList, FileSpreadsheet, FileText } from "lucide-react";
import {
  getProjectIntakeFormFullPath,
  getProjectIntakeFormPath,
} from "@/src/lib/projectsIntakeForm";
import {
  PROJECT_INTAKE_FULL_BUTTON_LABEL,
  PROJECT_INTAKE_QUICK_BUTTON_LABEL,
} from "@/src/lib/projectsIntakeQuickForm";
import {
  downloadProjectIntakeSpreadsheet,
  PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL,
} from "@/src/lib/projectsIntakeSpreadsheet";

type Props = {
  projectId?: string | null;
  layout?: "toolbar" | "documents";
};

const secondaryBtn =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted";
const primaryBtn =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90";

export function ProjectIntakeActions({ projectId, layout = "toolbar" }: Props) {
  const quickPath = projectId ? getProjectIntakeFormPath(projectId) : "/projects/intake-form/blank";
  const fullPath = projectId ? getProjectIntakeFormFullPath(projectId) : "/projects/intake-form/blank/full";

  if (layout === "documents") {
    return (
      <div className="flex flex-wrap gap-2">
        <Link to={quickPath} className={primaryBtn}>
          <ClipboardList className="h-4 w-4" />
          {PROJECT_INTAKE_QUICK_BUTTON_LABEL}
        </Link>
        <Link to={fullPath} className={secondaryBtn}>
          <FileText className="h-4 w-4" />
          {PROJECT_INTAKE_FULL_BUTTON_LABEL}
        </Link>
        <button type="button" onClick={() => downloadProjectIntakeSpreadsheet()} className={secondaryBtn}>
          <FileSpreadsheet className="h-4 w-4" />
          {PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Link to={quickPath} className={primaryBtn}>
        <ClipboardList className="h-4 w-4" />
        {PROJECT_INTAKE_QUICK_BUTTON_LABEL}
      </Link>
      <Link to={fullPath} className={secondaryBtn}>
        <FileText className="h-4 w-4" />
        {PROJECT_INTAKE_FULL_BUTTON_LABEL}
      </Link>
      <button type="button" onClick={() => downloadProjectIntakeSpreadsheet()} className={secondaryBtn}>
        <FileSpreadsheet className="h-4 w-4" />
        {PROJECT_INTAKE_SPREADSHEET_BUTTON_LABEL}
      </button>
    </div>
  );
}
