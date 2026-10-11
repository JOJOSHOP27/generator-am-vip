import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://am.kyzzz.xyz';
const FALLBACK_API_KEY = process.env.AM_API_KEY || '';
const DEFAULT_CONTINUE = 'https://alightcreative.com?ui_sid%3D0366624874%26ui_sd%3D0&lang=en';

const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': BASE_URL,
  'Referer': `${BASE_URL}/am`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ─────── Bangun URL final dari input apapun ─────── */
function buildFinalUrl(input) {
  const raw = (input || '').replace(/\s+/g, '').trim();
  if (!raw) return { url: null, reason: 'input kosong' };

  // Full URL — pakai apa adanya
  if (/^https?:\/\//i.test(raw)) return { url: raw, reason: 'full url' };

  // Cari oobCode
  let oobCode = null;
  const oobMatch = raw.match(/oobCode=([^&]+)/);
  if (oobMatch) oobCode = oobMatch[1];

  // Kalau nggak ada oobCode=, cek token mentah (panjang > 20, tanpa =)
  if (!oobCode && !raw.includes('=') && raw.length > 20) {
    oobCode = raw;
  }

  // Kalau masih nggak ada, coba ekstrak segmen panjang
  if (!oobCode) {
    const guess = raw.match(/([A-Za-z0-9_\-]{30,})/);
    if (guess) oobCode = guess[1];
  }

  if (!oobCode) return { url: null, reason: 'oobCode tidak ditemukan di input' };

  // Cari apiKey dari input
  let apiKey = null;
  const apiMatch = raw.match(/apiKey=([^&]+)/);
  if (apiMatch) apiKey = apiMatch[1];

  // Fallback ke env kalau link kepotong
  if (!apiKey) apiKey = FALLBACK_API_KEY;

  if (!apiKey) {
    return { url: null, reason: 'apiKey tidak ada di link dan AM_API_KEY env juga kosong' };
  }

  // Cari continueUrl dari input
  let continueUrl = DEFAULT_CONTINUE;
  const cMatch = raw.match(/continueUrl=([^&]+)/);
  if (cMatch) continueUrl = decodeURIComponent(cMatch[1]);

  const url = `https://alightcreative.com/auth_action/?apiKey=${apiKey}&mode=signIn&oobCode=${oobCode}&continueUrl=${continueUrl}`;
  return { url, reason: 'reconstructed', apiKey, oobCode };
}

/* ─────── /api/send-link ─────── */
app.post('/api/send-link', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'Format email tidak valid' });
    }
    const { data } = await axios.post(
      `${BASE_URL}/api/send-link`,
      { email: email.trim().toLowerCase() },
      { headers: HEADERS, timeout: 15000 }
    );
    return res.json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.response?.data?.error || err.message || 'Gagal mengirim link'
    });
  }
});

/* ─────── /api/verify ─────── */
app.post('/api/verify', async (req, res) => {
  const { email, link } = req.body || {};
  if (!email || !link) {
    return res.status(400).json({ ok: false, error: 'Email dan link wajib diisi' });
  }

  const built = buildFinalUrl(link);
  console.log('═'.repeat(60));
  console.log(`[AM] Email   : ${email}`);
  console.log(`[AM] Input   : ${link.substring(0, 150)}${link.length > 150 ? '...' : ''}`);
  console.log(`[AM] Length  : ${link.length} chars`);
  console.log(`[AM] Reason  : ${built.reason}`);
  console.log(`[AM] Final   : ${built.url ? built.url.substring(0, 150) + '...' : 'NULL'}`);
  console.log('═'.repeat(60));

  if (!built.url) {
    return res.status(400).json({ ok: false, error: `Gagal parse link: ${built.reason}` });
  }

  try {
    const result = await processAmKyzz({ email, finalUrl: built.url, headless: true });
    if (!result.apiResult) {
      return res.status(500).json({
        ok: false,
        error: result.error || 'Tidak ada respons dari server AM',
        debug: result.debug
      });
    }
    return res.json(result.apiResult);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────── /api/stats ─────── */
app.get('/api/stats', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE_URL}/api/stats`, {
      headers: HEADERS, timeout: 8000
    }).catch(() => ({ data: null }));
    if (data) return res.json(data);
    return res.json({ total: '300', uptime: '7 Hari 1 Jam', status: '100% Online' });
  } catch {
    return res.json({ total: '300', uptime: '7 Hari 1 Jam', status: '100% Online' });
  }
});

/* ─────── Playwright automation ─────── */
async function processAmKyzz({ email, finalUrl, headless = true }) {
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  console.log('[AM] Browser launched');

  const context = await browser.newContext({
    userAgent: HEADERS['User-Agent'],
    viewport: { width: 800, height: 600 }
  });
  const page = await context.newPage();

  await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (['image', 'media', 'font'].includes(t)) return route.abort();
    return route.continue();
  });

  try {
    console.log('[AM] Opening /am...');
    await page.goto(`${BASE_URL}/am`, { waitUntil: 'domcontentloaded', timeout: 45000 });

    await page.locator("input[type='email'], input[placeholder*='email']").first().fill(email.trim().toLowerCase());
    console.log('[AM] Email filled');

    await page.locator("button:has-text('KIRIM')").first().click();
    console.log('[AM] KIRIM clicked');

    const lanjutBtn = page.locator("button:has-text('LANJUT KE VERIFIKASI')");
    await lanjutBtn.waitFor({ state: 'visible', timeout: 25000 });
    await lanjutBtn.click();
    console.log('[AM] LANJUT clicked');
    await page.waitForTimeout(2000);

    const linkInput = page.locator(
      "input[placeholder*='tautan'], textarea[placeholder*='tautan'], input[placeholder*='link'], input[type='text'], textarea"
    ).first();
    await linkInput.waitFor({ state: 'visible', timeout: 15000 });
    await linkInput.click();
    await linkInput.fill('');
    await linkInput.type(finalUrl, { delay: 3 });
    await linkInput.evaluate((el) => {
      ['input', 'change', 'keyup', 'blur'].forEach(ev =>
        el.dispatchEvent(new Event(ev, { bubbles: true }))
      );
    });
    console.log('[AM] Link typed');

    const verifyBtn = page.locator("button:has-text('VERIFIKASI')").first();
    const handle = await verifyBtn.elementHandle();

    let enabled = false;
    try {
      await page.waitForFunction((b) => b && !b.disabled, handle, { timeout: 30000 });
      enabled = true;
      console.log('[AM] ✓ Verify button ENABLED');
    } catch {
      console.log('[AM] ✗ Verify button STILL DISABLED after 30s');
    }

    if (!enabled) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const debug = bodyText.substring(0, 800);
      console.log('[AM] Body preview:', debug);
      return {
        status: false,
        email,
        apiResult: null,
        error: 'Tombol VERIFIKASI tetap disabled. Kemungkinan: link expired, oobCode tidak valid, atau halaman menampilkan pesan error.',
        debug
      };
    }

    let verifyResponse = null;
    page.on('response', async (r) => {
      if (r.url().includes('/api/verify')) {
        try { verifyResponse = await r.json(); } catch {}
      }
    });

    await verifyBtn.click();
    console.log('[AM] Verify clicked, waiting...');
    await page.waitForTimeout(10000);

    if (verifyResponse) {
      console.log('[AM] ✓ Response:', JSON.stringify(verifyResponse));
      return { status: verifyResponse.ok, email, apiResult: verifyResponse };
    }

    return {
      status: false,
      email,
      apiResult: null,
      error: 'Klik verify terkirim tapi tidak ada respons dari server.'
    };
  } catch (err) {
    console.error('[AM] Error:', err.message);
    throw err;
  } finally {
    await browser.close();
    console.log('[AM] Browser closed');
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═'.repeat(60));
  console.log(`  FORESTER WEB RUNNING on :${PORT}`);
  console.log('═'.repeat(60));
});
