/**
 * WebSocket Broadcaster - Broadcasting messages with backpressure handling.
 */

const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer before skipping

/** Send a message to a single client with backpressure handling. */
export function sendToClient(ws, type, data) {
  if (ws.readyState !== ws.OPEN) return false;
  if (ws.bufferedAmount > MAX_BUFFER_SIZE) {
    ws._skippedMessages = (ws._skippedMessages || 0) + 1;
    return false;
  }
  try {
    ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    return true;
  } catch (err) {
    console.error('WebSocket send error:', err.message);
    return false;
  }
}

/** Broadcast a message to all connected clients with backpressure handling. */
export function broadcastToClients(clients, type, data) {
  const messageStr = JSON.stringify({ type, data, timestamp: Date.now() });
  let sentCount = 0, skippedCount = 0;

  for (const client of clients) {
    if (client.readyState !== client.OPEN) continue;
    if (client.bufferedAmount > MAX_BUFFER_SIZE) {
      client._skippedMessages = (client._skippedMessages || 0) + 1;
      skippedCount++;
      continue;
    }
    try { client.send(messageStr); sentCount++; }
    catch (err) { console.error('WebSocket broadcast error:', err.message); }
  }

  if (skippedCount > 0) console.warn(`Broadcast skipped ${skippedCount} slow clients (type: ${type})`);
  return { sentCount, skippedCount };
}

/** Broadcast a state update to all clients with backpressure handling. */
export function broadcastStateUpdate(clients, stateSnapshot, version) {
  const stateMessage = JSON.stringify({ type: 'stateUpdate', data: stateSnapshot, timestamp: Date.now(), version });
  let sentCount = 0, skippedCount = 0;

  for (const client of clients) {
    if (client.readyState !== client.OPEN) continue;
    if (client.bufferedAmount > MAX_BUFFER_SIZE) {
      client._skippedMessages = (client._skippedMessages || 0) + 1;
      skippedCount++;
      continue;
    }
    try { client.send(stateMessage); sentCount++; }
    catch (err) { console.error('WebSocket send error:', err.message); }
  }

  if (skippedCount > 0) console.warn(`State broadcast skipped ${skippedCount} slow clients`);
  return { sentCount, skippedCount };
}

/** EventHistory class for managing event history with size limits. */
export class EventHistory {
  constructor(maxSize = 1000) {
    this.events = [];
    this.maxSize = maxSize;
  }

  add(type, data) {
    this.events.push({ type, data, timestamp: Date.now() });
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(-this.maxSize);
    }
  }

  getRecent(limit = 100, offset = 0) { return this.events.slice(offset, offset + limit); }
  getLast(count = 100) { return this.events.slice(-count); }
  get length() { return this.events.length; }
  clear() { this.events = []; }
}

/** DebouncedBroadcaster class for batching rapid state updates. */
export class DebouncedBroadcaster {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || 50;
    this._pending = false;
    this._timer = null;
    this._version = 0;
    this._callback = null;
  }

  schedule(callback) {
    this._callback = callback;
    this._version++;
    if (this._pending) return;

    this._pending = true;
    if (this._timer) clearTimeout(this._timer);

    this._timer = setTimeout(() => {
      this._pending = false;
      this._timer = null;
      if (this._callback) this._callback(this._version);
    }, this.debounceMs);
  }

  get version() { return this._version; }

  cancel() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._pending = false;
  }

  reset() {
    this.cancel();
    this._version = 0;
    this._callback = null;
  }
}

export default { sendToClient, broadcastToClients, broadcastStateUpdate, EventHistory, DebouncedBroadcaster };
