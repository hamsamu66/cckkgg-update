const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bacaExcel, simpanBarisExcel, getWaktuSekarang } = require('./utils/excelManager');
const { tulisLog } = require('./utils/logger');

// --- KONFIGURASI ---
const TARGET_URL = 'https://sehatindonesiaku.kemkes.go.id/ckg-pendaftaran-individu';
const FILE_EXCEL = path.join(__dirname, 'data', 'data_peserta.xlsx');
const STATE_PATH = path.join(__dirname, 'state', 'storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

async function main() {
    console.log('[🚀] Memulai Engine CKG Automation...');

    // Cek Session
    if (!fs.existsSync(STATE_PATH)) {
        console.error('❌ Session tidak ditemukan! Jalankan "node setupLogin.js" terlebih dahulu.');
        process.exit(1);
    }

    const { workbook, sheetName, data } = bacaExcel(FILE_EXCEL);
// Buka Browser secara visual (Headed) menggunakan Google Chrome asli
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const context = await browser.newContext({ storageState: STATE_PATH });
    const page = await context.newPage();
    page.setDefaultTimeout(15000); // Set timeout standar 15 detik

    try {
        await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

        // Validasi Session Expired
        const isLoginRequired = await page.locator('input[name="email"]').isVisible({ timeout: 5000 }).catch(() => false);
        if (isLoginRequired) {
            console.error('🚨 SESSION EXPIRED! Menghentikan proses.');
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, `SESSION_EXPIRED_${Date.now()}.png`) });
            process.exit(1);
        }

        // --- LOOP PROSES BARIS EXCEL ---
        for (let i = 0; i < data.length; i++) {
            const row = data[i];

            // Auto-Recovery: Skip data yang sudah berhasil
            if (!row.NIK || row.STATUS === "BERHASIL") continue;

            console.log(`\n======================================`);
            console.log(`[▶️] Memproses NIK: ${row.NIK} | ${row.NAMA_LENGKAP}`);

            let status = "GAGAL";
            let pesanError = "";
            let keterangan = "";

            try {
               // 1. Masuk ke Form Pendaftaran
                await page.click('button:has-text("CKG Umum")');
                await page.waitForTimeout(500);
                await page.click('a#menu_cari\\/daftarkan_individu');
                await page.click('button:has-text("Daftar Baru")');

                // ============================================================
                // 🛑 DINDING PEMBATAS: Wajib tunggu form pendaftaran muncul murni
                // ============================================================
                console.log('⏳ Menunggu form pendaftaran baru muncul di layar...');
                await page.waitForSelector('input[name="NIK"]', { state: 'visible', timeout: 10000 });
                await page.waitForTimeout(500); // Jeda tambahan stabilitas animasi

                // 2. Input Data Anak
                await page.fill('input[name="NIK"]', String(row.NIK));
                await page.fill('input[name="Nama"]', String(row.NAMA_LENGKAP));
                await page.waitForTimeout(300); 

                // --- EKSEKUSI DATEPICKER TANGGAL LAHIR PENDAFTAR (ANAK) ---
                console.log(`📅 Mengisi Tanggal Lahir Pendaftar: ${row.TANGGAL_LAHIR}`);
                
                // PERBAIKAN: Mengunci langsung ke ID milik elemen kalender sesuai UI Vision
                const elTglAnak = page.locator('[id="Tanggal Lahir"]').first();
                await isiDatepicker(page, elTglAnak, String(row.TANGGAL_LAHIR));

                // Gender Anak
                await page.locator('span', { hasText: /Pilih Jenis Kelamin/i }).first().click().catch(()=>{});
                await page.waitForTimeout(300);
                const genderAnak = String(row.JENIS_KELAMIN).trim().toUpperCase() === 'L' ? 'Laki-laki' : 'Perempuan';
                await page.locator(`div:text-is("${genderAnak}")`).filter({ visible: true }).first().click();

                await page.fill('input[name="Nomor Whatsapp"]', String(row.NO_WA));
                
                await page.waitForTimeout(1000); // Rem Tangan UI

                // 3. Validasi Form Balita
                const formWaliMuncul = await page.locator('input[name="NIK wali"]').isVisible({ timeout: 4000 });
                if (!formWaliMuncul) {
                    throw new Error("BUKAN_BALITA");
                }

                // 4. Input Data Wali
                await page.fill('input[name="NIK wali"]', String(row.NIK_WALI));
                await page.fill('input[name="Nama Lengkap Wali"]', String(row.NAMA_WALI));

               // --- DATA WALI ---
                console.log('✍️ Memasukkan NIK Wali...');
                await page.fill('input[name="NIK wali"]', String(row.NIK_WALI));
                await page.fill('input[name="Nama Lengkap Wali"]', String(row.NAMA_WALI));
                
                await page.waitForTimeout(500); 

                // --- EKSEKUSI DATEPICKER TANGGAL LAHIR WALI ---
                console.log(`📅 Mengisi Tanggal Lahir Wali: ${row.TANGGAL_LAHIR_WALI}`);
                
                // PERBAIKAN: Mengunci ke ID posisi terakhir (milik Wali)
                const elTglWali = page.locator('[id="Tanggal Lahir"]').last();
                await elTglWali.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500); 
                
                await isiDatepicker(page, elTglWali, String(row.TANGGAL_LAHIR_WALI));
                // --- JENIS KELAMIN WALI (DENGAN AUTO-SCROLL) ---
                console.log('✍️ Memilih Jenis Kelamin Wali...');
                
                // Cari elemen tombol dropdown
                const btnPilihKelaminWali = page.locator('span', { hasText: /Pilih Jenis Kelamin/i }).last();
                
                // FORCE SCROLL: Paksa layar turun sampai elemen ini muncul di mata robot
                await btnPilihKelaminWali.scrollIntoViewIfNeeded();
                await page.waitForTimeout(500); // Jeda setelah scroll agar tidak "slide-out"
                
                // Klik tombolnya
                await btnPilihKelaminWali.click();
                
                await page.waitForTimeout(300);
                const kelaminWali = String(row.JENIS_KELAMIN_WALI).trim().toUpperCase() === 'L' ? 'Laki-laki' : 'Perempuan';
                
                // Klik pilihan Laki/Perempuan (Pastikan scroll juga ke sini kalau perlu)
                const pilihanKelamin = page.locator(`div:text-is("${kelaminWali}")`).filter({ visible: true }).last();
                await pilihanKelamin.scrollIntoViewIfNeeded();
                await pilihanKelamin.click();
               // --- PERBAIKAN FINAL: CENTANG WA SAMA (KHUSUS CHECKBOX) ---
                console.log('✅ Mencentang opsi "Sama dengan pendaftar"...');
                
                // Kunci langsung ke elemen <input> yang bertipe checkbox, ambil yang paling bawah
                const inputCheckboxWa = page.locator('input#phone-sama[type="checkbox"]').last();
                
                // Gunakan .check() alih-alih .click()
                // { force: true } memaksa centang dari balik layar, dan .check() otomatis membangunkan Vue.js!
                await inputCheckboxWa.check({ force: true });
                
                // Rem tangan 1 detik agar tombol Selanjutnya (Next) berubah jadi biru/aktif
                await page.waitForTimeout(1000);
                
                // Klik Tanggal Hari Ini
                const today = new Date().getDate().toString();
                await page.locator(`button:has(span.font-bold:text-is("${today}"))`).click().catch(async () => {
                    await page.locator('.cell.today').click().catch(()=>{});
                });

                // Submit Tahap 1
                await page.click('div.tracking-wide:has-text("Selanjutnya")');

                // 5. Penanganan Pop-up Validasi (Race Condition)
                console.log('⏳ Menunggu validasi server...');
                const hasilValidasi = await Promise.race([
                    page.waitForSelector('text="Data peserta valid"', { timeout: 8000 }).then(() => 'VALID'),
                    page.waitForSelector('text="Data peserta atau wali tidak valid"', { timeout: 8000 }).then(() => 'TIDAK_VALID'),
                    page.waitForSelector('text="Individu sudah menerima layanan"', { timeout: 8000 }).then(() => 'SUDAH_LAYANAN'),
                    page.waitForTimeout(8000).then(() => 'TIMEOUT')
                ]);

                if (hasilValidasi === 'TIDAK_VALID') {
                    throw new Error("DATA_TIDAK_VALID");
                } else if (hasilValidasi === 'SUDAH_LAYANAN') {
                    // Ekstrak tanggal pemeriksaan dari HTML
                    const tglPeriksa = await page.locator('div:has-text("Tanggal pemeriksaan:") + div').innerText();
                    keterangan = `Sudah diperiksa pada: ${tglPeriksa.trim()}`;
                    throw new Error("SUDAH_LAYANAN");
                } else if (hasilValidasi === 'TIMEOUT') {
                    throw new Error("Timeout: Pop-up validasi tidak muncul");
                }

                // 6. Tahap 2: Lokasi & Pekerjaan
                await page.click('div.tracking-wide:has-text("Lanjutkan")');
                
                await page.click('span:has-text("Pilih status pernikahan")');
                await page.locator('div', { hasText: String(row.STATUS_PERNIKAHAN) }).first().click();

                await page.fill('input[placeholder="Cari pekerjaan"]', String(row.PEKERJAAN));
                await page.waitForTimeout(500);
                await page.keyboard.press('Enter');
                await page.click('div.modal-content button:has-text("belum")').catch(()=>{}); // Selector dinamis klik pilihan pertama

                await isiDropdown(page, 'Cari Provinsi', String(row.PROVINSI));
                await isiDropdown(page, 'Cari Kabupaten/Kota', String(row.KOTA));
                await isiDropdown(page, 'Cari Kecamatan', String(row.KECAMATAN));
                await isiDropdown(page, 'Cari Kelurahan', String(row.KELURAHAN));
                
                await page.fill('#detail-domisili', String(row.ALAMAT));
                await page.click('div.tracking-wide:has-text("Selanjutnya")');
                await page.click('div.tracking-wide:has-text("Pilih")');
                await page.click('button:has-text("Daftarkan dengan NIK")');

                // Konfirmasi Sukses
                await page.waitForSelector('text="Berhasil Daftar"', { timeout: 10000 });
                await page.click('div.tracking-wide:has-text("Tutup")').catch(()=>{});
                
                status = "BERHASIL";
                keterangan = "Pendaftaran Sukses";

            } catch (err) {
                status = "GAGAL";
                
                // Klasifikasi Error
                if (err.message === "BUKAN_BALITA") {
                    pesanError = "Form NIK Wali tidak muncul";
                    keterangan = "Bukan balita / Usia tidak memenuhi syarat";
                } else if (err.message === "DATA_TIDAK_VALID") {
                    pesanError = "Data peserta atau wali tidak valid";
                    keterangan = "Gagal Validasi Dukcapil";
                } else if (err.message === "SUDAH_LAYANAN") {
                    pesanError = "Individu sudah menerima layanan";
                } else {
                    pesanError = err.message.split('\n')[0]; // Ambil baris pertama error
                    keterangan = "Error teknis/elemen tidak ditemukan";
                }

                console.error(`[❌] ${pesanError}`);

                // Ambil Screenshot jika error teknis
                const ssName = `${row.NIK}_${row.NAMA_LENGKAP.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.png`;
                await page.screenshot({ path: path.join(SCREENSHOT_DIR, ssName) });

                // Refresh halaman agar DOM kembali bersih
                await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
            }

            // --- AUTO SAVE & LOGGING PER BARIS ---
            const { tanggal, jam } = getWaktuSekarang();
            data[i].STATUS = status;
            data[i].TANGGAL_PROSES = tanggal;
            data[i].JAM_PROSES = jam;
            data[i].PESAN_ERROR = pesanError;
            data[i].KETERANGAN = keterangan;

            simpanBarisExcel(FILE_EXCEL, workbook, sheetName, data);
            tulisLog(row.NIK, row.NAMA_LENGKAP, status, pesanError, page.url());
        }

    } catch (globalErr) {
        console.error('[💀] CRITICAL ERROR:', globalErr.message);
    } finally {
        console.log('\n[🎉] Proses Selesai!');
        await browser.close();
    }
}

// --- FUNGSI HELPER UI ---
async function isiDropdown(page, placeholderText, valueToType) {
    const inputArea = page.locator(`input[placeholder="${placeholderText}"]`);
    await inputArea.fill(valueToType);
    await page.waitForTimeout(1000); 
    await page.locator(`div.modal-content button:has-text("${valueToType}")`, { ignoreCase: true }).first().click().catch(async () => {
        // Fallback jika button tidak terbaca, klik element div biasa
        await page.locator('div', { hasText: valueToType }).first().click();
    });
}

// ============================================================================
// FUNGSI HELPER: PEMBOBOL DATEPICKER (VERSI 1 KOLOM EXCEL)
// ============================================================================
async function isiDatepicker(page, locatorDatepicker, tanggalLahirExcel) {
    if (!tanggalLahirExcel || tanggalLahirExcel === "undefined") {
        throw new Error("Data tanggal kosong atau nama kolom di Excel salah!");
    }

    // Ubah garis miring "/" jadi setrip "-" dan hapus spasi
    const strTanggal = String(tanggalLahirExcel).replace(/\//g, '-').trim();
    const bagian = strTanggal.split('-'); 
    if (bagian.length !== 3) {
        throw new Error(`Format tanggal tidak valid (Harus DD-MM-YYYY): ${tanggalLahirExcel}`);
    }

    // Bersihkan angka (Contoh: "05" jadi "5")
    const targetHari = parseInt(bagian[0], 10).toString(); 
    const targetBulan = parseInt(bagian[1], 10);
    let targetTahun = parseInt(bagian[2], 10);

    // Proteksi tahun 2 digit (misal 98 jadi 1998)
    if (targetTahun < 100) {
        targetTahun += (targetTahun > 50 ? 1900 : 2000); 
    }

    const currentDate = new Date();
    const currentTahun = currentDate.getFullYear();
    const currentBulan = currentDate.getMonth() + 1;

    // Buka popup kalender
    await locatorDatepicker.click();
    await page.waitForTimeout(400);

    // SINKRONISASI TAHUN
    const selisihTahun = currentTahun - targetTahun;
    if (selisihTahun > 0) {
        for (let i = 0; i < selisihTahun; i++) {
            await page.locator('.mx-btn-icon-double-left').first().click();
            await page.waitForTimeout(40);
        }
    } else if (selisihTahun < 0) {
        for (let i = 0; i < Math.abs(selisihTahun); i++) {
            await page.locator('.mx-btn-icon-double-right').first().click();
            await page.waitForTimeout(40);
        }
    }

    // SINKRONISASI BULAN
    const selisihBulan = targetBulan - currentBulan;
    if (selisihBulan > 0) {
        for (let i = 0; i < selisihBulan; i++) {
            await page.locator('.mx-btn-icon-right').first().click();
            await page.waitForTimeout(40);
        }
    } else if (selisihBulan < 0) {
        for (let i = 0; i < Math.abs(selisihBulan); i++) {
            await page.locator('.mx-btn-icon-left').first().click();
            await page.waitForTimeout(40);
        }
    }

    // KLIK TANGGAL BERSIH
    const selectorTanggal = `td.cell:not(.not-current-month) div:text-is("${targetHari}")`;
    await page.locator(selectorTanggal).first().click();
    
    await page.waitForTimeout(300);
}

main();