// api/tg-sub.js
// Замок подписки для мини-приложения @tschoolai_bot.
// Проверяет, что запрос пришёл из Telegram, и спрашивает у Telegram,
// состоит ли человек в канале. Ответ: { subscribed: true | false }.
//
// Адрес после деплоя: https://www.anastasialushnikova.com/api/tg-sub
//
// Перед работой добавить в Vercel → Settings → Environment Variables:
//   TG_BOT_TOKEN = токен бота @tschoolai_bot из BotFather
//   TG_CHANNEL   = @target_school1   (можно не добавлять, это значение по умолчанию)
//
// Важно: бот @tschoolai_bot должен быть администратором канала,
// иначе Telegram не отдаст статус подписки.
// Пока токена нет, функция пропускает всех, чтобы приложение не закрылось.

import crypto from 'crypto';

function checkInitData(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc !== hash) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.TG_BOT_TOKEN;
  const channel = process.env.TG_CHANNEL || '@target_school1';
  if (!token) return res.status(200).json({ subscribed: true, reason: 'no-token' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const user = checkInitData(body.initData || '', token);
  if (!user || !user.id) return res.status(401).json({ subscribed: false, reason: 'bad-init-data' });

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${user.id}`);
    const j = await r.json();
    if (!j.ok) {
      console.warn('tg-sub: Telegram ответил ошибкой', j.description);
      return res.status(200).json({ subscribed: true, reason: 'tg-error' });
    }
    const s = j.result.status;
    const subscribed = s === 'creator' || s === 'administrator' || s === 'member' || (s === 'restricted' && j.result.is_member);
    return res.status(200).json({ subscribed });
  } catch (e) {
    console.error('tg-sub:', e);
    return res.status(200).json({ subscribed: true, reason: 'fetch-error' });
  }
}
