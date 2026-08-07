// Кто сейчас в тренажёре.
// Панель раз в минуту шлёт POST { email, lesson, sub }, тут запоминается последняя точка.
// Страница для глаз: /api/ts-presence?key=ТВОЙ_КЛЮЧ (тот же ключ, что у админки).
// Онлайн это те, кого видели за последние 3 минуты. Страница сама обновляется раз в 30 секунд.
// Переменные окружения те же: TS_ADMIN_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE

const ONLINE_MS = 3 * 60 * 1000;
// Часовой пояс для расчёта суток (Нячанг, UTC+7). При переезде поменять одно число.
const TZ_OFFSET_H = 7;
// Начало сегодняшнего дня по местному времени, в UTC
function localDayStart(shiftDays = 0) {
  const shifted = new Date(Date.now() + TZ_OFFSET_H * 3600 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_H * 3600 * 1000 - shiftDays * 24 * 3600 * 1000);
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const LESSON_NAMES = ["вход", "Аудитория", "Креативы", "Кабинет", "Блокировки", "Клиент", "Запуск", "Цифры", "Кейс", "Следующий уровень", "Пиксель"];

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
  const sb = (pathAndQuery, opts = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      ...opts,
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

  try {
    // Пинг из панели
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
      const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const okGuest = /^guest_[a-z0-9]{6,16}$/.test(email);
      if (!okEmail && !okGuest) return res.status(400).json({ ok: false });
      const lesson = parseInt(body.lesson, 10) || 0;
      const sub = parseInt(body.sub, 10) || 0;
      const spot = String(body.spot || "").slice(0, 80);
      const row = { email, lesson, sub, last_seen: new Date().toISOString() };
      if (spot) row.spot = spot;
      let up = await sb("ts_presence?on_conflict=email", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(row),
      });
      // если колонки spot в базе ещё нет, повторяем без неё, чтобы отметка не пропала
      if (!up.ok && spot) {
        const errText = await up.text();
        if (/spot/i.test(errText)) {
          delete row.spot;
          up = await sb("ts_presence?on_conflict=email", {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify(row),
          });
        }
      }
      return res.status(200).json({ ok: up.ok });
    }

    // Страница для Анастасии
    const key = req.query?.key || "";
    if (!process.env.TS_ADMIN_KEY || key !== process.env.TS_ADMIN_KEY) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(401).send("<p style='font-family:sans-serif'>Неверный ключ.</p>");
    }

    const r = await sb(`ts_presence?select=*&order=last_seen.desc&limit=1000`);
    const rows = await r.json();
    const all = Array.isArray(rows) ? rows : [];

    // Выгрузка для анализа: кто, последняя точка, когда
    if (req.query?.export === "1") {
      const csvCell = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
      const head = ["kto", "tip", "poslednyaya_tochka", "lesson", "sub", "kogda_utc"];
      const lines = all.map((x) => [
        x.email,
        /^guest_/.test(x.email) ? "гость" : "с почтой",
        x.spot || "",
        x.lesson,
        x.sub,
        x.last_seen,
      ]);
      const csv = [head, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ts-presence-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send("\uFEFF" + csv);
    }
    const now = Date.now();
    const online = all.filter((x) => now - new Date(x.last_seen).getTime() < ONLINE_MS);
    const todayStart = localDayStart(0).getTime();
    const yesterdayStart = localDayStart(1).getTime();
    const today = all.filter((x) => new Date(x.last_seen).getTime() >= todayStart);
    const yesterday = all.filter((x) => {
      const t = new Date(x.last_seen).getTime();
      return t >= yesterdayStart && t < todayStart;
    });

    const ago = (t) => {
      const m = Math.round((now - new Date(t).getTime()) / 60000);
      if (m < 1) return "только что";
      if (m < 60) return `${m} мин назад`;
      const h = Math.round(m / 60);
      return h < 24 ? `${h} ч назад` : new Date(t).toLocaleDateString("ru");
    };
    const place = (x) => {
      if (x.spot) return x.spot;
      const name = LESSON_NAMES[x.lesson] || "";
      return x.lesson ? `урок ${x.lesson}${name ? " · " + name : ""}, экран ${x.sub}` : "вход или бесплатная часть";
    };
    const isGuest = (x) => /^guest_/.test(x.email);
    const who = (x) => isGuest(x) ? `<span class="guest">гость ${esc(x.email.slice(6, 10))}</span>` : esc(x.email);

    const rowHtml = (x, dot) => `
      <tr data-e="${esc(x.email)}">
        <td>${dot ? '<span class="dot"></span>' : ""}${who(x)}</td>
        <td>${esc(place(x))}</td>
        <td style="white-space:nowrap;color:#666">${esc(ago(x.last_seen))}</td>
      </tr>`;

    const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Target School · кто онлайн</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #F6F6F4; color: #1C1C1E; padding: 24px; max-width: 860px; margin: 0 auto; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  a { color: #1C1C1E; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #E8E8E8; font-size: 14px; }
  th { background: #F0F0EE; font-size: 12px; text-transform: uppercase; color: #666; }
  .count { color: #666; margin-bottom: 4px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #34C759; margin-right: 8px; }
  .guest { color: #8E8E93; }
  .tools { margin: 6px 0 16px; font-size: 13px; }
  .note { color: #999; font-size: 12px; margin-top: 16px; }
</style></head>
<body>
  <h1>Кто в тренажёре <button id="snd" style="float:right;background:#fff;border:1px solid #E0E0E0;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer">🔕 Звук выкл</button></h1>
  <div class="tools"><a href="/api/ts-admin?key=${esc(key)}">← назад в админку</a> · <a href="/api/ts-presence?key=${esc(key)}&export=1">скачать выгрузку (CSV)</a></div>

  <h2 id="online-h">СЕЙЧАС ОНЛАЙН · ${online.length}${online.filter(isGuest).length ? ` (из них гостей: ${online.filter(isGuest).length})` : ""}</h2>
  <table>
    <thead><tr><th>Почта</th><th>Где</th><th>Когда</th></tr></thead>
    <tbody id="online-b">${online.map((x) => rowHtml(x, true)).join("") || "<tr><td colspan='3'>Сейчас никого</td></tr>"}</tbody>
  </table>

  <h2>ПО ТОЧКАМ: СЕГОДНЯ И ВЧЕРА <span style="font-weight:400;color:#999;font-size:12px">(сутки по местному времени)</span></h2>
  <table>
    <thead><tr><th>Где остановились</th><th>Сегодня</th><th>Доля</th><th>Вчера</th><th>Доля</th></tr></thead>
    <tbody>
      ${(() => {
        const spotOf = (x) => x.spot || (x.lesson ? `урок ${x.lesson}` : "вход");
        const cnt = (arr) => {
          const m = {};
          for (const x of arr) m[spotOf(x)] = (m[spotOf(x)] || 0) + 1;
          return m;
        };
        const t = cnt(today), y = cnt(yesterday);
        const spots = [...new Set([...Object.keys(t), ...Object.keys(y)])];
        spots.sort((a, b) => (t[b] || 0) - (t[a] || 0) || (y[b] || 0) - (y[a] || 0));
        const pct = (n, total) => total ? Math.round((n / total) * 100) + "%" : "—";
        return spots.map((s) => `<tr>
          <td>${esc(s)}</td>
          <td>${t[s] || 0}</td><td>${pct(t[s] || 0, today.length)}</td>
          <td style="color:#999">${y[s] || 0}</td><td style="color:#999">${pct(y[s] || 0, yesterday.length)}</td>
        </tr>`).join("");
      })()}
      <tr style="font-weight:700"><td>всего</td><td>${today.length}</td><td></td><td style="color:#999">${yesterday.length}</td><td></td></tr>
    </tbody>
  </table>

  <h2 id="day-h">БЫЛИ СЕГОДНЯ · ${today.length}</h2>
  <table>
    <thead><tr><th>Почта</th><th>Последняя точка</th><th>Когда</th></tr></thead>
    <tbody id="day-b">${today.map((x) => rowHtml(x, false)).join("") || "<tr><td colspan='3'>Пока пусто</td></tr>"}</tbody>
  </table>

  <script>
    var soundOn = false;
    var audioCtx = null;
    var sndBtn = document.getElementById("snd");
    sndBtn.addEventListener("click", function () {
      soundOn = !soundOn;
      if (soundOn && !audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (soundOn && audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      sndBtn.textContent = soundOn ? "🔔 Звук вкл" : "🔕 Звук выкл";
      if (soundOn) ding();
    });

    function ding() {
      if (!soundOn || !audioCtx) return;
      try {
        [660, 880].forEach(function (freq, i) {
          var o = audioCtx.createOscillator();
          var g = audioCtx.createGain();
          o.type = "sine";
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

    function onlineSet() {
      var s = {};
      document.querySelectorAll("#online-b tr[data-e]").forEach(function (tr) {
        s[tr.getAttribute("data-e")] = true;
      });
      return s;
    }

    var known = onlineSet();

    setInterval(function () {
      fetch(location.href, { cache: "no-store" })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          ["online-h", "online-b", "day-h", "day-b"].forEach(function (id) {
            var from = doc.getElementById(id);
            var to = document.getElementById(id);
            if (from && to) to.innerHTML = from.innerHTML;
          });
          var now = onlineSet();
          var fresh = Object.keys(now).filter(function (e) { return !known[e]; });
          if (fresh.length) ding();
          known = now;
        })
        .catch(function () {});
    }, 10000);
  </script>
  <div class="note">Цифры обновляются сами каждые 10 секунд, без перезагрузки страницы. Кнопка звука сверху: включи один раз, и каждый новый человек в списке онлайн отзовётся сигналом. Браузер требует этот клик, сам по себе звук включиться не может. Онлайн это активность за последние 3 минуты. «Последняя точка» это место, где человека видели в последний раз, удобно смотреть, где застревают. Гости это люди без регистрации: метка вида «гость 4f2k» живёт в их браузере, почты у них нет. Если гость потом зарегистрируется, он появится в списке уже с почтой, отдельной строкой.</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send("<p>Ошибка: " + esc(String(e)) + "</p>");
  }
}
