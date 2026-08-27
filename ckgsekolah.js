const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { app, ipcMain } = require('electron'); // 🌟 TAMBAHAN: Tarik app & ipcMain dari Electron
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
const Logger = panggilModul('Utils/Logger.js');

// ==============================================================================
// 1. KUMPULAN FUNGSI HELPER 
// ==============================================================================

// 🌟 FITUR 1: FUNGSI ANTI-MACET UNTUK SEMUA TOMBOL
async function klikAntiMacet(page, locatorTombol, namaAksi = "Tombol") {
    const loaderHitam = page.locator('div.bg-blackSoft').first();
    const maxPercobaan = 3;

    for (let i = 1; i <= maxPercobaan; i++) {
        if (await locatorTombol.count() > 0 && await locatorTombol.isVisible()) {
            await locatorTombol.click({ force: true });
        }

        try {
            // 🌟 PERBAIKAN: pastikan loader sempat MUNCUL dulu (bukti request benar-benar
            // terkirim ke server) sebelum kita anggap "hidden" = selesai. Sebelumnya,
            // waitFor({state:'hidden'}) langsung sukses instan kalau loader belum sempat
            // attach ke DOM (server >500ms utk munculkan overlay), sehingga kode lanjut
            // jalan padahal request masih diproses di server.
            await loaderHitam.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {
                // Loader memang tidak pernah muncul (aksi terlalu cepat / tidak pakai overlay).
                // Ini bukan error — cukup lanjut ke pengecekan 'hidden' di bawah.
            });

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

// 🌟 PERBAIKAN: pengganti pola `await locator.isVisible()` yang instan (tidak menunggu).
// Beberapa tempat mengecek tombol/baris langsung setelah aksi sebelumnya, padahal
// elemen itu bisa saja belum sempat dirender karena halaman masih loading — sehingga
// isVisible() instan bisa balikin false-negative (dikira gagal/tidak ada, padahal cuma
// belum sempat muncul). Fungsi ini menunggu singkat sebelum menyimpulkan hasilnya,
// tapi tetap mengembalikan boolean seperti isVisible() biasa, jadi alur if/else tidak berubah.
async function cekVisibleTunggu(locator, timeout = 3000) {
    try {
        await locator.waitFor({ state: 'visible', timeout });
        return true;
    } catch {
        return false;
    }
}

// 🌟 PERBAIKAN (laporan user): helper generik untuk dropdown jenis "klik kotak -> ketik di
// kolom cari -> klik opsi hasil pencarian" (dipakai di Nama Sekolah & Jenjang/Kelas form
// kedua). Sebelumnya opsi hasil pencarian cuma diklik SEKALI (force click) tanpa verifikasi
// apakah klik itu beneran nempel. Kalau daftar opsi sempat re-render pas mau diklik (abis
// ngetik di kolom cari), klik itu bisa "nembak angin" (elemen sudah berganti/ke-detach) dan
// gagal tanpa ketahuan karena ketutup try/catch kosong — makanya kadang jenjang/sekolah
// sudah "ketemu" pas dicari, tapi kotaknya nggak ikut berubah. Sekarang setelah klik, kita
// cek ULANG apakah teks kotaknya beneran sudah berubah sesuai target; kalau belum, ulangi
// proses klik kotak + cari + klik opsi sampai beberapa kali sebelum menyerah.
async function pilihDariDropdownCari(page, namaField, kotakLocator, searchInputLocator, teksUntukDicari, opsiLocatorFn, cekSudahBenar, maxPercobaan = 3) {
    for (let percobaan = 1; percobaan <= maxPercobaan; percobaan++) {
        try {
            await kotakLocator.click({ force: true });
            await page.waitForTimeout(500);
            await searchInputLocator.waitFor({ state: 'visible', timeout: 3000 });
            await searchInputLocator.fill(teksUntukDicari);
            await page.waitForTimeout(600);

            const opsi = opsiLocatorFn();
            await opsi.waitFor({ state: 'visible', timeout: 3000 });
            await opsi.click({ force: true });
            await page.waitForTimeout(500);
        } catch (e) {
            Logger.info(`⚠️ ${namaField}: opsi "${teksUntukDicari}" belum sempat muncul/diklik (percobaan ${percobaan}/${maxPercobaan}).`);
        }

        if (await cekSudahBenar()) return true;

        Logger.info(`⚠️ ${namaField} belum berubah sesuai target setelah diklik, mengulang pencarian (percobaan ${percobaan}/${maxPercobaan})...`);
        await page.keyboard.press('Escape').catch(() => { });
        await page.waitForTimeout(300);
    }
    Logger.info(`❌ Gagal memilih ${namaField} = "${teksUntukDicari}" setelah ${maxPercobaan}x percobaan. Field ini dilewati (cek manual nanti).`);
    return false;
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

        // 🌟 PERBAIKAN: dulu nunggu tetap 1000ms tanpa peduli kondisi halaman.
        // Sekarang nunggu form/modal-nya beneran muncul (maks 3 detik sbg jaring
        // pengaman) baru mengisi jawaban -> biasanya lebih cepat saat server
        // responsif, tapi tetap nunggu penuh kalau lagi lemot.
        const formLayanan = page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true }).first();
        await formLayanan.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });

        await actionCallback();

        const btnKirim = page.locator('input[title="Kirim"], button:has-text("Kirim"), button:has-text("Simpan")').filter({ visible: true }).first();

        if (await btnKirim.count() > 0) {
            await klikAntiMacet(page, btnKirim, `Simpan ${namaLayanan}`);
        } else {
            const btnFallback = page.locator('input[title="Kirim"]').last();
            await klikAntiMacet(page, btnFallback, `Simpan ${namaLayanan}`);
        }

        // 🌟 PERBAIKAN: tunggu form/modal-nya beneran tertutup (tanda submit berhasil).
        const berhasilTersimpan = await formLayanan.waitFor({ state: 'hidden', timeout: 3000 }).then(() => true).catch(() => false);

        if (!berhasilTersimpan) {
            // 🌟 PERBAIKAN: form masih terbuka setelah Kirim -> kemungkinan besar ada
            // jawaban wajib yang kosong (data belum ada di Excel), bukan soal loading
            // server. Keluar lewat tombol Batal/Kembali, lanjut ke pemeriksaan berikutnya.
            Logger.info(`⚠️ "${namaLayanan}" sepertinya ada jawaban wajib yang kosong (data belum ada di Excel). Melewati...`);
            const btnBatal = page.locator('button:has-text("Batal"), button:has-text("Kembali"), .close').filter({ visible: true }).first();
            if (await btnBatal.count() > 0) {
                await btnBatal.click({ force: true }).catch(() => { });
            } else {
                await page.keyboard.press('Escape');
            }
            await page.waitForTimeout(500);
        }

        await page.waitForTimeout(300);
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
    // 🌟 SISTEM PAUSE & STOP KHUSUS IPC
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

    async function checkPause() {
        if (isStopped) throw new Error("STOPPED_BY_USER");

        // Gunakan perulangan agar langsung merespon saat tombol Stop ditekan
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
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            path.join(process.env.LOCALAPPDATA || '', "Google\\Chrome\\Application\\chrome.exe")
        ];
        for (let p of paths) {
            if (fs.existsSync(p)) return p;
        }
        return null;
    }

    const chromePath = getChromePath();
    if (!chromePath) {
        throw new Error("Google Chrome tidak terinstal di PC ini!");
    }

    let browser;

    try {
        browser = await chromium.launch({
            headless: isHeadless,
            executablePath: chromePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const userDataPath = app.getPath('userData');
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
        sendUILog("🤖 Memulai proses CKG Anak Sekolah...");

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

        await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu', { waitUntil: 'networkidle' });
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
                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Skip`);
                sendUILog(`SUKSES|Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                continue;
            }

            if (row.jumlahCoba === undefined) row.jumlahCoba = 1;
            let sesi = "Persiapan";

            try {
                await checkPause();

                const statusExcel = String(row['Status'] || row['Keterangan'] || "").trim().toLowerCase();
                let lewatiPendaftaran = false;
                let langsungPelayanan = false;

                if (statusExcel === "sudah daftar bos") {
                    lewatiPendaftaran = true;
                    Logger.info(`⏩ Status "${statusExcel}" terdeteksi! Langsung melompat ke Konfirmasi Kehadiran...`);
                }

                if (!lewatiPendaftaran) {
                    sesi = "Form pendaftaran Pertama";
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Mengisi Form Pendaftaran pertama`);
                    await checkPause();

                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-anak-sekolah', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(500);
                    await page.waitForSelector('button:has(div:text("Daftar Baru"))');
                    await page.locator('button:has(div:text("Daftar Baru"))').last().click();
                    await page.waitForTimeout(1000);

                    await page.locator('input[name="NIK"]').last().fill(String(row['NIK']));
                    await page.waitForTimeout(500);
                    await checkPause();

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
                    } catch (error) {
                        dataOtomatisDitemukan = false;
                    }

                    await checkPause();

                    if (dataOtomatisDitemukan) {
                        await btnGunakanData.click({ force: true }).catch(() => { });
                        await page.waitForTimeout(1000);
                    } else {
                        await page.locator('input[name="Nama"]').last().fill(row['Nama Lengkap']);

                        const locatorKalender = page.locator('div:text-is("Pilih tanggal lahir")').last();
                        await isiDatepicker(page, locatorKalender, row['Tanggal lahir']);

                        await page.locator('span:has-text("Pilih jenis kelamin"), div:has-text("Pilih jenis kelamin")').last().click();
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

                    const tombolSelanjutnya = page.locator('button:has-text("Selanjutnya")').filter({ visible: true }).first();
                    await tombolSelanjutnya.waitFor({ state: 'visible', timeout: 5000 });

                    await klikAntiMacet(page, tombolSelanjutnya, "Selanjutnya (Cek NIK Awal)");
                    await checkPause();

                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Menunggu validasi NIK`);

                    let popupResult = await Promise.race([
                        page.waitForSelector('div:has-text("Data peserta valid")', { timeout: 10000 }).then(() => 'VALID'),
                        page.waitForSelector('div:has-text("Kuota Pemeriksaan Habis")', { timeout: 10000 }).then(() => 'KUOTA_HABIS'),
                        page.waitForSelector('div:has-text("Data peserta tidak valid")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                        page.waitForSelector('div:has-text("Individu sudah menerima layanan")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                    ]).catch(() => 'TIMEOUT_SERVER');

                    if (popupResult === 'KUOTA_HABIS') {
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

                    await checkPause();

                    if (popupResult === 'VALID') {
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Menuju form kedua`);

                        try {
                            const Lanjutkan = page.locator('button:has-text("Lanjutkan")').filter({ visible: true }).first();
                            await Lanjutkan.waitFor({ state: 'visible', timeout: 5000 });
                            await klikAntiMacet(page, Lanjutkan, "Lanjutkan");
                        } catch (e) { }

                        sesi = "Form pendaftaran Kedua";
                        await page.waitForTimeout(1500);

                        // 🌟 PERBAIKAN LOGIKA: sebelumnya seluruh isian di bawah ini (disabilitas,
                        // pekerjaan, Nama Sekolah, Jenjang/Kelas) hanya dijalankan KALAU
                        // dataOtomatisDitemukan == true (NIK sudah pernah terdaftar). Akibatnya
                        // kalau NIK BELUM pernah terdaftar (data baru), Nama Sekolah & Jenjang
                        // ikut TERLEWAT / tidak terisi sama sekali, padahal wajib diisi. Sekarang
                        // blok ini SELALU dijalankan untuk kedua kasus:
                        // - Data baru (dataOtomatisDitemukan == false): semua field di bawah wajib
                        //   diisi dari Excel tanpa terkecuali.
                        // - Data lama (dataOtomatisDitemukan == true): isian lain boleh ikut default
                        //   dari sistem, TAPI Nama Sekolah & Jenjang/Kelas tetap dicek & DIGANTI
                        //   kalau beda dari Excel (bisa jadi ada data terbaru/pindah kelas).
                        await checkPause();
                        if (row['penyandang disabilitas']) {
                            try {
                                const targetDisabilitas = String(row['penyandang disabilitas']).trim();
                                const kotakDisabilitas = page.locator('xpath=//*[contains(text(), "Penyandang disabilitas")]/following::div[contains(@class, "cursor-pointer")][1]');

                                if (await kotakDisabilitas.isVisible({ timeout: 2000 })) {
                                    const teksSaatIni = (await kotakDisabilitas.innerText()).trim();
                                    if (teksSaatIni.toLowerCase() !== targetDisabilitas.toLowerCase()) {
                                        await kotakDisabilitas.click({ force: true, timeout: 2000 });
                                        await page.waitForTimeout(500);
                                        await page.locator(`div:has-text("${targetDisabilitas}")`).last().click({ force: true, timeout: 2000 });
                                    }
                                }
                            } catch (e) { }
                        }

                        await checkPause();
                        if (row['pekerjaan']) {
                            try {
                                const targetPekerjaan = String(row['pekerjaan']).trim();
                                const pekerjaanSudahBenar = await page.locator(`div:text-is("${targetPekerjaan}")`).last().isVisible({ timeout: 2000 });

                                if (!pekerjaanSudahBenar) {
                                    const searchInput = page.locator('input[placeholder="Cari pekerjaan"]');
                                    await searchInput.click({ force: true, timeout: 2000 }).catch(async () => {
                                        await page.locator('xpath=//*[contains(text(), "Pekerjaan")]/following::div[contains(@class, "cursor-pointer")][1]').click({ force: true });
                                    });
                                    await page.waitForTimeout(500);
                                    await searchInput.fill(targetPekerjaan);
                                    await page.waitForTimeout(500);
                                    await page.locator(`div:text-is("${targetPekerjaan}")`).last().click({ force: true, timeout: 2000 });
                                }
                            } catch (error) { }
                        }

                        await checkPause();
                        if (row['Nama Sekolah']) {
                            try {
                                const targetSekolah = String(row['Nama Sekolah']).trim();
                                const kotakSekolah = page.locator('xpath=//*[contains(text(), "Nama Sekolah")]/following::div[contains(@class, "cursor-pointer")][1]');
                                await kotakSekolah.waitFor({ state: 'visible', timeout: 3000 });

                                const teksSaatIni = (await kotakSekolah.innerText()).trim();

                                if (teksSaatIni.toLowerCase() !== targetSekolah.toLowerCase()) {
                                    await pilihDariDropdownCari(
                                        page,
                                        "Nama Sekolah",
                                        kotakSekolah,
                                        page.locator('input[placeholder*="Cari nama sekolah"]').last(),
                                        targetSekolah,
                                        () => page.locator('button').filter({ hasText: targetSekolah }).last(),
                                        async () => (await kotakSekolah.innerText()).trim().toLowerCase() === targetSekolah.toLowerCase()
                                    );
                                } else if (row['Kelas / Jenjang']) {
                                    // 🌟 FIX TEMUAN BARU: sekolah sudah cocok dari data lama, tapi state cascade
                                    // ke pilihan "Kelas" belum ke-trigger -> opsi Kelas jadi kosong pas mau diisi.
                                    // Pilih ulang sekolah yang sama persis untuk "membangunkan" cascade-nya,
                                    // sama seperti yang terbukti berhasil pas dites manual.
                                    await pilihDariDropdownCari(
                                        page,
                                        "Nama Sekolah (refresh)",
                                        kotakSekolah,
                                        page.locator('input[placeholder*="Cari nama sekolah"]').last(),
                                        targetSekolah,
                                        () => page.locator('button').filter({ hasText: targetSekolah }).last(),
                                        async () => (await kotakSekolah.innerText()).trim().toLowerCase() === targetSekolah.toLowerCase()
                                    );
                                }
                            } catch (e) { }
                        }
                        await checkPause();
                        const rawJenjang = String(row['Kelas / Jenjang'] || '');
                        const angkaJenjang = rawJenjang.match(/\d+/)?.[0];

                        if (angkaJenjang) {
                            try {
                                const kotakJenjang = page.locator('xpath=//*[contains(text(), "Jenjang")]/following::div[contains(@class, "cursor-pointer")][1]');
                                await kotakJenjang.waitFor({ state: 'visible', timeout: 3000 });

                                // 🌟 FIX: definisikan polaJenjang di awal, pakai untuk SEMUA pengecekan
                                // (bukan cuma filter tombol) — supaya "Kelas 2" tidak salah dianggap
                                // "sudah cocok" hanya karena teks saat ini "Kelas 12"/"Kelas 21"/dst
                                // yang kebetulan sama-sama mengandung karakter "2".
                                const polaJenjang = new RegExp(`Kelas\\s*${angkaJenjang}(?!\\d)`, 'i');

                                const teksSaatIni = (await kotakJenjang.innerText()).trim();

                                if (!polaJenjang.test(teksSaatIni)) {
                                    await pilihDariDropdownCari(
                                        page,
                                        "Jenjang/Kelas",
                                        kotakJenjang,
                                        page.locator('input[placeholder*="Cari jenjang"]').last(),
                                        angkaJenjang,
                                        () => page.locator('button').filter({ hasText: polaJenjang }).last(),
                                        async () => polaJenjang.test((await kotakJenjang.innerText()).trim())
                                    );
                                }
                            } catch (e) { }
                        }
                        try {
                            await page.locator('input[name="sameAddress"]').last().check({ force: true, timeout: 2000 });
                        } catch (e) { }

                        if (row['Detail Domisili']) {
                            try {
                                await page.locator('textarea[name="detail-domisili"]').last().fill(String(row['Detail Domisili']), { timeout: 2000 });
                            } catch (e) { }
                        }

                        const btnSelanjutnyaForm2 = page.locator('div.tracking-wide:has-text("Selanjutnya")').last();
                        await checkPause();
                        await page.waitForTimeout(500);
                        await klikAntiMacet(page, btnSelanjutnyaForm2, "Selanjutnya (Form 2)");

                        const notifDaftar = await Promise.race([
                            page.waitForSelector('div:has-text("Berhasil Daftar")', { timeout: 10000 }).then(() => 'BERHASIL'),
                            page.waitForSelector('div:has-text("Data pasien tidak sesuai"),div.pb-2:has-text("Data peserta tidak valid"),div:has-text("Terjadi kesalahan")', { timeout: 10000 }).then(() => 'TIDAK_SESUAI'),
                            page.waitForSelector('div:has-text("Individu sudah")', { timeout: 10000 }).then(() => 'SUDAH_PELAYANAN')
                        ]).catch(() => 'TIMEOUT_SERVER');

                        if (notifDaftar === 'TIDAK_SESUAI') {
                            let pesanErrorForm2 = "Data tidak sesuai (Detail tidak terbaca)";
                            try {
                                const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();
                                if (await popupAktif.count() > 0) {
                                    pesanErrorForm2 = await popupAktif.innerText();
                                } else {
                                    pesanErrorForm2 = await page.locator('div.text-red-500, div:has-text("Data pasien tidak sesuai"), div:has-text("Terjadi kesalahan")').filter({ visible: true }).last().innerText();
                                }
                            } catch (e) { }

                            pesanErrorForm2 = pesanErrorForm2.replace(/\n/g, ' - ').trim();
                            row['notif'] = pesanErrorForm2;
                            row.Keterangan = "Ditolak Form 2: Cek kolom notif";
                            sendUILog(`GAGAL|NIK ${nikPeserta} tidak valid. Alasan: ${pesanErrorForm2}`);

                            await page.locator('button:has-text("Tutup"),button:has-text("Periksa Kembali"),div:has-text("periksa kembali "), button:has-text("OK")').last().click();
                            await page.reload({ waitUntil: 'networkidle' });
                            await page.waitForTimeout(1000);
                            continue;
                        } else if (notifDaftar === 'TIMEOUT_SERVER') {
                            throw new Error("TIMEOUT_SERVER: Web tidak merespon saat menyimpan Form 2.");
                        } else if (notifDaftar === 'BERHASIL') {
                            await page.locator('div:has-text("Tutup")').last().click({ force: true });
                        }
                    }

                    else if (popupResult === 'SUDAH_PELAYANAN') {
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Sudah ada data .. menuju pelayanan`);
                        const tombolCariIndividu = page.locator('div.tracking-wide:has-text("Cari Individu"), div:has-text("Tutup")').filter({ visible: true }).first();
                        await tombolCariIndividu.waitFor({ state: 'attached', timeout: 5000 });
                        await tombolCariIndividu.evaluate(el => el.click());
                        await page.waitForTimeout(2000);
                        langsungPelayanan = true;
                    }
                    else if (popupResult === 'TIMEOUT_SERVER') {
                        throw new Error("TIMEOUT_SERVER: Server lemot / timeout di awal");
                    }
                    else {
                        let pesanErrorForm1 = "Data tidak valid / ditolak sistem";
                        try {
                            const popupAktif = page.locator('div[role="dialog"], div.modal, .swal-modal, .swal2-popup, .el-message-box, .el-notification').filter({ visible: true }).last();
                            if (await popupAktif.count() > 0) {
                                pesanErrorForm1 = await popupAktif.innerText();
                            } else {
                                pesanErrorForm1 = await page.locator('div.text-red-500, div:has-text("Data peserta tidak valid"), div:has-text("tidak ditemukan"), div:has-text("data tidak ditemukan"), div:has-text("Data peserta atau wali tidak valid")').filter({ visible: true }).last().innerText();
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
                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-anak-sekolah', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(1500);
                    await page.locator('div:has-text("Pilih sekolah")').last().click();
                    await page.locator(`div:text-is("${row['Nama Sekolah']}")`).last().click();

                    await page.locator('span:has-text("Pilih kelas")').last().click();
                    await page.locator(`div:has-text("${row['Kelas / Jenjang']}")`).last().click();

                    await page.locator('span:has-text("Nomor Tiket"), span:has-text("NIK")').last().click({ force: true });
                    await page.locator('div:text-is("NIK")').last().click();
                    await page.locator('input[name="NIK"], input#nik').last().fill(String(row['NIK']));
                    await page.waitForTimeout(1000);
                    await page.keyboard.press('Enter');

                    const namaSiswa = row['Nama Lengkap'];
                    sesi = "Pelacakan hadir/sudah hadir";
                    await checkPause();

                    const hasilPencarian = await Promise.race([
                        page.waitForSelector(`tr:has-text("${namaSiswa}") >> button:has-text("Konfirmasi Hadir")`, { state: 'visible', timeout: 5000 }).then(() => 'TOMBOL_MUNCUL'),
                        page.waitForSelector(`tr:has-text("${namaSiswa}") >> div:has-text("Sudah Hadir")`, { state: 'visible', timeout: 5000 }).then(() => 'SUDAH_HADIR')
                    ]).catch(() => 'TIMEOUT');

                    if (hasilPencarian === 'TOMBOL_MUNCUL') {
                        sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Memproses kehadiran`);

                        const btnHadir = page.locator(`tr:has-text("${namaSiswa}") >> button:has-text("Konfirmasi Hadir")`);
                        await page.waitForTimeout(1000);
                        await btnHadir.scrollIntoViewIfNeeded();
                        await btnHadir.click();

                        let noWa = row['No Whatsapp'] ? String(row['No Whatsapp']).trim() : '';
                        noWa = noWa.replace(/\D/g, '');
                        if (!noWa || noWa.length < 7 || !noWa.startsWith('8')) {
                            noWa = '89999999';
                        }
                        await page.locator('input[name="Nomor Whatsapp"]').last().fill(noWa);

                        try {
                            const checkboxAlamat = page.locator('input[name="sameAddress"]').last();
                            const sudahTercentang = await checkboxAlamat.isChecked();
                            if (!sudahTercentang) await checkboxAlamat.check({ force: true, timeout: 2000 });
                        } catch (e) { }

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
                    }
                }

                sesi = "pencarian data di pelayanan";
                await checkPause();

                if (!langsungPelayanan) {
                    await page.waitForTimeout(500);
                    await page.goto('https://sehatindonesiaku.kemkes.go.id/ckg-pelayanan-sekolah', { waitUntil: 'networkidle' });
                    await page.waitForTimeout(2000);
                } else {
                    await page.waitForTimeout(1000);
                }

                const dropdownSekolah = page.locator('div:has(span:text-is("Pilih sekolah"))').last();
                await dropdownSekolah.waitFor({ state: 'visible', timeout: 5000 });
                await dropdownSekolah.last().click({ force: true });
                await page.waitForTimeout(100);

                const namaSekolahExcel = String(row['Nama Sekolah']).trim();
                await page.locator(`div:text-is("${namaSekolahExcel}")`).last().click({ force: true });
                await page.waitForTimeout(100);

                const dropdownKelas = page.locator('div:has(span:text-is("Pilih kelas"))').last();
                await dropdownKelas.waitFor({ state: 'visible', timeout: 5000 });
                await dropdownKelas.click({ force: true });
                await page.waitForTimeout(100);

                const kelasExcel = String(row['Kelas / Jenjang']).trim();
                await page.locator(`div:has-text("${kelasExcel}")`).last().click({ force: true });
                await page.waitForTimeout(500);

                await checkPause();
                await page.locator('text="Tampilkan Pencarian"').last().click();
                await page.locator('span:has-text("Nomor Tiket"), span:has-text("NIK")').last().click();
                await page.locator('div:text-is("NIK")').last().click();

                await page.locator('input[name="NIK"], input#nik').last().fill(String(row['NIK']));
                await page.keyboard.press('Enter');
                await page.waitForTimeout(2000);

                sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Memeriksa status pemeriksaan`);

                const tabBelum = page.locator('div.cursor-pointer:has-text("Belum Pemeriksaan")').last();
                const tabSedang = page.locator('div.cursor-pointer:has-text("Sedang Pemeriksaan")').last();
                const tabSelesai = page.locator('div.cursor-pointer:has-text("Selesai Pemeriksaan")').last();

                let statusTabel = "KOSONG";

                async function cekDanGeserTabel() {
                    const targetSiswa = String(row['Nama Lengkap']).trim();
                    const barisTarget = page.locator('tbody tr', { hasText: targetSiswa }).first();

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
                    await page.waitForTimeout(500);

                    const teksBaris = await barisTarget.innerText();

                    if (teksBaris.includes("Belum lengkap") || teksBaris.includes("Belum Pemeriksaan") || teksBaris.includes("Sedang Pemeriksaan")) {
                        return "BELUM_LENGKAP";
                    }
                    if (teksBaris.includes("Lengkap") && teksBaris.includes("Lengkap")) {
                        return "SUDAH_LENGKAP";
                    }
                    return "KOSONG";
                }

                await tabBelum.click({ force: true });
                statusTabel = await cekDanGeserTabel();

                if (statusTabel === "KOSONG") {
                    await tabSedang.click({ force: true });
                    statusTabel = await cekDanGeserTabel();
                }

                if (statusTabel === "KOSONG") {
                    await tabSelesai.click({ force: true });
                    statusTabel = await cekDanGeserTabel();
                }

                if (statusTabel === "SUDAH_LENGKAP") {
                    row.Keterangan = "terdeteksi sudah pelayanan lengkap";
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Terdeteksi sudah lengkap`);
                    sendUILog(`SUKSES|Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
                    continue;
                }
                else if (statusTabel === "KOSONG") {
                    row.Keterangan = "Gagal: Data tidak muncul di ketiga tab";
                    sendUILog(`GAGAL|NIK ${nikPeserta} Tidak muncul di pelayanan (faskes luar)`);
                    continue;
                }

                await checkPause();
                const barisTarget = page.locator('tbody tr', { hasText: String(row['Nama Lengkap']).trim() }).first();
                const tombolMulaiTabel = barisTarget.locator('button:has-text("Mulai")');

                if (await cekVisibleTunggu(tombolMulaiTabel)) {
                    await tombolMulaiTabel.scrollIntoViewIfNeeded();
                    await tombolMulaiTabel.click({ force: true });
                } else {
                    row.Keterangan = "Gagal: Tombol Mulai tidak bisa ditemukan di baris anak ini";
                    sendUILog(`GAGAL|NIK ${nikPeserta} Tombol Mulai tidak ditemukan`);
                    continue;
                }

                await page.waitForTimeout(3000);

                const btnMulaiPemeriksaan = page.locator('button:has-text("Mulai Pemeriksaan")').last();
                if (await cekVisibleTunggu(btnMulaiPemeriksaan)) {
                    await btnMulaiPemeriksaan.click();
                    await page.waitForTimeout(1000);

                    const btnSimpanTgl = page.locator('button:has-text("Simpan")').last();
                    if (await cekVisibleTunggu(btnSimpanTgl)) {
                        await btnSimpanTgl.click();
                        await page.waitForTimeout(2000);
                    }
                } else {
                    await page.waitForTimeout(1000);
                }

                sesi = "form pemeriksaan mandiri";
                await checkPause();

                let adaMandiri = true;
                // 🌟 PERBAIKAN: nama pemeriksaan yang gagal kirim karena ada jawaban wajib
                // yang kosong (data belum ada di Excel) dicatat di sini, supaya tidak
                // ketemu & diulang-ulang terus (infinite loop) — langsung lanjut ke
                // pemeriksaan mandiri lain yang belum diproses.
                const soalMandiriDilewati = new Set();

                const modalMasihBuka = page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true });
                if (await modalMasihBuka.count() > 0 && await page.locator('tr:has-text("Input Data")').count() === 0) {
                    const btnBatal = page.locator('button:has-text("Batal"), button:has-text("Kembali"), .close').filter({ visible: true });
                    if (await btnBatal.count() > 0) {
                        await btnBatal.first().click({ force: true }).catch(() => { });
                    } else {
                        await page.keyboard.press('Escape');
                    }
                    await page.waitForTimeout(1000);
                }

                while (adaMandiri) {
                    await checkPause();

                    // 🌟 PERBAIKAN: cari baris pending PERTAMA yang namanya belum ada di
                    // `soalMandiriDilewati` (dulu asal ambil baris pertama tanpa cek ini).
                    const semuaBarisPending = page.locator('tr:has(img[src*="icon-success-gray.svg"]):has(button:has-text("Input Data"))');
                    const jumlahPending = await semuaBarisPending.count();

                    let barisMandiri = null;
                    let namaPemeriksaan = null;
                    for (let k = 0; k < jumlahPending; k++) {
                        const kandidat = semuaBarisPending.nth(k);
                        const namaKandidat = (await kandidat.locator('td').first().textContent() || '').trim();
                        if (!soalMandiriDilewati.has(namaKandidat)) {
                            barisMandiri = kandidat;
                            namaPemeriksaan = namaKandidat;
                            break;
                        }
                    }

                    if (barisMandiri && await cekVisibleTunggu(barisMandiri)) {
                        await barisMandiri.locator('button:has-text("Input Data")').click();
                        // 🌟 PERBAIKAN: dulu nunggu tetap 1500ms, sekarang nunggu form soal
                        // beneran siap (maks 3 detik sbg jaring pengaman) baru isi jawaban.
                        await page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true }).first()
                            .waitFor({ state: 'visible', timeout: 3000 }).catch(() => { });

                        let indexSoal = 0;
                        let cekTerus = true;

                        while (cekTerus) {
                            const radioContainers = page.locator('label, div.sd-item').filter({
                                has: page.locator('span.sv-string-viewer:has-text("Tidak")')
                                    .or(page.locator('span.sv-string-viewer:has-text("Belum")'))
                            });
                            const jumlahSoal = await radioContainers.count();

                            if (indexSoal < jumlahSoal) {
                                const soalSaatIni = radioContainers.nth(indexSoal);
                                await soalSaatIni.scrollIntoViewIfNeeded();
                                await page.waitForTimeout(100);
                                const lingkaranRadio = soalSaatIni.locator('.sd-item__decorator, .sd-radio__decorator').first();
                                await lingkaranRadio.click({ force: true });
                                await page.waitForTimeout(100);
                                indexSoal++;
                            } else {
                                cekTerus = false;
                            }
                        }

                        const jawabanExcel = row[namaPemeriksaan.trim()];
                        if (jawabanExcel) {
                            const dropdown = page.locator('.sd-dropdown').first();
                            if (await cekVisibleTunggu(dropdown, 2000)) {
                                await dropdown.click();
                                await page.waitForTimeout(500);
                                await page.locator(`.sv-list__item:has-text("${jawabanExcel}")`).click();
                                await page.waitForTimeout(500);
                            }
                        }

                        const inputAngka = page.locator('input[type="number"]');
                        const jumlahInput = await inputAngka.count();

                        for (let j = 0; j < jumlahInput; j++) {
                            const kotak = inputAngka.nth(j);
                            const labelPlaceholder = (await kotak.getAttribute('placeholder') || "").trim();
                            const nilaiExcel = row[labelPlaceholder];

                            if (nilaiExcel !== undefined && nilaiExcel !== null && nilaiExcel !== "") {
                                await kotak.scrollIntoViewIfNeeded();
                                await kotak.fill(String(nilaiExcel));
                                await page.waitForTimeout(300);
                            }
                        }

                        const btnKirimMandiri = page.locator('input[title="Kirim"]').last();
                        await klikAntiMacet(page, btnKirimMandiri, `Kirim Mandiri ${namaPemeriksaan.trim()}`);
                        // 🌟 PERBAIKAN: tunggu form/modal-nya beneran tertutup (tanda submit berhasil).
                        const berhasilTersimpanMandiri = await page.locator('.sd-root-modern, .modal-dialog, form').filter({ visible: true }).first()
                            .waitFor({ state: 'hidden', timeout: 3000 }).then(() => true).catch(() => false);

                        if (!berhasilTersimpanMandiri) {
                            // 🌟 PERBAIKAN: form masih terbuka setelah Kirim -> kemungkinan besar ada
                            // jawaban wajib yang kosong (data belum ada di Excel), bukan soal loading
                            // server. Keluar lewat tombol Batal/Kembali, catat sebagai dilewati, lanjut.
                            Logger.info(`⚠️ "${namaPemeriksaan}" sepertinya ada jawaban wajib yang kosong (data belum ada di Excel). Melewati...`);
                            soalMandiriDilewati.add(namaPemeriksaan);
                            const btnBatalMandiri = page.locator('button:has-text("Batal"), button:has-text("Kembali"), .close').filter({ visible: true }).first();
                            if (await btnBatalMandiri.count() > 0) {
                                await btnBatalMandiri.click({ force: true }).catch(() => { });
                            } else {
                                await page.keyboard.press('Escape');
                            }
                            await page.waitForTimeout(500);
                        }

                        await page.waitForTimeout(300);
                    } else {
                        adaMandiri = false;
                    }
                }

                sesi = "Pemeriksaan oleh nakes";
                await checkPause();

                // 🌟 PERBAIKAN: 12 pemeriksaan nakes ini sekarang berupa DATA (array),
                // bukan 12 pemanggilan isiFormLayanan yang di-hardcode satu-satu.
                // Kalau suatu saat ada pemeriksaan baru dari Kemenkes, tinggal tambah
                // SATU object baru di array `daftarPemeriksaanNakes` di bawah ini
                // (isi `nama` = nama layanan persis seperti di web, `aksi` = cara ngisi
                // formnya) — tidak perlu utak-atik loop atau logika lain sama sekali.
                const daftarPemeriksaanNakes = [
                    {
                        nama: "Gizi Anak",
                        aksi: async () => {
                            const bb = hitungNilaiNormal(row['Berat Badan'], "Berat Badan", row['Tanggal lahir']);
                            const tb = hitungNilaiNormal(row['Tinggi Badan'], "Tinggi Badan", row['Tanggal lahir']);
                            await page.locator('input[placeholder*="dalam kg"]').last().fill(bb);
                            await page.locator('input[placeholder*="dalam cm"]').last().fill(tb);
                        }
                    },
                    {
                        nama: "Tekanan Darah Anak dan Remaja",
                        aksi: async () => {
                            const sistol = hitungNilaiNormal(row['Sistol'], "Sistol", row['Tanggal lahir']);
                            const diastol = hitungNilaiNormal(row['Diastol'], "Diastol", row['Tanggal lahir']);
                            const inputs = page.locator('input.sd-input.sd-text[type="number"]');
                            await inputs.nth(0).fill(sistol);
                            await inputs.nth(1).fill(diastol);
                        }
                    },
                    {
                        nama: "Pemeriksaan Gula Darah",
                        aksi: async () => {
                            await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
                            const gd = hitungNilaiNormal(row['Gula Darah'], "Gula Darah", row['Tanggal lahir']);
                            await page.locator('input.sd-input.sd-text[id="sq_102i"]').last().fill(gd);
                        }
                    },
                    {
                        nama: "Anemia",
                        aksi: async () => {
                            const hb = hitungNilaiNormal(row['Hemoglobin'], "Hemoglobin", row['Tanggal lahir']);
                            await page.locator('input.sd-input.sd-text[type="number"]').last().fill(hb);
                        }
                    },
                    {
                        nama: "Pemeriksaan Penyakit Frambusia",
                        aksi: async () => {
                            await page.locator('span.sv-string-viewer:has-text("Tidak")').last().click();
                        }
                    },
                    {
                        nama: "Pemeriksaan Penyakit Kusta",
                        aksi: async () => {
                            await page.locator('input[placeholder="Select..."]').last().click({ force: true });
                            await page.locator('span.sv-string-viewer:has-text("Tidak Ada")').last().click();
                        }
                    },
                    {
                        nama: "Pemeriksaan Penyakit Skabies",
                        aksi: async () => {
                            await page.locator('input[placeholder="Select..."]').last().click({ force: true });
                            await page.locator('span.sv-string-viewer:has-text("Tidak Ada")').last().click();
                        }
                    },
                    {
                        nama: "Pemeriksaan Gigi - Anak",
                        aksi: async () => {
                            let gigi = hitungNilaiNormal(row['Gigi'], "Gigi", row['Tanggal lahir']);
                            const teksGigi = String(gigi).trim();
                            const angkaGigi = parseInt(teksGigi);
                            if (!isNaN(angkaGigi) && angkaGigi > 3) {
                                gigi = ">3";
                            }
                            const locatorGigi = page.locator(`span.sv-string-viewer:has-text("${gigi}")`).last();
                            await locatorGigi.click({ force: true });
                        }
                    },
                    {
                        nama: "Skrining Telinga dan Mata",
                        aksi: async () => {
                            const status = hitungNilaiNormal(row['telinga dan mata'], "Telinga dan Mata", row['Tanggal lahir']);
                            if (status.toLowerCase() === "normal") {
                                const opsiNormal = ["Normal", "Tidak ada serumen impaksi", "Tidak ada infeksi", "Tidak"];
                                for (const opsi of opsiNormal) {
                                    const radios = page.locator(`span.sv-string-viewer:has-text("${opsi}")`);
                                    const count = await radios.count();
                                    for (let j = 0; j < count; j++) await radios.nth(j).click();
                                }
                            }
                        }
                    },
                    {
                        nama: "Hasil Pemeriksaan Kebugaran Jasmani",
                        aksi: async () => {
                            const kebugaran = hitungNilaiNormal(row['Kebugaran'], "Kebugaran", row['Tanggal lahir']);
                            await page.locator('input[placeholder*="Pilih tingkat kebugaran berdasarkan hasil tes"]').last().click({ force: true });
                            await page.locator(`span.sv-string-viewer:has-text("${kebugaran}")`).last().click();
                        }
                    },
                    {
                        nama: "Pemeriksaan RDT Malaria",
                        aksi: async () => {
                            await page.locator('span.sv-string-viewer:has-text("Non-reaktif")').last().click();
                        }
                    },
                    {
                        nama: "Pemeriksaan Hepatitis",
                        aksi: async () => {
                            await page.locator('span.sv-string-viewer:has-text("Non reaktif")').last().click();
                        }
                    },
                    {
                        nama: "Pemeriksaan Kadar CO",
                        aksi: async () => {
                            const co = hitungNilaiNormal(row['Kadar CO'], "Kadar CO", row['Tanggal lahir']);
                            const inputCO = page.locator('input[placeholder*="kadar CO pernapasan"]');
                            if (await inputCO.isVisible()) await inputCO.last().fill(co);
                        }
                    },
                    // 🌟 Tambah pemeriksaan baru di sini kalau suatu saat diperlukan, contoh:
                    // {
                    //     nama: "Nama Layanan Persis Seperti di Web",
                    //     aksi: async () => {
                    //         // cara isi form-nya di sini
                    //     }
                    // },
                ];

                for (const pemeriksaan of daftarPemeriksaanNakes) {
                    await checkPause();
                    await isiFormLayanan(page, pemeriksaan.nama, pemeriksaan.aksi);
                }

                await page.evaluate(() => window.scrollTo(0, 0));
                await page.waitForTimeout(1000);

                const btnSelesaiLayanan = page.getByRole('button', { name: /Selesaikan Layanan/i }).first();
                if (await btnSelesaiLayanan.isVisible()) {
                    await klikAntiMacet(page, btnSelesaiLayanan, "Selesaikan Layanan");

                    const notifSelesai = await Promise.race([
                        page.getByRole('button', { name: /Konfirmasi/i }).waitFor({ state: 'visible', timeout: 3000 }).then(() => 'ADA_KONFIRMASI'),
                        page.waitForTimeout(3000).then(() => 'TIDAK_ADA_KONFIRMASI')
                    ]);

                    if (notifSelesai === 'ADA_KONFIRMASI') {
                        await page.getByRole('button', { name: /Konfirmasi/i }).click();
                        await page.waitForTimeout(1500);
                    }
                }

                row.jumlahCoba = undefined;
                row.Keterangan = "Berhasil Selesai Pelayanan";
                sendUILog(`SUKSES|Data NIK ${nikPeserta} atas nama ${namaLengkap} tersimpan!`);
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
                    row.jumlahCoba += 1;
                    i--;
                    sendUILog(`KERJA|${namaLengkap}|${nikPeserta}|${barisExcel}/${totalData}|Reload Halaman (Lemot)`);
                    await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
                    await page.waitForTimeout(2500);
                } else {
                    if (pesanError.includes("TIMEOUT_SERVER")) {
                        row.Keterangan = `Gagal [${sesi}]: Server Kemenkes Lemot (setelah ${row.jumlahCoba}x coba)`;
                    } else {
                        row.Keterangan = `Gagal [${sesi}]: ${pesanError.split('\n')[0]}`;
                    }
                    sendUILog(`GAGAL|NIK ${nikPeserta} bermasalah. Alasan: ${row.Keterangan}`);
                    row.jumlahCoba = undefined;
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
        // 🌟 BERSIHKAN LISTENER AGAR TIDAK BOCOR MEMORI
        ipcMain.removeListener('toggle-pause-robot', pauseListener);
        ipcMain.removeListener('stop-robot', stopListener);
        if (browser) await browser.close();
    }
}

module.exports = { runAutomation };
