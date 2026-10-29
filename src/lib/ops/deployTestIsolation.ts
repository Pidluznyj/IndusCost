/**
 * Ambiente dos processos que os testes de deploy disparam (bash com a biblioteca, executor, instalador, hooks).
 *
 * No servidor, o gate de testes roda dentro do executor de deploy, que exporta a configuração do cluster REAL
 * (IDS_PG_BIN/HOST/PORT/ADMIN_ROLE, IDS_PG, globs, estado...). Herdada por um teste, ela faz a biblioteca chamar o
 * psql/pg_restore do servidor contra o banco oficial em vez dos simulados — foi o que reprovou o deploy de
 * 29/10/2026 (peer authentication failed para "postgres"; RC=48 no lugar dos códigos esperados). Todo spawn destes
 * testes parte daqui: nenhuma variável IDS_* ou PG* do host chega aos cenários; cada teste define as suas.
 */
const DEPLOY_CONFIG_KEY = /^(IDS_|PG)/;

export function isolatedHostEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !DEPLOY_CONFIG_KEY.test(key)));
}

export function isDeployConfigKey(key: string): boolean {
  return DEPLOY_CONFIG_KEY.test(key);
}
