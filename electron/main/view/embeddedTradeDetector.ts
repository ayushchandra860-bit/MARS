/**
 * Runs only inside an allowlisted Olymp Trade top-level page. It emits compact,
 * schema-validated console envelopes consumed by EmbeddedBrowserManager.
 * Market quotes use targeted selectors and a bounded heartbeat; no body.innerText
 * scan is performed in the live path.
 */
export function buildEmbeddedTradeDetectorScript(): string {
  return `
(function () {
  if (window.__marsTradeDetectorInstalled) return;
  window.__marsTradeDetectorInstalled = true;
  var pending = Array.isArray(window.__marsPendingExecutions) ? window.__marsPendingExecutions : [];
  window.__marsPendingExecutions = pending;

  function textOf(el) { return el ? String(el.value || el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim() : ''; }
  function firstText(selectors, root) {
    try {
      var el = (root || document).querySelector(selectors);
      return textOf(el);
    } catch (_) { return ''; }
  }
  function cleanAsset(value) {
    var text = String(value || '').replace(/\\s+/g, ' ').trim();
    return text.length >= 2 && text.length <= 80 ? text : '';
  }
  function parsePositiveNumber(value) {
    var text = String(value || '').replace(/\\s/g, '').replace(/,/g, '');
    var match = text.match(/(?:^|[^0-9])([0-9]+(?:\\.[0-9]+)?)(?:[^0-9]|$)/);
    var number = match ? Number(match[1]) : NaN;
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  function parseExpiry(value) {
    var text = String(value || '').trim().toLowerCase();
    var hms = text.match(/(\\d{1,2}):(\\d{2}):(\\d{2})/);
    if (hms) return Math.min(86400, Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]));
    var clock = text.match(/(\\d{1,2}):(\\d{2})/);
    if (clock) return Math.min(86400, Number(clock[1]) * 60 + Number(clock[2]));
    var duration = text.match(/(\\d+(?:\\.\\d+)?)\\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\\b/);
    if (duration) {
      var multiplier = duration[2].startsWith('h') ? 3600 : duration[2].startsWith('m') ? 60 : 1;
      return Math.min(86400, Math.max(1, Math.round(Number(duration[1]) * multiplier)));
    }
    return 60;
  }
  function detectAsset(root) {
    var value = firstText('[data-test="asset-select-button"], [data-test="asset-name"], [data-qa*="asset"], [data-testid*="asset"], [aria-label*="asset" i], .asset-select__name, .asset-name, [class*="assetName"], [class*="asset-title"]', root);
    if (!value && document.title) value = document.title.replace(/^[0-9.,\\s▲▼\\u25B2\\u25BC\\u2191\\u2193$€₹£]+/, '').split('|')[0];
    return cleanAsset(value);
  }
  function detectExpiry(root) {
    return firstText('[data-test="expiration-input"], [data-test="expiry-time"], [data-test*="duration"], [data-test*="expiry"], input[name="expiry"], input[name="duration"], .expiration-select, [class*="deal-duration"], [class*="duration-input"], [class*="duration-value"]', root);
  }
  function detectPrice(root) {
    var raw = firstText('[data-test="current-price"], [data-test="current-quote"], [data-test*="asset-price"], [data-qa*="current-price"], [data-testid*="current-price"], [class*="current-price"], [class*="currentPrice"]', root);
    if (!raw && document.title) raw = document.title;
    return parsePositiveNumber(raw);
  }
  function detectPlatformMode() {
    var mode = firstText('[data-test*="account-mode"], [data-test*="account-type"], [data-qa*="account"], [data-testid*="account"], [aria-label*="account" i], [title*="account" i], [class*="account-mode"], [class*="accountMode"], [class*="account-type"], [class*="accountType"]');
    var normalized = mode.toUpperCase();
    if (/\\b(DEMO|PRACTICE)\\b/.test(normalized)) return 'DEMO';
    if (/\\b(LIVE|REAL)\\b/.test(normalized)) return 'LIVE';
    return 'UNKNOWN';
  }

  var lastMarketKey = '';
  var lastMarketEmitAt = 0;
  function emitMarketSnapshot(force) {
    try {
      var now = Date.now();
      var minInterval = document.hidden ? 1000 : 200;
      if (!force && now - lastMarketEmitAt < minInterval) return;
      var asset = detectAsset(document);
      var price = detectPrice(document);
      var timeframe = detectExpiry(document);
      var platformMode = detectPlatformMode();
      if (!asset && price === null) return;
      var key = [asset, price, timeframe, platformMode].join('|');
      if (!force && key === lastMarketKey && now - lastMarketEmitAt < 1000) return;
      lastMarketKey = key;
      lastMarketEmitAt = now;
      console.log('[MARS_MARKET_SNAPSHOT]:' + JSON.stringify({
        asset: asset || null,
        price: price,
        timeframe: timeframe || null,
        platformMode: platformMode,
        title: String(document.title || '').slice(0, 300),
        observedAt: now
      }));
    } catch (_) {}
  }

  function makeId() {
    try { if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (_) {}
    return 'ot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }
  function classifyButton(event) {
    var path = event.composedPath ? event.composedPath() : [event.target];
    for (var i = 0; i < path.length; i++) {
      var el = path[i];
      if (!el || !el.getAttribute) continue;
      var attr = [el.getAttribute('data-test'), el.getAttribute('data-qa'), el.getAttribute('data-testid'), el.getAttribute('aria-label'), el.id, el.className].join(' ').toLowerCase();
      var text = textOf(el).toLowerCase();
      var buttonLike = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || /btn|button|deal/.test(attr);
      if (!buttonLike) continue;
      if (/deal-button-up|button-up|btn-up|\\bbuy\\b|\\bcall\\b/.test(attr) || /^(up|buy|call)\\b/.test(text)) return { action: 'BUY', element: el };
      if (/deal-button-down|button-down|btn-down|\\bsell\\b|\\bput\\b/.test(attr) || /^(down|sell|put)\\b/.test(text)) return { action: 'SELL', element: el };
    }
    return null;
  }

  document.addEventListener('click', function (event) {
    try {
      var match = classifyButton(event);
      if (!match) return;
      var now = Date.now();
      var executionId = makeId();
      var asset = detectAsset(document);
      var expiryText = detectExpiry(document);
      var expirySeconds = parseExpiry(expiryText);
      var entryPrice = detectPrice(document);
      var platformMode = detectPlatformMode();
      var record = { executionId: executionId, action: match.action, asset: asset, expirySeconds: expirySeconds, timestamp: now, resolved: false };
      pending.push(record);
      pending = pending.filter(function (item) { return now - item.timestamp < 86400000; }).slice(-50);
      window.__marsPendingExecutions = pending;
      console.log('[MARS_TRADE_CLICK]:' + JSON.stringify({
        action: match.action,
        eventId: executionId,
        executionId: executionId,
        asset: asset || null,
        expiryText: expiryText || null,
        expirySeconds: expirySeconds,
        entryPrice: entryPrice,
        platformMode: platformMode,
        timestamp: now
      }));
    } catch (_) {}
  }, true);

  var lastResultKey = '';
  var lastResultAt = 0;
  var resultSelectors = [
    '[data-test*="deal-result"]', '[data-test*="trade-result"]',
    '.deal-notification', '.trade-result', '.profit-notification',
    '.deal__result', '.result-popup', '[class*="trade-result"]',
    '[class*="deal-result"]'
  ];
  var signedAmount = /([+-])\\s*[$€₹£]?\\s*([\\d,]+(?:\\.\\d+)?)/;

  function normalizeAsset(value) { return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
  function matchExecution(root, resultText, now) {
    var asset = cleanAsset(firstText('[data-test*="asset"], [class*="asset-name"], [class*="assetName"]', root));
    var upper = String(resultText || '').toUpperCase();
    var direction = /\\b(BUY|UP|CALL)\\b/.test(upper) ? 'BUY' : /\\b(SELL|DOWN|PUT)\\b/.test(upper) ? 'SELL' : '';
    var candidates = pending.filter(function (item) { return !item.resolved && now - item.timestamp >= 0 && now - item.timestamp < 86400000; });
    if (asset) candidates = candidates.filter(function (item) { return normalizeAsset(item.asset) === normalizeAsset(asset); });
    if (direction) candidates = candidates.filter(function (item) { return item.action === direction; });
    if (candidates.length !== 1) return null;
    candidates[0].resolved = true;
    return candidates[0].executionId;
  }
  function emitResult(root, text, match) {
    var now = Date.now();
    var key = String(text).slice(0, 300);
    if (key === lastResultKey && now - lastResultAt < 10000) return;
    lastResultKey = key;
    lastResultAt = now;
    var signed = Number(String(match[1]) + String(match[2]).replace(/,/g, ''));
    var outcome = signed > 0 ? 'WIN' : signed < 0 ? 'LOSS' : 'DRAW';
    var executionId = matchExecution(root, text, now);
    console.log('[MARS_TRADE_RESULT]:' + JSON.stringify({
      outcome: outcome,
      executionId: executionId,
      profitAmount: signed,
      rawText: String(text).slice(0, 500),
      timestamp: now
    }));
  }
  function inspectResultElement(element) {
    if (!element || element.nodeType !== 1) return false;
    var text = textOf(element);
    var match = text.match(signedAmount);
    if (match) { emitResult(element, text, match); return true; }
    return false;
  }
  function scanForResult(root) {
    try {
      if (!root || !root.querySelectorAll) return;
      for (var s = 0; s < resultSelectors.length; s++) {
        if (root.matches && root.matches(resultSelectors[s]) && inspectResultElement(root)) return;
        var elements = root.querySelectorAll(resultSelectors[s]);
        for (var i = 0; i < elements.length; i++) {
          if (inspectResultElement(elements[i])) return;
        }
      }
    } catch (_) {}
  }

  var queuedResultRoots = [];
  var resultScanTimer = null;
  function queueResultScan(root) {
    if (!root || root.nodeType !== 1) return;
    if (queuedResultRoots.length < 25) queuedResultRoots.push(root);
    if (resultScanTimer !== null) return;
    resultScanTimer = setTimeout(function () {
      var roots = queuedResultRoots.splice(0, queuedResultRoots.length);
      resultScanTimer = null;
      for (var i = 0; i < roots.length; i++) scanForResult(roots[i]);
    }, 100);
  }

  try {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        for (var n = 0; n < mutations[i].addedNodes.length; n++) queueResultScan(mutations[i].addedNodes[n]);
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  emitMarketSnapshot(true);
  setInterval(function () { emitMarketSnapshot(false); }, 200);
  setInterval(function () {
    if (!document.hidden && Date.now() - lastResultAt > 5000) scanForResult(document);
  }, 10000);
})();`;
}
