const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getReconnectDelay } = require("../services/connection-retry");

test("WhatsApp reconnect uses bounded exponential delay", () => {
  assert.equal(getReconnectDelay(0), 2000);
  assert.equal(getReconnectDelay(1), 4000);
  assert.equal(getReconnectDelay(2), 8000);
  assert.equal(getReconnectDelay(3), 16000);
  assert.equal(getReconnectDelay(4), 32000);
  assert.equal(getReconnectDelay(5), 60000);
  assert.equal(getReconnectDelay(20), 60000);
  assert.equal(getReconnectDelay(-1), 2000);
});

test("reconnect handler guards old sockets, restores backoff on open and keeps service socket fresh", () => {
  const content = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(content, /if \(sock !== activeSocket\) return/);
  assert.match(content, /scheduleReconnect\("WhatsApp disconnected"/);
  assert.match(content, /reconnectAttempts = 0/);
  assert.match(content, /startReminderService\(serviceSocket,/);
  assert.match(content, /startProactiveMessaging\(serviceSocket,/);
  assert.doesNotMatch(content, /if \(statusCode !== DisconnectReason\.loggedOut\) connectToWhatsApp\(\)/);
});
