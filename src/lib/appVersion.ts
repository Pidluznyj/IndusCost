import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type AppBuildEnv,
  type AppBuildInfo,
  parseAppBuildInfoJson,
} from "./appVersionShared.js";

function resolveBuildEnv(): AppBuildEnv {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function resolveGitCommit(cwd = process.cwd()): string | null {
  if (process.env.BUILD_COMMIT?.trim()) {
    return process.env.BUILD_COMMIT.trim();
  }
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Metadados gerados no build (Vite closeBundle) ou em runtime no servidor. */
export function createAppBuildInfo(cwd = process.cwd()): AppBuildInfo {
  return {
    commit: resolveGitCommit(cwd) ?? "unknown",
    buildTime: new Date().toISOString(),
    env: resolveBuildEnv(),
  };
}

export function readAppBuildInfoFile(filePath: string): AppBuildInfo | null {
  if (!existsSync(filePath)) return null;
  try {
    return parseAppBuildInfoJson(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Versão atual servida pelo backend (dist/build-info.json → env → git). */
export function resolveServerAppBuildInfo(cwd = process.cwd()): AppBuildInfo {
  const fromDist = readAppBuildInfoFile(path.join(cwd, "dist", "build-info.json"));
  if (fromDist) return fromDist;

  const commit = resolveGitCommit(cwd);
  if (commit) {
    return {
      commit,
      buildTime: process.env.BUILD_TIME?.trim() || new Date().toISOString(),
      env: resolveBuildEnv(),
    };
  }

  return {
    commit: "unknown",
    buildTime: new Date().toISOString(),
    env: resolveBuildEnv(),
  };
}

export type { AppBuildEnv, AppBuildInfo } from "./appVersionShared.js";
export {
  APP_VERSION_AUTO_RELOAD_MS,
  APP_VERSION_POLL_MS,
  isUserEditingForm,
  parseAppBuildInfoJson,
  shouldReloadForNewAppVersion,
} from "./appVersionShared.js";
