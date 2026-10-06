// Gmail Unread Badge - favicon overlay.
// Runs inside the Gmail page, reads the unread count from the document title
// (e.g. "Inbox (12) - name@example.com - Gmail"), and redraws the tab's
// favicon with a count bubble. This is what makes the count visible on
// pinned tabs, which show no title at all.

(() => {
  'use strict';

  const LINK_ID = 'gmail-unread-badge-favicon';
  const COUNT_RE = /\((\d{1,3}(?:[., ]\d{3})*|\d+)\)/;

  let lastCount = 0;
  let lastDrawnText = null;

  // Per-account counts pushed by the background worker (which reads Gmail's
  // per-account Atom feeds). Null until the first push; we fall back to this
  // tab's own title. This tab shows the count of ITS account, identified by
  // the /mail/u/N/ index in the URL.
  let feedCount = null;

  function accountIndex() {
    const m = location.pathname.match(/\/mail\/u\/(\d+)\//);
    return m ? parseInt(m[1], 10) : 0;
  }

  function applyCounts(accounts) {
    if (!Array.isArray(accounts)) return;
    const own = accounts[accountIndex()];
    if (own && typeof own.count === 'number') {
      feedCount = own.count;
      update();
    }
  }

  function parseCountFromTitle() {
    const m = document.title.match(COUNT_RE);
    return m ? parseInt(m[1].replace(/[., ]/g, ''), 10) : null;
  }

  // While a single conversation is open the URL hash looks like
  // "#inbox/FMfcgz..." and the title shows the subject (never a count),
  // so we keep the last known count. On a list view ("#inbox", "#label/x")
  // a missing "(N)" genuinely means zero unread.
  function isConversationView() {
    return /^#[^/?]+\/./.test(location.hash);
  }

  function currentCount() {
    if (feedCount !== null) return feedCount;
    const parsed = parseCountFromTitle();
    if (parsed !== null) return parsed;
    return isConversationView() ? lastCount : 0;
  }

  // The extension's Gmail "M" icon, loaded once. Fetched as a blob so the
  // canvas stays untainted and toDataURL keeps working.
  let baseImagePromise = null;
  function getBaseImage() {
    if (!baseImagePromise) {
      baseImagePromise = fetch(chrome.runtime.getURL('icons/icon.png'))
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
        .catch(() => null);
    }
    return baseImagePromise;
  }

  async function drawFavicon(count) {
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');

    const base = await getBaseImage();
    if (base) {
      ctx.drawImage(base, 0, 0, S, S);
    } else {
      // Fallback if the icon can't be loaded: plain light envelope.
      ctx.fillStyle = '#E8EAED';
      ctx.fillRect(S * 0.06, S * 0.22, S * 0.88, S * 0.6);
      ctx.strokeStyle = '#5F6368';
      ctx.lineWidth = S * 0.05;
      ctx.beginPath();
      ctx.moveTo(S * 0.08, S * 0.25);
      ctx.lineTo(S * 0.5, S * 0.58);
      ctx.lineTo(S * 0.92, S * 0.25);
      ctx.stroke();
    }

    // Big yellow count badge with black text, bottom-right - high contrast
    // against both the red "M" and dark/light tab bars. Always drawn -
    // "0" means all read.
    const text = count > 99 ? '99+' : String(count);
    const bH = S * 0.72;
    ctx.font = `bold ${Math.round(bH * 0.76)}px Arial, sans-serif`;
    const textW = ctx.measureText(text).width;
    const bW = Math.min(S, Math.max(bH, textW + bH * 0.28));
    const bx = S - bW;
    const by = S - bH;

    ctx.fillStyle = '#FFD600';
    ctx.strokeStyle = '#202124';
    ctx.lineWidth = S * 0.05;
    ctx.beginPath();
    ctx.roundRect(bx + ctx.lineWidth / 2, by + ctx.lineWidth / 2, bW - ctx.lineWidth, bH - ctx.lineWidth, bH * 0.16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bW / 2, by + bH * 0.54);

    return canvas.toDataURL('image/png');
  }

  async function setFavicon(count) {
    const text = count > 99 ? '99+' : String(count);
    if (text === lastDrawnText && document.getElementById(LINK_ID)) return;
    lastDrawnText = text;

    const url = await drawFavicon(count);

    // Remove Gmail's own icon links so the browser can't prefer them.
    for (const link of document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')) {
      if (link.id !== LINK_ID) link.remove();
    }

    let link = document.getElementById(LINK_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = LINK_ID;
      link.rel = 'icon';
      link.type = 'image/png';
      document.head.appendChild(link);
    }
    link.href = url;
  }

  let scheduled = false;
  function update() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const count = currentCount();
      lastCount = count;
      setFavicon(count);
    }, 150);
  }

  // Title changes are the real-time signal (Gmail updates it even in
  // background/pinned tabs). Watch <head> too, in case Gmail re-inserts
  // its own favicon links over ours.
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(update).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeName === 'LINK' && node.id !== LINK_ID && /icon/i.test(node.rel || '')) {
          lastDrawnText = null;
          update();
          return;
        }
      }
    }
  }).observe(document.head, { childList: true });

  window.addEventListener('hashchange', update);

  // Receive per-account counts from the background worker, and ask for the
  // current ones on load.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'unreadCounts') applyCounts(msg.accounts);
  });
  try {
    chrome.runtime.sendMessage({ type: 'getCounts' }, (resp) => {
      void chrome.runtime.lastError;
      if (resp) applyCounts(resp.accounts);
    });
  } catch {
    // Extension context gone (e.g. just reloaded); title fallback still works.
  }

  update();
})();
