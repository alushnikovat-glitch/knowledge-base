// Публичный эндпоинт: сколько человек реально оплатили. Отдаёт только число, без почт
// и другой личной информации, поэтому безопасен для прямого вызова с сайта.
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE (те же, что и у остальных функций)

export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE;

    const r = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?select=id&paid=eq.true`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: "count=exact" },
    });
    const rows = await r.json().catch(() => []);
    const count = Array.isArray(rows) ? rows.length : 0;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60"); // не дёргаем базу на каждый заход
    return res.status(200).json({ count });
  } catch (e) {
    return res.status(200).json({ count: null });
  }
}
