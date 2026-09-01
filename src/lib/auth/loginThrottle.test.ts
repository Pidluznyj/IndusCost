/**
 * Throttle de força bruta do login.
 *
 * O defeito que estes testes existem para impedir: um limiter que apenas troca
 * o código de resposta (401 → 429) NÃO contém força bruta, porque o `scrypt`
 * continua rodando a cada tentativa. Aqui o ponto central é provar que durante
 * o cooldown a verificação da senha **não acontece**.
 *
 * Relógio injetado em todos os casos — nenhum `sleep` real.
 * Senhas fictícias.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_BACKOFF_MS,
  LOGIN_FAILURE_THRESHOLD,
  LOGIN_STATE_RESET_MS,
  LoginThrottle,
  isLoginAttemptDenied,
  loginCooldownMsFor,
} from "./authRateLimit.js";

const EMAIL = "vitima@exemplo.test";
const OUTRO = "outra.pessoa@exemplo.test";
const SENHA_CORRETA = "a senha verdadeira dela";
const SENHA_ERRADA = "chute do atacante 1";

/* ------------------------------------------------------------------ */
/* Harness: mesma sequência de gate da rota POST /api/auth/login       */
/* ------------------------------------------------------------------ */

type Attempt = { status: number; retryAfterSeconds?: number };

/**
 * Réplica exata da ordem usada em server.ts: gate → busca do usuário →
 * verifyPassword → sucesso. O espião conta quantas verificações
 * criptográficas realmente aconteceram.
 *
 * `passwordLifecycleWiring.test.ts` garante que o server.ts mantém esta ordem.
 */
function createLoginHarness(options: { userExists?: boolean } = {}) {
  const throttle = new LoginThrottle();
  const verifyCalls: string[] = [];

  async function verifyPasswordSpy(password: string): Promise<boolean> {
    verifyCalls.push(password);
    // Simula o custo do scrypt sem depender de tempo real.
    await Promise.resolve();
    return password === SENHA_CORRETA;
  }

  async function attemptLogin(
    email: string,
    password: string,
    now: number
  ): Promise<Attempt> {
    const gate = throttle.acquire(email, now);
    if (isLoginAttemptDenied(gate)) {
      return { status: 429, retryAfterSeconds: gate.retryAfterSeconds };
    }
    // Só depois do gate é que o banco e o scrypt entram em cena.
    const existe = options.userExists ?? true;
    if (!existe) return { status: 401 };
    const valido = await verifyPasswordSpy(password);
    if (!valido) return { status: 401 };
    throttle.recordSuccess(email);
    return { status: 200 };
  }

  return { throttle, attemptLogin, verifyCalls };
}

/* ------------------------------------------------------------------ */
/* Tabela de backoff                                                   */
/* ------------------------------------------------------------------ */

describe("backoff", () => {
  it("falhas 1–4 não geram cooldown", () => {
    for (let n = 1; n < LOGIN_FAILURE_THRESHOLD; n += 1) {
      assert.equal(loginCooldownMsFor(n), 0, `falha ${n} não pode ter cooldown`);
    }
  });

  it("segue a tabela 15s / 30s / 60s / 120s", () => {
    assert.equal(loginCooldownMsFor(5), 15_000);
    assert.equal(loginCooldownMsFor(6), 30_000);
    assert.equal(loginCooldownMsFor(7), 60_000);
    assert.equal(loginCooldownMsFor(8), 120_000);
  });

  it("nunca ultrapassa o teto, por maior que seja o número de falhas", () => {
    const teto = LOGIN_BACKOFF_MS[LOGIN_BACKOFF_MS.length - 1];
    assert.equal(teto, 120_000);
    for (const n of [9, 10, 50, 500, 10_000]) {
      assert.equal(loginCooldownMsFor(n), teto, `falhas=${n} deveria estar no teto`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* A–J: ciclo de vida                                                  */
/* ------------------------------------------------------------------ */

describe("ciclo de tentativas", () => {
  let h: ReturnType<typeof createLoginHarness>;
  const T0 = 1_000_000;

  beforeEach(() => {
    h = createLoginHarness();
  });

  it("A. as primeiras falhas realmente verificam a senha", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      const r = await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
      assert.equal(r.status, 401, `tentativa ${i + 1} deveria chegar ao 401`);
    }
    assert.equal(h.verifyCalls.length, LOGIN_FAILURE_THRESHOLD);
  });

  it("B. atingir o threshold inicia o cooldown", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    assert.equal(h.throttle.failuresFor(EMAIL, T0), LOGIN_FAILURE_THRESHOLD);
    assert.equal(h.throttle.cooldownRemainingMs(EMAIL, T0), 15_000);
  });

  it("C. chamada durante o cooldown responde 429", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const r = await h.attemptLogin(EMAIL, SENHA_ERRADA, T0 + 1_000);
    assert.equal(r.status, 429);
  });

  it("D. durante o cooldown verifyPassword NÃO é chamado (o ponto da correção)", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const antes = h.verifyCalls.length;

    // 500 tentativas dentro da janela: nenhuma pode custar um scrypt.
    for (let i = 0; i < 500; i += 1) {
      const r = await h.attemptLogin(EMAIL, `chute ${i}`, T0 + 1_000 + i);
      assert.equal(r.status, 429);
    }
    assert.equal(h.verifyCalls.length, antes, "nenhuma verificação podia acontecer");
  });

  it("D2. nem mesmo a senha CORRETA é verificada durante o cooldown", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const antes = h.verifyCalls.length;
    const r = await h.attemptLogin(EMAIL, SENHA_CORRETA, T0 + 1_000);
    assert.equal(r.status, 429);
    assert.equal(h.verifyCalls.length, antes);
  });

  it("E. Retry-After reflete o tempo restante e nunca é zero", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const inicio = await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    assert.equal(inicio.retryAfterSeconds, 15);

    const meio = await h.attemptLogin(EMAIL, SENHA_ERRADA, T0 + 10_000);
    assert.equal(meio.retryAfterSeconds, 5);

    const fim = await h.attemptLogin(EMAIL, SENHA_ERRADA, T0 + 14_999);
    assert.equal(fim.retryAfterSeconds, 1, "arredonda para cima, nunca 0");
  });

  it("F. terminado o cooldown, uma nova tentativa real é permitida", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const antes = h.verifyCalls.length;
    const r = await h.attemptLogin(EMAIL, SENHA_ERRADA, T0 + 15_000);
    assert.equal(r.status, 401, "a tentativa passou pelo gate");
    assert.equal(h.verifyCalls.length, antes + 1, "e custou exatamente um scrypt");
  });

  it("G. cada nova falha aumenta o backoff", async () => {
    let now = T0;
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, now);
    }
    const observados: number[] = [];
    for (const _ of [0, 1, 2]) {
      const espera = h.throttle.cooldownRemainingMs(EMAIL, now);
      observados.push(espera);
      now += espera;
      await h.attemptLogin(EMAIL, SENHA_ERRADA, now);
    }
    assert.deepEqual(observados, [15_000, 30_000, 60_000]);
  });

  it("H. o backoff estaciona no teto de 120s", async () => {
    let now = T0;
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, now);
    }
    for (let i = 0; i < 20; i += 1) {
      now += h.throttle.cooldownRemainingMs(EMAIL, now);
      await h.attemptLogin(EMAIL, SENHA_ERRADA, now);
    }
    assert.equal(h.throttle.cooldownRemainingMs(EMAIL, now), 120_000);
  });

  it("I. sucesso numa tentativa permitida limpa o bucket", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const ok = await h.attemptLogin(EMAIL, SENHA_CORRETA, T0 + 15_000);
    assert.equal(ok.status, 200);
    assert.equal(h.throttle.failuresFor(EMAIL, T0 + 15_000), 0);
  });

  it("J. depois do sucesso não sobra cooldown residual", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    await h.attemptLogin(EMAIL, SENHA_CORRETA, T0 + 15_000);
    assert.equal(h.throttle.cooldownRemainingMs(EMAIL, T0 + 15_000), 0);

    // E o login seguinte funciona na hora, sem 429.
    const denovo = await h.attemptLogin(EMAIL, SENHA_CORRETA, T0 + 15_001);
    assert.equal(denovo.status, 200);
  });

  it("sucesso antes do threshold também zera as falhas acumuladas", async () => {
    await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    assert.equal(h.throttle.failuresFor(EMAIL, T0), 2);
    const ok = await h.attemptLogin(EMAIL, SENHA_CORRETA, T0);
    assert.equal(ok.status, 200);
    assert.equal(h.throttle.failuresFor(EMAIL, T0), 0);
  });

  it("o estado decai sozinho após inatividade — não é lockout permanente", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD + 3; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const depois = T0 + LOGIN_STATE_RESET_MS;
    assert.equal(h.throttle.failuresFor(EMAIL, depois), 0);
    const r = await h.attemptLogin(EMAIL, SENHA_ERRADA, depois);
    assert.equal(r.status, 401, "identidade volta ao estado limpo");
  });

  it("o teto mantém o bloqueio máximo em 2 minutos", async () => {
    let now = T0;
    for (let i = 0; i < 30; i += 1) {
      const gate = h.throttle.acquire(EMAIL, now);
      if (isLoginAttemptDenied(gate)) {
        assert.ok(
          gate.retryAfterSeconds <= 120,
          `bloqueio de ${gate.retryAfterSeconds}s excede o teto`
        );
        now += h.throttle.cooldownRemainingMs(EMAIL, now);
      }
    }
  });

  it("identidades são independentes: travar uma não trava a outra", async () => {
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    assert.equal((await h.attemptLogin(EMAIL, SENHA_ERRADA, T0)).status, 429);
    assert.equal((await h.attemptLogin(OUTRO, SENHA_CORRETA, T0)).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* K: enumeração de contas                                             */
/* ------------------------------------------------------------------ */

describe("K. e-mail inexistente não revela existência da conta", () => {
  const T0 = 2_000_000;

  it("status e sequência de bloqueio são idênticos aos de um usuário real", async () => {
    const existente = createLoginHarness({ userExists: true });
    const inexistente = createLoginHarness({ userExists: false });

    const respostasExistente: number[] = [];
    const respostasInexistente: number[] = [];
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD + 2; i += 1) {
      respostasExistente.push((await existente.attemptLogin(EMAIL, SENHA_ERRADA, T0)).status);
      respostasInexistente.push((await inexistente.attemptLogin(EMAIL, SENHA_ERRADA, T0)).status);
    }

    assert.deepEqual(respostasExistente, respostasInexistente);
    assert.deepEqual(
      respostasExistente.slice(-2),
      [429, 429],
      "os dois entram em cooldown no mesmo ponto"
    );
  });

  it("o throttle conta a tentativa mesmo quando o e-mail não existe", async () => {
    const h = createLoginHarness({ userExists: false });
    await h.attemptLogin("ninguem@exemplo.test", SENHA_ERRADA, T0);
    assert.equal(h.throttle.failuresFor("ninguem@exemplo.test", T0), 1);
  });
});

/* ------------------------------------------------------------------ */
/* L e M: concorrência adversarial                                     */
/* ------------------------------------------------------------------ */

describe("concorrência", () => {
  const T0 = 3_000_000;

  it("L. 50 requisições paralelas durante o cooldown não executam scrypt algum", async () => {
    const h = createLoginHarness();
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const antes = h.verifyCalls.length;

    const respostas = await Promise.all(
      Array.from({ length: 50 }, (_, i) => h.attemptLogin(EMAIL, `chute ${i}`, T0 + 5_000))
    );

    assert.equal(h.verifyCalls.length, antes, "nenhum scrypt durante o cooldown");
    assert.ok(respostas.every((r) => r.status === 429));
  });

  it("M. na borda de expiração, no máximo UMA paralela adquire a tentativa", async () => {
    const h = createLoginHarness();
    for (let i = 0; i < LOGIN_FAILURE_THRESHOLD; i += 1) {
      await h.attemptLogin(EMAIL, SENHA_ERRADA, T0);
    }
    const antes = h.verifyCalls.length;

    // Exatamente o instante em que o cooldown expira: 20 requisições disparadas
    // juntas. Se o gate não fosse atômico, todas veriam "cooldown vencido" e
    // rodariam 20 scrypts.
    const borda = T0 + 15_000;
    const respostas = await Promise.all(
      Array.from({ length: 20 }, (_, i) => h.attemptLogin(EMAIL, `chute ${i}`, borda))
    );

    const permitidas = respostas.filter((r) => r.status !== 429).length;
    assert.equal(permitidas, 1, "só uma pode passar o gate");
    assert.equal(h.verifyCalls.length, antes + 1, "e só um scrypt foi executado");
    assert.equal(respostas.filter((r) => r.status === 429).length, 19);
  });

  it("M2. rajada simultânea partindo do zero não escapa pelo caminho livre", async () => {
    const h = createLoginHarness();
    // 200 requisições ao mesmo tempo, identidade sem histórico: a cobrança
    // acontece na CONCESSÃO, então o threshold fecha o portão no meio da rajada.
    const respostas = await Promise.all(
      Array.from({ length: 200 }, (_, i) => h.attemptLogin(EMAIL, `chute ${i}`, T0))
    );

    assert.equal(
      h.verifyCalls.length,
      LOGIN_FAILURE_THRESHOLD,
      "no máximo o threshold de verificações antes do cooldown fechar"
    );
    assert.equal(respostas.filter((r) => r.status === 401).length, LOGIN_FAILURE_THRESHOLD);
    assert.equal(respostas.filter((r) => r.status === 429).length, 200 - LOGIN_FAILURE_THRESHOLD);
  });

  it("o gate é síncrono — não há await entre ler e gravar o estado", () => {
    const throttle = new LoginThrottle();
    const resultado = throttle.acquire(EMAIL, T0);
    // Se acquire fosse assíncrono, isto seria uma Promise e a atomicidade
    // dependeria de sorte no laço de eventos.
    assert.equal(typeof (resultado as { then?: unknown }).then, "undefined");
    assert.equal(resultado.allowed, true);
  });
});
