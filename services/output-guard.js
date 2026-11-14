// Hina V4: deterministic boundary between model notes and WhatsApp output.
// Internal preambles aren't conversational replies. Never relay them or save
// them as examples for the next completion.
const META_START = /^(?:konteks|mood(?:\s+internal(?:\s+hina)?)?|nuansa(?:\s+pesan)?|batasan|analisis(?:\s+internal)?|strategi|rencana\s+jawaban|instruksi(?:\s+internal)?|catatan(?:\s+internal)?|aturan\s+jawab|self-respect)\s*:/i;
const META_LABEL = /(?:^|\n)\s*(?:konteks|mood(?:\s+internal(?:\s+hina)?)?|nuansa(?:\s+pesan)?|batasan|analisis(?:\s+internal)?|strategi|rencana\s+jawaban|instruksi(?:\s+internal)?|catatan(?:\s+internal)?|aturan\s+jawab|self-respect)\s*:/gi;
const STALE_MEMORY_CLAIM = /\b(?:aku|hina)\s+(?:gak|nggak|tidak|ga)\s+(?:menyimpan|simpan)\s+(?:riwayat|obrolan|chat)\b/i;
const STALE_CAPABILITY_CLAIM = /(?:akses\s+web\s+(?:umum)?(?:ku|nya)?\s+(?:lagi\s+)?belum\s+aktif|(?:web\s+search|browsing|akses\s+internet)\s+(?:real.?time\s+)?(?:ku\s+)?(?:belum|tidak|gak|nggak)\s+(?:aktif|tersedia)|TAVILY_API_KEY\s+belum\s+diisi)/i;

// Some providers start with an internal plan, then write the final reply.
// Examples seen in the wild: "Konteks: Karhutla...", "Mood internal Hina:...",
// "Balasan: Santai tapi prihatin, ... akhiri tag mood. Nah itu juga..."
// Never trust a response that still looks like a model planning transcript.
function stripInternalPreamble(reply) {
  const original = String(reply || "").trim();
  if (!META_START.test(original)) return original;

  const labels = [...original.matchAll(META_LABEL)];
  const likelyPlan = labels.length >= 2 ||
    /\b(?:mood(?:\s+internal(?:\s+hina)?)?|batasan|nuansa\s+pesan|instruksi\s+internal)\s*:/i.test(original.slice(1)) ||
    /(?:\b(?:tag\s+mood|tanpa\s+emoji|nuansa\s+pesan|mood\s+internal|jawaban\s+(?:akhir|final)|akhir(?:i|kan)?\s+tag)\b)/i.test(original);
  if (!likelyPlan) return original;

  // Prefer an explicit ending of the writing plan, then take only the text
  // *after* it. We require a complete instruction sentence to avoid splitting
  // natural text merely containing the word "mood".
  const instructionEnds = [
    /(?:tag\s+mood\s+di\s+akhir)\s*[.!:;\-–]?\s*/gi,
    /(?:akhir(?:i|kan)?\s+(?:dengan\s+)?tag\s+mood)\s*[.!:;\-–]?\s*/gi,
  ];
  for (const pattern of instructionEnds) {
    let match;
    let last = null;
    while ((match = pattern.exec(original)) !== null) {
      last = match;
    }
    if (last && last.index < 3000) {
      const candidate = original.slice(last.index + last[0].length).trim();
      if (candidate && !META_START.test(candidate) && !/^(?:balasan|jawaban)\s*:/i.test(candidate)) {
        return candidate;
      }
    }
  }

  // The last explicit "Hina:"/"Jawaban final:" section generally contains
  // speech, not planning instructions.
  const definiteAnswer = /(?:^|\n)\s*(?:balasan\s+hina|jawaban\s+(?:akhir|final|ke\s+user)|pesan\s+whatsapp|hina)\s*:\s*/gim;
  let match;
  let lastAnswer = null;
  while ((match = definiteAnswer.exec(original)) !== null) lastAnswer = match;
  if (lastAnswer) {
    const candidate = original.slice(lastAnswer.index + lastAnswer[0].length).trim();
    return looksLikeInternalNote(candidate) ? "" : candidate;
  }

  // "Balasan:" is ambiguous: it may contain a *description* of how to write,
  // rather than the actual reply. Disallow any candidate that starts with
  // directives like "Santai tapi prihatin, tanpa emoji...".
  const genericAnswer = /(?:^|\n)\s*(?:balasan|jawaban)\s*:\s*/gim;
  let lastGeneric = null;
  while ((match = genericAnswer.exec(original)) !== null) lastGeneric = match;
  if (lastGeneric) {
    const candidate = original.slice(lastGeneric.index + lastGeneric[0].length).trim();
    return looksLikeInternalNote(candidate) ? "" : candidate;
  }

  // Multi-line preamble separated from actual reply by an empty line.
  const blocks = original.split(/\n\s*\n/);
  if (blocks.length > 1) {
    const candidate = blocks.slice(1).join("\n\n").trim();
    return looksLikeInternalNote(candidate) ? "" : candidate;
  }

  return ""; // Better to ask user to retry than leak internal notes.
}

function looksLikeInternalNote(content) {
  const text = String(content || "").trim();
  return !text || META_START.test(text) ||
    /^(?:santai|singkat|natural|hangat|informative|informatif|formal|non-formal|tanpa\s+emoji|jangan\s+|gunakan\s+|sebutkan\s+).{0,110}(?:\b(?:tag\s+mood|emoji|jawab|nuansa|ak(hir|hiri)|gaya|respons|respon)\b)/i.test(text) ||
    /^(?:akhiri|tambahkan|sertakan)\s+(?:dengan\s+)?(?:tag\s+mood|mood|emoji)\b/i.test(text);
}

function isUnreliableAssistantContext(content) {
  const text = String(content || "").trim();
  return (META_START.test(text) && stripInternalPreamble(text) !== text) ||
    STALE_CAPABILITY_CLAIM.test(text) || STALE_MEMORY_CLAIM.test(text);
}

function filterContextHistory(history) {
  return (Array.isArray(history) ? history : []).filter(
    (entry) => entry && (entry.role !== "assistant" || !isUnreliableAssistantContext(entry.content))
  );
}

module.exports = { stripInternalPreamble, isUnreliableAssistantContext, filterContextHistory };
