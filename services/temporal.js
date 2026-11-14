// Hina Temporal Awareness Engine.
// Always derive time from the host clock with an explicit Asia/Jakarta timezone,
// not from LLM training data, chat history text, or server timezone settings.
const ZONE = "Asia/Jakarta";
const formatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getParts(at = Date.now()) {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) throw new RangeError("Timestamp tidak valid");
  const values = Object.fromEntries(partsFormatter.formatToParts(time)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
    dateKey: [values.year, values.month, values.day].join("-"),
  };
}

function dayPeriod(hour) {
  if (hour >= 4 && hour < 10) return "pagi";
  if (hour >= 10 && hour < 15) return "siang";
  if (hour >= 15 && hour < 18) return "sore";
  if (hour >= 18 && hour < 23) return "malam";
  return "larut malam";
}

function getWibClock(at = Date.now()) {
  const parts = getParts(at);
  return {
    ...parts,
    period: dayPeriod(parts.hour),
    formatted: formatter.format(new Date(at)) + " WIB",
    clock: [parts.hour, parts.minute, parts.second].map((n) => String(n).padStart(2, "0")).join(":"),
  };
}

function getGap(previousAt, now = Date.now()) {
  if (!Number.isFinite(previousAt) || previousAt <= 0 || previousAt > now) return null;
  const totalSeconds = Math.floor((now - previousAt) / 1000);
  const prev = getParts(previousAt);
  const current = getParts(now);
  const previousDate = Date.UTC(prev.year, prev.month - 1, prev.day);
  const currentDate = Date.UTC(current.year, current.month - 1, current.day);
  const calendarDays = Math.round((currentDate - previousDate) / 86400000);

  let duration;
  if (totalSeconds < 60) duration = totalSeconds + " detik";
  else if (totalSeconds < 3600) duration = Math.floor(totalSeconds / 60) + " menit";
  else if (totalSeconds < 86400) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    duration = hours + " jam" + (minutes ? " " + minutes + " menit" : "");
  } else {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600000);
    duration = days + " hari" + (hours ? " " + hours + " jam" : "");
  }

  return {
    totalSeconds,
    duration,
    calendarDays,
    dayChanged: calendarDays > 0,
    previousPeriod: dayPeriod(prev.hour),
    currentPeriod: dayPeriod(current.hour),
    periodChanged: dayPeriod(prev.hour) !== dayPeriod(current.hour),
    previousClock: [prev.hour, prev.minute].map((n) => String(n).padStart(2, "0")).join(":"),
    currentClock: [current.hour, current.minute].map((n) => String(n).padStart(2, "0")).join(":"),
  };
}

function getTemporalContext(previousUserAt, now = Date.now()) {
  const current = getWibClock(now);
  const elapsed = getGap(previousUserAt, now);
  const since = elapsed
    ? [
      "Jeda sejak pesan user sebelumnya: " + elapsed.duration + ".",
      "Pesan sebelumnya sekitar pukul " + elapsed.previousClock + " WIB (" + elapsed.previousPeriod + ").",
      "Hari kalender WIB " + (elapsed.dayChanged ? "sudah berganti (" + elapsed.calendarDays + " hari kalender)." : "masih sama."),
      "Periode hari " + (elapsed.periodChanged ? "sudah berubah dari " + elapsed.previousPeriod + " ke " + elapsed.currentPeriod + "." : "belum berubah."),
    ].join(" ")
    : "Belum ada waktu pesan sebelumnya yang dapat dipastikan.";

  return [
    "",
    "KONTEKS WAKTU INTERNAL (Asia/Jakarta; jangan dibacakan):",
    "Tanggal dan waktu saat MENYIAPKAN balasan: " + current.formatted + ".",
    "Jam 24 jam: " + current.clock + " WIB; periode: " + current.period + ".",
    since,
    elapsed ? (elapsed.totalSeconds < 300 ? "Jeda pendek: lanjutkan topik tanpa sapaan ulang." : elapsed.totalSeconds < 21600 ? "Jeda sedang: sambung topik jika masih relevan." : "Jeda panjang: jangan menganggap topik, kondisi, atau rencana lama masih berlaku.") : "Jangan menebak riwayat waktu.",
    "Gunakan tanggal arsip untuk menafsirkan kemarin/besok dari sudut pandang waktu pesan itu, bukan waktu sekarang.",
    "Jangan berasumsi pesan sebelumnya terjadi barusan jika sudah berlalu lama. Jangan mengubah durasi menjadi kisah/aktivitas fiktif Hina.",
    "Jangan otomatis menyapa berdasarkan waktu, mengomentari lamanya user tidak chat, atau menyebut jam/tanggal dalam setiap balasan. Lakukan hanya saat relevan dan terasa natural.",
    "Waktu bisa berjalan setelah prompt disusun; bila perlu waktu persis sampai detik, jawaban deterministik dari clock engine lebih akurat.",
  ].join("\n");
}

// Handle only direct clock/calendar questions deterministically. Other queries
// can still go to the LLM with a fresh temporal context.
function isDirectTimeQuestion(text) {
  const input = String(text || "").toLowerCase()
    .replace(/^(?:(?:hina|hin|na)[,\s]+)+/, "")
    .replace(/[?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(?:(?:eh|coba|btw|sekarang|ini)\s+)*(?:(?:jam|pukul)\s+(?:berapa|brp)(?:\s+(?:sekarang|nih|sih|wib))?|(?:sekarang\s+)?(?:hari|tanggal|bulan|tahun)\s+(?:apa|berapa|brp)(?:\s+sekarang)?|(?:sekarang\s+)?(?:pagi|siang|sore|malam)\s+(?:atau\s+(?:pagi|siang|sore|malam))?|sekarang\s+jam\s+(?:berapa|brp)|sekarang\s+(?:hari|tanggal|bulan|tahun)\s+(?:apa|berapa|brp))(?:\s+(?:nih|sih|dong|ya))?$/.test(input);
}

function getDirectTimeAnswer(text, now = Date.now()) {
  if (!isDirectTimeQuestion(text)) return null;
  const input = String(text || "").toLowerCase();
  const current = getWibClock(now);
  const hhmm = current.clock.slice(0, 5);
  if (/\b(jam|pukul)\b/.test(input)) return "sekarang jam " + hhmm + " WIB, " + current.period + " nih";
  if (/\b(tanggal|hari|bulan|tahun)\b/.test(input)) return "sekarang " + current.formatted.split(" pukul ")[0].replace(/,?\s+\d{2}\.\d{2}\.\d{2}$/, "") + ", WIB";
  return "sekarang udah " + current.period + " nih, jam " + hhmm + " WIB";
}

module.exports = { ZONE, getWibClock, getGap, getTemporalContext, isDirectTimeQuestion, getDirectTimeAnswer };
