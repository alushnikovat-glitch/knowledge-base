// Фиксирует факт регистрации: почта и, если оставили, телеграм для связи.
// Вызывается с сайта сразу после успешной регистрации или входа.
// Специально НЕ трогает поле paid: если человек уже когда-то оплатил,
// эта функция не сбросит его статус, просто обновит телеграм при желании.
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

    const r = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({ error: "supabase upsert failed", detail });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
