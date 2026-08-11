// api/ts-goals-admin.js
// Админка «Ответы учеников»: точка старта и момент честности из урока 1.
// Открывается по адресу /api/ts-goals-admin?key=ВАШ_TS_ADMIN_KEY
// Выгрузка таблицей: /api/ts-goals-admin?key=...&csv=1
// Читает ts_goals через service role. Время показывается местное, UTC+7 (Нячанг).

const TZ_OFFSET_H = 7;

const SITUATION_RU = {
  decree: "Декрет",
  office: "Надоел найм",
  studied: "Уже училась",
  relocate: "Переезд",
  own: "Своё дело",
};
const GOAL_RU = {
  "50000": "50 000 ₽",
  "100000": "100 000 ₽",
  "150000": "150 000 ₽+",
  unsure: "Пока не знает",
};
const AI_RU = { yes: "Пользовалась", no: "Ни разу" };

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function localTime(iso) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET_H * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function countBy(rows, field, dict) {
  const out = {};
  for (const r of rows) {
    const v = r[field];
    if (!v) continue;
    out[v] = (out[v] || 0) + 1;
  }
  return Object.entries(out)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: (dict && dict[k]) || k, n }));
}

export default async function handler(req, res) {
  const key = req.query && req.query.key;
  if (!key || key !== process.env.TS_ADMIN_KEY) {
    return res.status(403).send("Нет доступа");
  }

  let rows = [];
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/ts_goals?select=*&order=updated_at.desc&limit=1000`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        },
      }
    );
    if (!r.ok) throw new Error("supabase " + r.status);
    rows = await r.json();
  } catch (e) {
    console.error("ts-goals-admin error:", e.message);
    return res.status(500).send("Ошибка чтения базы");
  }

  // Выгрузка CSV
  if (req.query.csv) {
    const head = ["sid", "niche", "situation", "goal_sum", "ai_exp", "commitment", "email", "created_at", "updated_at"];
    const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const csv = [head.join(";")]
      .concat(rows.map((r) => head.map((h) => cell(r[h])).join(";")))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ts_goals_${Date.now()}.csv"`);
    return res.status(200).send("\uFEFF" + csv);
  }

  const total = rows.length;
  const withCommit = rows.filter((r) => r.commitment && r.commitment.trim()).length;
  const withEmail = rows.filter((r) => r.email).length;
  const bySituation = countBy(rows, "situation", SITUATION_RU);
  const byGoal = countBy(rows, "goal_sum", GOAL_RU);
  const byAi = countBy(rows, "ai_exp", AI_RU);

  const statCard = (label, value, sub) => `
    <div class="stat">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
    </div>`;

  const distBlock = (title, items) => `
    <div class="card">
      <div class="card-title">${esc(title)}</div>
      ${items.length === 0 ? '<div class="empty">Пока пусто</div>' : items.map((x) => `
        <div class="dist-row">
          <span>${esc(x.label)}</span>
          <span class="dist-n">${x.n}<span class="dist-pct"> · ${total ? Math.round((x.n / total) * 100) : 0}%</span></span>
        </div>`).join("")}
    </div>`;

  const feed = rows.slice(0, 200).map((r) => `
    <div class="lead${r.email ? " lead-hot" : ""}">
      <div class="lead-top">
        <span class="tag">${esc(SITUATION_RU[r.situation] || "—")}</span>
        <span class="tag tag-goal">${esc(GOAL_RU[r.goal_sum] || "—")}</span>
        <span class="tag ${r.ai_exp === "no" ? "tag-new" : ""}">${esc(r.ai_exp ? "Нейросеть: " + AI_RU[r.ai_exp] : "")}</span>
        <span class="lead-time">${esc(localTime(r.updated_at))}</span>
      </div>
      ${r.niche ? `<div class="lead-niche">Ниша: ${esc(r.niche)}</div>` : ""}
      ${r.commitment ? `<div class="lead-commit">«${esc(r.commitment)}»</div>` : ""}
      ${r.email ? `<div class="lead-email">🔥 ${esc(r.email)}</div>` : ""}
    </div>`).join("");

  const html = `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ответы учеников · Target School</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; background: #F5F5F7; color: #1D1D1F; padding: 18px; max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; letter-spacing: -0.02em; margin-bottom: 4px; }
  .sub { color: #86868B; font-size: 13px; margin-bottom: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .stat { background: #fff; border-radius: 14px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  .stat-label { font-size: 11px; font-weight: 700; color: #86868B; letter-spacing: .03em; text-transform: uppercase; }
  .stat-value { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin-top: 2px; }
  .stat-sub { font-size: 12px; color: #86868B; margin-top: 2px; }
  .card { background: #fff; border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); margin-bottom: 12px; }
  .card-title { font-size: 12px; font-weight: 700; letter-spacing: .03em; color: #86868B; text-transform: uppercase; margin-bottom: 8px; }
  .dist-row { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid rgba(0,0,0,.06); font-size: 14px; }
  .dist-row:first-of-type { border-top: none; }
  .dist-n { font-weight: 700; }
  .dist-pct { color: #86868B; font-weight: 400; }
  .empty { color: #86868B; font-size: 14px; }
  .lead { background: #fff; border-radius: 14px; padding: 13px 15px; box-shadow: 0 1px 3px rgba(0,0,0,.05); margin-bottom: 10px; }
  .lead-hot { background: #FFF3E8; box-shadow: none; border: 1px solid #F5C79A; }
  .lead-top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { background: #F5F5F7; border-radius: 99px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
  .tag-goal { background: rgba(255,204,0,.25); }
  .tag-new { background: rgba(52,199,89,.15); color: #1B7F3B; }
  .lead-time { margin-left: auto; color: #86868B; font-size: 12px; }
  .lead-niche { font-size: 13px; color: #86868B; margin-top: 7px; }
  .lead-commit { font-size: 14.5px; line-height: 1.5; margin-top: 7px; font-style: italic; }
  .lead-email { font-size: 13px; font-weight: 700; margin-top: 7px; color: #1B7F3B; }
  .btn-link { display: inline-block; background: #fff; border: 1px solid #E0E0E0; border-radius: 10px; padding: 9px 16px; font-size: 13.5px; font-weight: 700; color: #1D1D1F; text-decoration: none; margin: 0 8px 8px 0; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; margin: 6px 0 14px; }
  h2 { font-size: 15px; margin: 18px 0 10px; letter-spacing: -0.01em; }
</style></head>
<body>
  <h1>Ответы учеников</h1>
  <div class="sub">Точка старта и момент честности из урока 1 · время местное (UTC+7) · показаны последние 200</div>
  <div class="tools">
    <a class="btn-link" href="/api/ts-admin?key=${esc(key)}">← в админку</a>
    <a class="btn-link" href="?key=${esc(key)}&csv=1">Скачать всё таблицей (CSV)</a>
  </div>
  <div class="stats">
    ${statCard("Всего ответов", total)}
    ${statCard("С обязательством", withCommit, total ? Math.round((withCommit / total) * 100) + "% написали текст" : "")}
    ${statCard("С почтой", withEmail, "склеены с регистрацией")}
  </div>
  ${distBlock("Ситуации", bySituation)}
  ${distBlock("Цели через 3 месяца", byGoal)}
  ${distBlock("Опыт нейросетей", byAi)}
  <h2>Лента, свежие сверху</h2>
  ${feed || '<div class="card"><div class="empty">Ответов пока нет. Появятся после деплоя панели.</div></div>'}
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
