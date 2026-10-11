import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'https://am.kyzzz.xyz';
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

function normalizeLink(input) {
  const raw = (input || '').trim();
  if (!raw) return [];
  const variants = new Set();
  variants.add(raw);
  if (raw.startsWith('apiKey=') || raw.includes('oobCode=')) {
    variants.add(`https://alightcreative.com/auth_action/?${raw}`);
    variants.add(`https://alightcreative.com/auth_action/?${raw.replace(/&lang=.*$/, '')}`);
  }
  if (!raw.includes('=') && !raw.startsWith('http')) variants.add(raw);
  if (!raw.startsWith('http') && raw.includes('alightcreative.com')) variants.add(`https://${raw}`);
  if (raw.startsWith('http')) variants.add(raw.replace(/&lang=.*$/, ''));
  return Array.from(variants);
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
  try {
    const result = await processAmKyzz({ email, link, headless: true });
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

async function processAmKyzz({ email, link, headless = true }) {
  console.log(`[AM] Start verify for ${email}`);
  const variants = normalizeLink(link);
  console.log(`[AM] Variants:`, variants);

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process','--disable-blink-features=AutomationControlled']
  });
  console.log('[AM] Browser launched');

  const context = await browser.newContext({ userAgent: HEADERS['User-Agent'], viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (['image','media','font'].includes(t)) return route.abort();
    return route.continue();
  });

  const tried = [];
  try {
    for (const variant of variants) {
      tried.push(variant);
      console.log(`[AM] Trying: ${variant.substring(0, 100)}`);
      try {
        await page.goto(`${BASE_URL}/am`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.locator("input[type='email'], input[placeholder*='email']").first().fill(email.trim().toLowerCase());
        await page.locator("button:has-text('KIRIM')").first().click();
        const lanjutBtn = page.locator("button:has-text('LANJUT KE VERIFIKASI')");
        await lanjutBtn.waitFor({ state: 'visible', timeout: 20000 });
        await lanjutBtn.click();
        await page.waitForTimeout(1500);
        const linkInput = page.locator("input[placeholder*='tautan'], textarea[placeholder*='tautan'], input[placeholder*='link'], input[type='text'], textarea").first();
        await linkInput.waitFor({ state: 'visible', timeout: 15000 });
        await linkInput.fill(variant);
        console.log('[AM] Link filled');

        const verifyBtn = page.locator("button:has-text('VERIFIKASI')").first();
        const handle = await verifyBtn.elementHandle();
        try {
          await page.waitForFunction((b) => b && !b.disabled, handle, { timeout: 15000 });
          console.log('[AM] Verify button ENABLED ✓');
        } catch {
          console.log('[AM] Verify button STILL DISABLED, next variant...');
          continue;
        }

        let verifyResponse = null;
        page.on('response', async (r) => {
          if (r.url().includes('/api/verify')) { try { verifyResponse = await r.json(); } catch {} }
        });
        await verifyBtn.click();
        await page.waitForTimeout(8000);
        if (verifyResponse) {
          console.log('[AM] SUCCESS:', JSON.stringify(verifyResponse));
          return { status: verifyResponse.ok, email, apiResult: verifyResponse, tried };
        }
        console.log('[AM] No response, next variant...');
      } catch (e) {
        console.log(`[AM] Variant error: ${e.message}`);
      }
    }
    return { status: false, email, apiResult: null, error: 'Semua format gagal. Kemungkinan: link expired, format salah, atau ada proteksi anti-bot.', tried };
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
