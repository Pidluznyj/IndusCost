/**
 * Snapshots before/after para rollback.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { BackfillSnapshotFile, BackfillUserSnapshot } from "./types.ts";

export function defaultSnapshotDir(cwd = process.cwd()): string {
  return path.join(cwd, "docs", "generated", "backfill-snapshots");
}

export function writeBackfillSnapshot(args: {
  runId: string;
  label: string;
  users: BackfillUserSnapshot[];
  cwd?: string;
}): string {
  const dir = defaultSnapshotDir(args.cwd);
  mkdirSync(dir, { recursive: true });
  const file: BackfillSnapshotFile = {
    runId: args.runId,
    createdAt: new Date().toISOString(),
    label: args.label,
    users: args.users.map((u) => ({
      userId: u.userId,
      role: u.role,
      legacyPermissions: [...u.legacyPermissions].sort(),
      overrides: u.overrides.map((o) => ({ ...o })),
    })),
  };
  const outPath = path.join(dir, `${args.runId}.json`);
  writeFileSync(outPath, JSON.stringify(file, null, 2), "utf8");
  return outPath;
}

export function readBackfillSnapshot(runId: string, cwd = process.cwd()): BackfillSnapshotFile {
  const outPath = path.join(defaultSnapshotDir(cwd), `${runId}.json`);
  if (!existsSync(outPath)) {
    throw new Error(`BACKFILL_SNAPSHOT_NOT_FOUND:${runId}`);
  }
  return JSON.parse(readFileSync(outPath, "utf8")) as BackfillSnapshotFile;
}

export function listBackfillSnapshots(cwd = process.cwd()): string[] {
  const dir = defaultSnapshotDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}
