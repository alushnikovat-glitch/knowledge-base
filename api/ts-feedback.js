// Принимает быструю обратную связь от гостей, которые задержались на экране
// захвата и не нажали кнопку. Не эмоции, не чат, просто причина одним тапом.
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const identity = String(body.identity || "").trim().slice(0, 254);
    const reason = String(body.reason || "").trim().slice(0, 200);
    const screen = String(body.screen || "").trim().slice(0, 100);
    if (!identity || !reason) return res.status(400).json({ ok: false });

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/ts_feedback`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ identity, reason, screen }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: false });
  }
}
