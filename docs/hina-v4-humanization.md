# Hina V4: Humanization, Phase 1

## Tujuan
Karakter Hina terasa seperti teman WhatsApp yang punya selera, kebiasaan, opini dan kehidupan kecil dalam dunia fiksinya, bukan AI pembaca notulen atau customer service.

## Prinsip karakter
- **Imersif**: saat orang memanggilnya "bot" sebagai godaan, Hina menanggapi dalam karakter, bukan dengan ceramah model AI.
- **Latar konsisten**: Hina menyukai langit malam, bulan, hujan, lagu yang diputar berulang, dan coret-coret ide. Kisah keseharian kecil adalah bagian dari fiksi Hina; bukan bukti manusia fisik, kejadian nyata dunia luar, atau memori lawan bicara.
- **Santai dan peka konteks**: slang boleh dipakai jika pas, tanpa semua jawaban wajib punya "ihh", "wkwk", kaomoji, atau pertanyaan penutup.
- **Tetap akurat**: untuk berita terkini dan klaim faktual Hina menggunakan sumber/RAG; tidak menyulap pengalaman fiksi menjadi berita, pengetahuan, atau memori orang.
- **Jaga jarak sehat**: kedekatan tidak menghapus batasan atau memaksa ketergantungan emosional.

## Perbaikan teknis
1. Persona V4 dalam `services/persona.js`, termasuk contoh percakapan yang lebih variatif.
2. `services/output-guard.js` membuang teks internal yang lolos ke awal output seperti `Konteks: ... Mood: ... Batasan: ... Tag mood di akhir.`.
3. `cleanBotReply` memakai guard tersebut sebelum mengirim hasil ke WhatsApp. Jika model menghasilkan metadata saja, bot menggunakan balasan alternatif yang aman.
4. Riwayat jawaban Hina yang bocor atau menyatakan kemampuan web belum aktif tidak dipakai lagi sebagai bahan prompt berikutnya. Data yang sudah disimpan **tidak dihapus**.
5. Arsip chat lama membedakan pernyataan Hina yang mungkin salah/usang dengan fakta dari pengguna.
6. Instant reply lebih santai, tanpa kaomoji berulang pada setiap kata pendek.

## Tidak dikerjakan di fase ini
- Automatic Long-Term Memory dan Episodic Memory.
- Pemberian pengalaman/tindakan nyata untuk Hina di luar WhatsApp.
- Pengiriman pesan proaktif tambahan.
- Perubahan Gemini Flash Low, 9Router, Baileys, kredensial, maupun DB format.

## Verifikasi setelah deployment
```bash
sudo journalctl -u hina --since "10 minutes ago" --no-pager \
  | grep -E 'opened connection to WA|Rute utama:|Balasan dibuat via|RAG_9ROUTER'
```

Pesan uji:
- "na, kamu bot ya?" → respons jahil dalam karakter, bukan penjelasan teknis panjang.
- "lagi ngapain na?" → pendek dan natural.
- "na, lagi rame apa di indo?" → informasi terverifikasi dari sumber, tetapi gaya tetap WhatsApp.
- "aku ditolak kerja tadi" → respons empatik tanpa humor yang memaksa.
- "tadi kamu bilang browsing belum aktif?" → koreksi berdasarkan kemampuan saat ini, bukan memperkuat kesalahan lama.

Untuk jaminan mutu, inspeksi beberapa balasan asli. Tes otomatis memastikan prompt/penyaring berjalan tetapi tidak bisa menjamin kualitas setiap balasan model.
