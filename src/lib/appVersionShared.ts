export type AppBuildEnv = "production" | "development";

export type AppBuildInfo = {
  commit: string;
  buildTime: string;
  env: AppBuildEnv;
};

export const APP_VERSION_POLL_MS = 60_000;
export const APP_VERSION_AUTO_RELOAD_MS = 2_500;

export function isUserEditingForm(activeElement: Element | null = null): boolean {
  const el = activeElement ?? (typeof document !== "undefined" ? document.activeElement : null);
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return (el as HTMLElement).isContentEditable === true;
}

export function shouldReloadForNewAppVersion(
  localCommit: string,
  remoteCommit: string,
  editingForm: boolean
): { notify: boolean; autoReload: boolean } {
  if (!remoteCommit || remoteCommit === localCommit) {
    return { notify: false, autoReload: false };
  }
  return { notify: true, autoReload: !editingForm };
}

export function parseAppBuildInfoJson(raw: string): AppBuildInfo | null {
  try {
    const data = JSON.parse(raw) as Partial<AppBuildInfo>;
    const commit = typeof data.commit === "string" ? data.commit.trim() : "";
    const buildTime = typeof data.buildTime === "string" ? data.buildTime.trim() : "";
    const env = data.env === "production" ? "production" : "development";
    if (!commit || !buildTime) return null;
    return { commit, buildTime, env };
  } catch {
    return null;
  }
}
