// Серверна функція Vercel: приймає запит із сторінки й передає його до Claude.
// Ключ API ніколи не потрапляє в браузер — він лежить у змінних середовища Vercel.
const crypto = require('crypto');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_PROMPT_CHARS = 120000;

function sameCode(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Потрібен POST-запит.' });
  }

  // Необов'язковий код доступу: без нього будь-хто з посиланням витрачав би ваш рахунок.
  const need = process.env.ACCESS_CODE;
  if (need && !sameCode(req.headers['x-access-code'], need)) {
    return res.status(401).json({ error: 'Невірний або відсутній код доступу.' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'На сервері не задано ANTHROPIC_API_KEY (Vercel → Settings → Environment Variables).' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const prompt = body && typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return res.status(400).json({ error: 'Порожній запит.' });
  if (prompt.length > MAX_PROMPT_CHARS) return res.status(413).json({ error: 'Запит завеликий. Скоротіть текст програми.' });
  const maxTokens = Math.min(Math.max(parseInt(body.maxTokens, 10) || 4000, 256), 8000);

  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || 'Помилка Claude API (' + r.status + ').';
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return res.status(200).json({ text, truncated: data.stop_reason === 'max_tokens' });
  } catch (e) {
    return res.status(502).json({ error: 'Не вдалося зв’язатися з Claude API.' });
  }
};
