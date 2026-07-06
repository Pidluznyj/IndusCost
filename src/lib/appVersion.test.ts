import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  APP_VERSION_POLL_MS,
  createAppBuildInfo,
  isUserEditingForm,
  parseAppBuildInfoJson,
  readAppBuildInfoFile,
  resolveServerAppBuildInfo,
  shouldReloadForNewAppVersion,
} from "./appVersion.js";

describe("appVersion", () => {
  it("parseAppBuildInfoJson valida commit e buildTime", () => {
    const info = parseAppBuildInfoJson(
      JSON.stringify({
        commit: "abc123",
        buildTime: "2026-06-24T12:00:00.000Z",
        env: "production",
      })
    );
    assert.deepEqual(info, {
      commit: "abc123",
      buildTime: "2026-06-24T12:00:00.000Z",
      env: "production",
    });
  });

  it("resolveServerAppBuildInfo lê dist/build-info.json", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "induscost-build-info-"));
    try {
      const distDir = path.join(dir, "dist");
      mkdirSync(distDir, { recursive: true });
      writeFileSync(
        path.join(distDir, "build-info.json"),
        JSON.stringify({
          commit: "deadbeef",
          buildTime: "2026-06-24T10:00:00.000Z",
          env: "production",
        }),
        "utf8"
      );
      const info = resolveServerAppBuildInfo(dir);
      assert.equal(info.commit, "deadbeef");
      assert.equal(info.env, "production");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createAppBuildInfo retorna commit não vazio quando git disponível", () => {
    const info = createAppBuildInfo();
    assert.ok(info.commit.length >= 7);
    assert.ok(info.buildTime);
    assert.ok(info.env === "production" || info.env === "development");
  });

  it("shouldReloadForNewAppVersion detecta mudança de commit", () => {
    assert.deepEqual(shouldReloadForNewAppVersion("aaa", "aaa", false), {
      notify: false,
      autoReload: false,
    });
    assert.deepEqual(shouldReloadForNewAppVersion("aaa", "bbb", false), {
      notify: true,
      autoReload: true,
    });
    assert.deepEqual(shouldReloadForNewAppVersion("aaa", "bbb", true), {
      notify: true,
      autoReload: false,
    });
  });

  it("isUserEditingForm detecta input ativo", () => {
    const input = { tagName: "INPUT", isContentEditable: false } as HTMLElement;
    assert.equal(isUserEditingForm(input), true);
    const div = { tagName: "DIV", isContentEditable: true } as HTMLElement;
    assert.equal(isUserEditingForm(div), true);
    const span = { tagName: "SPAN", isContentEditable: false } as HTMLElement;
    assert.equal(isUserEditingForm(span), false);
  });

  it("poll interval padrão é 60 segundos", () => {
    assert.equal(APP_VERSION_POLL_MS, 60_000);
  });
});

describe("appVersion wiring", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("server.ts expõe GET /api/app-version", () => {
    const src = read("server.ts");
    assert.match(src, /app\.get\("\/api\/app-version"/);
    assert.match(src, /resolveServerAppBuildInfo/);
  });

  it("index.html é servido com no-store no fallback SPA", () => {
    const src = read("server.ts");
    assert.match(src, /setSpaHtmlNoCacheHeaders/);
    assert.match(src, /no-store, no-cache, must-revalidate/);
    assert.match(src, /max-age=31536000, immutable/);
  });

  it("main.tsx monta VersionWatcher globalmente", () => {
    const src = read("src/main.tsx");
    assert.match(src, /<VersionWatcher \/>/);
    assert.match(src, /from "\.\/components\/VersionWatcher/);
  });

  it("VersionWatcher consulta /api/app-version periodicamente", () => {
    const src = read("src/components/VersionWatcher.tsx");
    assert.match(src, /\/api\/app-version/);
    assert.match(src, /APP_VERSION_POLL_MS/);
    assert.match(src, /window\.location\.reload/);
    assert.match(src, /Atualizar agora/);
  });

  it("build gera dist/build-info.json via plugin Vite", () => {
    const src = read("vite.config.ts");
    assert.match(src, /build-info\.json/);
    assert.match(src, /__APP_BUILD_INFO__/);
  });
});
