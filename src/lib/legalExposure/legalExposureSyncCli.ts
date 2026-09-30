/**
 * CLI do Exposure. Preview é o padrão. Apply global exige LEGAL_EXPOSURE_AUTOSYNC_ENABLED.
 */

import {
  isLegalExposureAutosyncEnabled,
  type LegalExposureEnv,
} from "./legalExposureFeatureFlags.js";
import type { LegalExposureSource } from "./legalExposureContracts.js";

export const LEGAL_EXPOSURE_AUTOSYNC_OFF_MESSAGE =
  "Apply global recusado: LEGAL_EXPOSURE_AUTOSYNC_ENABLED está desligado.";

const SOURCES = new Set(["ALL", "DJEN", "DATAJUD", "DOMICILIO"]);

export type LegalExposureSyncCliArgs = {
  mode: "preview" | "apply";
  source: LegalExposureSource | "ALL";
  entityId: string | null;
};

export function parseLegalExposureSyncArgs(argv: string[]): LegalExposureSyncCliArgs {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length);
  const applyFlag = argv.includes("--apply");
  const mode = modeArg === "apply" || applyFlag ? "apply" : "preview";
  const sourceArg = (argv.find((arg) => arg.startsWith("--source="))?.slice("--source=".length) ?? "ALL")
    .trim()
    .toUpperCase();
  const source = SOURCES.has(sourceArg) ? (sourceArg as LegalExposureSource | "ALL") : "ALL";
  const entityId = argv.find((arg) => arg.startsWith("--entity="))?.slice("--entity=".length).trim() || null;
  return { mode, source, entityId };
}

export function legalExposureAutosyncApplyAllowed(
  args: LegalExposureSyncCliArgs,
  env: LegalExposureEnv = process.env
): { ok: true } | { ok: false; exitCode: number; message: string } {
  if (args.mode !== "apply") return { ok: true };
  if (args.entityId) return { ok: true };
  if (isLegalExposureAutosyncEnabled(env)) return { ok: true };
  return { ok: false, exitCode: 2, message: LEGAL_EXPOSURE_AUTOSYNC_OFF_MESSAGE };
}
