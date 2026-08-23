const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { app, ipcMain } = require('electron'); // 🌟 TAMBAHAN: Tarik app & ipcMain dari Electron
// Fungsi pintar: Cari di folder Update dulu, kalau gagal cari di bawaan .exe
function panggilModul(jalurRelatif) {
    const pathUpdate = path.join(app.getPath('userData'), jalurRelatif);
    if (fs.existsSync(pathUpdate)) {
        return require(pathUpdate);
    }
    // app.getAppPath() akan mengarah ke dalam app.asar (file .exe)
    return require(path.join(app.getAppPath(), jalurRelatif));
}

// CONTOH PENGGUNAAN:
// Hapus ini: const ExcelManager = require('./Utils/excelManager');
// Ganti jadi ini:
const ExcelManager = panggilModul('Utils/excelManager.js');
const Logger = require('./utils/logger');

// ==============================================================================
// 1. KUMPULAN FUNGSI HELPER 
// ==============================================================================

// 🌟 FITUR 1: FUNGSI ANTI-MACET SMART LOADER (TANPA DELAY JIKA TIDAK ADA LOADING)
async function klikAntiMacet(page, locatorTombol, namaAksi = "Tombol") {
    const loaderHitam = page.locator('div.bg-blackSoft').first();
    const maxPercobaan = 3;

    for (let i = 1; i <= maxPercobaan; i++) {
        if (await locatorTombol.count() > 0 && await locatorTombol.isVisible()) {
            await locatorTombol.click({ force: true });
        }

        try {
            await page.waitForTimeout(500);
            await loaderHitam.waitFor({ state: 'hidden', timeout: 15000 });
            return true;
        } catch (error) {
            Logger.info(`⚠️ Server lemot saat klik ${namaAksi}. Mengulang (Percobaan ${i}/${maxPercobaan})...`);
            if (i === maxPercobaan) {
                throw new Error(`TIMEOUT_SERVER: Gagal mengeklik ${namaAksi} setelah 3x percobaan.`);
            }
            await page.waitForTimeout(2000);
        }
    }
}

// 🌟 FITUR BARU: Tunggu indikator loading/spinner hilang sebelum lanjut aksi berikutnya.
// Best-effort & TIDAK melempar error — kalau tidak ada indikator sama sekali, langsung lolos
// (tidak menambah delay). Kalau loading kelamaan, biarkan proses lanjut apa adanya supaya
// error yang lebih jelas muncul di titik klik berikutnya (bukan macet diam-diam di sini).
async function tungguLoadingSelesai(page, timeout = 8000) {
    const indikatorLoading = page.locator('div.bg-blackSoft, .animate-spin, [aria-busy="true"]').first();
    try {
        if (await indikatorLoading.count() > 0) {
            await indikatorLoading.waitFor({ state: 'hidden', timeout });
        }
    } catch {
        // Diamkan: biar proses tetap jalan, jangan sampai berhenti total gara-gara ini.
    }
}

// 🌟 FITUR BARU: Baca innerText dengan retry singkat.
// Form SurveyJS (mandiri/nakes) sering re-render saat dibaca bersamaan, yang bisa membuat
// .innerText() gagal/"" padahal elemennya ada. Retry kecil ini menaikkan akurasi pencocokan
// jawaban tanpa menambah delay berarti kalau memang tidak ada masalah.
async function bacaTeksAman(locator, percobaan = 2, jedaMs = 150) {
    for (let i = 0; i < percobaan; i++) {
        try {
            return (await locator.innerText()).trim();
        } catch {
            if (i < percobaan - 1) await new Promise(r => setTimeout(r, jedaMs));
        }
    }
    return "";
}

async function isiDatepicker(page, locatorDatepicker, tanggalLahirExcel) {
    if (tanggalLahirExcel == null || tanggalLahirExcel === "undefined" || tanggalLahirExcel === "") {
        throw new Error("Data tanggal kosong atau nama kolom di Excel salah!");
    }

    let targetHari, targetBulan, targetTahun;

    if (tanggalLahirExcel instanceof Date) {
        targetHari = tanggalLahirExcel.getDate();
        targetBulan = tanggalLahirExcel.getMonth() + 1;
        targetTahun = tanggalLahirExcel.getFullYear();
    } else {
        const strTanggal = String(tanggalLahirExcel).replace(/\//g, '-').trim();
        const bagian = strTanggal.split('-');
        if (bagian.length !== 3) throw new Error(`Format tanggal tidak valid: ${tanggalLahirExcel}`);

        if (bagian[0].length === 4) {
            targetTahun = parseInt(bagian[0], 10);
            targetBulan = parseInt(bagian[1], 10);
            targetHari = parseInt(bagian[2], 10);
        } else {
            targetHari = parseInt(bagian[0], 10);
            targetBulan = parseInt(bagian[1], 10);
            let tahunTemp = parseInt(bagian[2], 10);
            targetTahun = tahunTemp < 100 ? tahunTemp + (tahunTemp > 50 ? 1900 : 2000) : tahunTemp;
        }
    }

    if (!targetTahun || !targetBulan || targetBulan < 1 || targetBulan > 12 || !targetHari) {
        throw new Error(`Hasil parsing tanggal tidak masuk akal: ${targetHari}-${targetBulan}-${targetTahun}`);
    }

    // Harus sama persis dengan title="YYYY-MM-DD" di panel tanggal
    const targetDateStr = `${targetTahun}-${String(targetBulan).padStart(2, '0')}-${String(targetHari).padStart(2, '0')}`;
    const targetMonthIndex = targetBulan - 1; // data-month bersifat 0-based (Jan=0)

    await locatorDatepicker.click();

    const calendar = page.locator('.mx-calendar').first();
    await calendar.waitFor({ state: 'visible' });

    // ===== 1. Panel TAHUN — loncat per DEKADE, klik langsung via data-year =====
    await page.locator('.mx-btn-current-year').first().click();

    const tableYear = page.locator('.mx-table-year');
    await tableYear.waitFor({ state: 'visible' });

    let tahunKetemu = false;
    for (let i = 0; i < 30; i++) { // 30x loncat dekade = jangkauan 300 tahun
        const cells = tableYear.locator('td.cell');
        const total = await cells.count();

        if (total === 0) {
            await page.waitForTimeout(100);
            continue;
        }

        const min = parseInt(await cells.first().getAttribute('data-year'), 10);
        const max = parseInt(await cells.nth(total - 1).getAttribute('data-year'), 10);

        if (targetTahun >= min && targetTahun <= max) {
            await tableYear.locator(`td.cell[data-year="${targetTahun}"]`).click();
            tahunKetemu = true;
            break;
        }

        await page.locator(targetTahun < min ? '.mx-btn-icon-double-left' : '.mx-btn-icon-double-right').first().click();
    }
    if (!tahunKetemu) {
        throw new Error(`Tahun ${targetTahun} tidak ditemukan (kemungkinan di luar rentang yang diizinkan datepicker)`);
    }

    // ===== 2. Panel BULAN — otomatis terbuka setelah pilih tahun, klik langsung via data-month =====
    const tableMonth = page.locator('.mx-table-month');
    let panelBulanTerbuka = true;
    try {
        await tableMonth.waitFor({ state: 'visible', timeout: 1000 });
    } catch {
        panelBulanTerbuka = false;
    }
    if (!panelBulanTerbuka) {
        await page.locator('.mx-btn-current-month').first().click();
        await tableMonth.waitFor({ state: 'visible' });
    }

    await tableMonth.locator(`td.cell[data-month="${targetMonthIndex}"]`).click();

    // ===== 3. Panel TANGGAL — klik via title="YYYY-MM-DD" =====
    const tableDate = page.locator('.mx-table-date');
    try {
        await tableDate.waitFor({ state: 'visible', timeout: 2000 });
    } catch {
        throw new Error('Panel tanggal tidak muncul setelah memilih bulan.');
    }

    await page.locator(`td.cell[title="${targetDateStr}"]`).first().click();
}

function hitungNilaiNormal(excelValue, tipePemeriksaan, tglLahirExcel) {
    const val = String(excelValue).trim().toLowerCase();

    if (val === "undefined" || val === "null" || val === "" || val === "normal") {
        let umur = 0;
        if (tglLahirExcel) {
            let thn = 0;
            if (tglLahirExcel instanceof Date) {
                thn = tglLahirExcel.getFullYear();
            } else {
                const parts = String(tglLahirExcel).replace(/\//g, '-').split('-');
                thn = parts[0].length === 4 ? parseInt(parts[0]) : (parseInt(parts[2]) < 100 ? parseInt(parts[2]) + 2000 : parseInt(parts[2]));
            }
            umur = new Date().getFullYear() - thn;
        }

        switch (tipePemeriksaan) {
            case "Berat Badan": return umur > 12 ? "45" : String(umur * 2 + 8);
            case "Tinggi Badan": return umur > 12 ? "155" : String(umur * 6 + 77);
            case "Lingkar Perut": return umur > 12 ? "85" : String(umur * 4 + 40);
            case "Sistol": return umur > 12 ? "110" : "100";
            case "Diastol": return umur > 12 ? "70" : "60";
            case "Gula Darah": return "90";
            case "Hemoglobin": return umur > 12 ? "13" : "12";
            case "Gigi": return "Tidak ada";
            case "Kebugaran": return "Baik";
            case "Kadar CO": return "1";
            case "Telinga dan Mata": return "Normal";
            default: return "";
        }
    }
    return String(excelValue);
}

async function isiFormLayanan(page, namaLayanan, actionCallback) {
    Logger.info(`🔍 Memproses layanan: ${namaLayanan}`);

    const bungkusanLayanan = page.locator('div:has(> button[aria-controls="dropdown-content"])').filter({
        has: page.locator('div.grid-cols-5', { hasText: namaLayanan })
    }).last();

    const menuLipat = bungkusanLayanan.locator('button[aria-controls="dropdown-content"]').first();
    const rowLayanan = bungkusanLayanan.locator('div.grid-cols-5').filter({ hasText: namaLayanan }).last();

    if (await menuLipat.count() > 0) {
        await menuLipat.scrollIntoViewIfNeeded();
        if (!(await rowLayanan.isVisible())) {
            Logger.info(`   Membuka menu lipat yang menyembunyikan form ini...`);
            await menuLipat.click({ force: true });
            await page.waitForTimeout(1000);
        }
    }

    const targetRow = await bungkusanLayanan.count() > 0 ? rowLayanan : page.locator('div.grid-cols-5').filter({ hasText: namaLayanan }).last();
    const btnInput = targetRow.locator('button:has-text("Input Data"), button:has-text("Ubah")').filter({ visible: true }).first();

    if (await btnInput.count() > 0 && await btnInput.isVisible() && await btnInput.isEnabled()) {
        await btnInput.scrollIntoViewIfNeeded();
        await btnInput.click({ force: true });

        await page.waitForTimeout(1000);
        await actionCallback();

        const btnKirim = page.locator('input[title="Kirim"], button:has-text("Kirim"), button:has-text("Simpan")').filter({ visible: true }).first();

        if (await btnKirim.count() > 0) {
            await klikAntiMacet(page, btnKirim, `Simpan ${namaLayanan}`);
        } else {
            const btnFallback = page.locator('input[title="Kirim"]').last();
            await klikAntiMacet(page, btnFallback, `Simpan ${namaLayanan}`);
        }
        await page.waitForTimeout(2500);
    } else {
        Logger.info(`⏩ Form dilewati: Tombol untuk "${namaLayanan}" tidak ditemukan/dikunci.`);
    }
}

// ==============================================================================
// 2. FUNGSI UTAMA AUTOMATION (Sistem Looping)
// ==============================================================================

// 🌟 PERBAIKAN: Fungsi menerima Parameter langsung dari main.js!
async function runAutomation(idAkun, strHeadless, eventSender) {
    const isHeadless = strHeadless === 'true';

    // 🌟 FUNGSI PENERUS LOG KE UI HTML KITA
    function sendUILog(pesan) {
        console.log(`[Akun ${idAkun}] ${pesan}`);
        if (eventSender) eventSender.send('robot-log', idAkun, pesan);
    }

    // ==========================================
    // 🌟 SISTEM PAUSE & STOP KHUSUS IPC (Super Agresif)
    // ==========================================
    let isPaused = false;
    let isStopped = false;
    let resumeResolver = null;

    const pauseListener = (event, id) => {
        if (id == idAkun) {
            isPaused = !isPaused;
            if (!isPaused && resumeResolver) {
                resumeResolver();
                resumeResolver = null;
            }
        }
    };

    const stopListener = (event, id) => {
        if (id == idAkun) {
            isStopped = true;
            if (resumeResolver) {
                resumeResolver();
                resumeResolver = null;
            }
        }
    };

    ipcMain.on('toggle-pause-robot', pauseListener);
    ipcMain.on('stop-robot', stopListener);

    // 🌟 REM PAKEM: Langsung ngerem kalau isPaused true!
    async function checkPause() {
        if (isStopped) throw new Error("STOPPED_BY_USER");
        while (isPaused) {
            if (isStopped) throw new Error("STOPPED_BY_USER");
            await new Promise(resolve => { resumeResolver = resolve; });
        }
        if (isStopped) throw new Error("STOPPED_BY_USER");
    }
    // ==========================================

    Logger.info("Membuka browser menggunakan Google Chrome asli...");

    function getChromePath() {
        const paths = [
            path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        ];
        for (const p of paths) {
            if (p && fs.existsSync(p)) return p;
        }
        return null;
    }

    let browser;

    // 👇 INI ADALAH TRY UTAMA (Pasangan dari catch fatalError di baris 1337)
    try {

        // --- Mulai Blok Pengecekan Chrome ---
        try {
            // 1. Cara resmi Playwright — deteksi otomatis Chrome yang terinstal normal di sistem
            browser = await chromium.launch({
                headless: isHeadless,
                channel: 'chrome',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
        } catch (errChannel) {
            // 2. Fallback manual kalau deteksi otomatis gagal (install Chrome non-standar / portable)
            const chromePath = getChromePath();
            if (!chromePath) {
                throw new Error("Google Chrome tidak ditemukan di PC ini. Silakan install Google Chrome terlebih dahulu.");
            }
            browser = await chromium.launch({
                headless: isHeadless,
                executablePath: chromePath,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
        }
        // --- Selesai Blok Pengecekan Chrome ---





        const userDataPath = app.getPath('userData'); // 🌟 Otomatis pakai Stealth Path
        const folderState = path.join(userDataPath, 'state');
        if (!fs.existsSync(folderState)) {
            fs.mkdirSync(folderState, { recursive: true });
        }

        const STATE_PATH = path.join(folderState, `storageState${idAkun}.json`);
        const context = await browser.newContext({ storageState: STATE_PATH });

        const excelPath = path.join(userDataPath, 'Data', `Data${idAkun}.xlsx`);
        if (!fs.existsSync(excelPath)) {
            throw new Error(`File Excel Data${idAkun}.xlsx belum diupload!`);
        }

        const dataPeserta = ExcelManager.readExcel(excelPath);
        sendUILog("🤖 Memulai proses CKG Umum...");

        const page = await context.newPage();

        page.on('framenavigated', async (frame) => {
            if (frame === page.mainFrame()) {
                const currentUrl = frame.url();
                if (currentUrl.includes('/auth/login')) {
                    console.log(`[Akun ${idAkun}] 🔴 Terdeteksi lempar ke login: ${currentUrl}. Langsung Close!`);
                    try { if (!page.isClosed()) await page.close(); } catch (e) { }
                }
            }
        });

        await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu');
        await checkPause();

        for (let i = 0; i < dataPeserta.length; i++) {
            if (isStopped) break;

            const row = dataPeserta[i];
            const barisExcel = i + 1;
            const totalData = dataPeserta.length;

            const namaLengkap = row['Nama Lengkap'] || 'Tanpa Nama';
            const nikPeserta = row['NIK'] || 'Kosong';

            sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Membaca excel`);

            const cekNik = String(row['NIK'] || '').trim();

            if (!cekNik || cekNik.length < 16) {
                row['Keterangan'] = 'Gagal NIK tidak lengkap';
                Logger.info(`Skip NIK: ${nikPeserta} karena kosong atau kurang dari 16 digit.`);
                sendUILog(`GAGAL|NIK ${nikPeserta} Gagal NIK tidak lengkap`);
                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Gagal NIK tidak lengkap`);
                continue;
            }

            const kataKunciSkip = [
                'Berhasil Selesai Pelayanan',
                'terdeteksi sudah pelayanan lengkap',
                'gagal999',
                'gagal nik tidak valid'
            ];

            if (row.Keterangan && kataKunciSkip.some(kata => String(row.Keterangan).toLowerCase().includes(kata.toLowerCase()))) {
                Logger.info(`Skip NIK: ${row['NIK']} karena sudah berstatus selesai/skip.`);
                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Skip`);
                sendUILog(`SUKSES|Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                continue;
            }

            if (row.jumlahCoba === undefined) {
                row.jumlahCoba = 1;
            }
            let sesi = "Persiapan";

            try {
                await checkPause();
                Logger.info(`Memproses NIK: ${row['NIK']} - ${row['Nama Lengkap']} (Percobaan ke-${row.jumlahCoba})`);

                const statusExcel = String(row['Status'] || row['Keterangan'] || "").trim().toLowerCase();
                let lewatiPendaftaran = false;
                let langsungPelayanan = false;

                if (statusExcel === "sudah daftar bos") {
                    lewatiPendaftaran = true;
                    Logger.info(`⏩ Status "${statusExcel}" terdeteksi! Langsung melompat ke Konfirmasi Kehadiran...`);
                }

                if (!lewatiPendaftaran) {
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi Form Pendaftaran pertama`);
                    sesi = "Form pendaftaran Pertama";
                    await checkPause();

                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(500);

                    await page.waitForSelector('button:has(div:text("Daftar Baru"))');
                    await page.locator('button:has(div:text("Daftar Baru"))').last().click();
                    await page.waitForTimeout(1000);

                    await page.locator('input[name="NIK"]').last().fill(String(row['NIK']));
                    await page.waitForTimeout(500);
                    await checkPause();

                    Logger.info(`Mengecek NIK: ${row['NIK']}...`);
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengecek NIK`);

                    const btnCekNik = page.locator('div.tracking-wide:has-text("Cek NIK"), button:has-text("Cek NIK")').filter({ visible: true }).first();
                    await btnCekNik.click({ force: true });

                    let dataOtomatisDitemukan = false;
                    const popupTeks = page.getByText('Data Peserta ditemukan', { exact: false }).first();
                    const btnGunakanData = page.locator('button:has-text("Gunakan Data")').first();

                    try {
                        await Promise.race([
                            popupTeks.waitFor({ state: 'visible', timeout: 6000 }),
                            btnGunakanData.waitFor({ state: 'visible', timeout: 6000 })
                        ]);
                        dataOtomatisDitemukan = true;
                        Logger.info("✅ Data Peserta ditemukan!");
                    } catch (error) {
                        dataOtomatisDitemukan = false;
                        Logger.info("⚠️ Data belum terdaftar di server. Beralih ke mode ISI MANUAL...");
                    }
                    await checkPause();

                    if (dataOtomatisDitemukan) {
                        await btnGunakanData.click({ force: true }).catch(() => { });
                        await page.waitForTimeout(1000);
                        Logger.info("Menggunakan data dari server Kemenkes...");
                    } else {
                        Logger.info("Mengisi form pendaftaran secara manual dari Excel...");

                        await page.locator('input[name="Nama"]').last().fill(row['Nama Lengkap']);

                        const locatorKalender = page.locator('div:text-is("Pilih tanggal lahir")').last();
                        await isiDatepicker(page, locatorKalender, row['Tanggal lahir']);

                        await page.getByText('Pilih jenis kelamin').first().click();
                        await page.waitForTimeout(500);
                        await page.locator(`div:has-text("${row['Jenis Kelamin']}")`).last().click();

                        let noWa = row['No Whatsapp'] ? String(row['No Whatsapp']).trim() : '';
                        noWa = noWa.replace(/\D/g, '');
                        if (!noWa || noWa.length < 7 || noWa.length > 13 || !noWa.startsWith('8')) {
                            noWa = '89999999';
                        }

                        await page.waitForTimeout(500);
                        await page.locator('input[name="Nomor Whatsapp"]').last().fill(noWa);
                        await page.waitForTimeout(1000);
                    }

                    const checkboxVisual = page.locator('div#noWali.check');
                    if (await checkboxVisual.isVisible()) {
                        const isChecked = await page.locator('input#noWali').first().isChecked();
                        if (!isChecked) {
                            await checkboxVisual.click();
                        }
                    }
                    await checkPause();

                    Logger.info("Mengisi tanggal pelayanan (hari ini)...");
                    const todayDate = new Date().getDate().toString();
                    await page.locator(`button:has(span.font-bold:text-is("${todayDate}"))`).last().click({ force: true });
                    await page.waitForTimeout(500);

                    Logger.info("Mengeklik tombol 'Selanjutnya'...");
                    const tombolSelanjutnya = page.locator('button:has-text("Selanjutnya")').filter({ visible: true }).first();
                    await tombolSelanjutnya.waitFor({ state: 'visible', timeout: 5000 });
                    await klikAntiMacet(page, tombolSelanjutnya, "Selanjutnya (Cek NIK Awal di form pendaftaran pertama)");

                    Logger.info("Menunggu check sistem validasi NIK...");
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Menunggu check validasi NIK`);

                    let popupResult = await Promise.race([
                        page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                        page.waitForSelector('div:has-text("Kuota Pemeriksaan Habis")', { timeout: 10000 }).then(() => 'KUOTA_HABIS'),
                        page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                        page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                    ]).catch(() => 'TIMEOUT_SERVER');

                    if (popupResult === 'KUOTA_HABIS') {
                        Logger.info(`NIK ${row['NIK']} LANJUT. Menuju POPUP SELANJUTNYA...`);
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Kuota Habis (Bypass)`);
                        const tombolLanjutkan = page.locator('div.tracking-wide:has-text("Lanjut"), button:has-text("Lanjut")').filter({ visible: true }).last();
                        await tombolLanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                        await tombolLanjutkan.click({ force: true });
                        await page.waitForTimeout(1000);

                        popupResult = await Promise.race([
                            page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                            page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                            page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                        ]).catch(() => 'TIMEOUT_SERVER');
                    }

                    if (popupResult === 'VALID') {
                        Logger.info(`NIK ${row['NIK']} VALID. Menuju form kedua...`);
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Menuju form kedua`);

                        const tombolLanjutkan = page.locator('button:has-text("Lanjutkan"),div.tracking-wide:has-text("Lanjut"), button:has-text("Lanjut")').filter({ visible: true }).last();
                        await tombolLanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                        await tombolLanjutkan.click({ force: true });
                        await page.waitForTimeout(1000);

                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi Form pendaftaran kedua`);
                        sesi = "Form pendaftaran Kedua";
                        await checkPause();

                        let targetPernikahan = String(row['Status Pernikahan']).trim();
                        if (!targetPernikahan || targetPernikahan === 'undefined' || targetPernikahan === 'null') {
                            Logger.info("⚠️ Kolom Status Pernikahan KOSONG! Menghitung dari umur...");
                            let tahunLahir = 0;
                            const tanggalLahirAsli = row['Tanggal lahir'];

                            if (tanggalLahirAsli instanceof Date) {
                                tahunLahir = tanggalLahirAsli.getFullYear();
                            } else if (typeof tanggalLahirAsli === 'string' && tanggalLahirAsli.includes('-')) {
                                const bagian = tanggalLahirAsli.split('-');
                                if (bagian.length === 3) {
                                    tahunLahir = (bagian[0].length === 4) ? parseInt(bagian[0], 10) : parseInt(bagian[2], 10);
                                }
                            }

                            if (tahunLahir > 0) {
                                const umur = new Date().getFullYear() - tahunLahir;
                                Logger.info(`Tahun lahir: ${tahunLahir} (Umur: ${umur} tahun)`);
                                targetPernikahan = umur < 19 ? "Belum Menikah" : "Menikah";
                            } else {
                                targetPernikahan = "Belum Menikah";
                            }
                            Logger.info(`=> Memutuskan status otomatis: ${targetPernikahan}`);
                        }
                        await checkPause();

                        if (targetPernikahan) {
                            const isPernikahanOK = await page.locator('div, span').filter({ hasText: new RegExp(`^\\s*${targetPernikahan}\\s*$`, 'i') }).filter({ visible: true }).count() > 0;
                            if (isPernikahanOK) {
                                Logger.info(`✅ Status Pernikahan sudah terisi: ${targetPernikahan}. Dilewati...`);
                            } else {
                                Logger.info(`🔄 Mengisi Status Pernikahan: ${targetPernikahan}`);
                                await page.locator('span:has-text("Pilih status pernikahan"), span:has-text("Belum Menikah"), span:has-text("Cerai"), span:has-text("Menikah")').last().click({ force: true }).catch(() => { });
                                await page.waitForTimeout(500);

                                const opsiPernikahan = page.locator('div, li').filter({ hasText: new RegExp(`^\\s*${targetPernikahan}\\s*$`, 'i') }).filter({ visible: true }).last();
                                await opsiPernikahan.click({ force: true }).catch(() => { });
                            }
                        }

                        const targetDisabilitas = String(row['Penyandang Disabilitas']).trim();
                        if (targetDisabilitas) {
                            const isDisabilitasOK = await page.locator('div, span').filter({ hasText: new RegExp(`^\\s*${targetDisabilitas}\\s*$`, 'i') }).filter({ visible: true }).count() > 0;
                            if (isDisabilitasOK) {
                                Logger.info(`✅ Disabilitas sudah terisi: ${targetDisabilitas}. Dilewati...`);
                            } else {
                                Logger.info(`🔄 Mengisi Disabilitas: ${targetDisabilitas}`);
                                await page.locator('span:has-text("Tidak memiliki disabilitas"), span:has-text("Pilih penyandang")').last().click({ force: true }).catch(() => { });
                                await page.waitForTimeout(500);
                                const opsiDisabilitas = page.locator('div, li').filter({ hasText: new RegExp(`^\\s*${targetDisabilitas}\\s*$`, 'i') }).filter({ visible: true }).last();
                                await opsiDisabilitas.click({ force: true }).catch(() => { });
                            }
                        }

                        const targetPekerjaanBaru = String(row['Pekerjaan'] || '').trim();
                        if (targetPekerjaanBaru) {
                            const kotakKosongLocator = page.locator('div, span').filter({ hasText: new RegExp('^\\s*Pilih pekerjaan\\s*$', 'i') }).filter({ visible: true }).last();
                            const isMasihKosong = await kotakKosongLocator.count() > 0;

                            if (!isMasihKosong) {
                                Logger.info(`✅ Pekerjaan sudah terisi data dari sistem Kemenkes. Membiarkan (Skip)...`);
                            } else {
                                try {
                                    Logger.info(`🔄 Kolom kosong. Mengisi pekerjaan dengan: ${targetPekerjaanBaru}`);
                                    await kotakKosongLocator.scrollIntoViewIfNeeded();
                                    await kotakKosongLocator.click({ force: true });
                                    await page.waitForTimeout(600);

                                    const inputCari = page.locator('input[placeholder*="Pekerjaan"], input[placeholder*="Cari"], input[type="text"]').last();
                                    if (await inputCari.isVisible({ timeout: 2000 }).catch(() => false)) {
                                        await inputCari.click({ force: true }).catch(() => { });
                                        await inputCari.clear().catch(() => { });
                                        await page.waitForTimeout(300);
                                        await inputCari.fill(targetPekerjaanBaru);
                                        await page.waitForTimeout(1000);
                                    }

                                    try {
                                        const opsiStrict = page.locator('div, li, [role="option"]').filter({ hasText: new RegExp(`^\\s*${targetPekerjaanBaru}\\s*$`, 'i') }).last();
                                        await opsiStrict.waitFor({ state: 'attached', timeout: 3000 });
                                        await opsiStrict.scrollIntoViewIfNeeded().catch(() => { });
                                        await opsiStrict.click({ force: true });
                                        Logger.info(`🎯 Berhasil memilih pekerjaan: ${targetPekerjaanBaru}`);
                                    } catch (errorStrict) {
                                        Logger.info(`⚠️ Mode persis gagal. Coba mode longgar untuk "${targetPekerjaanBaru}"...`);
                                        const opsiLoose = page.locator('div, li, [role="option"]').filter({ hasText: targetPekerjaanBaru }).last();
                                        await opsiLoose.waitFor({ state: 'attached', timeout: 3000 });
                                        await opsiLoose.scrollIntoViewIfNeeded().catch(() => { });
                                        await opsiLoose.click({ force: true });
                                        Logger.info(`🎯 Berhasil memilih pekerjaan (Mode Longgar): ${targetPekerjaanBaru}`);
                                    }
                                } catch (error) {
                                    Logger.info(`⚠️ Gagal total memilih Pekerjaan "${targetPekerjaanBaru}". Lanjut otomatis...`);
                                }
                            }
                        }
                        await checkPause();

                        const isAlamatKosong = await page.locator('div, span').filter({ hasText: new RegExp('^\\s*Pilih alamat domisili\\s*$', 'i') }).filter({ visible: true }).count() > 0;
                        if (!isAlamatKosong) {
                            Logger.info(`✅ Alamat Domisili sudah terisi dari sistem Kemenkes. Dilewati...`);
                        } else {
                            Logger.info(`🔄 Kolom Alamat Domisili kosong. Mulai mengeksekusi pengisian...`);
                            const daftarAlamat = [row['Provinsi'], row['Kota'], row['Kecamatan'], row['Kelurahan']];

                            await page.locator('div.cursor-pointer:has-text("Pilih alamat domisili")').last().click({ force: true });
                            await page.waitForTimeout(500);
                            const modalInput = page.locator('div.modal-content input[type="text"]').last();

                            for (let i = 0; i < daftarAlamat.length; i++) {
                                let daerah = daftarAlamat[i];
                                if (!daerah || daerah.trim() === "") continue;

                                daerah = String(daerah).trim().toUpperCase();
                                Logger.info(`Mencari wilayah: ${daerah}...`);

                                await modalInput.clear().catch(() => { });
                                await page.waitForTimeout(300);
                                await modalInput.fill(daerah);
                                await page.waitForTimeout(100);

                                const tombolPilihan = page.locator('div.modal-content button').filter({ hasText: new RegExp(`^\\s*${daerah}\\s*$`, 'i') }).filter({ visible: true }).last();

                                try {
                                    await tombolPilihan.waitFor({ state: 'visible', timeout: 5000 });
                                    await tombolPilihan.click({ force: true });
                                } catch (error) {
                                    Logger.info(`⚠️ "${daerah}" tidak ditemukan! Mengambil hasil paling mirip...`);
                                    await page.waitForTimeout(1000);
                                    const tombolCadangan = page.locator('div.modal-content button').filter({ visible: true }).last();
                                    if (await tombolCadangan.isVisible()) await tombolCadangan.click({ force: true });
                                }
                                await page.waitForTimeout(100);
                            }
                        }
                        await checkPause();

                        await page.locator('textarea[name="detail-domisili"]').last().fill(String(row['Detail Domisili']));
                        await page.locator('div.tracking-wide:has-text("Selanjutnya")').last().click({ force: true });

                        const tombolPilih = page.locator('button.btn-outline-primary:has-text("Pilih")').last();
                        Logger.info("Menunggu pop-up / tombol 'Pilih' muncul...");
                        await tombolPilih.waitFor({ state: 'visible', timeout: 10000 });
                        await tombolPilih.click({ force: true });

                        const btnSelanjutnyaForm2 = page.getByRole('button', { name: 'Daftarkan dengan NIK' }).last();
                        await page.waitForTimeout(500);
                        await klikAntiMacet(page, btnSelanjutnyaForm2, "Selanjutnya (Form 2)");

                        const notifDaftar = await Promise.race([
                            page.waitForSelector('div:has-text("Berhasil Daftar")', { timeout: 10000 }).then(() => 'BERHASIL'),
                            page.waitForSelector('div:has-text("Data pasien tidak sesuai"),div.pb-2:has-text("Data peserta tidak valid"),div:has-text("Terjadi kesalahan")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                            page.waitForSelector('div:has-text("Individu sudah")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                        ]).catch(() => 'TIMEOUT_SERVER');

                        if (notifDaftar === 'TIDAK_SESUAI') {
                            Logger.info(`NIK ${row['NIK']} data tidak sesuai di pengecekan form 2. Menyedot pesan...`);
                            sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Data tidak sesuai di form 2`);

                            let pesanErrorForm2 = "Data tidak sesuai (Detail tidak terbaca)";
                            try {
                                const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();
                                if (await popupAktif.count() > 0) {
                                    pesanErrorForm2 = await popupAktif.innerText();
                                } else {
                                    const popupAlternatif = page.locator('div.text-red-500, div:has-text("Data pasien tidak sesuai"), div:has-text("Terjadi kesalahan")').filter({ visible: true }).last();
                                    if (await popupAlternatif.count() > 0) pesanErrorForm2 = await popupAlternatif.innerText();
                                }
                            } catch (e) { }

                            pesanErrorForm2 = pesanErrorForm2.replace(/\n/g, ' - ').trim();
                            row['notif'] = pesanErrorForm2;
                            row.Keterangan = "Ditolak Form 2: Cek kolom notif";
                            sendUILog(`GAGAL|NIK ${nikPeserta} bermasalah. Alasan: ${pesanErrorForm2}`);

                            await page.locator('button:has-text("Tutup"),button:has-text("Periksa Kembali"),div:has-text("periksa kembali "), button:has-text("OK")').last().click();
                            await page.reload({ waitUntil: 'networkidle' });
                            await page.waitForTimeout(1000);
                            continue;
                        } else if (notifDaftar === 'TIMEOUT_SERVER') {
                            throw new Error("TIMEOUT_SERVER: Web tidak merespon saat menyimpan Form 2.");
                        } else if (notifDaftar === 'BERHASIL') {
                            await page.locator('div:has-text("Tutup")').last().click({ force: true });
                        }
                    } else if (popupResult === 'SUDAH_PELAYANAN') {
                        Logger.info(`NIK ${row['NIK']} Sudah Punya Data. Melewati form alamat...`);
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Sudah ada data .. menuju pelayanan`);
                        const tombolCariIndividu = page.locator('div.tracking-wide:has-text("Cari Individu"), div:has-text("Tutup")').filter({ visible: true }).first();
                        await tombolCariIndividu.waitFor({ state: 'attached', timeout: 5000 });
                        await tombolCariIndividu.evaluate(el => el.click());
                        await page.waitForTimeout(2000);
                        langsungPelayanan = true;
                    } else if (popupResult === 'TIMEOUT_SERVER') {
                        throw new Error("TIMEOUT_SERVER: Server lemot / timeout di awal");
                    } else {
                        Logger.info(`❌ NIK ${row['NIK']} ditolak sistem karena NIK/Nama tidak valid. Menyedot pesan...`);
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Data tidak valid`);

                        let pesanErrorForm1 = "Data tidak valid / ditolak sistem";
                        try {
                            const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();
                            if (await popupAktif.count() > 0) {
                                pesanErrorForm1 = await popupAktif.innerText();
                            } else {
                                const popupAlternatif = page.locator('div.text-red-500, div:has-text("Data peserta tidak valid"), div:has-text("tidak ditemukan")').filter({ visible: true }).last();
                                if (await popupAlternatif.count() > 0) pesanErrorForm1 = await popupAlternatif.innerText();
                            }
                        } catch (e) { }

                        pesanErrorForm1 = pesanErrorForm1.replace(/\n/g, ' - ').trim();
                        row['notif'] = pesanErrorForm1;
                        row.Keterangan = "Ditolak Form 1: Cek kolom notif";
                        sendUILog(`GAGAL|NIK ${nikPeserta} bermasalah. Alasan: ${pesanErrorForm1}`);

                        const tombolTutupPopup = page.locator('button:has-text("Tutup"),button:has-text("Periksa Kembali"), button:has-text("OK")').filter({ visible: true }).first();
                        if (await tombolTutupPopup.count() > 0) {
                            await tombolTutupPopup.click({ force: true }).catch(() => { });
                            await page.reload({ waitUntil: 'networkidle' });
                        }
                        await page.waitForTimeout(1000);
                        continue;
                    }
                }

                sesi = "Konfirmasi Kehadiran";
                await checkPause();

                if (!langsungPelayanan) {
                    await page.waitForTimeout(1500);
                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(1500);

                    await page.locator('span:has-text("Nomor Tiket"), span:has-text("NIK")').last().click({ force: true });
                    await page.locator('div:text-is("NIK")').last().click();
                    await page.locator('input[name="NIK"], input#nik').last().fill(String(row['NIK']));
                    await page.waitForTimeout(1000);
                    await page.keyboard.press('Enter');

                    const namaSiswa = row['Nama Lengkap'];
                    sesi = "Pelacakan hadir/sudah hadir";

                    const hasilPencarian = await Promise.race([
                        page.waitForSelector(`tr:has-text("${namaSiswa}") >> button:has-text("Konfirmasi Hadir")`, { state: 'visible', timeout: 5000 }).then(() => 'TOMBOL_MUNCUL'),
                        page.waitForSelector(`tr:has-text("${namaSiswa}") >> div:has-text("Sudah Hadir")`, { state: 'visible', timeout: 5000 }).then(() => 'SUDAH_HADIR')
                    ]).catch(() => 'TIMEOUT');

                    if (hasilPencarian === 'TOMBOL_MUNCUL') {
                        Logger.info(`Tombol Konfirmasi Hadir muncul untuk ${namaSiswa}. Memproses kehadiran...`);
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Memproses kehadiran`);

                        const btnHadir = page.locator(`tr:has-text("${namaSiswa}") >> button:has-text("Konfirmasi Hadir")`);
                        await page.waitForTimeout(1000);
                        await btnHadir.scrollIntoViewIfNeeded();
                        await btnHadir.click();

                        await page.locator('input#verify').last().check({ force: true });
                        await page.waitForTimeout(500);
                        await page.locator('div.tracking-wide:has-text("Hadir ")').last().click();

                        row.Status = "sudah daftar bos";

                        await page.waitForSelector('text="Berhasil Hadir"', { timeout: 3000 }).catch(() => { });
                        const tombolTutup = page.locator('button:has-text("Tutup"), span:text-is("Tutup")').filter({ visible: true }).first();

                        if (await tombolTutup.count() > 0) {
                            await tombolTutup.click({ force: true }).catch(() => { });
                        } else {
                            await page.locator('text="Tutup"').filter({ visible: true }).first().click({ force: true }).catch(() => { });
                        }
                    } else if (hasilPencarian === 'SUDAH_HADIR') {
                        Logger.info("⏩ Status 'Sudah Hadir' terdeteksi! Langsung gas satset ke Pelayanan Klinis...");
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Terdeteksi sudah hadir .. langsung ke pelayanan`);
                    } else {
                        Logger.info("⚠️ Website Kemenkes tidak merespon/lemot. Tetap lanjut ke Pelayanan Klinis...");
                    }
                }

                sesi = "pencarian data di pelayanan";
                await checkPause();

                if (!langsungPelayanan) {
                    Logger.info("Berpindah ke menu Pelayanan Klinis...");
                    await page.waitForTimeout(500);
                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pelayanan', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(2000);
                } else {
                    Logger.info("Sudah berada di halaman Pelayanan otomatis, lanjut cari data...");
                    await page.waitForTimeout(1000);
                }

                const checkboxLocation = page.locator('input#sameLocation');
                if (await checkboxLocation.isVisible({ timeout: 500 })) {
                    Logger.info("Checkbox sameLocation ditemukan! Mencentang...");
                    await checkboxLocation.check({ force: true }).catch(async () => {
                        await checkboxLocation.click({ force: true }).catch(() => { });
                    });

                    const tombolSimpan = page.locator('button:has-text("Simpan")').last();
                    try {
                        await tombolSimpan.waitFor({ state: 'attached', timeout: 5000 });
                        Logger.info("Tombol Simpan ketemu! Menggulir dan memaksa klik...");
                        await tombolSimpan.scrollIntoViewIfNeeded().catch(() => { });
                        await page.waitForTimeout(500);
                        await tombolSimpan.evaluate(node => node.click());
                        Logger.info("✅ Tombol Simpan berhasil dieksekusi!");
                    } catch (error) {
                        Logger.info("⚠️ Tombol <button> Simpan lambat muncul. Beralih ke Jalur Cadangan (Tembak Teksnya)...");
                        const teksSimpan = page.locator('div.tracking-wide:has-text("Simpan"), span:has-text("Simpan")').last();
                        if (await teksSimpan.isVisible({ timeout: 1000 })) {
                            await teksSimpan.scrollIntoViewIfNeeded().catch(() => { });
                            await teksSimpan.evaluate(node => node.click()).catch(() => { });
                            Logger.info("✅ Tombol Simpan (Jalur Cadangan) berhasil diklik!");
                        } else {
                            Logger.info("❌ Gagal parah: Tombol Simpan benar-benar tidak ada di layar.");
                        }
                    }
                }
                await checkPause();

                await page.locator('span:has-text("Nama"), span:has-text("NIK")').last().click();
                await page.locator('div:text-is("NIK")').last().click();

                const inputNik = page.locator('#searchNik').last();
                await inputNik.clear();
                await inputNik.pressSequentially(String(row['NIK']).trim(), { delay: 1 });
                await page.waitForTimeout(10);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(1000);

                sesi = "pencarian status pelayanan/pemeriksaan";
                Logger.info("Memeriksa tab status pemeriksaan (Belum/Sedang/Selesai)...");
                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Memeriksa status pemeriksaan/pelayanan`);

                const tabBelum = page.locator('div.cursor-pointer').filter({ hasText: 'Belum Pemeriksaan' }).last();
                const tabSedang = page.locator('div.cursor-pointer').filter({ hasText: 'Sedang Pemeriksaan' }).last();
                const tabSelesai = page.locator('div.cursor-pointer').filter({ hasText: 'Selesai Pemeriksaan' }).last();

                let statusTabel = "KOSONG";

                async function cekDanGeserTabel() {
                    const targetNik = String(row['Nama Lengkap']).trim();
                    const barisTarget = page.locator('tbody tr', { hasText: targetNik }).first();

                    try {
                        await barisTarget.waitFor({ state: 'visible', timeout: 3000 });
                    } catch (e) {
                        return "KOSONG";
                    }

                    await page.evaluate(() => {
                        const elemenScroll = document.querySelectorAll('div, table, tbody');
                        elemenScroll.forEach(el => {
                            if (el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
                        });
                    });
                    await checkPause();
                    await page.waitForTimeout(500);

                    const teksBaris = await barisTarget.innerText();
                    if (teksBaris.includes("Belum lengkap") || teksBaris.includes("Belum Pemeriksaan") || teksBaris.includes("Sedang Pemeriksaan")) {
                        return "BELUM_LENGKAP";
                    }
                    if (teksBaris.includes("Lengkap") && teksBaris.includes("Selesai Pemeriksaan")) {
                        return "SUDAH_LENGKAP";
                    }
                    return "KOSONG";
                }
                await checkPause();

                await tabBelum.click({ force: true }).catch(() => { });
                statusTabel = await cekDanGeserTabel();

                if (statusTabel === "KOSONG") {
                    Logger.info("Data tidak di tab Belum. Pindah ke tab Sedang...");
                    await tabSedang.click({ force: true }).catch(() => { });
                    statusTabel = await cekDanGeserTabel();
                }

                if (statusTabel === "KOSONG") {
                    Logger.info("Data tidak di tab Sedang. Pindah ke tab Selesai...");
                    await tabSelesai.click({ force: true }).catch(() => { });
                    statusTabel = await cekDanGeserTabel();
                }

                if (statusTabel === "SUDAH_LENGKAP") {
                    row.Keterangan = "terdeteksi sudah pelayanan lengkap";
                    sendUILog(`SUKSES|Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                    Logger.info(`✅ Data NIK ${row['NIK']} sudah lengkap di sistem. Lanjut siswa berikutnya.`);
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Terdeteksi sudah lengkap`);
                    continue;
                } else if (statusTabel === "KOSONG") {
                    row.Keterangan = "Gagal: Data gaib / Tidak muncul di ketiga tab,kemungkinan faskes luar";
                    sendUILog(`GAGAL|NIK ${nikPeserta} Tidak muncul di pelayanan, kemungkinan faskes luar`);
                    Logger.info(`❌ Tabel kosong untuk NIK ${row['NIK']}. Melewati anak ini.`);
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Data tidak muncul di ketiga tab`);
                    continue;
                }

                Logger.info(`⏳ Status BELUM LENGKAP terdeteksi. Mulai mengeksekusi form pelayanan...`);
                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Status belum lengkap .. gas eksekusi`);

                const barisTarget = page.locator('tbody tr', { hasText: String(row['Nama Lengkap']).trim() }).first();
                const tombolMulaiTabel = barisTarget.locator('button:has-text("Mulai")');

                if (await tombolMulaiTabel.isVisible()) {
                    await tombolMulaiTabel.scrollIntoViewIfNeeded();
                    await tombolMulaiTabel.click({ force: true });
                } else {
                    row.Keterangan = "Gagal: Tombol Mulai tidak ditemukan pada baris Nama target";
                    sendUILog(`GAGAL|NIK ${nikPeserta} Tombol Mulai tidak ditemukan pada baris Nama target`);
                    continue;
                }

                Logger.info("Menunggu halaman pemeriksaan dimuat...");
                await page.waitForTimeout(1000);
                Logger.info("Menunggu halaman form klinis dimuat...");
                await page.waitForTimeout(1000);

                const btnMulaiPemeriksaan = page.locator('button:has-text("Mulai Pemeriksaan")').last();
                if (await btnMulaiPemeriksaan.isVisible()) {
                    await btnMulaiPemeriksaan.click();
                    await page.waitForTimeout(1000);

                    const btnSimpanTgl = page.locator('button:has-text("Simpan")').last();
                    if (await btnSimpanTgl.isVisible()) {
                        await btnSimpanTgl.click();
                        await page.waitForTimeout(2000);
                    }
                } else {
                    await page.waitForTimeout(1000);
                }

                sesi = "form pemeriksaan mandiri";
                await checkPause();

                let cekStatus = String(row['Status Pernikahan'] || '').trim();
                if (!cekStatus || cekStatus === 'undefined' || cekStatus === 'null') {
                    Logger.info("⚠️ Kolom Status Pernikahan KOSONG di Pemeriksaan Mandiri! Menghitung dari umur...");
                    let tahunLahir = 0;
                    const tanggalLahirAsli = row['Tanggal lahir'];

                    if (tanggalLahirAsli instanceof Date) {
                        tahunLahir = tanggalLahirAsli.getFullYear();
                    } else if (typeof tanggalLahirAsli === 'string' && tanggalLahirAsli.includes('-')) {
                        const bagian = tanggalLahirAsli.split('-');
                        if (bagian.length === 3) tahunLahir = (bagian[0].length === 4) ? parseInt(bagian[0], 10) : parseInt(bagian[2], 10);
                    }

                    if (tahunLahir > 0) {
                        const umur = new Date().getFullYear() - tahunLahir;
                        row['Status Pernikahan'] = umur < 19 ? "Belum Menikah" : "Menikah";
                        Logger.info(`=> Memutuskan status otomatis form mandiri: ${row['Status Pernikahan']} (Umur: ${umur} tahun)`);
                    }
                }
                await checkPause();

                const kamusPintar = [
                    { kolom: 'Status Pernikahan', kataKunci: 'Status Perkawinan' },
                    { kolom: 'Disabilitas', kataKunci: 'apakah anda penyandang disabilitas' },
                    { kolom: 'Hamil', kataKunci: 'apakah anda sedang hamil' }
                ];

                const kamusLayananKhusus = [
                    {
                        kataKunciLayanan: 'Faktor Risiko Kanker Usus',
                        kolomExcel: 'Faktor Risiko Kanker Usus',
                        rumus: {
                            'TIDAK': ["Tidak", "Tidak"],
                            'IYA': ["Ya", "Tidak"]
                        }
                    },
                    {
                        kataKunciLayanan: 'Faktor Risiko TB - Dewasa & Lansia',
                        kolomExcel: 'Faktor Risiko TB - Dewasa & Lansia',
                        rumus: { 'TIDAK': ["Tidak"] }
                    },
                    {
                        kataKunciLayanan: 'Hati',
                        kolomExcel: 'Hati',
                        rumus: { 'NORMAL': ["Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak"] }
                    },
                    {
                        kataKunciLayanan: 'Kanker Leher Rahim',
                        kolomExcel: 'Kanker Leher Rahim',
                        rumus: {
                            'IYA': ["Ya"],
                            'TIDAK': ["Tidak"]
                        }
                    },
                    {
                        kataKunciLayanan: 'Kesehatan Jiwa',
                        kolomExcel: 'Kesehatan Jiwa',
                        rumus: {
                            'BAIK': ["Tidak sama sekali", "Tidak sama sekali", "Tidak sama sekali", "Tidak sama sekali"],
                            'KURANG BAIK': ["Tidak sama sekali", "Kurang dari 1 minggu", "Tidak sama sekali", "Tidak sama sekali"]
                        }
                    },
                    {
                        kataKunciLayanan: 'Penapisan Risiko Kanker Paru',
                        kolomExcel: 'Penapisan Risiko Kanker Paru',
                        rumus: { 'NORMAL': ["Tidak", "Tidak", "Tidak", "Tidak", "Tidak", "Tidak"] }
                    },
                    {
                        kataKunciLayanan: 'Perilaku Merokok',
                        kolomExcel: 'Perilaku Merokok',
                        rumus: {
                            'TIDAK': ["Tidak", "Tidak", "Tidak"],
                            'IYA': ["ya", "Keduanya", "1", "5", "Ya"]
                        }
                    },
                    {
                        kataKunciLayanan: 'Tingkat Aktivitas Fisik (sedang dan berat)',
                        kolomExcel: 'Tingkat Aktivitas Fisik (sedang dan berat)',
                        rumus: {
                            'BAIK': ["Ya", "4", "60", "Tidak", "Ya", "3", "60", "Tidak", "Tidak", "Tidak"],
                            'SANGAT BAIK': ["Ya", "7", "120", "Ya", "Ya", "5", "120", "Ya", "Ya", "Tidak"]
                        }
                    },
                    {
                        kataKunciLayanan: 'Riwayat Imunisasi Tetanus(Status T) - Hanya untuk Catin',
                        kolomExcel: 'TT Catin',
                        rumus: {
                            'TIDAK TAHU': ["Tidak tahu atau tidak ingat"]
                        }
                    }
                ];
                await checkPause();

                Logger.info("Mengecek status Pemeriksaan Mandiri...");
                let adaMandiri = true;
                let layananTerproses = [];
                let gagalLoop = 0;
                let examTerlewatKosong = []; // 🌟 nama pemeriksaan yang di-skip karena jawaban wajib kosong di Excel

                while (adaMandiri) {
                    await checkPause();
                    await page.waitForTimeout(1000);
                    const semuaBarisAbu = page.locator('tr:has(img[src*="icon-success-gray.svg"]):has(button:has-text("Input Data"))').filter({ visible: true });
                    const jumlahBarisAbu = await semuaBarisAbu.count();

                    let barisMandiri = null;
                    let namaBersih = "";

                    for (let k = 0; k < jumlahBarisAbu; k++) {
                        const kandidatBaris = semuaBarisAbu.nth(k);
                        const namaPemeriksaan = await kandidatBaris.locator('td').first().textContent().catch(() => "");
                        const namaClean = namaPemeriksaan.trim();

                        if (!layananTerproses.includes(namaClean)) {
                            barisMandiri = kandidatBaris;
                            namaBersih = namaClean;
                            break;
                        }
                    }

                    if (!barisMandiri) {
                        if (gagalLoop < 2 && jumlahBarisAbu > 0) {
                            gagalLoop++;
                            await page.waitForTimeout(2000);
                            continue;
                        }
                        adaMandiri = false;
                        Logger.info("✅ Semua Pemeriksaan Mandiri sudah selesai atau telah dilewati.");
                        break;
                    }

                    gagalLoop = 0;
                    Logger.info(`Mengisi Mandiri: ${namaBersih}`);
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi skrining mandiri`);
                    layananTerproses.push(namaBersih);

                    await barisMandiri.locator('button:has-text("Input Data")').click({ force: true });
                    await page.waitForTimeout(500);

                    let rumusBakuTerditeksi = null;
                    for (let layanan of kamusLayananKhusus) {
                        if (namaBersih.toLowerCase().includes(layanan.kataKunciLayanan.toLowerCase())) {
                            let statusDiExcel = String(row[layanan.kolomExcel] || "").trim();
                            let keyRumus = statusDiExcel.toUpperCase();
                            if (layanan.rumus[keyRumus]) {
                                rumusBakuTerditeksi = layanan.rumus[keyRumus];
                                Logger.info(`⚡ Jalur Pintas Aktif! Menggunakan rumus [${keyRumus}]`);
                            }
                            break;
                        }
                    }
                    await checkPause();

                    let indexSoal = 0;
                    let sabukPengamanLoading = 0;

                    while (true) {
                        await checkPause();
                        let jmlSoalSaatIni = await page.locator('.sd-question').filter({ visible: true }).count();
                        if (indexSoal >= jmlSoalSaatIni) {
                            // 🌟 Tunggu SEPERLUNYA (indikator loading beneran), bukan tebak-tebakan 1 detik.
                            // Kalau memang tidak ada loading, ini nyaris instan -> lebih cepat dari sebelumnya.
                            await tungguLoadingSelesai(page, 3000);
                            jmlSoalSaatIni = await page.locator('.sd-question').filter({ visible: true }).count();
                            if (indexSoal >= jmlSoalSaatIni) {
                                sabukPengamanLoading++;
                                if (sabukPengamanLoading >= 3) break;
                                continue;
                            }
                        }
                        await checkPause();

                        sabukPengamanLoading = 0;
                        const kotakSoal = page.locator('.sd-question').filter({ visible: true }).nth(indexSoal);
                        let teksSoalWeb = await bacaTeksAman(kotakSoal.locator('.sd-question__title'));
                        let jawabanTarget = null;

                        if (rumusBakuTerditeksi && indexSoal < rumusBakuTerditeksi.length) {
                            jawabanTarget = String(rumusBakuTerditeksi[indexSoal]).trim();
                        } else if (!rumusBakuTerditeksi) {
                            for (let item of kamusPintar) {
                                if (teksSoalWeb.toLowerCase().includes(item.kataKunci.toLowerCase())) {
                                    if (row[item.kolom]) {
                                        jawabanTarget = String(row[item.kolom]).trim();
                                        Logger.info(`🔍 Cocok! Web "${item.kataKunci}" -> Excel "${item.kolom}" (${jawabanTarget})`);
                                    }
                                    break;
                                }
                            }
                        }

                        if (jawabanTarget) {
                            await kotakSoal.scrollIntoViewIfNeeded().catch(() => { });
                            await page.waitForTimeout(200);

                            const adaRadio = await kotakSoal.locator('.sd-radio').count() > 0;
                            const adaDropdown = await kotakSoal.locator('.sd-dropdown, .sv-dropdown').count() > 0;
                            const adaInput = await kotakSoal.locator('input[type="text"], input[type="number"]').count() > 0;

                            let daftarJawaban = jawabanTarget.split(/[/,]/).map(j => j.trim()).filter(j => j !== "");
                            let berhasilTerisi = false;
                            await checkPause();

                            for (let teksJawab of daftarJawaban) {
                                if (berhasilTerisi) break;
                                let targetKecil = teksJawab.toLowerCase();

                                if (adaRadio || adaDropdown) {
                                    let opsiElemen;
                                    if (adaDropdown) {
                                        await kotakSoal.locator('.sd-dropdown, .sv-dropdown').first().click({ force: true }).catch(() => { });
                                        await page.waitForTimeout(600);
                                        opsiElemen = page.locator('.sv-list__item, .sd-dropdown__item').filter({ visible: true });
                                    } else {
                                        opsiElemen = kotakSoal.locator('label').filter({ visible: true });
                                    }

                                    const totalOpsi = await opsiElemen.count();
                                    let kandidatElemen = null;
                                    let tipeMatch = "";

                                    for (let o = 0; o < totalOpsi; o++) {
                                        let teksWeb = (await bacaTeksAman(opsiElemen.nth(o))).toLowerCase();
                                        if (teksWeb === targetKecil) {
                                            kandidatElemen = opsiElemen.nth(o);
                                            tipeMatch = "Persis Sama";
                                            break;
                                        }
                                    }

                                    if (!kandidatElemen) {
                                        for (let o = 0; o < totalOpsi; o++) {
                                            let teksWeb = (await bacaTeksAman(opsiElemen.nth(o))).toLowerCase();
                                            if (teksWeb.includes(targetKecil) && targetKecil.length > 1) {
                                                kandidatElemen = opsiElemen.nth(o);
                                                tipeMatch = "Web Mengandung Teks";
                                                break;
                                            }
                                        }
                                    }

                                    if (!kandidatElemen) {
                                        for (let o = 0; o < totalOpsi; o++) {
                                            let teksWeb = (await bacaTeksAman(opsiElemen.nth(o))).toLowerCase();
                                            if (targetKecil.includes(teksWeb) && teksWeb.length > 1) {
                                                kandidatElemen = opsiElemen.nth(o);
                                                tipeMatch = "Excel Mengandung Teks";
                                                break;
                                            }
                                        }
                                    }

                                    if (kandidatElemen) {
                                        await kandidatElemen.click({ force: true }).catch(() => { });
                                        Logger.info(`✅ Dipilih (${tipeMatch}): Target "${teksJawab}"`);
                                        berhasilTerisi = true;
                                    }
                                } else if (adaInput) {
                                    const kotakKetik = kotakSoal.locator('input[type="text"], input[type="number"]').first();
                                    await kotakKetik.clear().catch(() => { });
                                    await kotakKetik.fill(teksJawab).catch(() => { });
                                    Logger.info(`✅ Isi Kolom Input: "${teksJawab}"`);
                                    berhasilTerisi = true;
                                }
                            }
                            await page.waitForTimeout(600);
                        }
                        indexSoal++;
                    }
                    await checkPause();

                    const btnKirimMandiri = page.locator('input[title="Kirim"], button[title="Kirim"], button:has-text("Kirim"), .sd-btn--action:has-text("Kirim")').filter({ visible: true }).last();
                    if (await btnKirimMandiri.count() > 0) {
                        await klikAntiMacet(page, btnKirimMandiri, `Kirim Mandiri ${namaBersih}`);
                    } else {
                        Logger.info(`⚠️ Tombol Kirim untuk ${namaBersih} tidak ditemukan, mencoba melanjutkan...`);
                    }

                    await page.waitForTimeout(1000);
                    await checkPause();

                    // 🌟 FITUR BARU: Web menampilkan pesan di bawah soal kalau ada jawaban WAJIB
                    // yang kosong (biasanya karena datanya memang belum ada di Excel). Kalau ini
                    // terdeteksi, jangan dipaksa lagi — langsung Kembali dan lanjut ke pemeriksaan
                    // mandiri berikutnya (namaBersih sudah tercatat di layananTerproses jadi tidak
                    // akan diulang-ulang).
                    // CATATAN: selector class error di bawah ini tebakan berdasarkan pola SurveyJS
                    // (tema "sd-"). Kalau ternyata tidak kedeteksi, inspect elemen pesan error
                    // merah di bawah soal saat submit gagal, lalu kirim class-nya untuk disesuaikan.
                    const errorWajibDiisi = page.locator('.sd-question__erbox, .sv_qstn_error_box, [class*="erbox"], .sd-question--error').filter({ visible: true });
                    const jumlahErrorWajib = await errorWajibDiisi.count();

                    if (jumlahErrorWajib > 0) {
                        Logger.info(`⚠️ "${namaBersih}" punya ${jumlahErrorWajib} jawaban wajib yang kosong (data belum ada di Excel). Melewati & kembali...`);
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Lewati ${namaBersih} (jawaban wajib kosong)`);
                        examTerlewatKosong.push(namaBersih);

                        const btnKembaliMandiri = page.locator('button:has-text("Kembali"), button:has-text("Batal"), button:has-text("Go Back"), .close').filter({ visible: true }).first();
                        if (await btnKembaliMandiri.count() > 0) {
                            await btnKembaliMandiri.click({ force: true }).catch(() => { });
                        } else {
                            await page.keyboard.press('Escape');
                        }
                        await page.waitForTimeout(1000);
                        await checkPause();
                        continue; // lanjut cari pemeriksaan mandiri lain, jangan diproses lebih jauh
                    }

                    const popupOk = page.locator('button:has-text("OK"), button:has-text("Tutup")').filter({ visible: true });
                    if (await popupOk.count() > 0) {
                        Logger.info("⚠️ Menutup popup informasi...");
                        await popupOk.first().click({ force: true }).catch(() => { });
                        await page.waitForTimeout(1000);
                    }

                    const modalMasihBuka = page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true });
                    if (await modalMasihBuka.count() > 0 && await page.locator('tr:has-text("Input Data")').count() === 0) {
                        Logger.info(`⚠️ Form ${namaBersih} macet tidak tertutup! Memaksa tutup...`);
                        const btnBatal = page.locator('button:has-text("Batal"), button:has-text("Kembali"), .close').filter({ visible: true });
                        if (await btnBatal.count() > 0) {
                            await btnBatal.first().click({ force: true }).catch(() => { });
                        } else {
                            await page.keyboard.press('Escape');
                        }
                        await page.waitForTimeout(1000);
                    }

                }

                // 🌟 Catat & laporkan pemeriksaan mandiri yang dilewati karena jawaban wajib kosong,
                // supaya kelihatan di Excel mana saja yang perlu dilengkapi datanya lalu di-run ulang.
                if (examTerlewatKosong.length > 0) {
                    Logger.info(`⚠️ Pemeriksaan mandiri dilewati (data Excel kosong): ${examTerlewatKosong.join(', ')}`);
                    row['Soal Mandiri Terlewat'] = examTerlewatKosong.join(', ');
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|${examTerlewatKosong.length} pemeriksaan mandiri dilewati (data kosong)`);
                }

                sesi = "Pemeriksaan oleh nakes";
                await checkPause();

                // 🌟 Daftar form Nakes dibuat berbasis data (bukan hardcode berurutan) —
                // kalau suatu saat ada pemeriksaan nakes tambahan, cukup tambah 1 objek baru
                // di array ini, TIDAK perlu ubah logika loop-nya.
                const daftarFormNakes = [
                    {
                        nama: "Gizi",
                        isi: async () => {
                            const bb = hitungNilaiNormal(row['Berat Badan'], "Berat Badan", row['Tanggal lahir']);
                            const tb = hitungNilaiNormal(row['Tinggi Badan'], "Tinggi Badan", row['Tanggal lahir']);
                            const lp = hitungNilaiNormal(row['Lingkar Perut'], "Lingkar Perut", row['Tanggal lahir']);

                            await page.locator('input[placeholder*="isikan dalam satuan kg, dengan koma diisi dengan (.)"]').last().fill(bb);
                            await page.locator('input[placeholder*="Isi sesuai hasil pengukuran tinggi badan dalam cm"]').last().fill(tb);
                            await page.locator('input[placeholder*="Isi sesuai hasil pengukuran"]').last().fill(lp);
                        }
                    },
                    {
                        nama: "Tekanan Darah",
                        isi: async () => {
                            await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
                            const sistol = hitungNilaiNormal(row['Sistol'], "Sistol", row['Tanggal lahir']);
                            const diastol = hitungNilaiNormal(row['Diastol'], "Diastol", row['Tanggal lahir']);
                            const inputs = page.locator('input.sd-input.sd-text[type="number"]');
                            await inputs.nth(0).fill(sistol);
                            await inputs.nth(1).fill(diastol);
                        }
                    },
                    {
                        nama: "Pemeriksaan Gula Darah",
                        isi: async () => {
                            await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
                            const gd = hitungNilaiNormal(row['Gula Darah'], "Gula Darah", row['Tanggal lahir']);
                            await page.locator('input.sd-input.sd-text[id="sq_102i"]').last().fill(gd);
                        }
                    }
                    // 🌟 Contoh menambah form nakes baru di kemudian hari:
                    // {
                    //     nama: "Nama Layanan Baru",
                    //     isi: async () => {
                    //         await page.locator('input[placeholder*="..."]').last().fill(row['Kolom Excel Baru']);
                    //     }
                    // }
                ];

                for (const formNakes of daftarFormNakes) {
                    await checkPause();
                    await isiFormLayanan(page, formNakes.nama, formNakes.isi);
                }

                await page.evaluate(() => window.scrollTo(0, 0));
                await page.waitForTimeout(1000);

                const btnSelesaiLayanan = page.getByRole('button', { name: /Selesaikan Layanan/i }).first();
                if (await btnSelesaiLayanan.isVisible()) {
                    Logger.info("Mengklik tombol Selesaikan Layanan...");
                    await klikAntiMacet(page, btnSelesaiLayanan, "Selesaikan Layanan");

                    const notifSelesai = await Promise.race([
                        page.getByRole('button', { name: /Konfirmasi/i }).waitFor({ state: 'visible', timeout: 3000 }).then(() => 'ADA_KONFIRMASI'),
                        page.waitForTimeout(1000).then(() => 'TIDAK_ADA_KONFIRMASI')
                    ]);

                    if (notifSelesai === 'ADA_KONFIRMASI') {
                        await page.getByRole('button', { name: /Konfirmasi/i }).click();
                        Logger.info("Pop-up konfirmasi berhasil disetujui.");
                        await page.waitForTimeout(1500);
                    }
                } else {
                    Logger.info("Tombol Selesaikan Layanan tidak ditemukan (Mungkin sudah berstatus Selesai).");
                }
                await checkPause();

                row.jumlahCoba = undefined;
                row.Keterangan = "Berhasil Selesai Pelayanan";
                sendUILog(`SUKSES|Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                Logger.info(`Tuntas untuk NIK ${row['NIK']}`);
                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Berhasil Selesai Pelayanan`);

            } catch (error) {
                if (error.message === "STOPPED_BY_USER") {
                    sendUILog("⚠️ Robot dihentikan paksa oleh pengguna.");
                    break;
                }

                let pesanError = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : String(error || '');
                pesanError = pesanError || "Unknown Error";

                const isTimeout = pesanError.toLowerCase().includes("timeout");

                if (isTimeout && row.jumlahCoba < 3) {
                    Logger.info(`⚠️ Terdeteksi Timeout lambat pada NIK ${row['NIK']}. Akan diulang (Menuju percobaan ke-${row.jumlahCoba + 1})...`);
                    row.jumlahCoba += 1;
                    i--;
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Reload Halaman`);
                    await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
                    await page.waitForTimeout(2500);
                } else {
                    if (pesanError.includes("TIMEOUT_SERVER")) {
                        row.Keterangan = `Gagal [${sesi}]: Server Kemenkes Lemot (setelah ${row.jumlahCoba}x coba)`;
                    } else {
                        row.Keterangan = `Gagal [${sesi}]: ${pesanError.split('\n')[0]}`;
                    }
                    sendUILog(`GAGAL|NIK ${nikPeserta} bermasalah. Alasan: ${row.Keterangan}`);
                    Logger.error(`❌ Menyerah pada NIK ${row['NIK']} setelah ${row.jumlahCoba}x mencoba di [${sesi}]: ${pesanError}`);
                    row.jumlahCoba = undefined;

                    Logger.info("🔄 Error fatal / macet total. Me-reset browser kembali ke halaman awal untuk siswa berikutnya...");
                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => { });
                    await page.waitForTimeout(2000);
                }
            } finally {
                ExcelManager.writeExcel(dataPeserta, excelPath);
            }
        }

        sendUILog("✨ Selesai mengeksekusi semua data Excel.");

    } catch (fatalError) {
        sendUILog(`❌ ERROR FATAL: ${fatalError.message}`);
        throw fatalError;
    } finally {
        ipcMain.removeListener('toggle-pause-robot', pauseListener);
        ipcMain.removeListener('stop-robot', stopListener);
        if (browser) await browser.close();
    }
}


module.exports = { runAutomation };