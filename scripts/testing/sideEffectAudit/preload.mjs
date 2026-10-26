// Preload da auditoria de efeitos colaterais (scripts/testing/sideEffectAudit/run.mts): registra, por arquivo de
// teste, escrita fora do diretório temporário, processos filhos e rede externa (bloqueada).
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import childProcess from "node:child_process";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const OUT = process.env.SIDE_EFFECT_AUDIT_DIR;
const testFile = process.env.SIDE_EFFECT_AUDIT_FILE || process.argv[1] || "?";
const tmp = path.resolve(os.tmpdir()).toLowerCase();
const auditRoot = OUT ? path.resolve(OUT).toLowerCase() : "";
const origAppend = fs.appendFileSync;
const seen = new Set();

function record(kind, detail) {
  if (!OUT) return;
  const key = `${kind}|${detail}`;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    origAppend(path.join(OUT, `${process.pid}.jsonl`), JSON.stringify({ file: testFile, kind, detail }) + "\n");
  } catch {}
}

function outsideTmp(p) {
  if (typeof p !== "string" && !(p instanceof URL) && !Buffer.isBuffer(p)) return null;
  const s = p instanceof URL ? p.pathname : String(p);
  if (/[\\/]pipe[\\/]/i.test(s) && s.startsWith("\\\\")) return null;
  const abs = path.resolve(s).toLowerCase();
  if (abs.startsWith(tmp) || (auditRoot && abs.startsWith(auditRoot))) return null;
  if (abs.includes(`${path.sep}node_modules${path.sep}`) || abs.includes(`${path.sep}.vite`) || abs.includes(`${path.sep}dist${path.sep}`)) return null;
  return s;
}

const writeFns = ["writeFileSync", "appendFileSync", "mkdirSync", "unlinkSync", "rmSync", "renameSync", "copyFileSync", "rmdirSync", "truncateSync"];
for (const fn of writeFns) {
  const orig = fs[fn];
  if (typeof orig !== "function") continue;
  fs[fn] = function (p, ...rest) {
    const o = outsideTmp(p);
    if (o) record("fs-write", `${fn} ${o}`);
    return orig.call(this, p, ...rest);
  };
}
const origOpen = fs.openSync;
fs.openSync = function (p, flags, ...rest) {
  const f = String(flags ?? "r");
  if (/[wax+]/.test(f)) {
    const o = outsideTmp(p);
    if (o) record("fs-write", `openSync(${f}) ${o}`);
  }
  return origOpen.call(this, p, flags, ...rest);
};
for (const fn of ["writeFile", "appendFile", "mkdir", "unlink", "rm", "rename", "copyFile"]) {
  const orig = fs.promises[fn];
  if (typeof orig !== "function") continue;
  fs.promises[fn] = function (p, ...rest) {
    const o = outsideTmp(p);
    if (o) record("fs-write", `promises.${fn} ${o}`);
    return orig.call(this, p, ...rest);
  };
}

for (const fn of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const orig = childProcess[fn];
  childProcess[fn] = function (cmd, args, ...rest) {
    const a = Array.isArray(args) ? args.join(" ") : "";
    const line = `${cmd} ${a}`.trim();
    // Workers do próprio runner de teste não interessam.
    if (!/tsx[\\/]dist[\\/](cli|preflight|loader)|--test-reporter|node_modules[\\/]\.bin/.test(line)) record("child-process", `${fn}: ${line.slice(0, 200)}`);
    return orig.call(this, cmd, args, ...rest);
  };
}

const isLoopback = (host) => /^(localhost|127\.|::1|\[::1\])/.test(String(host || ""));
const realFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  let host = "?";
  try {
    host = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://relative.invalid").host;
  } catch {}
  if (!isLoopback(host) && host !== "relative.invalid") {
    record("network", `fetch ${host}`);
    throw new TypeError(`fetch bloqueado pela auditoria (${host})`);
  }
  return realFetch(input, init);
};
for (const mod of [http, https]) {
  for (const fn of ["request", "get"]) {
    const orig = mod[fn];
    mod[fn] = function (opts, ...rest) {
      let host = "?";
      try {
        host = typeof opts === "string" || opts instanceof URL ? new URL(String(opts)).hostname : opts?.hostname || opts?.host || "?";
      } catch {}
      // Socket Unix (ex.: API local do Tailscale) é local, não rede externa.
      const local = typeof opts === "object" && opts !== null && "socketPath" in opts && opts.socketPath;
      if (!local && !isLoopback(host)) record("network", `${mod === https ? "https" : "http"}.${fn} ${host}`);
      return orig.call(this, opts, ...rest);
    };
  }
}
syncBuiltinESMExports();
