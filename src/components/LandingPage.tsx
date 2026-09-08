import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import "./landing/landing-page.css";

/**
 * Landing pública (rota "/") — "Cockpit industrial 4.0/5.0".
 * Espelha landing-dist/index.html (site estático do Cloudflare Pages); aqui os
 * CTAs usam as rotas internas do app (/login, /guide). CSS escopado em .ic-landing.
 */

/** Comportamentos da landing (progresso de leitura, reveal, contadores, simulador). */
function setupLanding(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  const reduceMotion =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const progress = root.querySelector<HTMLElement>("#scrollProgress");
  if (progress) {
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      progress.style.width = `${max > 0 ? (doc.scrollTop / max) * 100 : 0}%`;
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
    cleanups.push(() => window.removeEventListener("scroll", update));
  }

  const reveals = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
  if (!("IntersectionObserver" in window)) {
    reveals.forEach((el) => el.classList.add("is-visible"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "-30px" }
    );
    reveals.forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());
  }

  const fmt = (v: number, d: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const counters = Array.from(root.querySelectorAll<HTMLElement>(".count"));
  const runCounter = (el: HTMLElement) => {
    const to = Number.parseFloat(el.getAttribute("data-to") ?? "0") || 0;
    const d = Number.parseInt(el.getAttribute("data-decimals") ?? "0", 10);
    if (reduceMotion) {
      el.textContent = fmt(to, d);
      return;
    }
    let start: number | null = null;
    const dur = 1400;
    const frame = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased, d);
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if (counters.length) {
    if (!("IntersectionObserver" in window)) {
      counters.forEach(runCounter);
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              runCounter(entry.target as HTMLElement);
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.4 }
      );
      counters.forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    }
  }

  // Simulador de margem invisível — mesma fórmula da landing estática (3,5% do faturamento).
  const fatRange = root.querySelector<HTMLInputElement>("#fatRange");
  const margemRange = root.querySelector<HTMLInputElement>("#margemRange");
  const fatDisplay = root.querySelector<HTMLElement>("#fatDisplay");
  const margemDisplay = root.querySelector<HTMLElement>("#margemDisplay");
  const recuperadoValor = root.querySelector<HTMLElement>("#recuperadoValor");
  const anoGanho = root.querySelector<HTMLElement>("#anoGanho");
  if (fatRange && margemRange && fatDisplay && margemDisplay && recuperadoValor && anoGanho) {
    const formatBRL = (val: number) =>
      val.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    const updateSim = () => {
      const fat = Number.parseFloat(fatRange.value);
      const margem = Number.parseFloat(margemRange.value);
      fatDisplay.textContent = formatBRL(fat);
      margemDisplay.textContent = `${margem}%`;
      const ganhoMensal = fat * 0.035;
      recuperadoValor.textContent = formatBRL(ganhoMensal);
      anoGanho.textContent = Math.round(ganhoMensal * 12).toLocaleString("pt-BR");
    };
    fatRange.addEventListener("input", updateSim);
    margemRange.addEventListener("input", updateSim);
    updateSim();
    cleanups.push(() => {
      fatRange.removeEventListener("input", updateSim);
      margemRange.removeEventListener("input", updateSim);
    });
  }

  return () => cleanups.forEach((fn) => fn());
}

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return setupLanding(root);
  }, []);

  return (
    <div className="ic-landing" ref={rootRef} data-testid="public-landing">
      <div className="scroll-progress" id="scrollProgress" aria-hidden></div>

      <div className="telemetry" aria-hidden>
        <div className="telemetry-track">
          <span className="telemetry-item"><span className="dot"></span>Indústria 4.0/5.0 ready</span>
          <span className="telemetry-item">Motor tributário ativo: <b>ICMS · DIFAL · PIS · COFINS · IPI</b></span>
          <span className="telemetry-item">Custeio por centro de trabalho: <b>MOD · CIF · BOM</b></span>
          <span className="telemetry-item"><span className="dot amber"></span>Simulações what-if: <b>ilimitadas</b></span>
          <span className="telemetry-item">Grupo Lazários Intelligence Hub</span>
          <span className="telemetry-item">Proposta com margem real: <b>em minutos</b></span>

          <span className="telemetry-item"><span className="dot"></span>Indústria 4.0/5.0 ready</span>
          <span className="telemetry-item">Motor tributário ativo: <b>ICMS · DIFAL · PIS · COFINS · IPI</b></span>
          <span className="telemetry-item">Custeio por centro de trabalho: <b>MOD · CIF · BOM</b></span>
          <span className="telemetry-item"><span className="dot amber"></span>Simulações what-if: <b>ilimitadas</b></span>
          <span className="telemetry-item">Grupo Lazários Intelligence Hub</span>
          <span className="telemetry-item">Proposta com margem real: <b>em minutos</b></span>
        </div>
      </div>

      <div className="header-wrap">
        <header className="wrap header">
          <Link className="brand" to="/" aria-label="IndusCost Intelligence">
            <div className="brand-mark">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></svg>
            </div>
            <div>
              <div className="brand-title">IndusCost <span>Intelligence</span></div>
              <div className="brand-sub">Grupo Lazários • Custeio 4.0</div>
            </div>
          </Link>

          <nav className="nav" aria-label="Seções">
            <a href="#como-funciona">Como funciona</a>
            <a href="#simulador">Simulador de margem</a>
            <a href="#pilares">Pilares 4.0</a>
            <a href="#comparativo">Planilha vs IndusCost</a>
            <a href="#modulos">Módulos</a>
          </nav>

          <div className="header-actions">
            <Link className="btn btn-ghost btn-sm" to="/guide">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
              Guia do sistema
            </Link>
            <Link className="btn btn-primary btn-sm" to="/login">
              Entrar
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            </Link>
          </div>
        </header>
      </div>

      <section className="wrap hero">
        <div className="hero-grid">
          <div>
            <div className="eyebrow reveal">
              <span className="tag">Nova era</span>
              <span>Engenharia, financeiro e vendas com a mesma verdade numérica</span>
            </div>

            <h1 className="reveal d1">
              <span className="line">O custo cirúrgico.</span>
              <span className="line">O preço
                <span className="rotator" aria-label="blindado, auditável, previsível"><span className="grad">blindado.</span><span className="grad">auditável.</span><span className="grad">previsível.</span></span>
              </span>
              <span className="line">O comercial imparável.</span>
            </h1>

            <p className="hero-lead reveal d2">
              Você já perdeu uma cotação porque o orçamento demorou. E já fechou um pedido que virou prejuízo na DRE.
              O <strong>IndusCost Intelligence</strong> conecta custeio por centro de trabalho, tributação em tempo real e formação de preço
              em um único fluxo, para que cada proposta saia com a <strong>margem real já calculada</strong>.
            </p>

            <div className="hero-ctas reveal d3">
              <Link className="btn btn-primary" to="/login">
                Acessar o sistema
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </Link>
              <a className="btn btn-ghost" href="#simulador">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#38bdf8" }} aria-hidden><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></svg>
                Diagnosticar minha margem
              </a>
            </div>

            <div className="trust reveal d3">
              <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>100% web, sem instalação</span>
              <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Centros de trabalho e BOM estruturados</span>
              <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Simulações what-if ilimitadas</span>
            </div>
          </div>

          <div className="reveal d2">
            <div className="cockpit">
              <div className="cockpit-inner">
                <div className="cockpit-bar">
                  <div className="win-dots"><i style={{ background: "#ef4444" }} /><i style={{ background: "#f59e0b" }} /><i style={{ background: "#10b981" }} /></div>
                  <div className="cockpit-title">Cockpit // proposta #0417 // margem líquida</div>
                  <div className="cockpit-live"><span className="dot"></span>Ao vivo</div>
                </div>

                <div className="cockpit-grid">
                  <div className="panel panel-span">
                    <div className="panel-label">Margem líquida da proposta</div>
                    <div className="gauge-wrap">
                      <svg className="gauge" viewBox="0 0 112 64" aria-hidden>
                        <path d="M8 58 A48 48 0 0 1 104 58" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" strokeLinecap="round" />
                        <path className="gauge-arc" d="M8 58 A48 48 0 0 1 104 58" fill="none" stroke="url(#g1)" strokeWidth="10" strokeLinecap="round" />
                        <defs><linearGradient id="g1" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#34d399" /></linearGradient></defs>
                      </svg>
                      <div>
                        <div className="gauge-value"><span className="count" data-to="23.4" data-decimals="1">0</span>%</div>
                        <div className="gauge-sub">acima do piso de <b className="mono">18%</b> definido pela diretoria</div>
                      </div>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-label">Composição do preço</div>
                    <div className="stack">
                      <div className="bar-row"><span>Materiais</span><div className="bar"><i style={{ width: "58%", background: "#38bdf8", animationDelay: ".3s" }} /></div><b>41%</b></div>
                      <div className="bar-row"><span>MOD + CIF</span><div className="bar"><i style={{ width: "34%", background: "#60a5fa", animationDelay: ".45s" }} /></div><b>19%</b></div>
                      <div className="bar-row"><span>Tributos</span><div className="bar"><i style={{ width: "30%", background: "#a78bfa", animationDelay: ".6s" }} /></div><b>17%</b></div>
                      <div className="bar-row"><span>Margem</span><div className="bar"><i style={{ width: "40%", background: "#34d399", animationDelay: ".75s" }} /></div><b>23%</b></div>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-label">Sinais da proposta</div>
                    <div className="stack" style={{ gap: "0.7rem" }}>
                      <div className="kpi"><div className="kpi-val">R$ <span className="count" data-to="184290" data-decimals="0">0</span></div><div className="kpi-delta">↑ preço mínimo respeitado</div></div>
                      <div className="kpi"><div className="kpi-val"><span className="count" data-to="12" data-decimals="0">0</span> min</div><div className="kpi-delta">do cadastro ao PDF da proposta</div></div>
                      <div className="kpi"><div className="kpi-val">0</div><div className="kpi-delta warn">itens abaixo do custo</div></div>
                    </div>
                  </div>
                </div>

                <div className="toast" role="status">
                  <strong>Alerta de margem</strong> Item 03 com desconto acima do limite da política comercial.
                  <small>Bloqueado antes de sair da fábrica.</small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="numbers" aria-label="Resultados">
        <div className="wrap numbers-grid">
          <div className="num reveal"><div className="num-val"><em><span className="count" data-to="2" data-decimals="0">0</span>–<span className="count" data-to="5" data-decimals="0">0</span>%</em></div><div className="num-label">do faturamento evapora em margem invisível nas indústrias que ainda vivem de planilha</div></div>
          <div className="num reveal d1"><div className="num-val"><span className="count" data-to="85" data-decimals="0">0</span><em>%</em></div><div className="num-label">menos tempo de resposta a cotações com custo e tributos já calculados</div></div>
          <div className="num reveal d2"><div className="num-val"><em>1</em> clique</div><div className="num-label">para simular alta de matéria-prima, energia ou frete e ver o impacto na margem</div></div>
          <div className="num reveal d3"><div className="num-val">360<em>°</em></div><div className="num-label">custo, preço e funil comercial na mesma tela, com a mesma base de dados</div></div>
        </div>
      </section>

      <section id="como-funciona" className="wrap pipeline">
        <div className="section-head center reveal">
          <div className="kicker">Do chão de fábrica ao contrato</div>
          <h2>Três movimentos. Uma única verdade numérica.</h2>
          <p>O IndusCost não é mais uma planilha bonita: é o fluxo inteiro, encadeado, da engenharia até a assinatura do pedido.</p>
        </div>

        <div className="steps">
          <div className="step reveal">
            <div className="step-num"></div>
            <h3>Engenharia estrutura o custo</h3>
            <p>BOM, roteiros, tempos de máquina, mão de obra direta e custos indiretos por centro de trabalho. O custo nasce do processo real, não de uma média.</p>
            <div className="step-out"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Custo industrial auditável</div>
          </div>
          <div className="step reveal d1">
            <div className="step-num"></div>
            <h3>O motor forma o preço</h3>
            <p>ICMS, DIFAL, PIS, COFINS, IPI, frete escalonado e comissão entram por dentro. Você define a margem desejada; o sistema devolve o markup e o preço mínimo.</p>
            <div className="step-out"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Preço blindado por política</div>
          </div>
          <div className="step reveal d2">
            <div className="step-num"></div>
            <h3>Comercial fecha sem surpresa</h3>
            <p>Propostas técnicas e comerciais em minutos, com limites automáticos de desconto e a margem real visível antes de enviar ao cliente.</p>
            <div className="step-out"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Pedido protegido na DRE</div>
          </div>
        </div>
      </section>

      <section id="simulador" className="wrap simulator">
        <div className="sim reveal">
          <div className="sim-grid">
            <div>
              <span className="tag amber">Diagnóstico de margem invisível</span>
              <h2>Quanto a sua fábrica está deixando na mesa todo mês?</h2>
              <p className="sim-sub">
                Custos indiretos desatualizados, rateios errados e distorções tributárias consomem de <strong>2% a 5% do faturamento</strong>
                sem aparecer em nenhum relatório. Arraste e veja o tamanho do buraco.
              </p>

              <div className="slider-group">
                <div className="slider-row">
                  <span className="slider-name">Faturamento mensal da indústria</span>
                  <span className="slider-val" id="fatDisplay">R$ 1.500.000</span>
                </div>
                <input type="range" id="fatRange" className="range" min="100000" max="10000000" step="50000" defaultValue="1500000" aria-label="Faturamento mensal" />
              </div>

              <div className="slider-group">
                <div className="slider-row">
                  <span className="slider-name">Margem líquida estimada hoje</span>
                  <span className="slider-val" id="margemDisplay">15%</span>
                </div>
                <input type="range" id="margemRange" className="range" min="5" max="40" step="1" defaultValue="15" aria-label="Margem líquida atual" />
              </div>

              <p className="sim-note">Estimativa conservadora: recuperação média de 3,5% do faturamento ao eliminar distorções de rateio e tributos.</p>
            </div>

            <div className="sim-result">
              <div className="sim-badge">Lucro recuperável</div>
              <div className="sim-gain" id="recuperadoValor">R$ 52.500</div>
              <div className="sim-period">por mês, ou <b>~R$ <span id="anoGanho">630.000</span>/ano</b> que hoje não chegam à sua DRE</div>

              <div className="sim-list">
                <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Blindagem contra erro de rateio e depreciação</span>
                <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Markup e margem por dentro calculados à risca</span>
                <span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>Cotação respondida antes do concorrente</span>
              </div>

              <Link className="btn btn-primary" to="/login">
                Blindar minha margem agora
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="pilares" className="bento-section">
        <div className="wrap">
          <div className="section-head center reveal">
            <div className="kicker">Arquitetura de valor industrial</div>
            <h2>Por que o IndusCost redefine a sua operação</h2>
            <p>Engenharia precisa, controladoria estratégica e vendas competitivas, sem planilhas quebradas e sem reunião para descobrir quem está com o número certo.</p>
          </div>

          <div className="bento">
            <div className="card span-3 reveal">
              <div className="icon-box"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16h.01" /><path d="M16 16h.01" /><path d="M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" /><path d="M8 16h.01" /></svg></div>
              <h3>Custeio industrial de ponta a ponta</h3>
              <p>Da matéria-prima ao produto no palete: listas técnicas (BOM), tempos de máquina, MOD e CIF com vínculo direto ao chão de fábrica.</p>
              <div className="card-tag">✓ Engenharia de métodos &amp; processos</div>
            </div>

            <div className="card span-3 reveal d1">
              <div className="icon-box"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg></div>
              <h3>Preço com margem que você enxerga</h3>
              <p>Formação de preço que desconstrói a carga tributária estadual e federal, frete escalonado e comissão. Descubra o markup ideal para a margem desejada.</p>
              <div className="card-tag">✓ Blindagem fiscal &amp; margem por dentro</div>
            </div>

            <div className="card span-2 reveal">
              <div className="icon-box"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg></div>
              <h3>Comercial e funil integrados</h3>
              <p>Propostas com limites automáticos de desconto. Nenhum pedido sai com prejuízo para a fábrica.</p>
              <div className="card-tag">✓ Governança comercial</div>
            </div>

            <div className="card span-4 reveal d1">
              <div className="card-wide">
                <div>
                  <div className="icon-box"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" /></svg></div>
                  <h3>Simulações what-if antes da decisão</h3>
                  <p>E se o alumínio subir 12%? E se a energia dobrar no horário de pico? Simule no sandbox sem tocar no cadastro oficial até aprovar.</p>
                  <div className="card-tag">✓ Testes de estresse &amp; cenários</div>
                </div>
                <div className="whatif" aria-hidden>
                  <div className="whatif-row"><span>Alumínio +12%</span><b className="up">margem −3,1 p.p.</b></div>
                  <div className="whatif-row"><span>Energia +40% (ponta)</span><b className="up">margem −1,4 p.p.</b></div>
                  <div className="whatif-row"><span>Reajuste de tabela +6%</span><b className="ok">margem +4,2 p.p.</b></div>
                  <div className="whatif-row"><span>Cenário aprovado</span><b className="ok">23,4% líquida</b></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="comparativo" className="wrap compare">
        <div className="section-head center reveal">
          <div className="kicker" style={{ color: "#fb7185" }}>O custo da inércia</div>
          <h2>Continuar na planilha é o caminho mais caro</h2>
          <p>Perder negócios por orçamento lento, ou ganhar contratos que viram prejuízo escondido. Os dois saem do mesmo lugar: números que não conversam.</p>
        </div>

        <div className="vs-grid reveal">
          <div className="cmp cmp-old">
            <div className="cmp-title">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              Indústria na planilha
            </div>
            <ul>
              <li><span className="x">✕</span>Várias versões de .xlsx circulando por e-mail e WhatsApp, sem rastreabilidade.</li>
              <li><span className="x">✕</span>Engenharia calcula com uma fórmula, financeiro aplica outra e o vendedor altera na ponta.</li>
              <li><span className="x">✕</span>Orçamento demora de 3 a 7 dias; o cliente compra do concorrente mais rápido.</li>
              <li><span className="x">✕</span>Surpresa na DRE do fim do mês: pedidos fechados com prejuízo disfarçado.</li>
            </ul>
            <div className="cmp-score"><span>Rastreabilidade</span><b>nenhuma</b></div>
          </div>

          <div className="vs" aria-hidden>VS</div>

          <div className="cmp cmp-new">
            <div className="cmp-title">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              IndusCost Intelligence
            </div>
            <ul>
              <li><span className="ok-i">✓</span>Base única em nuvem: a mesma verdade para engenharia, diretoria e vendas.</li>
              <li><span className="ok-i">✓</span>Centros de trabalho, máquinas e custos indiretos integrados matematicamente ao preço.</li>
              <li><span className="ok-i">✓</span>Propostas em minutos, com margem real calculada na hora.</li>
              <li><span className="ok-i">✓</span>Cenários ilimitados para antecipar matéria-prima, energia e tributos.</li>
            </ul>
            <div className="cmp-score"><span>Rastreabilidade</span><b>total, por usuário e versão</b></div>
          </div>
        </div>
      </section>

      <section id="modulos" className="modules">
        <div className="wrap">
          <div className="section-head reveal">
            <div className="kicker">Ecossistema completo</div>
            <h2>Tudo o que a sua fábrica precisa, interligado</h2>
            <p>Dashboard, engenharia de roteiros, suprimentos, compras, tributos, propostas, clientes, simulações e relatórios: cada peça transforma dado fabril em margem real.</p>
            <div className="chips">
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="8" y="8" width="8" height="8" rx="1" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2" /></svg>Máquinas e roteiros</span>
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>Estruturas BOM</span>
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>Relatórios e BI</span>
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></svg>Dashboard gerencial</span>
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></svg>Simulações e cenários</span>
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>Insumos &amp; compras</span>
              <span className="chip"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>Propostas e clientes</span>
            </div>
          </div>
        </div>

        <div className="wrap faq">
          <div className="section-head center reveal">
            <div className="kicker">Antes de decidir</div>
            <h2>As perguntas que a diretoria faz</h2>
          </div>
          <div className="faq-list reveal">
            <details>
              <summary>Já tenho ERP. Por que preciso do IndusCost?</summary>
              <p>O ERP registra o que aconteceu. O IndusCost decide o que vai acontecer: custo por processo, preço com margem por dentro e proposta protegida por política comercial, antes de o pedido existir. Um complementa o outro.</p>
            </details>
            <details>
              <summary>Minha equipe não é técnica. Vai conseguir usar?</summary>
              <p>O sistema é 100% web, sem instalação, e o guia funcional acompanha cada tela. Engenharia parametriza uma vez; vendas só preenche a proposta e enxerga a margem.</p>
            </details>
            <details>
              <summary>E se os meus custos mudarem toda semana?</summary>
              <p>É exatamente para isso que existem as simulações what-if: você testa alta de matéria-prima, energia ou frete em um sandbox e só publica no cadastro oficial quando aprovar.</p>
            </details>
            <details>
              <summary>Como o vendedor fica impedido de vender com prejuízo?</summary>
              <p>Cada proposta nasce com preço mínimo e limite de desconto calculados a partir do custo real e da carga tributária. O que passa do limite é bloqueado antes de sair da fábrica.</p>
            </details>
          </div>
        </div>

        <div className="wrap">
          <div className="cta-mega reveal">
            <div className="cta-row">
              <div className="cta-left">
                <div className="cta-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>
                </div>
                <div>
                  <h3 className="cta-title">Projetado para a rotina de quem decide na fábrica</h3>
                  <p className="cta-body">
                    Comece pelo dashboard executivo, parametrize máquinas e centros de custo e capacite a equipe comercial a fechar pedidos protegidos contra surpresas.
                    O guia interno do sistema está sempre a um clique.
                  </p>
                </div>
              </div>
              <div className="cta-actions">
                <Link className="btn btn-primary" to="/login">
                  Começar agora no IndusCost
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                </Link>
                <Link className="btn btn-ghost" to="/guide">Ver o guia do sistema</Link>
                <small>Sem instalação. Acesso pelo navegador.</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer-row">
          <div className="footer-brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></svg>
            <span>© {new Date().getFullYear()} IndusCost Intelligence • Grupo Lazários. Todos os direitos reservados.</span>
          </div>
          <div className="footer-links">
            <Link className="footer-link" to="/guide">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
              Abrir guia do sistema
            </Link>
            <Link className="footer-link" to="/login">Acessar aplicação</Link>
          </div>
        </div>
      </footer>

      <div className="mobile-cta" aria-label="Ações rápidas">
        <Link className="btn btn-ghost" to="/guide">Guia</Link>
        <Link className="btn btn-primary" to="/login">Acessar o sistema</Link>
      </div>    </div>
  );
}
