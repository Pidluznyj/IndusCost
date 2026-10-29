/**
 * Hook de segurança do servidor-01 (infra/deploy/hooks/servidor01-checks.sh) — SEM banco, sem rede, sem systemd.
 *
 * Roda o hook real num bash com systemctl/curl/ssh/getent e induscost-runtime-role SIMULADOS, a partir do arquivo de
 * ambiente REAL da homologação (infra/deploy/environments/homologacao.env; só as chaves pendentes recebem valores de
 * teste e os comandos apontam para os simulados). Cobre: sucesso, gateway e AWS indisponíveis (inclusive falha
 * passageira que não pode reprovar), commit AWS alterado, contexto de outra execução, CNPJ indisponível e egress,
 * fase pós-rollback, configuração (A_COLETAR, prazo somado, atualizador de egress) e ausência de efeitos colaterais.
 * O executor completo com o hook instalado: deployExecutor.pg17.e2e.test.ts (E12–E15).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";
import { isolatedHostEnv } from "./deployTestIsolation";

const HOOK = join(process.cwd(), "infra/deploy/hooks/servidor01-checks.sh");
const ENV = join(process.cwd(), "infra/deploy/environments/homologacao.env");
const EXECUTOR = join(process.cwd(), "infra/deploy/induscost-deploy-executor.sh");

function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  for (const candidate of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
const BASH = findBash();
const SKIP = BASH ? false : "bash não encontrado neste sistema.";
const toPosix = (p: string) =>
  process.platform === "win32" ? p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`) : p;

const SHA_A = "0123456789abcdef0123456789abcdef01234567";
const SHA_B = "fedcba9876543210fedcba9876543210fedcba98";
const GATEWAY = "http://192.168.100.5:3000/api/health";
const AWS = "http://100.85.97.124:3000/api/health";
const BRASILAPI = "https://brasilapi.com.br/";
const CNPJWS = "https://publica.cnpj.ws/";
const key = (url: string) => url.replace(/[^A-Za-z0-9]/g, "_");

const STUBS: Record<string, string> = {
  // Só leitura é aceita; qualquer outro verbo fica registrado como PROIBIDO (e o teste reprova).
  systemctl: `#!/usr/bin/env bash
echo "systemctl $*" >> "$STUB/calls"
case "$1" in
  is-active) st="$(cat "$STUB/unit-$2" 2>/dev/null || echo inactive)"; [[ "$st" == SILENT ]] && exit 1; echo "$st"; [[ "$st" == active ]]; exit $? ;;
  show) u="\${@: -1}"
    if [[ "$*" == *LoadState* ]]; then cat "$STUB/load-$u" 2>/dev/null || echo loaded; exit 0; fi
    [[ -f "$STUB/show-fail" ]] && exit 1
    cat "$STUB/show-$u" 2>/dev/null || printf 'IPAddressDeny=\\nIPAddressAllow=\\n'; exit 0 ;;
  *) echo "PROIBIDO systemctl $*" >> "$STUB/calls"; exit 1 ;;
esac
`,
  // fail-<url> = quantas tentativas falham (999 = todas); com -w %{http_code}, a falha devolve 000.
  curl: `#!/usr/bin/env bash
echo "curl $*" >> "$STUB/calls"
url="\${@: -1}"; k="\${url//[^A-Za-z0-9]/_}"
n=$(( $(cat "$STUB/n-$k" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB/n-$k"
fails="$(cat "$STUB/fail-$k" 2>/dev/null || echo 0)"
if [[ "$*" == *http_code* ]]; then
  if (( n <= fails )); then echo 000; exit 28; fi
  echo "\${STUB_HTTP_CODE:-200}"; exit 0
fi
(( n <= fails )) && exit 7
exit 0
`,
  // aws-sha-<n> = resposta da n-ésima chamada; senão aws-sha. ssh-fail = destino inalcançável.
  ssh: `#!/usr/bin/env bash
echo "ssh $*" >> "$STUB/calls"
[[ -f "$STUB/ssh-fail" ]] && { echo "ssh: connect to host: Connection timed out" >&2; exit 255; }
n=$(( $(cat "$STUB/ssh-n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB/ssh-n"
if [[ -f "$STUB/aws-sha-$n" ]]; then cat "$STUB/aws-sha-$n"; else cat "$STUB/aws-sha"; fi
`,
  getent: `#!/usr/bin/env bash
echo "getent $*" >> "$STUB/calls"
[[ "$1" == ahostsv4 && -f "$STUB/dns-$2" ]] || exit 2
while read -r ip; do echo "$ip STREAM $2"; done < "$STUB/dns-$2"
`,
  "induscost-runtime-role": `#!/usr/bin/env bash
echo "role $*" >> "$STUB/calls"
case "$1" in
  get) [[ -f "$STUB/role-stderr" ]] && cat "$STUB/role-stderr" >&2; cat "$STUB/role" 2>/dev/null || echo CLOUD_PRIMARY ;;
  check) exit "$(cat "$STUB/role-check-rc" 2>/dev/null || echo 0)" ;;
  *) echo "PROIBIDO role $*" >> "$STUB/calls"; exit 1 ;;
esac
`,
};

const work = mkdtempSync(join(tmpdir(), "deploy-hooks-s01-"));
after(() => rmSync(work, { recursive: true, force: true }));

const RUN_ID = "20261029T120000Z-4242-a1b2c3d4e5f6";
let seq = 0;

/** Um servidor-01 de mentira: estado dos simulados num diretório, ambiente real da homologação + chaves pendentes. */
function host(envOverrides: Record<string, string> = {}, opts: { keepPending?: boolean; realDelays?: boolean } = {}) {
  seq += 1;
  const base = join(work, `h${seq}`);
  const stub = join(base, "stub");
  const bin = join(base, "bin");
  const ctx = join(base, "state", "hook-context", RUN_ID);
  for (const d of [stub, bin, ctx]) mkdirSync(d, { recursive: true });
  // Como o executor cria (umask 077): no Linux o hook recusa contexto que não seja 0700.
  chmodSync(ctx, 0o700);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(stub, "calls"), "");
  writeFileSync(join(stub, "unit-nginx.service"), "active");
  writeFileSync(join(stub, "aws-sha"), `${SHA_A}\n`);
  let env = readFileSync(ENV, "utf8");
  if (!opts.keepPending) {
    env = env
      .replace(/^HOOK_AWS_SSH_TARGET=.*$/m, "HOOK_AWS_SSH_TARGET=deploy@aws-prod")
      .replace(/^HOOK_LOCAL_PROD_SERVICE=.*$/m, "HOOK_LOCAL_PROD_SERVICE=induscost.service")
      .replace(/^HOOK_RUNTIME_ROLE_CHECK_ARGS=.*$/m, "HOOK_RUNTIME_ROLE_CHECK_ARGS=none");
  }
  const overrides: Record<string, string> = {
    HOOK_RUNTIME_ROLE_CMD: toPosix(join(bin, "induscost-runtime-role")),
    IDS_SYSTEMCTL: toPosix(join(bin, "systemctl")),
    HOOK_CURL: toPosix(join(bin, "curl")),
    HOOK_SSH: toPosix(join(bin, "ssh")),
    HOOK_GETENT: toPosix(join(bin, "getent")),
    ...(opts.realDelays ? {} : { HOOK_RETRY_DELAY: "0" }),
    ...envOverrides,
  };
  env += `\n# --- simulados do teste\n${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join("\n")}\n`;
  const envFile = join(base, "homologacao.env");
  writeFileSync(envFile, env);

  const run = (phase: string, extra: Record<string, string> = {}) => {
    const r = spawnSync(BASH!, [toPosix(HOOK)], {
      encoding: "utf8",
      env: {
        ...isolatedHostEnv(),
        STUB: toPosix(stub),
        IDS_ENV_FILE: toPosix(envFile),
        IDS_DEPLOY_PHASE: phase,
        IDS_DEPLOY_RUN_ID: RUN_ID,
        IDS_HOOK_CONTEXT_DIR: toPosix(ctx),
        IDS_ENV_NAME: "homologacao",
        IDS_OLD_COMMIT: "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
        IDS_TARGET: "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1",
        IDS_BACKUP_DIR: "",
        ...extra,
      },
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const manual = (mode: "--check" | "--validate") => {
    const r = spawnSync(BASH!, [toPosix(HOOK), mode, "--env-file", toPosix(envFile)], { encoding: "utf8", env: { ...isolatedHostEnv(), STUB: toPosix(stub), IDS_ENV_FILE: "" } });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const set = (name: string, content: string) => writeFileSync(join(stub, name), content);
  const fail = (url: string, times = 999) => set(`fail-${key(url)}`, String(times));
  const calls = () => readFileSync(join(stub, "calls"), "utf8");
  const record = () => (existsSync(join(ctx, "aws-commit.before")) ? readFileSync(join(ctx, "aws-commit.before"), "utf8") : "");
  /** Todos os arquivos fora do estado dos simulados (para provar que o hook só grava no contexto). */
  const snapshot = () => {
    const out: Record<string, string> = {};
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (!p.startsWith(stub)) out[relative(base, p)] = readFileSync(p, "utf8");
      }
    };
    walk(base);
    return out;
  };
  return { base, ctx, envFile, run, manual, set, fail, calls, record, snapshot };
}

/** Nenhuma chamada com efeito: systemctl só is-active/show; ssh só o git rev-parse fixo; curl sem método/corpo. */
function assertReadOnlyCalls(calls: string) {
  assert.doesNotMatch(calls, /PROIBIDO/, calls);
  for (const line of calls.split("\n").filter(Boolean)) {
    if (line.startsWith("systemctl ")) assert.match(line, /^systemctl (is-active \S+|show -p LoadState --value -- \S+|show -p IPAddressDeny -p IPAddressAllow -- \S+)$/, line);
    else if (line.startsWith("ssh ")) assert.match(line, /^ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ControlMaster=no -o ControlPath=none -o ConnectTimeout=\d+ -o ServerAliveInterval=5 -o ServerAliveCountMax=2 [\w.@-]+ git -C '\/opt\/induscost' rev-parse --verify HEAD$/, line);
    else if (line.startsWith("curl ")) assert.doesNotMatch(line, /\s(-X|--request|-d|--data\S*|-T|--upload-file|-F|--form)\s/, line);
    else if (line.startsWith("role ")) assert.match(line, /^role (get|check( [\w -]+)?)$/, line);
    else assert.match(line, /^getent ahostsv4 [\w.-]+$/, line);
  }
  assert.doesNotMatch(calls, /update-induscost-homolog-egress/);
}

describe("hook de segurança do servidor-01 (somente leitura)", { skip: SKIP }, () => {
  it("H1. sucesso antes do deploy: todas as críticas OK, commit AWS registrado UMA vez no contexto da execução; só leituras; nada gravado fora do contexto", () => {
    const h = host();
    const before = h.snapshot();
    const r = h.run("HOOKS_PRE_DEPLOY");
    assert.equal(r.code, 0, r.out);
    for (const m of [/OK {4}papel do servidor: CLOUD_PRIMARY/, /OK {4}produção Node local induscost\.service desligada \(inactive; loaded\)/, /OK {4}nginx\.service ativo/, /OK {4}gateway respondeu/, /OK {4}produção AWS respondeu/, /OK {4}commit AWS anterior ao deploy registrado/, /RESULTADO: OK antes do deploy/]) assert.match(r.out, m);
    const rec = h.record();
    assert.match(rec, new RegExp(`^run_id=${RUN_ID}$`, "m"));
    assert.match(rec, new RegExp(`^aws_commit=${SHA_A}$`, "m"));
    assert.match(rec, /^old_commit=c0c0/m);
    assert.match(rec, /^target=c1c1/m);
    assertReadOnlyCalls(h.calls());
    const now = h.snapshot();
    const created = Object.keys(now).filter((k) => !(k in before));
    assert.deepEqual(created.map((k) => k.replace(/\\/g, "/")), [`state/hook-context/${RUN_ID}/aws-commit.before`]);
    for (const k of Object.keys(before)) assert.equal(now[k], before[k], `${k} alterado pelo hook`);
    // Registro único: uma segunda gravação na mesma execução é recusada (nada é sobrescrito).
    const again = h.run("HOOKS_PRE_DEPLOY");
    assert.equal(again.code, 1, again.out);
    assert.match(again.out, /já existe/);
    assert.equal(h.record(), rec);
  });

  it("H2. gateway indisponível em todas as tentativas: falha antes do deploy (1), nada registrado; falha passageira (1ª tentativa) não reprova", () => {
    const h = host();
    h.fail(GATEWAY);
    const r = h.run("HOOKS_PRE_DEPLOY");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FALHA crítica: gateway indisponível: http:\/\/192\.168\.100\.5:3000\/api\/health não respondeu 2xx em 3 tentativa\(s\)/);
    assert.match(r.out, /deploy recusado; nada foi alterado/);
    assert.equal(h.record(), "", "sem registro quando uma crítica falha");
    assert.equal(h.calls().split("\n").filter((l) => l.includes(GATEWAY)).length, 3, "três tentativas");

    const t = host();
    t.fail(GATEWAY, 1);
    t.fail(AWS, 2);
    const ok = t.run("HOOKS_PRE_DEPLOY");
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /gateway: tentativa 1\/3 falhou/);
    assert.match(ok.out, /OK {4}gateway respondeu .*tentativa 2\/3/);
    assert.match(ok.out, /OK {4}produção AWS respondeu .*tentativa 3\/3/);
  });

  it("H3. produção AWS indisponível (health) ou commit AWS ilegível por SSH: falha antes do deploy (1), nada registrado", () => {
    const h = host();
    h.fail(AWS);
    const r = h.run("HOOKS_PRE_DEPLOY");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FALHA crítica: produção AWS indisponível/);
    assert.equal(h.record(), "");

    const s = host();
    s.set("ssh-fail", "1");
    const r2 = s.run("HOOKS_PRE_DEPLOY");
    assert.equal(r2.code, 1, r2.out);
    assert.match(r2.out, /commit da produção AWS ilegível por SSH \(deploy@aws-prod: git -C \/opt\/induscost rev-parse\) em 2 tentativa\(s\)/);
    assert.equal(s.record(), "");

    const g = host();
    g.set("aws-sha", "fatal: not a git repository\n");
    const r3 = g.run("HOOKS_PRE_DEPLOY");
    assert.equal(r3.code, 1, "saída que não é um SHA conta como ilegível");
    assert.equal(g.record(), "");
  });

  it("H4. papel ≠ CLOUD_PRIMARY, produção Node local ligada, Nginx parado ou `check` recusado: falha antes do deploy (1)", () => {
    const a = host();
    a.set("role", "STANDBY\n");
    const ra = a.run("HOOKS_PRE_DEPLOY");
    assert.equal(ra.code, 1, ra.out);
    assert.match(ra.out, /papel do servidor 'STANDBY' ≠ esperado 'CLOUD_PRIMARY'/);
    const b = host();
    b.set("unit-induscost.service", "active");
    const rb = b.run("HOOKS_PRE_DEPLOY");
    assert.equal(rb.code, 1, rb.out);
    assert.match(rb.out, /produção Node local induscost\.service está 'active'/);
    const c = host();
    c.set("unit-nginx.service", "failed");
    const rc = c.run("HOOKS_PRE_DEPLOY");
    assert.equal(rc.code, 1, rc.out);
    assert.match(rc.out, /nginx\.service está 'failed'/);
    const d = host({ HOOK_RUNTIME_ROLE_CHECK_ARGS: "CLOUD_PRIMARY" });
    d.set("role-check-rc", "4");
    const rd = d.run("HOOKS_PRE_DEPLOY");
    assert.equal(rd.code, 1, rd.out);
    assert.match(rd.out, /check CLOUD_PRIMARY recusou \(RC=4\)/);
    assert.match(d.calls(), /^role check CLOUD_PRIMARY$/m);
    // "Desligada" exige prova: unidade inexistente (nome errado), sonda muda ou estado desconhecido reprovam.
    const e = host();
    e.set("load-induscost.service", "not-found");
    const re = e.run("HOOKS_PRE_DEPLOY");
    assert.equal(re.code, 1, re.out);
    assert.match(re.out, /unidade induscost\.service não existe \(LoadState=not-found\): conferir HOOK_LOCAL_PROD_SERVICE/);
    const f = host();
    f.set("unit-induscost.service", "SILENT");
    const rf = f.run("HOOKS_PRE_DEPLOY");
    assert.equal(rf.code, 1, rf.out);
    assert.match(rf.out, /estado de induscost\.service ilegível \('unknown'\)/);
    const g = host();
    g.set("load-induscost.service", "");
    const rg = g.run("HOOKS_PRE_DEPLOY");
    assert.equal(rg.code, 1, rg.out);
    assert.match(rg.out, /estado de carga de induscost\.service ilegível/);
    for (const x of [a, b, c, d, e, f, g]) assert.equal(x.record(), "");
    // Aviso no stderr da ferramenta (locale, sudo) não contamina a comparação do papel.
    const w = host();
    w.set("role-stderr", "bash: warning: setlocale: LC_CTYPE: cannot change locale (UTF-8)\n");
    const rw = w.run("HOOKS_PRE_DEPLOY");
    assert.equal(rw.code, 0, rw.out);
    assert.match(rw.out, /OK {4}papel do servidor: CLOUD_PRIMARY/);
    assert.match(rw.out, /setlocale/, "o aviso aparece no log");
  });

  it("H5. depois da subida: commit AWS igual → OK; alterado → ALERTA (10) sem nenhuma ação na AWS; HOOK_PROD_POST_POLICY=rollback → falha comum (1)", () => {
    const h = host();
    assert.equal(h.run("HOOKS_PRE_DEPLOY").code, 0);
    const same = h.run("HOOKS_POST_START");
    assert.equal(same.code, 0, same.out);
    assert.match(same.out, new RegExp(`commit da produção AWS inalterado durante o deploy \\(${SHA_A}\\)`));
    assert.ok(existsSync(join(h.ctx, "aws-commit.after-HOOKS_POST_START")));

    const m = host();
    m.set("aws-sha-2", `${SHA_B}\n`);
    assert.equal(m.run("HOOKS_PRE_DEPLOY").code, 0);
    const changed = m.run("HOOKS_POST_START");
    assert.equal(changed.code, 10, changed.out);
    assert.match(changed.out, new RegExp(`ALTERAÇÃO INESPERADA no commit da produção AWS: antes do deploy ${SHA_A}, agora ${SHA_B}`));
    assert.match(changed.out, /RESULTADO: ALERTA em HOOKS_POST_START/);
    assertReadOnlyCalls(m.calls());
    assert.equal(m.calls().split("\n").filter((l) => l.startsWith("ssh ")).length, 2, "só leituras do commit (antes e depois)");

    const p = host({ HOOK_PROD_POST_POLICY: "rollback" });
    p.set("aws-sha-2", `${SHA_B}\n`);
    assert.equal(p.run("HOOKS_PRE_DEPLOY").code, 0);
    const rb = p.run("HOOKS_POST_START");
    assert.equal(rb.code, 1, rb.out);
    assert.match(rb.out, /HOOK_PROD_POST_POLICY=rollback/);

    // Gateway caiu depois da subida: ALERTA (o rollback da homologação não o recuperaria).
    const g = host();
    assert.equal(g.run("HOOKS_PRE_DEPLOY").code, 0);
    g.fail(GATEWAY);
    const gw = g.run("HOOKS_POST_START");
    assert.equal(gw.code, 10, gw.out);
    assert.match(gw.out, /gateway indisponível/);
  });

  it("H6. contexto protegido: registro de outra execução, outro alvo, outro destino AWS, diretório de outra execução ou ausente → ALERTA (10) sem comparar", () => {
    const h = host();
    assert.equal(h.run("HOOKS_PRE_DEPLOY").code, 0);
    const r1 = h.run("HOOKS_POST_START", { IDS_DEPLOY_RUN_ID: "20261029T130000Z-9999-ffffffffffff" });
    assert.equal(r1.code, 10, r1.out);
    assert.match(r1.out, /contexto '.*' não é o da execução 20261029T130000Z-9999/);
    const r2 = h.run("HOOKS_POST_START", { IDS_TARGET: "d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2" });
    assert.equal(r2.code, 10, r2.out);
    assert.match(r2.out, /é de outra execução/);
    // Registro adulterado (outro run_id dentro do arquivo do mesmo diretório): recusado.
    writeFileSync(join(h.ctx, "aws-commit.before"), h.record().replace(`run_id=${RUN_ID}`, "run_id=20261028T090000Z-1-000000000000"));
    const r3 = h.run("HOOKS_POST_START");
    assert.equal(r3.code, 10, r3.out);
    assert.match(r3.out, /é de outra execução/);
    const d = host({ HOOK_AWS_SSH_TARGET: "outro@aws" });
    const pre = host();
    assert.equal(pre.run("HOOKS_PRE_DEPLOY").code, 0);
    writeFileSync(join(d.ctx, "aws-commit.before"), pre.record());
    const r4 = d.run("HOOKS_POST_START");
    assert.equal(r4.code, 10, r4.out);
    assert.match(r4.out, /registro feito para outro destino AWS/);
    const none = host();
    const r5 = none.run("HOOKS_POST_START");
    assert.equal(r5.code, 10, r5.out);
    assert.match(r5.out, /sem registro do commit AWS anterior/);
    const bad = host();
    const r6 = bad.run("HOOKS_PRE_DEPLOY", { IDS_HOOK_CONTEXT_DIR: "", IDS_DEPLOY_RUN_ID: "" });
    assert.equal(r6.code, 1, "antes do deploy, contexto inválido recusa");
    assert.match(r6.out, /IDS_DEPLOY_RUN_ID ausente ou inválido/);
  });

  it("H7. CNPJ: provedor indisponível só avisa por padrão (0); política fail recusa antes (1) e é ALERTA depois (10); 404/429 provam alcance", () => {
    const h = host();
    h.fail(BRASILAPI);
    const r = h.run("HOOKS_PRE_DEPLOY");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ATENÇÃO CNPJ: https:\/\/brasilapi\.com\.br\/ indisponível a partir do host \(HTTP 000\) após 2 tentativa\(s\)/);
    assert.match(r.out, /RESULTADO: OK antes do deploy \(CNPJ: 1 aviso/);
    assert.notEqual(h.record(), "", "aviso de terceiro não impede o registro");

    const f = host({ HOOK_CNPJ_POLICY: "fail" });
    f.fail(CNPJWS);
    const rf = f.run("HOOKS_PRE_DEPLOY");
    assert.equal(rf.code, 1, rf.out);
    assert.match(rf.out, /FALHA CNPJ: https:\/\/publica\.cnpj\.ws\//);
    const p = host({ HOOK_CNPJ_POLICY: "fail" });
    assert.equal(p.run("HOOKS_PRE_DEPLOY").code, 0);
    p.fail(CNPJWS);
    const rp = p.run("HOOKS_POST_START");
    assert.equal(rp.code, 10, rp.out);

    const t = host();
    t.fail(BRASILAPI, 1);
    const rt = t.run("HOOKS_PRE_DEPLOY");
    assert.equal(rt.code, 0);
    assert.match(rt.out, /OK {4}https:\/\/brasilapi\.com\.br\/ alcançável \(HTTP 200\)/, "segunda tentativa recupera");
    for (const code of ["404", "429"]) {
      const c = host();
      const rc = spawnSync(BASH!, [toPosix(HOOK), "--check", "--env-file", toPosix(c.envFile)], { encoding: "utf8", env: { ...isolatedHostEnv(), STUB: toPosix(join(c.base, "stub")), STUB_HTTP_CODE: code } });
      assert.equal(rc.status, 0, rc.stdout);
      assert.match(rc.stdout, new RegExp(`alcançável \\(HTTP ${code}\\)`));
    }
    const e = host();
    const re = spawnSync(BASH!, [toPosix(HOOK), "--check", "--env-file", toPosix(e.envFile)], { encoding: "utf8", env: { ...isolatedHostEnv(), STUB: toPosix(join(e.base, "stub")), STUB_HTTP_CODE: "503" } });
    assert.equal(re.status, 0, "503 de terceiro: aviso (política warn)");
    assert.match(re.stdout, /ATENÇÃO CNPJ: .* \(HTTP 503\)/);
  });

  it("H8. egress do serviço (leitura): IPAddressDeny ativo + IP fora do IPAddressAllow → aviso com instrução manual; dentro do prefixo → OK; nunca executa o atualizador", () => {
    const h = host();
    h.set("show-induscost-homolog.service", "IPAddressDeny=0.0.0.0/0 ::/0\nIPAddressAllow=127.0.0.0/8 ::1/128 104.16.0.0/13 198.51.100.7\n");
    h.set("dns-brasilapi.com.br", "104.21.3.4\n");
    h.set("dns-publica.cnpj.ws", "198.51.100.7\n203.0.113.9\n");
    const r = h.run("HOOKS_PRE_DEPLOY");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /OK {4}egress de induscost-homolog\.service cobre brasilapi\.com\.br \(104\.21\.3\.4\)/);
    assert.match(r.out, /OK {4}egress de induscost-homolog\.service cobre publica\.cnpj\.ws \(198\.51\.100\.7\)/);
    assert.match(r.out, /ATENÇÃO CNPJ: egress de induscost-homolog\.service NÃO cobre publica\.cnpj\.ws \(203\.0\.113\.9 negado pelo IPAddressDeny e fora do IPAddressAllow\).*MANUALMENTE.*este hook não o executa/);
    assertReadOnlyCalls(h.calls());
    const n = host();
    n.set("show-induscost-homolog.service", "IPAddressDeny=0.0.0.0/0\nIPAddressAllow=\n");
    const rn = n.run("HOOKS_PRE_DEPLOY");
    assert.equal(rn.code, 0);
    assert.match(rn.out, /ATENÇÃO CNPJ: DNS não resolveu brasilapi\.com\.br/);
    // Regra do systemd: IP fora do IPAddressDeny passa mesmo sem estar no IPAddressAllow.
    const p = host();
    p.set("show-induscost-homolog.service", "IPAddressDeny=10.0.0.0/8\nIPAddressAllow=\n");
    p.set("dns-brasilapi.com.br", "104.21.3.4\n");
    p.set("dns-publica.cnpj.ws", "10.1.2.3\n");
    const rp = p.run("HOOKS_PRE_DEPLOY");
    assert.equal(rp.code, 0, rp.out);
    assert.match(rp.out, /OK {4}egress de induscost-homolog\.service cobre brasilapi\.com\.br \(104\.21\.3\.4\)/);
    assert.match(rp.out, /NÃO cobre publica\.cnpj\.ws \(10\.1\.2\.3 negado/);
    // systemctl show falhou: cobertura "não conferida", nunca OK.
    const x = host();
    x.set("show-fail", "1");
    const rx = x.run("HOOKS_PRE_DEPLOY");
    assert.equal(rx.code, 0, rx.out);
    assert.match(rx.out, /ATENÇÃO CNPJ: cobertura do egress de induscost-homolog\.service não conferida \(systemctl show RC=1/);
    assert.doesNotMatch(rx.out, /sem IPAddressDeny: egress do serviço não restrito/);
    // Com HOOK_CNPJ_POLICY=fail, egress descoberto segue a política: recusa antes do deploy.
    const f = host({ HOOK_CNPJ_POLICY: "fail" });
    f.set("show-induscost-homolog.service", "IPAddressDeny=0.0.0.0/0\nIPAddressAllow=104.16.0.0/13\n");
    f.set("dns-brasilapi.com.br", "104.21.3.4\n");
    f.set("dns-publica.cnpj.ws", "203.0.113.9\n");
    const rf = f.run("HOOKS_PRE_DEPLOY");
    assert.equal(rf.code, 1, rf.out);
    assert.match(rf.out, /FALHA CNPJ: egress de induscost-homolog\.service NÃO cobre publica\.cnpj\.ws/);
  });

  it("H9. depois do rollback: mesmo contexto da execução; commit igual → OK; alterado → ALERTA (10); executor só avisa", () => {
    const h = host();
    assert.equal(h.run("HOOKS_PRE_DEPLOY").code, 0);
    const ok = h.run("HOOKS_POST_ROLLBACK");
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /fase HOOKS_POST_ROLLBACK/);
    assert.match(ok.out, /commit da produção AWS inalterado/);
    assert.ok(existsSync(join(h.ctx, "aws-commit.after-HOOKS_POST_ROLLBACK")));
    const m = host();
    m.set("aws-sha-2", `${SHA_B}\n`);
    assert.equal(m.run("HOOKS_PRE_DEPLOY").code, 0);
    const changed = m.run("HOOKS_POST_ROLLBACK");
    assert.equal(changed.code, 10, changed.out);
    assert.match(changed.out, /ALTERAÇÃO INESPERADA/);
  });

  it("H10. configuração: pendências só entre as 3 justificadas; com pendência o hook e o executor recusam (3) sem tocar em nada; preenchido, valida e o pior caso REAL cabe no prazo", () => {
    const env = readFileSync(ENV, "utf8");
    // Vale antes e depois da coleta: o que ainda estiver A_COLETAR precisa ser uma das três pendências justificadas.
    const pending = env.split("\n").filter((l) => /^[^#]*A_COLETAR/.test(l)).map((l) => l.split("=")[0]);
    for (const k of pending) assert.ok(["HOOK_AWS_SSH_TARGET", "HOOK_LOCAL_PROD_SERVICE", "HOOK_RUNTIME_ROLE_CHECK_ARGS"].includes(k!), `pendência sem justificativa: ${k}`);
    if (pending.length > 0) {
      assert.match(env, /Inventar seria pior que\s*\n# recusar/, "justificativa das pendências");
      assert.match(env, /sudo grep -nE 'ssh\|induscost-runtime-role\|systemctl\|is-active' \/usr\/local\/bin\/deploy-induscost-homologacao/);
    }
    for (const [k, v] of Object.entries({ IDS_PG_OS_USER: "pg17homolog", IDS_PG_BIN: "/opt/postgresql-17/bin", IDS_PG_HOST: "/run/induscost-pg17", IDS_PG_PORT: "5433", DB: "teste_bi_homolog", MODE_FILE: "none", EXPECTED_MODE: "none", PRECUTOVER_DROPIN: "none", PRECUTOVER_EXPECTED: "none", START_SERVICE_POLICY: "if-was-active", CRON_GLOB: "'induscost-homolog*'", UNIT_GLOB: "'induscost-homolog-*'", HOOK_RUNTIME_ROLE_EXPECTED: "CLOUD_PRIMARY", HOOK_GATEWAY_HEALTH: GATEWAY, HOOK_AWS_HEALTH: AWS, HOOK_AWS_APP_DIR: "/opt/induscost" })) {
      assert.match(env, new RegExp(`^${k}=${v.replace(/[.*?/]/g, "\\$&")}(\\s|$)`, "m"), k);
    }
    // Pendência (injetada numa cópia, para valer depois da coleta também): hook recusa sem sondar nada.
    const p = host({ HOOK_AWS_SSH_TARGET: "A_COLETAR", HOOK_LOCAL_PROD_SERVICE: "A_COLETAR" });
    const rp = p.manual("--validate");
    assert.equal(rp.code, 3, rp.out);
    assert.match(rp.out, /HOOK_AWS_SSH_TARGET ausente ou A_COLETAR/);
    assert.match(rp.out, /HOOK_LOCAL_PROD_SERVICE ausente ou A_COLETAR/);
    assert.equal(p.calls(), "");
    // Pior caso com os prazos e intervalos REAIS do ambiente (o mesmo número que a documentação cita).
    const ok = host({}, { realDelays: true });
    const v = ok.manual("--validate");
    assert.equal(v.code, 0, v.out);
    assert.match(v.out, /pior caso das sondas: 245s \(HOOK_TIMEOUT=300s\)/);
    assert.match(host({ HOOK_RUNTIME_ROLE_CHECK_ARGS: "CLOUD_PRIMARY" }, { realDelays: true }).manual("--validate").out, /pior caso das sondas: 255s \(HOOK_TIMEOUT=300s\)/);
    assert.equal(ok.calls(), "", "--validate não chama nada");
    // O executor recusa (3) um ambiente com pendência ANTES da trava, do pidfile e de qualquer leitura do servidor
    // (cópia temporária com A_COLETAR; nunca o arquivo do repositório, que no servidor apontaria para caminhos reais).
    const envCopy = join(p.base, "pendente.env");
    writeFileSync(envCopy, readFileSync(p.envFile, "utf8"));
    const r = spawnSync(BASH!, [toPosix(EXECUTOR), "--env-file", toPosix(envCopy), "--check"], { encoding: "utf8", env: { ...isolatedHostEnv(), IDS_ALLOW_UNINSTALLED: "1" } });
    assert.equal(r.status, 3, r.stdout);
    assert.match(r.stdout, /A_COLETAR/);
  });

  it("H11. configuração inválida recusa antes de qualquer sonda: prazo somado > HOOK_TIMEOUT, atualizador de egress como comando, URL/política inválidas; depois da subida vira ALERTA (10)", () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ HOOK_TIMEOUT: "120" }, /pior caso das sondas \(\d+s \+ 10s de folga\) excede HOOK_TIMEOUT=120s/],
      [{ HOOK_RUNTIME_ROLE_CMD: "/usr/local/bin/update-induscost-homolog-egress" }, /é o atualizador de egress; este hook nunca o executa/],
      [{ HOOK_GATEWAY_HEALTH: "'http://x;rm -rf /'" }, /HOOK_GATEWAY_HEALTH=.* não é uma URL/],
      [{ HOOK_CNPJ_POLICY: "ignore" }, /HOOK_CNPJ_POLICY='ignore'/],
      [{ HOOK_AWS_SSH_TARGET: "-oProxyCommand=x" }, /HOOK_AWS_SSH_TARGET=/],
      [{ HOOK_HTTP_ATTEMPTS: "50" }, /HOOK_HTTP_ATTEMPTS='50'/],
    ];
    for (const [o, re] of cases) {
      const h = host(o);
      const r = h.run("HOOKS_PRE_DEPLOY");
      assert.equal(r.code, 3, `${JSON.stringify(o)}\n${r.out}`);
      assert.match(r.out, re);
      assert.equal(h.calls(), "", "nenhuma sonda com configuração inválida");
      assert.equal(h.record(), "");
    }
    const post = host({ HOOK_TIMEOUT: "120" });
    assert.equal(post.run("HOOKS_POST_START").code, 10);
    const unknown = host();
    assert.equal(unknown.run("HOOKS_OUTRA").code, 3);
  });

  it("H12. --check manual: todas as sondas, nada gravado (nem contexto); reprova (1) se uma crítica falhar", () => {
    const h = host();
    const before = h.snapshot();
    const r = h.manual("--check");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /RESULTADO: --check OK .*nada foi gravado/);
    assert.match(r.out, new RegExp(`commit em execução na produção AWS .*${SHA_A}`));
    assert.deepEqual(h.snapshot(), before);
    assertReadOnlyCalls(h.calls());
    const f = host();
    f.fail(AWS);
    const rf = f.manual("--check");
    assert.equal(rf.code, 1, rf.out);
    assert.match(rf.out, /um deploy agora seria recusado/);
  });

  it("H13. código do hook: nenhum verbo de systemctl que altere estado, nenhum firewall, nenhuma execução do atualizador de egress, escrita só no contexto", () => {
    const code = readFileSync(HOOK, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    assert.doesNotMatch(code, /systemctl_cmd"?\s+(start|stop|restart|reload|enable|disable|daemon-reload|set-property|edit|mask|unmask|kill|reset-failed)\b/);
    assert.doesNotMatch(code, /\b(iptables|nft|ufw|firewall-cmd|ip6tables)\b/);
    assert.doesNotMatch(code, /(^|[;&|]\s*|\$\(\s*)\/usr\/local\/bin\/update-induscost-homolog-egress/m);
    assert.doesNotMatch(code, /\brm -rf\b|\bsudo\b|\brunuser\b|\bchmod\b|\bchown\b/);
    // Toda escrita em arquivo (>, mv) vai para o diretório do contexto.
    for (const m of code.matchAll(/>\s*"([^"]+)"/g)) assert.match(m[1]!, /^\$(ctx_file|tmp)$/, `escrita fora do contexto: ${m[0]}`);
    for (const m of code.matchAll(/mv -f "([^"]+)" "([^"]+)"/g)) assert.match(m[2]!, /^\$f$/);
    assert.match(code, /remote="git -C '\$aws_app_dir' rev-parse --verify HEAD"/, "comando remoto fixo e só leitura");
    assert.match(code, /-o UpdateHostKeys=no[\s\\]*-o ControlMaster=no -o ControlPath=none/, "ssh não regrava known_hosts nem deixa mestre");
  });

  // No servidor (Linux) o gate de deploy roda este arquivo: as conferências de dono/permissão do contexto valem lá.
  it("H14. (só Linux) contexto 0755 é recusado; registro gravável por grupo é recusado; 0700 deste usuário é aceito", { skip: process.platform !== "linux" ? "conferências de permissão só no Linux" : false }, () => {
    const h = host();
    assert.equal(h.run("HOOKS_PRE_DEPLOY").code, 0);
    assert.equal((statSync(join(h.ctx, "aws-commit.before")).mode & 0o777).toString(8), "600");
    chmodSync(join(h.ctx, "aws-commit.before"), 0o664);
    const g = h.run("HOOKS_POST_START");
    assert.equal(g.code, 10, g.out);
    assert.match(g.out, /com dono\/permissão inesperados/);
    const o = host();
    chmodSync(o.ctx, 0o755);
    const r = o.run("HOOKS_PRE_DEPLOY");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /precisa ser 0700 e deste usuário/);
    assert.equal(o.record(), "");
  });
});
