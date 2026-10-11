async function processAmKyzz({ email, link, headless = true }) {
  console.log(`[AM] Start verify for ${email}`);
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',        // WAJIB di container kecil
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',
      '--single-process',                // hemat RAM
      '--disable-blink-features=AutomationControlled'
    ]
  });
  console.log('[AM] Browser launched');

  const context = await browser.newContext({
    userAgent: HEADERS['User-Agent'],
    viewport: { width: 800, height: 600 }
  });
  const page = await context.newPage();

  // ─── BLOCK RESOURCE YANG NGGAK PERLU ───
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    console.log('[AM] Opening /am page...');
    await page.goto(`${BASE_URL}/am`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[AM] Page loaded');
    
    // ... sisanya sama
