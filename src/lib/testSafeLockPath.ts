/**
 * Locks reais nunca são tocados por processos de teste.
 *
 * O gate do deploy executa os testes no próprio servidor, ao lado das rotinas Nomus em execução. Um teste
 * que adquirisse /tmp/induscost-*.lock (a) seria pulado com "lock ocupado" e derrubaria o deploy
 * (incidente de 26/10/2026) e (b) poderia fazer a rotina real pular. Dentro de um processo do test runner do
 * Node (NODE_TEST_CONTEXT definido), todo lock de produção — nome `induscost-*` em /tmp, /run/lock ou
 * /var/lock — é redirecionado para um diretório temporário do próprio processo. Fora de teste: identidade.
 *
 * O mapeamento é determinístico (mesmo processo → mesmo caminho), então adquirir e liberar continuam
 * apontando para o mesmo arquivo. Caminhos temporários dos próprios testes não são alterados.
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

const PRODUCTION_LOCK_DIRS = new Set(["/tmp", "/run/lock", "/var/lock"]);

export function isNodeTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.NODE_TEST_CONTEXT ?? "").trim());
}

export function isProductionLockPath(lockPath: string): boolean {
  const normalized = String(lockPath ?? "").replace(/\\/g, "/");
  return PRODUCTION_LOCK_DIRS.has(posix.dirname(normalized)) && posix.basename(normalized).startsWith("induscost-");
}

export function testSafeLockPath(lockPath: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isNodeTestProcess(env) || !isProductionLockPath(lockPath)) return lockPath;
  const dir = join(tmpdir(), `induscost-test-locks-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, posix.basename(String(lockPath).replace(/\\/g, "/")));
}
