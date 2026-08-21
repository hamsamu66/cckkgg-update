const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const idAkun = process.argv[2] || '1';
const emailUser = process.argv[3] || '';
const passUser = process.argv[4] || '';

// 🌟 PERBAIKAN: Namanya disamakan menjadi STATE_DIR semua
const STATE_DIR = path.join(userDataPath, 'state');
const STATE_PATH = path.join(STATE_DIR, `storageState${idAkun}.json`);

async function generateSession() {
    // Tambahkan { recursive: true } agar foldernya terbuat dengan aman tanpa error
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    console.log(`[Akun ${idAkun}] 🌐 Membuka browser di belakang layar...`);
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    await page.goto('https://sehatindonesiaku.kemkes.go.id/login', { waitUntil: 'networkidle' });

    if (emailUser && passUser) {
        await page.waitForSelector('input[name="Email"]');
        await page.locator('input[name="Email"]').fill(emailUser);
        await page.locator('input[name="Kata sandi"]').fill(passUser);
    }

    try {
        await page.waitForSelector('img[alt="image-captcha"]', { timeout: 10000 });
        const captchaBase64 = await page.locator('img[alt="image-captcha"]').getAttribute('src');
        console.log(`CAPTCHA_IMAGE_${idAkun}|${captchaBase64}`);
    } catch (err) {
        console.log(`[Akun ${idAkun}] Gagal memuat gambar captcha dari web.`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on('line', async (captchaDariUI) => {
        console.log(`[Akun ${idAkun}] Menerima captcha, mencoba login...`);

        await page.locator('#input-captcha').fill(captchaDariUI.trim());
        await page.locator('text="Masuk"').click();

        try {
            console.log(`[Akun ${idAkun}] ⏳ Menunggu konfirmasi masuk...`);
            // Menunggu maksimal 15 detik. Jika tidak berhasil masuk, berarti captcha salah.
            const indicator = await page.waitForSelector('#verify, button:has-text("CKG Umum")', { timeout: 15000 });
            const elementId = await indicator.evaluate(node => node.id);

            if (elementId === 'verify') {
                await page.click('#verify', { force: true });
                await page.click('button:has-text("Setuju")');
                await page.waitForSelector('button:has-text("CKG Umum")', { timeout: 10000 });
            }

            await context.storageState({ path: STATE_PATH });
            console.log(`LOGIN_SUCCESS_${idAkun}`);
            rl.close();
            await browser.close();

        } catch (error) {
            // JIKA CAPTCHA SALAH ATAU GAGAL LOGIN
            console.log(`LOGIN_FAILED_${idAkun}|Captcha salah / Login gagal. Coba lagi.`);
            // Menutup proses agar user bisa mengulang dari awal tanpa nyangkut
            rl.close();
            await browser.close();
        }
    });
}

generateSession().catch(err => {
    console.log(`LOGIN_FAILED_${idAkun}|Terjadi error sistem.`);
    process.exit(1);
});