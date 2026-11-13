// Hina V4: output boundary. Model-written strategy/notes must never enter WhatsApp.
// This is a deterministic last-mile guard, not a replacement for correct prompting.
const META_OPENING = /^(?:konteks\s*:\s*(?:user|pengguna|teman|allif|percakapan)|mood\s*:\s*(?:malu|ceria|senang|biasa|sedih|marah|kesal|netral|mengantuk)|nuansa pesan\s*:|batasan\s*:|analisis(?:\s+internal)?\s*:|strategi\s*:|rencana jawaban\s*:|instruksi(?:\s+internal)?\s*:|catatan(?:\s+internal)?\s*:)/i;
const META_LINE = /^(?:konteks|mood|nuansa pesan|batasan|analisis|strategi|rencana jawaban|instruksi internal|catatan internal|aturan jawab|self-respect)\s*:/i;
const STALE_CAPABILITY_CLAIM = /(?:akses\s+web\s+(?:umum)?(?:ku|nya)?\s+(?:lagi\s+)?belum\s+aktif|(?:web\s+search|browsing|akses\s+internet)\s+(?:real.?time\s+)?(?:ku\s+)?(?:belum|tidak|gak|nggak)\s+(?:aktif|tersedia)|TAVILY_API_KEY\s+belum\s+diisi)/i;

function stripInternalPreamble(reply) {
  const original = String(reply || "").trim();
  if (!META_OPENING.test(original)) return original;

  // Models sometimes leak "Konteks: ... Mood: ... Batasan: ... Tag mood di akhir."
  // and then append their actual WhatsApp response, without a newline.
  const finalMarker = /(?:tag\s+mood\s+di\s+akhir|(?:jawaban|balasan)\s+(?:akhir|final)\s*:)\s*[.!:\-–]?\s*/i;
  const markerMatch = finalMarker.exec(original);
  if (markerMatch && markerMatch.index < 3000) {
    const remainder = original.slice(markerMatch.index + markerMatch[0].length).trim();
    return META_OPENING.test(remainder) ? "" : remainder;
  }

  // Safe when the model emits a separate labelled "Hina: ..." answer section.
  const answerMarker = /(?:^|\n)\s*(?:balasan hina|pesan whatsapp|jawaban ke user|hina)\s*:\s*(\S[\s\S]*)$/im;
  const answerMatch = answerMarker.exec(original);
  if (answerMatch) {
    const remainder = answerMatch[1].trim();
    return META_OPENING.test(remainder) ? "" : remainder;
  }

  const lines = original.split(/\r?\n/);
  let at = 0;
  while (at < lines.length && (META_LINE.test(lines[at].trim()) || !lines[at].trim())) at++;
  // When metadata is spread over unlabelled continuation lines, don't leak it.
  // Only release standalone content after a blank-line separator.
  if (at < lines.length && at > 0 && !META_LINE.test(lines[at].trim())) {
    const candidate = lines.slice(at).join("\n").trim();
    if (!/(?:\bKonteks:\s*(?:User|Pengguna)|\bNuansa pesan:|\bBatasan:)/i.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function isUnreliableAssistantContext(content) {
  const text = String(content || "");
  return META_OPENING.test(text.trim()) || STALE_CAPABILITY_CLAIM.test(text);
}

function filterContextHistory(history) {
  return (Array.isArray(history) ? history : []).filter(
    (entry) => entry && (entry.role !== "assistant" || !isUnreliableAssistantContext(entry.content))
  );
}

module.exports = { stripInternalPreamble, isUnreliableAssistantContext, filterContextHistory };
