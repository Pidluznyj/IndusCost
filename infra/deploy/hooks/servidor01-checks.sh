#!/usr/bin/env bash
# Hook de segurança do executor versionado para o servidor-01 (homologação) — SOMENTE LEITURA.
#
# Preserva as verificações críticas do executor antigo (/usr/local/bin/deploy-induscost-homologacao), sem alterar
# nada: papel do servidor (induscost-runtime-role get = CLOUD_PRIMARY), produção Node local desligada, Nginx ativo,
# gateway e produção AWS respondendo, commit da produção AWS (lido por SSH) igual antes e depois do deploy da
# homologação, e alcance da BrasilAPI e da publica.cnpj.ws.
#
# NUNCA: altera firewall, allowlist, drop-in ou unidade do systemd, reinicia ou para serviço, executa
# /usr/local/bin/update-induscost-homolog-egress, escreve na AWS (o SSH só executa `git rev-parse` no checkout da
# produção) ou grava fora de IDS_HOOK_CONTEXT_DIR. systemctl só com is-active/show.
#
# Uso pelo executor (listado em HOOKS_PRE_DEPLOY, HOOKS_POST_START e HOOKS_POST_ROLLBACK como
# @release/hooks/servidor01-checks.sh): a fase vem de IDS_DEPLOY_PHASE e a configuração (chaves HOOK_*) do mesmo
# arquivo de ambiente do executor (IDS_ENV_FILE).
#
# Uso manual (só leitura, nada é gravado):
#   servidor01-checks.sh --validate --env-file /etc/induscost/deploy-executor-homologacao.env   configuração, sem rede
#   servidor01-checks.sh --check    --env-file /etc/induscost/deploy-executor-homologacao.env   todas as verificações
#
# Política (docs/deploy/hooks-servidor01.md):
#   - Críticas (papel, produção local, Nginx, gateway, AWS, commit AWS): cada sonda de rede tem prazo e novas
#     tentativas (HOOK_HTTP_*/HOOK_SSH_*); só falha se TODAS falharem. Antes do deploy, falha = deploy recusado antes
#     de qualquer alteração (executor sai com 9). Depois da subida, falha = ALERTA (saída 10: o executor conclui sem
#     rollback e termina com 59), pois um rollback da homologação não corrige a produção; HOOK_PROD_POST_POLICY=rollback
#     transforma em falha comum (rollback pela política do executor).
#   - BrasilAPI/publica.cnpj.ws (terceiros, intermitentes): HOOK_CNPJ_POLICY=warn (padrão) só avisa; fail recusa
#     antes do deploy e vira ALERTA depois. A cobertura do egress do serviço (IPAddressAllow) é conferida por leitura;
#     corrigir é decisão do operador (o atualizador de egress reinicia a homologação).
#   - O pior caso de tempo somado (todas as tentativas estourando o prazo) precisa caber em HOOK_TIMEOUT: senão a
#     configuração é recusada (3) — o executor nunca mata o hook no meio de uma sonda.
#
# Saídas: 0 ok; 1 falha (antes do deploy: recusa; depois: política); 3 configuração/uso inválido; 10 ALERTA.
set -Euo pipefail

say() { echo "[hook servidor-01] $*"; }

mode=phase
env_file="${IDS_ENV_FILE:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) mode=check; shift ;;
    --validate) mode=validate; shift ;;
    --env-file) env_file="${2:-}"; shift 2 || { say "ERRO: --env-file sem arquivo"; exit 3; } ;;
    *) say "ERRO: opção desconhecida $1 (use --check|--validate --env-file <arquivo>)"; exit 3 ;;
  esac
done
if [[ -z "$env_file" || ! -r "$env_file" ]]; then
  say "ERRO: arquivo de ambiente ilegível: '${env_file}' (IDS_ENV_FILE ou --env-file)"
  exit 3
fi
if [[ "$mode" == phase ]]; then
  phase="${IDS_DEPLOY_PHASE:-}"
  case "$phase" in
    HOOKS_PRE_DEPLOY|HOOKS_POST_START|HOOKS_POST_ROLLBACK) ;;
    *) say "ERRO: fase desconhecida '${phase}' (o executor informa IDS_DEPLOY_PHASE; à mão use --check)"; exit 3 ;;
  esac
else
  phase="$mode"
fi

# shellcheck disable=SC1090
set +u
source "$env_file"
set -u

systemctl_cmd="${IDS_SYSTEMCTL:-systemctl}"
curl_cmd="${HOOK_CURL:-curl}"
ssh_cmd="${HOOK_SSH:-ssh}"
getent_cmd="${HOOK_GETENT:-getent}"
timeout_cmd="${IDS_TIMEOUT:-timeout}"

role_cmd="${HOOK_RUNTIME_ROLE_CMD:-}"
role_expected="${HOOK_RUNTIME_ROLE_EXPECTED:-}"
role_check_args="${HOOK_RUNTIME_ROLE_CHECK_ARGS:-}"
local_prod_service="${HOOK_LOCAL_PROD_SERVICE:-}"
nginx_service="${HOOK_NGINX_SERVICE:-}"
gateway_url="${HOOK_GATEWAY_HEALTH:-}"
aws_url="${HOOK_AWS_HEALTH:-}"
aws_ssh_target="${HOOK_AWS_SSH_TARGET:-}"
aws_app_dir="${HOOK_AWS_APP_DIR:-}"
cnpj_urls="${HOOK_CNPJ_URLS:-}"
cnpj_policy="${HOOK_CNPJ_POLICY:-warn}"
post_policy="${HOOK_PROD_POST_POLICY:-alert}"
http_attempts="${HOOK_HTTP_ATTEMPTS:-3}"
http_timeout="${HOOK_HTTP_TIMEOUT:-10}"
retry_delay="${HOOK_RETRY_DELAY:-5}"
ssh_attempts="${HOOK_SSH_ATTEMPTS:-2}"
ssh_timeout="${HOOK_SSH_TIMEOUT:-15}"
cnpj_attempts="${HOOK_CNPJ_ATTEMPTS:-2}"
cnpj_timeout="${HOOK_CNPJ_TIMEOUT:-10}"
cmd_timeout="${HOOK_COMMAND_TIMEOUT:-10}"
hook_budget="${HOOK_TIMEOUT:-300}"
app_service="${SERVICE:-}"

# ---------------------------------------------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------------------------------------------
config_errors=0
config_error() { say "ERRO de configuração: $*"; config_errors=$((config_errors + 1)); }
re_unit='^[A-Za-z0-9@_:.][A-Za-z0-9@_:.-]*$'
re_url='^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'
is_int_in() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= $2 && $1 <= $3 )); }

validate_config() {
  local k v u
  for k in HOOK_RUNTIME_ROLE_CMD HOOK_RUNTIME_ROLE_EXPECTED HOOK_RUNTIME_ROLE_CHECK_ARGS HOOK_LOCAL_PROD_SERVICE HOOK_NGINX_SERVICE \
    HOOK_GATEWAY_HEALTH HOOK_AWS_HEALTH HOOK_AWS_SSH_TARGET HOOK_AWS_APP_DIR HOOK_CNPJ_URLS SERVICE; do
    v="${!k:-}"
    if [[ -z "$v" || "$v" == *A_COLETAR* ]]; then config_error "$k ausente ou A_COLETAR"; fi
  done
  (( config_errors == 0 )) || return 0
  if [[ "$role_cmd" != /* ]]; then config_error "HOOK_RUNTIME_ROLE_CMD='$role_cmd' precisa de caminho absoluto"; fi
  [[ "$role_expected" =~ ^[A-Z][A-Z0-9_]*$ ]] || config_error "HOOK_RUNTIME_ROLE_EXPECTED='$role_expected' (ex.: CLOUD_PRIMARY)"
  [[ "$role_check_args" == none || "$role_check_args" =~ ^[A-Za-z0-9_][A-Za-z0-9_\ -]*$ ]] || config_error "HOOK_RUNTIME_ROLE_CHECK_ARGS='$role_check_args' (argumentos de 'check' ou none)"
  for u in "$local_prod_service" "$nginx_service" "$app_service"; do
    [[ "$u" =~ $re_unit ]] || config_error "nome de unidade inválido: '$u'"
  done
  [[ "$gateway_url" =~ $re_url ]] || config_error "HOOK_GATEWAY_HEALTH='$gateway_url' não é uma URL http(s) simples"
  [[ "$aws_url" =~ $re_url ]] || config_error "HOOK_AWS_HEALTH='$aws_url' não é uma URL http(s) simples"
  [[ "$aws_ssh_target" =~ ^[A-Za-z0-9_][A-Za-z0-9._@-]*$ ]] || config_error "HOOK_AWS_SSH_TARGET='$aws_ssh_target' (usuário@host ou alias do ~/.ssh/config do root)"
  [[ "$aws_app_dir" =~ ^/[A-Za-z0-9._/-]+$ ]] || config_error "HOOK_AWS_APP_DIR='$aws_app_dir' (caminho absoluto simples)"
  local -a urls
  read -r -a urls <<< "$cnpj_urls"
  (( ${#urls[@]} > 0 )) || config_error "HOOK_CNPJ_URLS vazio"
  for u in "${urls[@]}"; do [[ "$u" =~ $re_url && "$u" == https://* ]] || config_error "HOOK_CNPJ_URLS: '$u' não é uma URL https simples"; done
  case "$cnpj_policy" in warn|fail) ;; *) config_error "HOOK_CNPJ_POLICY='$cnpj_policy' (warn | fail)" ;; esac
  case "$post_policy" in alert|rollback) ;; *) config_error "HOOK_PROD_POST_POLICY='$post_policy' (alert | rollback)" ;; esac
  is_int_in "$http_attempts" 1 5 || config_error "HOOK_HTTP_ATTEMPTS='$http_attempts' (1–5)"
  is_int_in "$http_timeout" 1 60 || config_error "HOOK_HTTP_TIMEOUT='$http_timeout' (1–60 s)"
  is_int_in "$retry_delay" 0 30 || config_error "HOOK_RETRY_DELAY='$retry_delay' (0–30 s)"
  is_int_in "$ssh_attempts" 1 3 || config_error "HOOK_SSH_ATTEMPTS='$ssh_attempts' (1–3)"
  is_int_in "$ssh_timeout" 1 30 || config_error "HOOK_SSH_TIMEOUT='$ssh_timeout' (1–30 s)"
  is_int_in "$cnpj_attempts" 1 3 || config_error "HOOK_CNPJ_ATTEMPTS='$cnpj_attempts' (1–3)"
  is_int_in "$cnpj_timeout" 1 30 || config_error "HOOK_CNPJ_TIMEOUT='$cnpj_timeout' (1–30 s)"
  is_int_in "$cmd_timeout" 1 60 || config_error "HOOK_COMMAND_TIMEOUT='$cmd_timeout' (1–60 s)"
  is_int_in "$hook_budget" 10 3600 || config_error "HOOK_TIMEOUT='$hook_budget' (10–3600 s)"
  # O atualizador de egress reinicia a homologação: nenhum comando configurado pode ser ele.
  for v in "$role_cmd" "$systemctl_cmd" "$curl_cmd" "$ssh_cmd" "$getent_cmd" "$timeout_cmd"; do
    [[ "$(basename -- "${v%% *}")" == update-induscost-*egress* ]] && config_error "'$v' é o atualizador de egress; este hook nunca o executa"
  done
  (( config_errors == 0 )) || return 0
  # Pior caso: cada sonda estoura o prazo em todas as tentativas, com as esperas entre elas.
  local worst
  worst=$(( cmd_timeout * (1 + 3) ))
  [[ "$role_check_args" != none ]] && worst=$(( worst + cmd_timeout ))
  worst=$(( worst + 2 * (http_attempts * http_timeout + (http_attempts - 1) * retry_delay) ))
  worst=$(( worst + ssh_attempts * (2 * ssh_timeout) + (ssh_attempts - 1) * retry_delay ))
  worst=$(( worst + ${#urls[@]} * (cnpj_attempts * cnpj_timeout + (cnpj_attempts - 1) * retry_delay) ))
  worst=$(( worst + cmd_timeout * (1 + ${#urls[@]}) ))
  if (( worst + 10 > hook_budget )); then
    config_error "pior caso das sondas (${worst}s + 10s de folga) excede HOOK_TIMEOUT=${hook_budget}s; reduzir tentativas/prazos ou aumentar HOOK_TIMEOUT"
  else
    say "pior caso das sondas: ${worst}s (HOOK_TIMEOUT=${hook_budget}s)"
  fi
}

# ---------------------------------------------------------------------------------------------------------------
# Sondas (todas só leitura)
# ---------------------------------------------------------------------------------------------------------------
trim() { local s="${1//$'\r'/}"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }
critical_failures=0
critical_fail() { say "FALHA crítica: $*"; critical_failures=$((critical_failures + 1)); }
cnpj_problems=0
cnpj_problem() { say "$([[ "$cnpj_policy" == fail ]] && echo "FALHA" || echo "ATENÇÃO") CNPJ: $*"; cnpj_problems=$((cnpj_problems + 1)); }

check_runtime_role() {
  local out rc=0
  # Só a saída padrão é comparada: avisos no stderr (locale, sudo) vão para o log, não reprovam o papel.
  out="$($timeout_cmd "$cmd_timeout" "$role_cmd" get)" || rc=$?
  out="$(trim "$out")"
  if [[ "$rc" != 0 ]]; then critical_fail "$role_cmd get falhou (RC=$rc): ${out:0:200}"; return; fi
  if [[ "$out" != "$role_expected" ]]; then critical_fail "papel do servidor '${out:0:200}' ≠ esperado '$role_expected' ($role_cmd get)"; return; fi
  say "OK    papel do servidor: $out"
  if [[ "$role_check_args" != none ]]; then
    local -a args
    read -r -a args <<< "$role_check_args"
    rc=0
    out="$($timeout_cmd "$cmd_timeout" "$role_cmd" check "${args[@]}" 2>&1)" || rc=$?
    if [[ "$rc" != 0 ]]; then critical_fail "$role_cmd check $role_check_args recusou (RC=$rc): $(trim "${out:0:200}")"; return; fi
    say "OK    $role_cmd check $role_check_args"
  fi
}

unit_state() {
  local st
  st="$($timeout_cmd "$cmd_timeout" "$systemctl_cmd" is-active "$1" 2>/dev/null | head -n 1)" || true
  st="$(trim "$st")"
  printf '%s' "${st:-unknown}"
}

# Desligada = unidade EXISTENTE (LoadState loaded/masked) e explicitamente inactive/failed. Sonda ilegível, prazo
# estourado ou unidade inexistente (nome errado em HOOK_LOCAL_PROD_SERVICE) reprovam: nunca contam como "desligada".
check_local_production_off() {
  local st load
  load="$($timeout_cmd "$cmd_timeout" "$systemctl_cmd" show -p LoadState --value -- "$local_prod_service" 2>/dev/null | head -n 1)" || true
  load="$(trim "$load")"
  case "$load" in
    loaded|masked) ;;
    not-found) critical_fail "unidade $local_prod_service não existe (LoadState=not-found): conferir HOOK_LOCAL_PROD_SERVICE com o executor antigo"; return ;;
    *) critical_fail "estado de carga de $local_prod_service ilegível (LoadState='${load}'): não dá para afirmar que a produção local está desligada"; return ;;
  esac
  st="$(unit_state "$local_prod_service")"
  case "$st" in
    inactive|failed) say "OK    produção Node local $local_prod_service desligada ($st; $load)" ;;
    active|activating|reloading|deactivating|refreshing) critical_fail "produção Node local $local_prod_service está '$st' (precisa estar desligada: a produção é a AWS)" ;;
    *) critical_fail "estado de $local_prod_service ilegível ('$st'): não dá para afirmar que a produção local está desligada" ;;
  esac
}

check_nginx_active() {
  local st
  st="$(unit_state "$nginx_service")"
  if [[ "$st" == active ]]; then say "OK    $nginx_service ativo"; else critical_fail "$nginx_service está '$st' (o gateway depende dele)"; fi
}

# URL responde 2xx dentro do prazo em alguma das tentativas?
http_ok() {
  local label="$1" url="$2" i rc
  for (( i = 1; i <= http_attempts; i++ )); do
    rc=0
    $curl_cmd -q -fsS -o /dev/null --connect-timeout "$(( http_timeout < 5 ? http_timeout : 5 ))" --max-time "$http_timeout" "$url" 2>/dev/null || rc=$?
    if [[ "$rc" == 0 ]]; then say "OK    $label respondeu ($url; tentativa $i/$http_attempts)"; return 0; fi
    say "      $label: tentativa $i/$http_attempts falhou (curl RC=$rc)"
    (( i < http_attempts )) && sleep "$retry_delay"
  done
  critical_fail "$label indisponível: $url não respondeu 2xx em $http_attempts tentativa(s) de até ${http_timeout}s"
  return 1
}

# Commit em execução na produção AWS (só leitura: git rev-parse no checkout). Imprime o SHA; ≠ 0 se ilegível.
read_aws_commit() {
  local i rc out sha remote
  remote="git -C '$aws_app_dir' rev-parse --verify HEAD"
  for (( i = 1; i <= ssh_attempts; i++ )); do
    rc=0
    # UpdateHostKeys=no: o ssh não regrava o known_hosts do root; ControlMaster=no/ControlPath=none: nenhum socket
    # nem processo mestre fica para trás (mesmo que o ~/.ssh/config do root os ative para o alias).
    out="$($timeout_cmd "$(( 2 * ssh_timeout ))" "$ssh_cmd" -n -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no \
      -o ControlMaster=no -o ControlPath=none -o "ConnectTimeout=$ssh_timeout" -o ServerAliveInterval=5 -o ServerAliveCountMax=2 \
      "$aws_ssh_target" "$remote" 2>/dev/null)" || rc=$?
    sha="$(trim "$out")"
    if [[ "$rc" == 0 && "$sha" =~ ^[0-9a-f]{40}$ ]]; then printf '%s\n' "$sha"; return 0; fi
    say "      commit AWS: tentativa $i/$ssh_attempts falhou (ssh RC=$rc)" >&2
    (( i < ssh_attempts )) && sleep "$retry_delay"
  done
  return 1
}

# IPv4 → inteiro; ≠ 0 se não for IPv4.
ip2int() {
  local IFS=. a b c d
  [[ "$1" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  read -r a b c d <<< "$1"
  a=$((10#$a)); b=$((10#$b)); c=$((10#$c)); d=$((10#$d))
  (( a <= 255 && b <= 255 && c <= 255 && d <= 255 )) || return 1
  echo $(( (a << 24) | (b << 16) | (c << 8) | d ))
}

# IPv4 dentro de algum prefixo da lista (IPv6 e entradas não reconhecidas são ignorados)?
ip_in_list() {
  local ip n net bits mask entry
  ip="$(ip2int "$1")" || return 1
  local -a entries
  read -r -a entries <<< "$2"
  for entry in "${entries[@]}"; do
    [[ "$entry" == *:* ]] && continue
    net="${entry%/*}"
    bits=32
    [[ "$entry" == */* ]] && bits="${entry#*/}"
    [[ "$bits" =~ ^[0-9]+$ ]] && (( bits <= 32 )) || continue
    n="$(ip2int "$net")" || continue
    mask=$(( bits == 0 ? 0 : (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF ))
    (( (ip & mask) == (n & mask) )) && return 0
  done
  return 1
}

check_cnpj_providers() {
  local -a urls
  local url code i host props deny allow ips ip
  read -r -a urls <<< "$cnpj_urls"
  for url in "${urls[@]}"; do
    code=000
    for (( i = 1; i <= cnpj_attempts; i++ )); do
      code="$($curl_cmd -q -sS -o /dev/null -w '%{http_code}' --connect-timeout "$(( cnpj_timeout < 5 ? cnpj_timeout : 5 ))" --max-time "$cnpj_timeout" "$url" 2>/dev/null)" || true
      code="$(trim "$code")"
      [[ "$code" =~ ^[1-4][0-9][0-9]$ ]] && break
      (( i < cnpj_attempts )) && sleep "$retry_delay"
    done
    # Qualquer resposta HTTP < 500 (inclusive 404/429) prova rede, DNS e TLS até o provedor; nenhum CNPJ é consultado.
    if [[ "$code" =~ ^[1-4][0-9][0-9]$ ]]; then say "OK    $url alcançável (HTTP $code)"; else cnpj_problem "$url indisponível a partir do host (HTTP ${code:-000}) após $cnpj_attempts tentativa(s)"; fi
  done
  # Egress do serviço (leitura), pela regra do systemd: o IP passa se estiver no IPAddressAllow ou fora do
  # IPAddressDeny. Sem a propriedade na saída (systemctl falhou), a cobertura NÃO foi conferida — nunca "OK".
  local prc=0
  props="$($timeout_cmd "$cmd_timeout" "$systemctl_cmd" show -p IPAddressDeny -p IPAddressAllow -- "$app_service" 2>/dev/null)" || prc=$?
  if [[ "$prc" != 0 ]] || ! printf '%s\n' "$props" | grep -q '^IPAddressDeny='; then
    cnpj_problem "cobertura do egress de $app_service não conferida (systemctl show RC=$prc, sem IPAddressDeny na saída)"
    return 0
  fi
  deny="$(trim "$(printf '%s\n' "$props" | sed -n 's/^IPAddressDeny=//p' | head -n 1)")"
  allow="$(trim "$(printf '%s\n' "$props" | sed -n 's/^IPAddressAllow=//p' | head -n 1)")"
  if [[ -z "$deny" ]]; then
    say "OK    $app_service sem IPAddressDeny: egress do serviço não restrito pelo systemd (cobertura não se aplica)"
    return 0
  fi
  for url in "${urls[@]}"; do
    host="${url#https://}"; host="${host%%/*}"; host="${host%%:*}"
    ips="$($timeout_cmd "$cmd_timeout" "$getent_cmd" ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u)" || ips=""
    if [[ -z "$ips" ]]; then cnpj_problem "DNS não resolveu $host (cobertura do egress não conferida)"; continue; fi
    for ip in $ips; do
      if ip_in_list "$ip" "$allow" || ! ip_in_list "$ip" "$deny"; then
        say "OK    egress de $app_service cobre $host ($ip)"
      else
        cnpj_problem "egress de $app_service NÃO cobre $host ($ip negado pelo IPAddressDeny e fora do IPAddressAllow): a aplicação não alcançaria o provedor; atualizar o egress MANUALMENTE (/usr/local/bin/update-induscost-homolog-egress reinicia a homologação; este hook não o executa)"
      fi
    done
  done
}

# ---------------------------------------------------------------------------------------------------------------
# Contexto desta execução (o que o hook prévio grava e os posteriores comparam)
# ---------------------------------------------------------------------------------------------------------------
ctx_dir="${IDS_HOOK_CONTEXT_DIR:-}"
run_id="${IDS_DEPLOY_RUN_ID:-}"
ctx_file=""

# O diretório é exatamente o desta execução (nome = identificador), real, deste usuário e fechado para os demais.
ctx_valid() {
  [[ "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9a-f]+$ ]] || { say "ERRO: IDS_DEPLOY_RUN_ID ausente ou inválido ('$run_id')"; return 1; }
  [[ -n "$ctx_dir" && "$ctx_dir" == /* && -d "$ctx_dir" && ! -L "$ctx_dir" ]] || { say "ERRO: IDS_HOOK_CONTEXT_DIR ausente ou não é um diretório real ('$ctx_dir')"; return 1; }
  [[ "$(basename -- "$ctx_dir")" == "$run_id" ]] || { say "ERRO: contexto '$ctx_dir' não é o da execução $run_id"; return 1; }
  if [[ "$(uname -s)" == Linux ]]; then
    [[ "$(stat -c %u "$ctx_dir")" == "$(id -u)" && "$(stat -c %a "$ctx_dir")" == 700 ]] || { say "ERRO: contexto $ctx_dir precisa ser 0700 e deste usuário"; return 1; }
  fi
  ctx_file="$ctx_dir/aws-commit.before"
}

ctx_record_before() {
  local sha="$1"
  if [[ -e "$ctx_file" || -L "$ctx_file" ]]; then say "ERRO: $ctx_file já existe (o registro desta execução é gravado uma única vez)"; return 1; fi
  # noclobber: criação exclusiva — dois processos nunca gravam o mesmo registro.
  ( umask 077; set -o noclobber
    printf '%s\n' "run_id=$run_id" "env=${IDS_ENV_NAME:-}" "old_commit=${IDS_OLD_COMMIT:-}" "target=${IDS_TARGET:-}" \
      "aws_ssh_target=$aws_ssh_target" "aws_app_dir=$aws_app_dir" "aws_commit=$sha" "recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" "recorded_by_pid=$$" > "$ctx_file"
  ) 2>/dev/null || { say "ERRO: não foi possível gravar $ctx_file"; return 1; }
  say "OK    commit AWS anterior ao deploy registrado: $sha ($ctx_file)"
}

# Commit AWS registrado pelo hook prévio DESTA execução (em before_sha); recusa registro de outra execução, alvo ou
# destino.
before_sha=""
ctx_read_before() {
  local key value rec_run="" rec_env="" rec_old="" rec_target="" rec_ssh="" rec_dir="" rec_sha=""
  [[ -f "$ctx_file" && ! -L "$ctx_file" ]] || { say "ERRO: sem registro do commit AWS anterior ($ctx_file): o hook prévio desta execução não rodou ou não gravou"; return 1; }
  if [[ "$(uname -s)" == Linux ]]; then
    [[ "$(stat -c %u "$ctx_file")" == "$(id -u)" && ! "$(stat -c %a "$ctx_file")" =~ [2367].$|[2367]$ ]] || { say "ERRO: $ctx_file com dono/permissão inesperados"; return 1; }
  fi
  while IFS='=' read -r key value; do
    case "$key" in
      run_id) rec_run="$value" ;; env) rec_env="$value" ;; old_commit) rec_old="$value" ;; target) rec_target="$value" ;;
      aws_ssh_target) rec_ssh="$value" ;; aws_app_dir) rec_dir="$value" ;; aws_commit) rec_sha="$value" ;;
    esac
  done < "$ctx_file"
  if [[ "$rec_run" != "$run_id" || "$rec_env" != "${IDS_ENV_NAME:-}" || "$rec_old" != "${IDS_OLD_COMMIT:-}" || "$rec_target" != "${IDS_TARGET:-}" ]]; then
    say "ERRO: registro $ctx_file é de outra execução (run=$rec_run env=$rec_env anterior=$rec_old alvo=$rec_target); esperado run=$run_id env=${IDS_ENV_NAME:-} anterior=${IDS_OLD_COMMIT:-} alvo=${IDS_TARGET:-}"
    return 1
  fi
  if [[ "$rec_ssh" != "$aws_ssh_target" || "$rec_dir" != "$aws_app_dir" ]]; then
    say "ERRO: registro feito para outro destino AWS ($rec_ssh:$rec_dir ≠ $aws_ssh_target:$aws_app_dir)"
    return 1
  fi
  [[ "$rec_sha" =~ ^[0-9a-f]{40}$ ]] || { say "ERRO: commit registrado inválido em $ctx_file"; return 1; }
  before_sha="$rec_sha"
}

ctx_record_after() {
  local sha="$1" f="$ctx_dir/aws-commit.after-$phase" tmp
  tmp="$ctx_dir/.aws-commit.after-$phase.$$"
  ( umask 077; printf '%s\n' "run_id=$run_id" "phase=$phase" "aws_commit=$sha" "recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp" ) && mv -f "$tmp" "$f" || rm -f "$tmp"
}

# ---------------------------------------------------------------------------------------------------------------
# Fluxo
# ---------------------------------------------------------------------------------------------------------------
say "fase $phase (ambiente ${IDS_ENV_NAME:-?}; somente leitura)"
validate_config
if (( config_errors > 0 )); then
  say "RESULTADO: configuração inválida ($config_errors erro(s)); nada foi verificado"
  # Depois da subida, configuração inválida é ALERTA: desfazer a homologação não a corrige.
  [[ "$phase" == HOOKS_POST_START || "$phase" == HOOKS_POST_ROLLBACK ]] && exit 10
  exit 3
fi
if [[ "$mode" == validate ]]; then say "RESULTADO: configuração válida"; exit 0; fi
if [[ "$mode" == phase ]] && ! ctx_valid; then
  if [[ "$phase" == HOOKS_PRE_DEPLOY ]]; then say "RESULTADO: FALHA (contexto da execução)"; exit 1; fi
  say "RESULTADO: ALERTA (contexto da execução inválido: o commit AWS não pode ser comparado)"
  exit 10
fi

check_runtime_role
check_local_production_off
check_nginx_active
http_ok "gateway" "$gateway_url" || true
http_ok "produção AWS" "$aws_url" || true

aws_sha=""
if aws_sha="$(read_aws_commit)"; then
  say "OK    commit em execução na produção AWS ($aws_ssh_target:$aws_app_dir): $aws_sha"
else
  aws_sha=""
  critical_fail "commit da produção AWS ilegível por SSH ($aws_ssh_target: git -C $aws_app_dir rev-parse) em $ssh_attempts tentativa(s)"
fi

case "$phase" in
  HOOKS_PRE_DEPLOY)
    if (( critical_failures == 0 )); then ctx_record_before "$aws_sha" || critical_fail "registro do commit AWS anterior"; fi
    ;;
  HOOKS_POST_START|HOOKS_POST_ROLLBACK)
    if ctx_read_before; then
      if [[ -n "$aws_sha" ]]; then
        ctx_record_after "$aws_sha"
        if [[ "$aws_sha" == "$before_sha" ]]; then
          say "OK    commit da produção AWS inalterado durante o deploy ($before_sha)"
        else
          critical_fail "ALTERAÇÃO INESPERADA no commit da produção AWS: antes do deploy $before_sha, agora $aws_sha (nenhuma ação foi executada na AWS; investigar quem publicou)"
        fi
      fi
    else
      critical_fail "commit AWS anterior ao deploy indisponível para comparação"
    fi
    ;;
esac

check_cnpj_providers

if [[ "$mode" == check ]]; then
  if (( critical_failures > 0 )) || { (( cnpj_problems > 0 )) && [[ "$cnpj_policy" == fail ]]; }; then
    say "RESULTADO: --check reprovado (críticas com falha: $critical_failures; CNPJ: $cnpj_problems, política $cnpj_policy) — um deploy agora seria recusado"
    exit 1
  fi
  say "RESULTADO: --check OK (críticas: 0 falha; CNPJ: $cnpj_problems aviso(s), política $cnpj_policy); nada foi gravado"
  exit 0
fi

cnpj_blocking=0
(( cnpj_problems > 0 )) && [[ "$cnpj_policy" == fail ]] && cnpj_blocking=1
if [[ "$phase" == HOOKS_PRE_DEPLOY ]]; then
  if (( critical_failures > 0 || cnpj_blocking )); then
    say "RESULTADO: FALHA antes do deploy (críticas: $critical_failures; CNPJ: $cnpj_problems, política $cnpj_policy) — deploy recusado; nada foi alterado"
    exit 1
  fi
  say "RESULTADO: OK antes do deploy (CNPJ: $cnpj_problems aviso(s))"
  exit 0
fi
if (( critical_failures > 0 || cnpj_blocking )); then
  if [[ "$phase" == HOOKS_POST_START && "$post_policy" == rollback && "$critical_failures" -gt 0 ]]; then
    say "RESULTADO: FALHA depois da subida (críticas: $critical_failures; HOOK_PROD_POST_POLICY=rollback)"
    exit 1
  fi
  say "RESULTADO: ALERTA em $phase (críticas: $critical_failures; CNPJ: $cnpj_problems, política $cnpj_policy) — reportar e investigar; nenhuma ação na AWS"
  exit 10
fi
say "RESULTADO: OK em $phase (CNPJ: $cnpj_problems aviso(s))"
exit 0
