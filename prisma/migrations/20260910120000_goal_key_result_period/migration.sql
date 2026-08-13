-- Metas (OKR) — período próprio do indicador (KR).
--
-- Por que: o indicador podia medir apenas a janela inteira do Objetivo. Um
-- objetivo anual com um indicador trimestral/semestral era impossível de
-- representar, e o usuário não tinha como recortar o período da medição.
--
-- Semântica: NULL = herda o período do Objetivo. Quando preenchido, o motor
-- usa a INTERSEÇÃO com a janela do Objetivo — o indicador nunca mede fora do
-- período do pai (a validação no service já bloqueia datas fora, isto é a
-- rede de segurança para objetivos cujo período encolheu depois).
--
-- Retrocompatível: colunas nulas, sem default, sem backfill — todos os KRs
-- existentes continuam herdando a janela do Objetivo exatamente como antes.

ALTER TABLE "GoalKeyResult" ADD COLUMN IF NOT EXISTS "startDate" DATE;
ALTER TABLE "GoalKeyResult" ADD COLUMN IF NOT EXISTS "endDate" DATE;
