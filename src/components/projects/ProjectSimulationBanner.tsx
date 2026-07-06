import React from "react";
import { AlertCircle } from "lucide-react";
import {
  PROJECT_SIMULATION_BANNER_SUBTITLE,
  PROJECT_SIMULATION_BANNER_TITLE,
  PROJECT_SIMULATION_MODE,
} from "@/src/lib/projectSimulationMode";

export function ProjectSimulationBanner({ mode = PROJECT_SIMULATION_MODE }: { mode?: string }) {
  if (mode !== PROJECT_SIMULATION_MODE) return null;
  return (
    <div
      className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      data-simulation-mode={mode}
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">{PROJECT_SIMULATION_BANNER_TITLE}</p>
        <p className="mt-1 text-amber-900/90">{PROJECT_SIMULATION_BANNER_SUBTITLE}</p>
      </div>
    </div>
  );
}
