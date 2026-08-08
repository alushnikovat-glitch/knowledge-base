// Сырой счётчик заходов на страницу тренажёра.
// Стреляет мгновенно, без задержки в 3 секунды, в отличие от ts-presence.
// Живёт в отдельной таблице ts_hits, никогда не путается с честной воронкой
// в «Сутки по точкам». Нужен только для одного числа: сколько раз вообще
// открыли страницу сегодня, включая тех, кто ушёл раньше, чем что-то увидел.
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const identity = String(body.identity || "").trim().slice(0, 254);
    if (!identity) return res.status(400).json({ ok: false });

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/ts_hits`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identity }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
