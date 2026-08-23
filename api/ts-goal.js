// api/ts-goal.js
// Принимает ответы «Точки старта» и «Момента честности» из урока 1.
// Пишет в таблицу ts_goals по анонимному id сессии (sid), не дожидаясь регистрации.
// Повторный запрос с тем же sid обновляет запись, а не плодит дубли.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const body = req.body || {};
  const sid = typeof body.sid === "string" ? body.sid.slice(0, 64) : "";
  if (!sid || sid.length < 8) {
    return res.status(400).json({ error: "no sid" });
  }

  // Обрезаем всё до разумных длин: защита от мусора и случайных простыней
  const clean = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

  const row = { sid, updated_at: new Date().toISOString() };
  const niche = clean(body.niche, 200);
  const situation = clean(body.situation, 32);
  const goalSum = clean(body.goal_sum, 16);
  const commitment = clean(body.commitment, 1000);
  const aiExp = clean(body.ai_exp, 8);
  const email = clean(body.email, 254);
  const pains = clean(body.pains, 100);
  const source = clean(body.source, 20);
  const fear = clean(body.fear, 1000);

  // Кладём только присланные поля, чтобы поздний запрос не затирал ранние ответы пустотой
  if (niche) row.niche = niche;
  if (situation) row.situation = situation;
  if (goalSum) row.goal_sum = goalSum;
  if (commitment) row.commitment = commitment;
  if (aiExp === "yes" || aiExp === "no") row.ai_exp = aiExp;
  if (pains) row.pains = pains;
  if (fear) row.fear = fear;
  // Источник входа: только известные значения, чужое отбрасываем.
  // "start" — личная продажа, "start_ads" — та же страница, но пришли с рекламы.
  if (source === "trenazher" || source === "start" || source === "start_ads") row.source = source;
  // Простая проверка на почту, без строгой валидации: пропускаем всё похожее
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) row.email = email.toLowerCase();

  // Ситуация только из известного списка, всё чужое отбрасываем
  const KNOWN_SITUATIONS = ["decree", "office", "studied", "relocate", "own"];
  if (row.situation && !KNOWN_SITUATIONS.includes(row.situation)) delete row.situation;
  const KNOWN_GOALS = ["50000", "100000", "150000", "unsure"];
  if (row.goal_sum && !KNOWN_GOALS.includes(row.goal_sum)) delete row.goal_sum;
  // Боли только из известного списка, через запятую, чужое выбрасываем
  const KNOWN_PAINS = ["alarm_job", "no_own_money", "credit_pressure"];
  if (row.pains) {
    const filtered = row.pains.split(",").map((s) => s.trim()).filter((s) => KNOWN_PAINS.includes(s));
    if (filtered.length) row.pains = filtered.join(","); else delete row.pains;
  }

  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/ts_goals?on_conflict=sid`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      }
    );

    if (!r.ok) {
      const text = await r.text();
      console.error("ts-goal supabase error:", r.status, text);
      return res.status(500).json({ error: "db" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("ts-goal error:", e.message);
    return res.status(500).json({ error: "server" });
  }
}
