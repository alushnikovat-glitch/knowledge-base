// Фиксирует факт регистрации: почта и, если оставили, телеграм для связи.
// Вызывается с сайта сразу после успешной регистрации или входа.
// Специально НЕ трогает поле paid: если человек уже когда-то оплатил,
// эта функция не сбросит его статус, просто обновит телеграм при желании.
//
// Дополнительно ловит опознавательные данные для рекламы Meta:
// куки пикселя (_fbp, _fbc), айпи и браузер. Они лежат в базе и при оплате
// уходят в Conversions API вместе с событием Purchase, чтобы Meta понимала,
// какому человеку принадлежит покупка (качество сопоставления).
// Если этих колонок в базе ещё нет, запись повторяется без них,
// регистрация сработает в любом случае.
//
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE (уже есть у остальных функций)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = (body.email || "").trim().toLowerCase();
    const telegram = (body.telegram || "").trim();
    if (!email) return res.status(400).json({ error: "email required" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE;

    const payload = { email };
    if (telegram) payload.telegram = telegram;

    // Опознавательные данные из запроса браузера
    try {
      const cookies = {};
      String(req.headers.cookie || "").split(";").forEach((p) => {
        const i = p.indexOf("=");
        if (i > 0) cookies[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      });
      if (cookies._fbp) payload.fbp = cookies._fbp.slice(0, 100);
      if (cookies._fbc) payload.fbc = cookies._fbc.slice(0, 400);
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (ip) payload.reg_ip = ip.slice(0, 45);
      const ua = String(req.headers["user-agent"] || "");
      if (ua) payload.reg_ua = ua.slice(0, 300);
    } catch (e) {}

    const upsert = (p) =>
      fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
        method: "POST",
        headers: {
          apikey: SERVICE,
          Authorization: `Bearer ${SERVICE}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(p),
      });

    let r = await upsert(payload);
    if (!r.ok) {
      // Колонок fbp/fbc/reg_ip/reg_ua может ещё не быть, повторяем без них
      const detail = await r.text();
      if (/fbp|fbc|reg_ip|reg_ua/i.test(detail)) {
        const clean = { email };
        if (telegram) clean.telegram = telegram;
        r = await upsert(clean);
      }
      if (!r.ok) {
        const detail2 = await r.text();
        return res.status(500).json({ error: "supabase upsert failed", detail: detail2 });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
