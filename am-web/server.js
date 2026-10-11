import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://am.kyzzz.xyz';
const API_KEY  = 'AIzaSyDrZ9jr_Y16ltSBqsQR5IH6I04FRga6Ki0';

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

/**
 * Bangun URL final dari input apapun.
 * Menerima:
 *   - full URL
 *   - query string dengan apiKey
 *   - query string tanpa apiKey
 *   - oobCode doang
 */
function buildFinalUrl(input) {
  const raw = (input || '').replace(/\s+/g, '').trim();
  if (!raw) return null;

  // 1) Full URL — pakai apa adanya
  if (/^https?:\/\//i.test(raw)) return raw;

  // 2) Cari oobCode di input
  let oobCode = null;
  const oobMatch = raw.match(/oobCode=([^&]+)/);
  if (oobMatch) oobCode = oobMatch[1];

  // 3) Cari apiKey
  let apiKey = API_KEY;
  const apiMatch = raw.match(/apiKey=([^&]+)/);
  if (apiMatch) apiKey = apiMatch[1];

  // 4) Kalau tidak ada oobCode= tapi raw keliatan seperti token mentah
  //    (tidak ada = dan panjang > 20) — anggap sebagai oobCode
  if (!oobCode && !raw.includes('=') && raw.length > 20) {
    oobCode = raw;
  }

  // 5) Kalau masih tidak ada oobCode, coba cari segmen panjang setelah "oobCode" atau sebelum "&continueUrl"
  if (!oobCode) {
    const tokenGuess = raw.match(/([A-Za-z0-9_\-]{30,})/);
    if (tokenGuess) oobCode = tokenGuess[1];
  }

  if (!oobCode) return null;

  // 6) Bangun URL final
  return `https://alightcreative.com/auth_action/?apiKey=${apiKey}&mode=signIn&oobCode=${oobCode}&continueUrl=https://alightcreative.com?ui_sid%3D0366624874%26ui_sd%3D0&lang=en`;
}

app.post('/api/send-link', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Format email tidak valid' });
    const { data } = await axios.post(`${BASE_URL}/api/send-link`, { email: email.trim().toLowerCase() }, { headers: HEADERS, timeout: 15000 });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.response?.data?.error || err.message || 'Gagal mengirim link' });
  }
});

app.post('/api/verify', async (req, res) => {
  const { email, link } = req.body || {};
  if (!email || !link) return res.status(400).json({ ok: false, error: 'Email dan link wajib diisi' });

  const finalUrl = buildFinalUrl(link);
  console.log(`[AM] ============================================`);
  console.log(`[AM] Input  : ${link.substring(0, 200)}`);
  console.log(`[AM] Final  : ${finalUrl}`);
  console.log(`[AM] ============================================`);

  if (!finalUrl) {
    return res.status(400).json({ ok: false, error: 'Tidak bisa membaca oobCode dari link yang kamu paste. Pastikan link dari email mengandung "oobCode=".' });
  }

  try {
    const result = await processAmKyzz({ email, finalUrl, headless: true });
    if (!result.apiResult) return res.status(500).json({ ok: false, error: result.error || 'Tidak ada respons', tried: result.tried });
    return res.json(result.apiResult);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE_URL}/api/stats`, { headers: HEADERS, timeout: 8000 }).catch(() => ({ data: null }));
    if (data) return res.json(data);
    return res.json({ total: '300', uptime: '7 Hari 1 Jam', status: '100% Online' });
  } catch {
    return res.json({ total: '300', uptime: '7 Hari 1 Jam', status: '100% Online' });
  }
});

async function processAmKyzz({ email, finalUrl, headless = true }) {
  console.log(`[AM] Start verify for ${email}`);

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process','--disable-blink-features=AutomationControlled']
  });
  console.log('[AM] Browser launched');

  const context = await browser.newContext({
    userAgent: HEADERS['User-Agent'],
    viewport: { width: 800, height: 600 }
  });
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (['image','media','font'].includes(t)) return route.abort();
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

    const linkInput = page.locator("input[placeholder*='tautan'], textarea[placeholder*='tautan'], input[placeholder*='link'], input[type='text'], textarea").first();
    await linkInput.waitFor({ state: 'visible', timeout: 15000 });
    await linkInput.click();
    await linkInput.fill('');
    await linkInput.type(finalUrl, { delay: 3 });
    await linkInput.evaluate((el) => {
      ['input','change','keyup','blur'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
    });
    console.log('[AM] Link filled:', finalUrl.substring(0, 100));

    // Cek tombol enabled, max 30 detik
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
      // Coba cek pesan error yang muncul di halaman
      const bodyText = await page.locator('body').innerText().catch(() => '');
      console.log('[AM] Page body preview:', bodyText.substring(0, 500));
      return { status: false, email, apiResult: null, error: 'Tombol VERIFIKASI tetap disabled. Cek apakah link expired atau server menolak.' };
    }

    let verifyResponse = null;
    page.on('response', async (r) => {
      if (r.url().includes('/api/verify')) {
        try { verifyResponse = await r.json(); } catch {}
      }
    });

    await verifyBtn.click();
    console.log('[AM] Verify clicked, waiting 10s...');
    await page.waitForTimeout(10000);

    if (verifyResponse) {
      console.log('[AM] ✓ Response:', JSON.stringify(verifyResponse));
      return { status: verifyResponse.ok, email, apiResult: verifyResponse };
    }

    return { status: false, email, apiResult: null, error: 'Klik verify terkirim tapi tidak ada respons.' };
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
  console.log('═'.repeat(50));
  console.log(`  FORESTER WEB RUNNING on :${PORT}`);
  console.log('═'.repeat(50));
});
