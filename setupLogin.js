const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { app, ipcMain } = require('electron');

async function jalankanLogin(idAkun, emailUser, passUser, eventSender) {
    console.log("👉 [DEBUG 1] Fungsi jalankanLogin dipanggil untuk Akun:", idAkun);

    try {
        const userDataPath = app.getPath('userData');
        const STATE_DIR = path.join(userDataPath, 'state');
        const STATE_PATH = path.join(STATE_DIR, `storageState${idAkun}.json`);

        if (!fs.existsSync(STATE_DIR)) {
            fs.mkdirSync(STATE_DIR, { recursive: true });
        }
        console.log("👉 [DEBUG 2] Folder state aman di:", STATE_PATH);

        eventSender.send('log-update', idAkun, '🌐 Mencari Google Chrome...');

        // Cari Chrome atau Edge
        const paths = [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            path.join(process.env.LOCALAPPDATA || '', "Google\\Chrome\\Application\\chrome.exe"),
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
        ];

        let browserPath = null;
        for (let p of paths) {
            if (fs.existsSync(p)) {
                browserPath = p;
                break;
            }
        }

        if (!browserPath) {
            console.log("❌ [DEBUG ERROR] Browser Chrome/Edge tidak ditemukan sama sekali di PC ini!");
            eventSender.send('login-failed', idAkun, 'Chrome/Edge tidak ditemukan di PC.');
            return false;
        }
        console.log("👉 [DEBUG 3] Browser ditemukan di:", browserPath);

        eventSender.send('log-update', idAkun, '🚀 Meluncurkan browser...');

        const browser = await chromium.launch({
            headless: true,
            executablePath: browserPath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        console.log("👉 [DEBUG 4] Browser BERHASIL diluncurkan!");
        const context = await browser.newContext({ viewport: null });
        const page = await context.newPage();

        eventSender.send('log-update', idAkun, '🔗 Membuka web Kemenkes...');
        console.log("👉 [DEBUG 5] Mengakses URL login...");

        await page.goto('https://sehatindonesiaku.kemkes.go.id/login', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        console.log("👉 [DEBUG 6] Halaman web terbuka!");

        if (emailUser && passUser) {
            await page.waitForSelector('input[name="Email"]');
            await page.locator('input[name="Email"]').fill(emailUser);
            await page.locator('input[name="Kata sandi"]').fill(passUser);
            console.log("👉 [DEBUG 7] Email & Password terisi otomatis.");
        }

        await page.waitForSelector('img[alt="image-captcha"]', { timeout: 15000 });
        const captchaBase64 = await page.locator('img[alt="image-captcha"]').getAttribute('src');
        console.log("👉 [DEBUG 8] Gambar Captcha berhasil ditarik!");

        eventSender.send('captcha-ready', idAkun, captchaBase64);

        return new Promise((resolve) => {
            ipcMain.once(`submit-captcha-${idAkun}`, async (event, captchaText) => {
                console.log("👉 [DEBUG 9] Menerima teks captcha dari user...");
                eventSender.send('log-update', idAkun, 'Mencoba login...');

                try {
                    await page.locator('#input-captcha').fill(captchaText.trim());
                    await page.locator('text="Masuk"').click();

                    const indicator = await page.waitForSelector('#verify, button:has-text("CKG Umum")', { timeout: 15000 });
                    const elementId = await indicator.evaluate(node => node.id);

                    if (elementId === 'verify') {
                        await page.click('#verify', { force: true });
                        await page.click('button:has-text("Setuju")');
                        await page.waitForSelector('button:has-text("CKG Umum")', { timeout: 10000 });
                    }

                    await context.storageState({ path: STATE_PATH });
                    eventSender.send('login-success', idAkun);
                    await browser.close();
                    console.log("✅ [DEBUG 10] Login SUKSES!");
                    resolve(true);

                } catch (err) {
                    console.log("❌ [DEBUG ERROR SAAT SUBMIT]:", err.message);
                    eventSender.send('login-failed', idAkun, 'Captcha salah / Login gagal.');
                    await browser.close();
                    resolve(false);
                }
            });
        });

    } catch (err) {
        console.log("🔥 [DEBUG FATAL ERROR]:", err);
        eventSender.send('login-failed', idAkun, `Error: ${err.message.substring(0, 40)}`);
    }
}

module.exports = { jalankanLogin };