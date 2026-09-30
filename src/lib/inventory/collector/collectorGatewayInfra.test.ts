/**
 * Guarda a infraestrutura versionada do gateway do Collector
 * (infra/collector-gateway + scripts): variáveis por ambiente completas,
 * caminho real do vhost (sem sites-enabled), template com bind
 * exclusivo/deny all/header dedicado, drop-in com espera e restart, scripts
 * fail-fast e dry-run sem escrita. Não executa nada no host.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "..", "..", "..");
const INFRA = path.join(ROOT, "infra", "collector-gateway");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Só o que o shell executa: sem comentários e sem o texto das mensagens (die/warn/log/echo). */
const executable = (script: string) =>
  script
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => line.replace(/(die|warn|log|echo|info|ok|fail) "[^"]*"/g, ""))
    .join("\n");

const REQUIRED_KEYS = [
  "COLLECTOR_ENV",
  "COLLECTOR_TAILSCALE_HOSTNAME",
  "COLLECTOR_TAILSCALE_IP",
  "COLLECTOR_APP_PORT",
  "COLLECTOR_HTTPS_PORT",
  "COLLECTOR_TLS_DIR",
  "COLLECTOR_NGINX_CONFIG_PATH",
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

const prod = parseEnv(readFileSync(path.join(INFRA, "env", "production.env"), "utf8"));
const homolog = parseEnv(readFileSync(path.join(INFRA, "env", "homolog.env"), "utf8"));

describe("infra/collector-gateway — variáveis por ambiente", () => {
  for (const [name, env] of [["production", prod], ["homolog", homolog]] as const) {
    it(`${name}.env declara todas as variáveis, sem aspas, dentro da faixa Tailscale`, () => {
      for (const key of REQUIRED_KEYS) assert.ok(env[key], `${name}: ${key}`);
      assert.equal(env.COLLECTOR_ENV, name);
      assert.match(env.COLLECTOR_TAILSCALE_IP!, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/);
      assert.match(env.COLLECTOR_TAILSCALE_HOSTNAME!, /\.ts\.net$/);
      assert.match(env.COLLECTOR_APP_PORT!, /^\d+$/);
      assert.equal(env.COLLECTOR_HTTPS_PORT, "443", "os QR Codes apontam para 443");
      assert.ok(Number(env.COLLECTOR_TAILSCALE_WAIT_TIMEOUT) >= 60 && Number(env.COLLECTOR_TAILSCALE_WAIT_TIMEOUT) <= 300);
      for (const value of Object.values(env)) assert.doesNotMatch(value, /["'\s]/);
      assert.equal(env.COLLECTOR_NGINX_SITE, undefined, "variável antiga não pode voltar");
    });
  }

  it("produção usa o caminho REAL do vhost (conf.d), nunca sites-available/sites-enabled", () => {
    assert.equal(prod.COLLECTOR_NGINX_CONFIG_PATH, "/etc/nginx/conf.d/induscost-collector.conf");
    assert.equal(prod.COLLECTOR_TAILSCALE_HOSTNAME, "induscost-prod-saopaulo.tail31eb9e.ts.net");
    assert.equal(prod.COLLECTOR_TAILSCALE_IP, "100.85.97.124");
    assert.equal(prod.COLLECTOR_APP_PORT, "3000");
    assert.equal(prod.COLLECTOR_TLS_DIR, "/etc/induscost/collector-tls");
    assert.doesNotMatch(prod.COLLECTOR_NGINX_CONFIG_PATH!, /sites-(available|enabled)/);
  });

  it("homologação: servidor-01, IP 100.64.174.124, app 3001; TLS e vhost marcados CONFIGURE_ME até confirmação no host", () => {
    assert.equal(homolog.COLLECTOR_TAILSCALE_HOSTNAME, "servidor-01.tail31eb9e.ts.net");
    assert.equal(homolog.COLLECTOR_TAILSCALE_IP, "100.64.174.124");
    assert.equal(homolog.COLLECTOR_APP_PORT, "3001", "a :3000 do servidor-01 é o gateway de produção");
    assert.equal(homolog.COLLECTOR_TLS_DIR, "CONFIGURE_ME");
    assert.equal(homolog.COLLECTOR_NGINX_CONFIG_PATH, "CONFIGURE_ME");
    assert.notEqual(prod.COLLECTOR_TAILSCALE_IP, homolog.COLLECTOR_TAILSCALE_IP);
    assert.notEqual(prod.COLLECTOR_TAILSCALE_HOSTNAME, homolog.COLLECTOR_TAILSCALE_HOSTNAME);
  });
});

describe("infra/collector-gateway — template do Nginx", () => {
  const template = readFileSync(path.join(INFRA, "nginx", "induscost-collector.conf.template"), "utf8");

  it("renderiza sem placeholder sobrando e reproduz a configuração vigente de produção", () => {
    const rendered = render(template, prod);
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

describe("infra/collector-gateway — systemd", () => {
  const dropin = readFileSync(path.join(INFRA, "systemd", "nginx.service.d", "induscost-tailscale.conf"), "utf8");
  const directives = dropin.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));

  it("ordena após tailscaled, espera o IP, tem timeout finito e restart — e só ACRESCENTA ao unit do pacote", () => {
    assert.deepEqual(directives, [
      "[Unit]",
      "Wants=network-online.target tailscaled.service",
      "After=network-online.target tailscaled.service",
      "StartLimitIntervalSec=1800",
      "StartLimitBurst=10",
      "[Service]",
      "EnvironmentFile=-/etc/induscost/collector-gateway.env",
      "ExecStartPre=/usr/local/lib/induscost/wait-for-tailscale.sh",
      "TimeoutStartSec=180",
      "Restart=on-failure",
      "RestartSec=10",
    ]);
    // StartLimit* na seção [Unit] (systemd >= 230); nenhuma lista do pacote é apagada.
    const unitSection = directives.slice(directives.indexOf("[Unit]"), directives.indexOf("[Service]"));
    assert.ok(unitSection.includes("StartLimitIntervalSec=1800") && unitSection.includes("StartLimitBurst=10"));
    for (const cleared of ["ExecStartPre=", "ExecStart=", "ExecReload=", "ExecStop=", "After=", "Wants="]) {
      assert.ok(!directives.includes(cleared), `${cleared} vazio apagaria a lista do pacote`);
    }
    assert.ok(!directives.some((line) => /^(Type|PIDFile|ExecStart|ExecReload|ExecStop)=/.test(line)), "nada do unit original é substituído");
    const timeout = Number(directives.find((line) => line.startsWith("TimeoutStartSec="))!.split("=")[1]);
    assert.ok(timeout > Number(prod.COLLECTOR_TAILSCALE_WAIT_TIMEOUT), "TimeoutStartSec precisa cobrir a espera");
  });
});

describe("infra/collector-gateway — wait script", () => {
  const wait = readFileSync(path.join(INFRA, "bin", "wait-for-tailscale.sh"), "utf8");
  const code = executable(wait);

  it("decide pelo IP no kernel + tailscaled ativo; CLI do Tailscale só diagnostica; timeout finito", () => {
    assert.match(wait, /^set -euo pipefail$/m);
    assert.match(wait, /COLLECTOR_TAILSCALE_WAIT_TIMEOUT:-120/);
    assert.match(code, /ip -4 -o addr show/);
    assert.match(code, /systemctl is-active --quiet tailscaled/);
    assert.match(code, /deadline/);
    assert.match(code, /exit 1/);
    assert.doesNotMatch(code, /tailscale up/);
    // BackendState e tailscale ip -4 só dentro de diagnostic(); a decisão (iface_with_ip/tailscaled_active) não os usa.
    const decision = code.slice(code.indexOf("iface_with_ip()"), code.indexOf("diagnostic()"));
    assert.doesNotMatch(decision, /BackendState|tailscale ip/);
    const loop = code.slice(code.indexOf("while :; do"));
    assert.match(loop, /iface_with_ip/);
    assert.match(loop, /tailscaled_active/);
    assert.doesNotMatch(loop.replace(/\$\(diagnostic\)/g, ""), /BackendState|tailscale ip -4/);
  });
});

describe("infra/collector-gateway — instalador e health check", () => {
  const install = read("scripts/install-collector-gateway.sh");
  const installCode = executable(install);
  const check = read("scripts/check-collector-gateway.sh");
  const checkCode = executable(check);
  /** Fluxo principal (depois do bloco --rollback), para não confundir com as funções auxiliares. */
  const rollbackBlock = installCode.indexOf("if (( ROLLBACK )); then");
  const mainStart = installCode.indexOf("\nfi\n", rollbackBlock) + 4;
  const main = installCode.slice(mainStart);

  it("instalador: caminho real do vhost, sem criar sites-enabled, recusa CONFIGURE_ME e homolog na :3000", () => {
    assert.match(install, /^set -euo pipefail$/m);
    assert.match(installCode, /COLLECTOR_NGINX_CONFIG_PATH/);
    assert.doesNotMatch(installCode, /COLLECTOR_NGINX_SITE/);
    assert.doesNotMatch(installCode, /sites-enabled|sites-available|ln -s/);
    assert.match(installCode, /CONFIGURE_ME/);
    assert.match(installCode, /"\$COLLECTOR_ENV" == "homolog" && "\$COLLECTOR_APP_PORT" == "3000"/);
    // Duplicidade de server block em qualquer outro arquivo do Nginx aborta antes de escrever.
    assert.match(installCode, /grep -RlsE "server_name\[\[:space:\]\]\+\$COLLECTOR_TAILSCALE_HOSTNAME\|listen/);
  });

  it("instalador: ordem render → validar → dry-run → backup → trap → instalar → daemon-reload → nginx -t → reload → health check", () => {
    const order = [
      'RENDERED="$TMP_DIR/site.conf"',
      '! grep -q "__COLLECTOR_" "$RENDERED"',
      "if (( DRY_RUN )); then\n",
      "exit 0",
      'BACKUP_DIR="$BACKUP_ROOT/$STAMP"',
      'mkdir -p "$BACKUP_DIR"',
      "on_error() {",
      'restore_from "$BACKUP_DIR"',
      "trap on_error ERR",
      'install -m 0755 "$INFRA_DIR/bin/wait-for-tailscale.sh" "$WAIT_TARGET"',
      'install -m 0644 "$TMP_DIR/env" "$ENV_TARGET"',
      'install -m 0644 "$INFRA_DIR/systemd/nginx.service.d/induscost-tailscale.conf" "$DROPIN_TARGET"',
      'install -m 0644 "$RENDERED" "$SITE_PATH"',
      "systemctl daemon-reload",
      "nginx -t",
      "systemctl reload nginx",
      "systemctl restart nginx",
      "INSTALLED=1",
      'bash "$SCRIPT_DIR/check-collector-gateway.sh"',
    ];
    // O 1.º "if (( DRY_RUN ))" (antes do render) só relaxa a exigência de root; o bloco de saída vem depois do render.
    let cursor = 0;
    for (const step of order) {
      const index = main.indexOf(step, cursor);
      assert.ok(index >= cursor, `fora de ordem ou ausente: ${step}`);
      cursor = index + step.length;
    }
  });

  it("dry-run sai antes de qualquer escrita (backup, /etc, /usr/local, systemd, vhost)", () => {
    const firstDry = main.indexOf("if (( DRY_RUN )); then\n");
    const dry = main.indexOf("if (( DRY_RUN )); then\n", firstDry + 1);
    const dryExit = main.indexOf("exit 0", dry);
    assert.ok(dry > 0 && dryExit > dry);
    const beforeDry = main.slice(0, dry);
    assert.doesNotMatch(beforeDry, /mkdir -p "\$(BACKUP_DIR|ETC_DIR)|install -m|cp -a|systemctl daemon-reload|systemctl (reload|restart)|trap on_error/);
    // No dry-run só há escrita em diretório temporário (mktemp), removido antes de sair.
    const dryBlock = main.slice(dry, dryExit);
    assert.match(dryBlock, /rm -rf "\$TMP_DIR"/);
    assert.doesNotMatch(dryBlock, /install -m|cp -a|mkdir -p/);
    assert.match(main.slice(dryExit), /mkdir -p "\$BACKUP_DIR"/);
  });

  it("instalador não toca app, banco, firewall, Tailscale, DNS ou certificados; rollback restaura o mesmo caminho", () => {
    // Só comandos executados (início de linha ou após ; | && ||); "tailscale cert" aparece apenas em mensagens.
    const commands = installCode
      .split("\n")
      .flatMap((line) => line.split(/;|&&|\|\||\|/))
      .map((part) => part.trim())
      .filter(Boolean);
    for (const cmd of commands) {
      assert.doesNotMatch(cmd, /^(sudo )?(systemctl (stop|restart|start|reload) induscost|npx prisma|prisma |ufw |iptables |tailscale (up|cert)|certbot )/, cmd);
    }
    const restore = installCode.slice(installCode.indexOf("restore_from() {"), rollbackBlock);
    assert.match(restore, /site\.path/);
    assert.match(restore, /cp -a "\$dir\/site\.conf" "\$site_path"/);
    assert.match(restore, /rm -f "\$site_path"/);
    assert.match(restore, /rm -f "\$DROPIN_TARGET"/);
    // O trap restaura o backup e valida com nginx -t antes de qualquer reload.
    const onError = main.slice(main.indexOf("on_error() {"), main.indexOf("set -E"));
    assert.match(onError, /restore_from "\$BACKUP_DIR"/);
    assert.match(onError, /nginx -t/);
  });

  it("health check cobre tailscaled, IP, nginx, nginx -t, listen, app, certificado (subject/issuer/datas/dias) e HTTPS com SNI sem -k", () => {
    assert.match(check, /RESULTADO: OK/);
    assert.match(check, /RESULTADO: FAIL/);
    for (const needle of [
      "systemctl is-active --quiet tailscaled",
      "ip -4 -o addr show",
      "systemctl is-active --quiet nginx",
      "nginx -t",
      "X-IndusCost-Tailscale-Peer",
      "ss -lntp",
      "/api/health",
      "-subject",
      "-issuer",
      "-startdate",
      "-enddate",
      "dia(s)",
      "subjectAltName",
      "--resolve",
      "200|301|302|303|307|308",
      "COLLECTOR_NGINX_CONFIG_PATH",
    ]) {
      assert.ok(checkCode.includes(needle) || check.includes(needle), needle);
    }
    // O teste principal de HTTPS não usa -k; o modo inseguro aparece só como informação após falha.
    const mainCurl = check.slice(check.indexOf('\n  code="$(curl'), check.indexOf('case "$code"'));
    assert.ok(mainCurl.length > 0);
    assert.doesNotMatch(mainCurl, /-k|--insecure/);
    assert.doesNotMatch(checkCode, /systemctl (restart|start|stop|reload)/);
  });

  it("a documentação operacional cobre o caminho real, CONFIGURE_ME, o comportamento a validar, rollback e reboot", () => {
    const doc = read("docs/collector-gateway-tailscale-nginx.md");
    for (const needle of [
      "/etc/nginx/conf.d/induscost-collector.conf",
      "COLLECTOR_NGINX_CONFIG_PATH",
      "CONFIGURE_ME",
      "COMPORTAMENTO A VALIDAR EM HOMOLOGAÇÃO",
      "systemctl restart tailscaled",
      "systemctl cat nginx",
      "install-collector-gateway.sh",
      "check-collector-gateway.sh",
      "--rollback",
      "reboot",
      "Cannot assign requested address",
      "X-IndusCost-Tailscale-Peer",
    ]) {
      assert.ok(doc.includes(needle), needle);
    }
    assert.doesNotMatch(doc, /COLLECTOR_NGINX_SITE/);
  });
});
