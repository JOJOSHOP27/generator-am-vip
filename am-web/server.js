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

/* ─────────── /api/send-link ─────────── */
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
    const msg = err.response?.data?.error || err.message || 'Gagal mengirim link';
    return res.status(500).json({ ok: false, error: msg });
  }
});

/* ─────────── /api/verify (Playwright) ─────────── */
app.post('/api/verify', async (req, res) => {
  const { email, link } = req.body || {};
  if (!email || !link) {
    return res.status(400).json({ ok: false, error: 'Email dan link wajib diisi' });
  }

  try {
    const result = await processAmKyzz({ email, link, headless: true });

    if (!result.apiResult) {
      return res.status(500).json({ ok: false, error: 'Tidak ada respons dari server AM' });
    }

    return res.json(result.apiResult);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Verifikasi gagal' });
  }
});

/* ─────────── /api/stats ─────────── */
app.get('/api/stats', async (req, res) => {
  try {
    const { data } = await axios.get(`${BASE_URL}/api/stats`, {
      headers: HEADERS,
      timeout: 8000
    }).catch(() => ({ data: null }));

    if (data) return res.json(data);

    // fallback dummy
    return res.json({
      total: '300',
      uptime: '7 Hari 1 Jam',
      status: '100% Online'
    });
  } catch {
    return res.json({ total: '300', uptime: '7 Hari 1 Jam', status: '100% Online' });
  }
});

/* ─────────── Core automation (sama persis dengan script asli) ─────────── */
async function processAmKyzz({ email, link, headless = true }) {
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: HEADERS['User-Agent']
  });

  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/am`, { waitUntil: 'networkidle' });

    const emailInput = page.locator("input[type='email'], input[placeholder*='email']").first();
    await emailInput.fill(email.trim().toLowerCase());

    const sendBtn = page.locator("button:has-text('KIRIM')").first();
    await sendBtn.click();

    const lanjutBtn = page.locator("button:has-text('LANJUT KE VERIFIKASI')");
    await lanjutBtn.waitFor({ state: 'visible', timeout: 15000 });
    await lanjutBtn.click();
    await page.waitForTimeout(1000);

    const linkInput = page.locator(
      "input[placeholder*='tautan'], textarea[placeholder*='tautan'], input[type='text'], textarea"
    ).first();
    await linkInput.waitFor({ state: 'visible', timeout: 10000 });
    await linkInput.fill(link.trim());

    let verifyResponse = null;
    page.on('response', async (r) => {
      if (r.url().includes('/api/verify')) {
        try { verifyResponse = await r.json(); } catch {}
      }
    });

    const verifyBtn = page.locator("button:has-text('VERIFIKASI')").first();
    await page.waitForFunction(
      (btn) => btn && !btn.disabled,
      await verifyBtn.elementHandle(),
      { timeout: 35000 }
    );

    await verifyBtn.click();
    await page.waitForTimeout(5000);

    return {
      status: verifyResponse ? verifyResponse.ok : false,
      email,
      apiResult: verifyResponse
    };
  } finally {
    await browser.close();
  }
}

/* ─────────── Start ─────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═'.repeat(50));
  console.log(`  FORESTER WEB RUNNING on :${PORT}`);
  console.log('═'.repeat(50));
});
