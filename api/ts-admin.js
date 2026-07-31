// Минимальная админка. Показывает список оплативших из таблицы ts_payments,
// и позволяет вручную открыть доступ по почте, если оплата прошла, а вебхук
// по какой-то причине не сработал.
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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  let message = "";

  try {
    // Если пришла форма с почтой — вручную помечаем оплату, до того как показать таблицу
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const email = (body.email || "").trim().toLowerCase();
      if (email) {
        const up = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
          method: "POST",
          headers: {
            apikey: SERVICE,
            Authorization: `Bearer ${SERVICE}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            email,
            paid: true,
            amount: body.amount ? Number(body.amount) : 1490,
            currency: "RUB",
            paid_at: new Date().toISOString(),
          }),
        });
        message = up.ok
          ? `Готово. Доступ открыт для ${email}. Когда человек войдёт под этой почтой, платные уроки откроются.`
          : `Не получилось: ${await up.text()}`;
      }
    }

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
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  .count { color: #666; margin-bottom: 16px; }
  .box { background: #fff; border-radius: 12px; padding: 16px; }
  .box input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #E0E0E0; border-radius: 8px; font-size: 14px; margin-bottom: 10px; }
  .box button { background: #1C1C1E; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
  .msg { background: #EFF9F0; border: 1px solid #B7E4BC; color: #1B7F3B; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .msg.err { background: #FDEEEE; border-color: #F0B8B8; color: #B3261E; }
</style></head>
<body>
  <h1>Target School · админка</h1>

  ${message ? `<div class="msg ${message.startsWith("Не получилось") ? "err" : ""}">${message}</div>` : ""}

  <h2>ОТКРЫТЬ ДОСТУП ВРУЧНУЮ</h2>
  <div class="box">
    <form method="POST" action="?key=${key}">
      <input type="email" name="email" placeholder="Почта человека" required />
      <button type="submit">Открыть доступ</button>
    </form>
  </div>

  <h2>ОПЛАТИВШИЕ</h2>
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
