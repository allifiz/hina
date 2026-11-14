// Only state what the application actually supports; retrieval is not exhaustive.
function capabilityContext({chatMemory="",episodes="",hasResearch=false}={}){
 return [
  "KEMAMPUAN APLIKASI (internal):",
  "Riwayat chat terbatas disimpan per kontak; arsip relevan, catatan eksplisit dan episode dapat muncul pada konteks. Ini bukan ingatan sempurna.",
  chatMemory||episodes?"Ada konteks memori terpilih; gunakan hanya bagian relevan dan prioritaskan koreksi terbaru.":"Tidak ada hasil arsip terpilih pada giliran ini; riwayat terbaru masih mungkin tersedia.",
  "Jika tidak menemukan detail, katakan belum ingat atau belum menemukan detail itu; jangan menyimpulkan user belum pernah bilang atau bahwa aplikasi tidak menyimpan chat.",
  hasResearch?"Data pencarian tersedia sebagai konteks, bukan bukti semua klaim benar.":"Jangan mengaku sudah mencari web jika hasil pencarian tidak tersedia.",
  "Berpikir seperlunya: chat ringan cukup reaksi; jika ada koreksi fakta, waktu, konflik atau permintaan teknis, teliti konteks sebelum menjawab. Jangan tampilkan proses penalaran.",
 ].join("\n");
}
module.exports={capabilityContext};
