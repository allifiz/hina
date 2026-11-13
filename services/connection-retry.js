function getReconnectDelay(attempt, { baseMs = 2000, maxMs = 60000 } = {}) {
  const safeAttempt = Math.max(0, Math.min(15, Math.floor(Number(attempt) || 0)));
  return Math.min(maxMs, baseMs * (2 ** safeAttempt));
}

module.exports = { getReconnectDelay };
