// Минимальная админка. Показывает оплативших и отдельно тех, кто зарегистрировался,
// но не оплатил (с ними можно списаться, если оставили телеграм).
// Позволяет вручную открыть или убрать доступ по почте.
// Открывается по ссылке с секретным ключом: /api/ts-admin?key=ТВОЙ_КЛЮЧ
// Переменные окружения:
//   TS_ADMIN_KEY           — свой секретный ключ, придумай любой длинный пароль
//   SUPABASE_URL           — тот же URL проекта Supabase
//   SUPABASE_SERVICE_ROLE  — service_role ключ (секретный)
//
// Важно: тут видно, КТО оплатил и КОГДА. На каком уроке сейчас человек, эта страница
// не покажет, прогресс по урокам хранится в браузере самого человека, не в базе.
// Доступ на месяц не отключается автоматически, продления пока ручные: смотри колонку
// "Доступ до" и списывайся с человеком заранее.
//
// ОТКУДА ПРИШЁЛ (source): чтобы видеть, какая дверь принесла продажу, добавь в таблицу
// ts_payments колонку source (тип text). Один раз, в SQL-редакторе Supabase:
//   ALTER TABLE ts_payments ADD COLUMN source text;
// Дальше вебхук оплаты должен писать "lavatop" для холодной двери и "tribute" для тёплой.
// Ручная выдача из этой админки пишет "ручная", тестовый доступ пишет "тест".
// Пока колонки нет, всё работает по-старому, источник показывается прочерком.
//
// ТЕСТОВЫЙ ДОСТУП: галочка "тест" ставит сумму 0. Такие строки не считаются продажей
// и подписаны "тест". Публичный счётчик мест на сайте тоже должен считать только строки
// с суммой больше нуля, иначе тестовые доступы наберут сотню раньше реальных покупок.

const DAY_MS = 24 * 60 * 60 * 1000;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

const isTest = (x) => x.source === "тест" || Number(x.amount) === 0;

// Похоже ли сообщение на контакт: ник телеграма, ссылка, номер телефона или слово-маркер
const looksLikeContact = (s) =>
  /@[a-zA-Z0-9_]{4,}|t\.me\/|wa\.me\/|телеграм|telegram|ватсап|whatsapp|вотсап|(^|[^а-яёa-z])тг([^а-яёa-z]|$)/i.test(String(s || "")) ||
  /(?:\+?\d[\s\-()]?){7,}/.test(String(s || ""));

export default async function handler(req, res) {
  const key = req.query?.key || "";
  if (!process.env.TS_ADMIN_KEY || key !== process.env.TS_ADMIN_KEY) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send("<p style='font-family:sans-serif'>Неверный ключ.</p>");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  let message = "";

  const upsert = (payload) =>
    fetch(`${SUPABASE_URL}/rest/v1/ts_payments?on_conflict=email`, {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
    });

  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const email = (body.email || "").trim().toLowerCase();
      const action = body.action === "revoke" ? "revoke" : "grant";
      const test = !!(body.is_test && body.is_test !== "false");

      if (email) {
        const payload = action === "grant"
          ? {
              email,
              paid: true,
              amount: test ? 0 : (body.amount ? Number(body.amount) : 1490),
              currency: "RUB",
              paid_at: new Date().toISOString(),
              source: test ? "тест" : "ручная",
            }
          : { email, paid: false, paid_at: null };

        // Пробуем записать. Если колонки source в базе ещё нет, повторяем без неё,
        // чтобы выдача доступа сработала в любом случае.
        let up = await upsert(payload);
        let errText = "";
        if (!up.ok) {
          errText = await up.text();
          if ("source" in payload && /source/i.test(errText)) {
            const { source, ...rest } = payload;
            up = await upsert(rest);
            errText = up.ok ? "" : await up.text();
          }
        }

        if (action === "grant") {
          message = up.ok
            ? `Готово. Доступ открыт для ${esc(email)}${test ? " (тест, в счёт не идёт)" : ""}. Когда человек войдёт под этой почтой, платные уроки откроются.`
            : `Не получилось: ${esc(errText)}`;
        } else {
          message = up.ok
            ? `Готово. Доступ убран у ${esc(email)}. При следующем входе платные уроки снова закроются.`
            : `Не получилось: ${esc(errText)}`;
        }
      }
    }

    // Читаем через * , чтобы колонка source (если её ещё нет) не ломала запрос.
    const r = await fetch(`${SUPABASE_URL}/rest/v1/ts_payments?select=*&order=created_at.desc`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    const rows = await r.json();
    const all = Array.isArray(rows) ? rows : [];
    const paidRows = all.filter((x) => x.paid);
    const unpaidRows = all.filter((x) => !x.paid);
    const realSales = paidRows.filter((x) => !isTest(x));
    const testRows = paidRows.filter((x) => isTest(x));

    // Цифры для дашборда: вопросы ассистенту и кто онлайн. Если таблиц ещё нет, показываем прочерки.
    const sbHead = async (pathAndQuery) => {
      try {
        const rc = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
          method: "HEAD",
          headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: "count=exact" },
        });
        const n = parseInt((rc.headers.get("content-range") || "").split("/")[1], 10);
        return Number.isFinite(n) ? n : null;
      } catch (e) { return null; }
    };
    const dayStartIso = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); })();
    const onlineIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const [qToday, qEsc, onlineUsers, onlineGuests] = await Promise.all([
      sbHead(`ts_assistant_messages?role=eq.user&created_at=gte.${dayStartIso}&select=id`),
      sbHead(`ts_assistant_messages?role=eq.user&escalated=eq.true&worked=eq.false&select=id`),
      sbHead(`ts_presence?last_seen=gte.${onlineIso}&email=not.like.guest_*&select=email`),
      sbHead(`ts_presence?last_seen=gte.${onlineIso}&email=like.guest_*&select=email`),
    ]);
    const dash = (v) => (v == null ? "—" : v);

    // Горячие лиды из чата: не оплатившие, кто оставил контакт или позвал Анастасию, и это не проработано
    let hotLeads = [];
    try {
      const rmsg = await fetch(
        `${SUPABASE_URL}/rest/v1/ts_assistant_messages?role=eq.user&order=created_at.desc&limit=500&select=id,user_email,content,escalated,worked,created_at`,
        { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
      );
      const msgs = await rmsg.json();
      if (Array.isArray(msgs)) {
        const paidSet = new Set(paidRows.map((x) => x.email));
        const byPerson = {};
        for (const m of msgs) {
          if (paidSet.has(m.user_email)) continue;
          const p = byPerson[m.user_email] || (byPerson[m.user_email] = { email: m.user_email, last: m, contactMsg: null, escMsg: null });
          if (!p.contactMsg && looksLikeContact(m.content)) p.contactMsg = m;
          if (!p.escMsg && m.escalated) p.escMsg = m;
        }
        hotLeads = Object.values(byPerson)
          .map((p) => {
            const keyMsg = p.contactMsg || p.escMsg;
            if (!keyMsg || keyMsg.worked) return null;
            return {
              email: p.email,
              contact: p.contactMsg ? p.contactMsg.content : null,
              lastQ: p.last.content,
              when: keyMsg.created_at,
              msgId: keyMsg.id,
            };
          })
          .filter(Boolean)
          .sort((a, b) => new Date(b.when) - new Date(a.when))
          .slice(0, 10);
      }
    } catch (e) {}
    const leadWho = (e) => /^guest_/.test(e) ? `гость ${esc(e.slice(6, 10))}` : esc(e);

    // Выгрузка в CSV: /api/ts-admin?key=...&export=paid | unpaid | all
    const exportKind = (req.query?.export || "").toString();
    if (exportKind) {
      const untilOf = (x) => (x.paid_at ? new Date(new Date(x.paid_at).getTime() + 30 * DAY_MS) : null);
      let head = [];
      let lines = [];
      if (exportKind === "unpaid") {
        head = ["email", "telegram", "created_at"];
        lines = unpaidRows.map((x) => [x.email, x.telegram, x.created_at]);
      } else {
        const src = exportKind === "all" ? all : paidRows;
        head = ["email", "telegram", "source", "amount", "currency", "paid", "paid_at", "access_until", "created_at"];
        lines = src.map((x) => [
          x.email, x.telegram, x.source, x.amount, x.currency, x.paid,
          x.paid_at, untilOf(x) ? untilOf(x).toISOString().slice(0, 10) : "", x.created_at,
        ]);
      }
      const csv = [head, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ts-${exportKind}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send("\uFEFF" + csv);
    }

    const revokeForm = (email) => `
      <form method="POST" action="?key=${esc(key)}" style="display:inline">
        <input type="hidden" name="email" value="${esc(email)}" />
        <input type="hidden" name="action" value="revoke" />
        <button type="submit" class="link-btn" onclick="return confirm('Убрать доступ у этой почты?')">убрать доступ</button>
      </form>`;

    const paidRowsHtml = paidRows.map((x) => {
      const until = x.paid_at ? new Date(new Date(x.paid_at).getTime() + 30 * DAY_MS) : null;
      const t = isTest(x);
      return `
      <tr${t ? ' class="test"' : ""}>
        <td>${esc(x.email)}${t ? ' <span class="tag">тест</span>' : ""}</td>
        <td>${x.telegram ? esc(x.telegram) : "—"}</td>
        <td>${x.source ? esc(x.source) : "—"}</td>
        <td>${x.amount ?? ""} ${esc(x.currency)}</td>
        <td>${x.paid_at ? new Date(x.paid_at).toLocaleDateString("ru") : ""}</td>
        <td>${until ? until.toLocaleDateString("ru") : ""}</td>
        <td>${revokeForm(x.email)}</td>
      </tr>`;
    }).join("");

    const unpaidRowsHtml = unpaidRows.map((x) => `
      <tr>
        <td>${esc(x.email)}</td>
        <td>${x.telegram ? esc(x.telegram) : "—"}</td>
        <td>${x.created_at ? new Date(x.created_at).toLocaleDateString("ru") : ""}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Target School · оплатившие</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 940px; margin: 0 auto; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  tr.test td { color: #999; }
  .tag { background: #EEE; color: #666; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 600; }
  .count { color: #666; margin-bottom: 16px; }
  .box { background: #fff; border-radius: 12px; padding: 16px; }
  .box input[type=email] { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #E0E0E0; border-radius: 8px; font-size: 14px; margin-bottom: 10px; }
  .box label { display: block; font-size: 13px; color: #444; margin-bottom: 10px; }
  .box button { background: #1C1C1E; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
  .msg { background: #EFF9F0; border: 1px solid #B7E4BC; color: #1B7F3B; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  .msg.err { background: #FDEEEE; border-color: #F0B8B8; color: #B3261E; }
  .link-btn { background: none; border: none; color: #B3261E; text-decoration: underline; cursor: pointer; font-size: 13px; padding: 0; }
  .search { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #E0E0E0; border-radius: 8px; font-size: 14px; margin: 6px 0 16px; }
  .tools { margin: 6px 0 4px; font-size: 13px; }
  .tools a { color: #1C1C1E; }
  .dash { display: flex; gap: 12px; margin: 4px 0 20px; flex-wrap: wrap; }
  .card { flex: 1; min-width: 150px; background: #fff; border-radius: 12px; padding: 14px 16px; text-decoration: none; color: #1C1C1E; display: block; }
  .card-num { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; }
  .card-label { font-size: 13px; color: #666; margin-top: 2px; }
  .card-sub { font-size: 12px; color: #999; margin-top: 6px; }
  .card-sub .alert { color: #B3261E; }
</style></head>
<body>
  <h1>Target School · админка <button id="snd" style="float:right;background:#fff;border:1px solid #E0E0E0;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer">🔕 Звук выкл</button></h1>

  <div class="dash">
    <a class="card" href="/api/ts-admin-questions?key=${esc(key)}">
      <div class="card-num">${dash(qToday)}</div>
      <div class="card-label">вопросов сегодня</div>
      <div class="card-sub">${qEsc ? `<b class="alert">${qEsc} ждут Анастасию</b>` : "эскалаций нет"}</div>
    </a>
    <a class="card" href="/api/ts-presence?key=${esc(key)}">
      <div class="card-num" id="on-num">${dash(onlineUsers == null && onlineGuests == null ? null : (onlineUsers || 0) + (onlineGuests || 0))}</div>
      <div class="card-label">сейчас онлайн</div>
      <div class="card-sub" id="on-sub">учеников: ${dash(onlineUsers)} · гостей: ${dash(onlineGuests)}</div>
    </a>
    <div class="card">
      <div class="card-num">${realSales.length}</div>
      <div class="card-label">продаж всего</div>
      <div class="card-sub">${testRows.length ? `плюс ${testRows.length} тестовых` : "без тестовых"}</div>
    </div>
  </div>

  ${message ? `<div class="msg ${message.startsWith("Не получилось") ? "err" : ""}">${message}</div>` : ""}

  ${hotLeads.length ? `
  <div style="background:#FFF3E8;border:1px solid #F5C79A;border-radius:12px;padding:16px;margin:0 0 20px">
    <div style="font-size:15px;font-weight:700;margin-bottom:10px">🔥 Лиды из чата ждут ответа · ${hotLeads.length}</div>
    ${hotLeads.map((l) => `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:8px 0;border-top:1px solid #F5DEC4;font-size:14px">
        <div style="min-width:110px;color:#666">${leadWho(l.email)}</div>
        <div style="flex:1;min-width:200px">${l.contact ? `<b>${esc(l.contact)}</b>` : `<span style="color:#B3261E">нажал «Позвать Анастасию», контакта нет</span>`}
          <div style="color:#888;font-size:12px;margin-top:2px">последний вопрос: ${esc(String(l.lastQ || "").slice(0, 90))}</div>
        </div>
        <div style="color:#999;font-size:12px;white-space:nowrap">${esc(String(l.when || "").slice(0, 16).replace("T", " "))}</div>
        <button onclick="leadWork('${esc(l.msgId)}',this)" style="background:#1C1C1E;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer">взяла в работу</button>
      </div>`).join("")}
    <div style="margin-top:10px;font-size:13px"><a href="/api/ts-admin-questions?key=${esc(key)}&leads=1">все лиды, включая тёплых →</a></div>
  </div>` : ""}

  <input class="search" id="q" placeholder="Поиск по почте или телеграму" autocomplete="off" />

  <h2>ОТКРЫТЬ ДОСТУП ВРУЧНУЮ</h2>
  <div class="box">
    <form method="POST" action="?key=${esc(key)}">
      <input type="hidden" name="action" value="grant" />
      <input type="email" name="email" placeholder="Почта человека" required />
      <label><input type="checkbox" name="is_test" value="true" /> тест, не считать как продажу</label>
      <button type="submit">Открыть доступ</button>
    </form>
  </div>

  <h2>ОПЛАТИЛИ</h2>
  <div class="count">
    Продаж: ${realSales.length}${testRows.length ? `. Плюс ${testRows.length} тестовых, в счёт не идут.` : ""}
    <div class="tools"><a href="?key=${esc(key)}&export=paid">скачать оплативших (CSV)</a></div>
  </div>
  <table class="data">
    <thead><tr><th>Почта</th><th>Телеграм</th><th>Откуда</th><th>Сумма</th><th>Оплатил</th><th>Доступ до</th><th></th></tr></thead>
    <tbody>${paidRowsHtml || "<tr><td colspan='7'>Пока пусто</td></tr>"}</tbody>
  </table>

  <h2>ЗАРЕГИСТРИРОВАЛИСЬ, НЕ ОПЛАТИЛИ</h2>
  <div class="count">
    Всего: ${unpaidRows.length}. Можно написать, если оставили телеграм.
    <div class="tools"><a href="?key=${esc(key)}&export=unpaid">скачать этот список (CSV)</a></div>
  </div>
  <table class="data">
    <thead><tr><th>Почта</th><th>Телеграм</th><th>Когда зарегистрировался</th></tr></thead>
    <tbody>${unpaidRowsHtml || "<tr><td colspan='3'>Пока пусто</td></tr>"}</tbody>
  </table>

  <script>
    // Звук на нового человека онлайн и живая карточка. Питается страницей «Кто онлайн».
    var soundOn = false;
    var audioCtx = null;
    var sndBtn = document.getElementById('snd');
    if (sndBtn) sndBtn.addEventListener('click', function () {
      soundOn = !soundOn;
      if (soundOn && !audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (soundOn && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      sndBtn.textContent = soundOn ? '🔔 Звук вкл' : '🔕 Звук выкл';
      if (soundOn) ding();
    });
    function ding() {
      if (!soundOn || !audioCtx) return;
      try {
        [660, 880].forEach(function (freq, i) {
          var o = audioCtx.createOscillator();
          var g = audioCtx.createGain();
          o.type = 'sine';
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.12);
          g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + i * 0.12 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.12 + 0.35);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(audioCtx.currentTime + i * 0.12);
          o.stop(audioCtx.currentTime + i * 0.12 + 0.4);
        });
      } catch (e) {}
    }
    var knownOnline = null;
    function pollOnline() {
      fetch('/api/ts-presence?key=' + encodeURIComponent('${esc(key)}'), { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var rows = doc.querySelectorAll('#online-b tr[data-e]');
          var now = {};
          var guests = 0;
          rows.forEach(function (tr) {
            var e = tr.getAttribute('data-e');
            now[e] = true;
            if (e.indexOf('guest_') === 0) guests++;
          });
          var total = Object.keys(now).length;
          var numEl = document.getElementById('on-num');
          var subEl = document.getElementById('on-sub');
          if (numEl) numEl.textContent = total;
          if (subEl) subEl.textContent = 'учеников: ' + (total - guests) + ' · гостей: ' + guests;
          if (knownOnline !== null) {
            var fresh = Object.keys(now).filter(function (e) { return !knownOnline[e]; });
            if (fresh.length) ding();
          }
          knownOnline = now;
        })
        .catch(function () {});
    }
    pollOnline();
    setInterval(pollOnline, 10000);

    function leadWork(id, btn) {
      fetch('/api/ts-admin-questions?key=' + encodeURIComponent('${esc(key)}'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'work', id: id })
      }).then(function (r) {
        if (r.ok) { var row = btn.parentElement; row.style.opacity = '0.35'; btn.outerHTML = '✓'; }
      });
    }

    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () {
      var v = q.value.toLowerCase();
      document.querySelectorAll('table.data tbody tr').forEach(function (tr) {
        tr.style.display = tr.textContent.toLowerCase().indexOf(v) > -1 ? '' : 'none';
      });
    });
  </script>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>Ошибка: " + esc(String(e)) + "</p>");
  }
}
