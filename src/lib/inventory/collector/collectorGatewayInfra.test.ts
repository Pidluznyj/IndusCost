/**
 * Guarda a infraestrutura versionada do gateway do Collector
 * (infra/collector-gateway + scripts): variáveis por ambiente completas,
 * template com bind exclusivo/deny all/header dedicado, drop-in com espera e
 * restart, scripts fail-fast. Não executa nada no host.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "..", "..", "..");
const INFRA = path.join(ROOT, "infra", "collector-gateway");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Só o que o shell executa: sem comentários e sem o texto das mensagens (die/warn/log). */
const executable = (script: string) =>
  script
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => line.replace(/(die|warn|log|echo) "[^"]*"/g, ""))
    .join("\n");

const REQUIRED_KEYS = [
  "COLLECTOR_ENV",
  "COLLECTOR_TAILSCALE_HOSTNAME",
  "COLLECTOR_TAILSCALE_IP",
  "COLLECTOR_APP_PORT",
  "COLLECTOR_HTTPS_PORT",
  "COLLECTOR_TLS_DIR",
  "COLLECTOR_NGINX_SITE",
  "COLLECTOR_TAILSCALE_WAIT_TIMEOUT",
];

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    out[key!] = rest.join("=");
  }
  return out;
}

function render(template: string, env: Record<string, string>): string {
  return template.replace(/__([A-Z_]+)__/g, (_match, key: string) => env[key] ?? `__${key}__`);
}

describe("infra/collector-gateway — variáveis por ambiente", () => {
  for (const name of ["production", "homolog"]) {
    it(`${name}.env declara todas as variáveis, sem aspas, dentro da faixa Tailscale`, () => {
      const env = parseEnv(readFileSync(path.join(INFRA, "env", `${name}.env`), "utf8"));
      for (const key of REQUIRED_KEYS) assert.ok(env[key], `${name}: ${key}`);
      assert.equal(env.COLLECTOR_ENV, name);
      assert.match(env.COLLECTOR_TAILSCALE_IP!, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/);
      assert.match(env.COLLECTOR_TAILSCALE_HOSTNAME!, /\.ts\.net$/);
      assert.match(env.COLLECTOR_APP_PORT!, /^\d+$/);
      assert.equal(env.COLLECTOR_HTTPS_PORT, "443", "os QR Codes apontam para 443");
      assert.ok(Number(env.COLLECTOR_TAILSCALE_WAIT_TIMEOUT) >= 60 && Number(env.COLLECTOR_TAILSCALE_WAIT_TIMEOUT) <= 300);
      for (const value of Object.values(env)) assert.doesNotMatch(value, /["'\s]/);
    });
  }

  it("produção e homologação apontam para hosts, IPs e portas diferentes (a :3000 do servidor-01 é o gateway de produção)", () => {
    const prod = parseEnv(readFileSync(path.join(INFRA, "env", "production.env"), "utf8"));
    const homolog = parseEnv(readFileSync(path.join(INFRA, "env", "homolog.env"), "utf8"));
    assert.notEqual(prod.COLLECTOR_TAILSCALE_IP, homolog.COLLECTOR_TAILSCALE_IP);
    assert.notEqual(prod.COLLECTOR_TAILSCALE_HOSTNAME, homolog.COLLECTOR_TAILSCALE_HOSTNAME);
    assert.equal(prod.COLLECTOR_APP_PORT, "3000");
    assert.equal(homolog.COLLECTOR_APP_PORT, "3001");
    assert.equal(prod.COLLECTOR_TAILSCALE_HOSTNAME, "induscost-prod-saopaulo.tail31eb9e.ts.net");
    assert.equal(prod.COLLECTOR_TAILSCALE_IP, "100.85.97.124");
  });
});

describe("infra/collector-gateway — template do Nginx", () => {
  const template = readFileSync(path.join(INFRA, "nginx", "induscost-collector.conf.template"), "utf8");

  it("renderiza sem placeholder sobrando e reproduz a configuração vigente de produção", () => {
    const env = parseEnv(readFileSync(path.join(INFRA, "env", "production.env"), "utf8"));
    const rendered = render(template, env);
    assert.doesNotMatch(rendered, /__COLLECTOR_/);
    const directives = rendered
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    assert.deepEqual(directives, [
      "server {",
      "listen 100.85.97.124:443 ssl;",
      "server_name induscost-prod-saopaulo.tail31eb9e.ts.net;",
      "ssl_certificate     /etc/induscost/collector-tls/induscost-prod-saopaulo.tail31eb9e.ts.net.crt;",
      "ssl_certificate_key /etc/induscost/collector-tls/induscost-prod-saopaulo.tail31eb9e.ts.net.key;",
      "ssl_protocols TLSv1.2 TLSv1.3;",
      "allow 100.64.0.0/10;",
      "deny all;",
      "location / {",
      "proxy_pass http://127.0.0.1:3000;",
      "proxy_http_version 1.1;",
      "proxy_set_header Host $host;",
      "proxy_set_header X-Forwarded-Proto https;",
      "proxy_set_header X-Forwarded-Host $host;",
      "proxy_set_header X-Forwarded-Port 443;",
      "proxy_set_header X-IndusCost-Tailscale-Peer $remote_addr;",
      'proxy_set_header X-Forwarded-For "";',
      'proxy_set_header X-Real-IP "";',
      'proxy_set_header CF-Connecting-IP "";',
      "}",
      "}",
    ]);
  });

  it("nunca escuta em 0.0.0.0 e não usa tailscale serve", () => {
    assert.doesNotMatch(template, /listen\s+(0\.0\.0\.0|\[::\]|443\b)/);
    assert.doesNotMatch(template, /tailscale serve|funnel/);
    assert.match(template, /listen __COLLECTOR_TAILSCALE_IP__:__COLLECTOR_HTTPS_PORT__ ssl;/);
  });
});

describe("infra/collector-gateway — systemd e scripts", () => {
  it("drop-in ordena após tailscaled, espera o IP, tem timeout finito e restart", () => {
    const dropin = readFileSync(path.join(INFRA, "systemd", "nginx.service.d", "induscost-tailscale.conf"), "utf8");
    assert.match(dropin, /^\[Unit\]/m);
    assert.match(dropin, /^Wants=network-online\.target tailscaled\.service$/m);
    assert.match(dropin, /^After=network-online\.target tailscaled\.service$/m);
    assert.match(dropin, /^StartLimitBurst=\d+$/m);
    assert.match(dropin, /^\[Service\]/m);
    assert.match(dropin, /^EnvironmentFile=-\/etc\/induscost\/collector-gateway\.env$/m);
    assert.match(dropin, /^ExecStartPre=\/usr\/local\/lib\/induscost\/wait-for-tailscale\.sh$/m);
    assert.match(dropin, /^TimeoutStartSec=(1[5-9]\d|[2-9]\d\d)$/m);
    assert.match(dropin, /^Restart=on-failure$/m);
    assert.match(dropin, /^RestartSec=\d+$/m);
    // Não substitui o unit do pacote: nada de ExecStart= nem ExecStartPre= vazio.
    assert.doesNotMatch(dropin, /^ExecStart=/m);
    assert.doesNotMatch(dropin, /^ExecStartPre=$/m);
  });

  it("wait-for-tailscale: sem loop infinito, timeout configurável, três verificações", () => {
    const wait = readFileSync(path.join(INFRA, "bin", "wait-for-tailscale.sh"), "utf8");
    assert.match(wait, /^set -euo pipefail$/m);
    assert.match(wait, /COLLECTOR_TAILSCALE_WAIT_TIMEOUT:-120/);
    assert.match(wait, /BackendState/);
    assert.match(wait, /tailscale ip -4/);
    assert.match(wait, /ip -4 addr show dev/);
    assert.match(wait, /deadline/);
    assert.match(wait, /exit 1/);
    assert.doesNotMatch(executable(wait), /tailscale up/);
  });

  it("instalador e health check são fail-fast e não tocam app, banco, firewall ou Tailscale", () => {
    const install = read("scripts/install-collector-gateway.sh");
    assert.match(install, /^set -euo pipefail$/m);
    assert.match(install, /--dry-run/);
    assert.match(install, /--rollback/);
    assert.match(install, /nginx -t/);
    assert.match(install, /systemctl daemon-reload/);
    assert.match(install, /X-IndusCost-Tailscale-Peer \\\$remote_addr/);
    assert.match(install, /BACKUP_ROOT=/);
    assert.doesNotMatch(executable(install), /systemctl (stop|restart|start) induscost|prisma|migrate|ufw|iptables|tailscale up|tailscale cert|certbot/);
    const check = read("scripts/check-collector-gateway.sh");
    assert.match(check, /RESULTADO: OK/);
    assert.match(check, /RESULTADO: FAIL/);
    assert.match(check, /--resolve/);
    assert.match(check, /-checkend/);
    assert.doesNotMatch(check, /systemctl (restart|start|stop|reload)/);
  });

  it("a documentação operacional existe e cobre instalação, health check, rollback e reboot", () => {
    const doc = read("docs/collector-gateway-tailscale-nginx.md");
    for (const needle of ["install-collector-gateway.sh", "check-collector-gateway.sh", "--rollback", "reboot", "Cannot assign requested address", "X-IndusCost-Tailscale-Peer"]) {
      assert.ok(doc.includes(needle), needle);
    }
  });
});
