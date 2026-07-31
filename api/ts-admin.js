// Минимальная админка. Показывает список оплативших из таблицы ts_payments.
// Открывается по ссылке с секретным ключом: /api/ts-admin?key=ТВОЙ_КЛЮЧ
// Переменные окружения:
//   TS_ADMIN_KEY           — свой секретный ключ, придумай любой длинный пароль
//   SUPABASE_URL           — тот же URL проекта Supabase
//   SUPABASE_SERVICE_ROLE  — service_role ключ (секретный)
//
// Важно: тут видно, КТО оплатил и КОГДА. На каком уроке сейчас человек, эта страница
// не покажет, прогресс по урокам хранится в браузере самого человека, не в базе.

export default async function handler(req, res) {
  const key = req.query?.key || "";
  if (!process.env.TS_ADMIN_KEY || key !== process.env.TS_ADMIN_KEY) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send("<p style='font-family:sans-serif'>Неверный ключ.</p>");
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE;

    const r = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?select=email,paid,amount,currency,paid_at,created_at&order=paid_at.desc.nullslast`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const rows = await r.json();

    const rowsHtml = (Array.isArray(rows) ? rows : []).map((x) => `
      <tr>
        <td>${x.email || ""}</td>
        <td>${x.paid ? "✓ оплачено" : "—"}</td>
        <td>${x.amount ?? ""} ${x.currency ?? ""}</td>
        <td>${x.paid_at ? new Date(x.paid_at).toLocaleString("ru") : ""}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<title>Target School · оплатившие</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; }
  h1 { font-size: 20px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  .count { color: #666; margin-bottom: 16px; }
</style></head>
<body>
  <h1>Оплатившие · Target School</h1>
  <div class="count">Всего записей: ${Array.isArray(rows) ? rows.length : 0}</div>
  <table>
    <tr><th>Почта</th><th>Статус</th><th>Сумма</th><th>Когда оплатил</th></tr>
    ${rowsHtml || "<tr><td colspan='4'>Пока пусто</td></tr>"}
  </table>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>Ошибка: " + String(e) + "</p>");
  }
}
