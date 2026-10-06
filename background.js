// Gmail Unread Badge - background worker.
// Counts unread mail across ALL accounts signed into this Chrome profile by
// fetching Gmail's per-account Atom feed (mail.google.com/mail/u/N/feed/atom).
// The feed uses the browser's existing Gmail session cookies - no OAuth, no
// Gmail API, and it only returns the inbox unread count, never mail content.
// Tab-title changes trigger an immediate refresh (real-time for accounts with
// an open tab); an alarm polls every 30s for accounts without one.

const GMAIL_URL_PATTERN = 'https://mail.google.com/*';
const MAX_ACCOUNTS = 10;
const POLL_MINUTES = 0.5;

async function fetchAccount(u) {
  try {
    const res = await fetch(`https://mail.google.com/mail/u/${u}/feed/atom`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    const countMatch = text.match(/<fullcount>(\d+)<\/fullcount>/);
    if (!countMatch) return null; // login page, not a feed: no such account slot
    const emailMatch = text.match(/Inbox for ([^<\s]+)/);
    return { email: emailMatch ? emailMatch[1] : `account ${u}`, count: parseInt(countMatch[1], 10) };
  } catch {
    return null;
  }
}

async function fetchAllAccounts() {
  const results = await Promise.all(
    Array.from({ length: MAX_ACCOUNTS }, (_, u) => fetchAccount(u))
  );
  // Account slots are contiguous; stop at the first empty one.
  const accounts = [];
  for (const r of results) {
    if (r === null) break;
    accounts.push(r);
  }
  return accounts;
}

// Fallback when the feed is unreachable: sum the open Gmail tab titles
// (one count per account, "Inbox (12) - name@example.com - Gmail").
async function totalFromTabTitles() {
  const tabs = await chrome.tabs.query({ url: GMAIL_URL_PATTERN });
  const perAccount = new Map();
  for (const tab of tabs) {
    const email = (tab.title?.match(/[\w.+-]+@[\w.-]+\.\w+/) || [null])[0];
    const m = tab.title?.match(/\((\d{1,3}(?:[., ]\d{3})*|\d+)\)/);
    const count = m ? parseInt(m[1].replace(/[., ]/g, ''), 10) : 0;
    const key = email || `tab-${tab.id}`;
    perAccount.set(key, Math.max(perAccount.get(key) || 0, count));
  }
  return [...perAccount.values()].reduce((a, b) => a + b, 0);
}

async function refresh() {
  const accounts = await fetchAllAccounts();
  let total;
  let tooltip;
  if (accounts.length > 0) {
    total = accounts.reduce((sum, a) => sum + a.count, 0);
    tooltip = accounts.map((a) => `${a.email}: ${a.count}`).join('\n');
  } else {
    total = await totalFromTabTitles();
    tooltip = `${total} unread (from open tabs; feed unavailable)`;
  }

  await chrome.storage.session.set({ total, accounts });

  await chrome.action.setBadgeBackgroundColor({ color: '#FFD600' });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#000000' });
  }
  await chrome.action.setBadgeText({ text: String(total) });
  await chrome.action.setTitle({ title: tooltip || 'Gmail Unread Badge' });

  // Push the per-account counts to every open Gmail tab; each tab's favicon
  // shows the count of the account it belongs to (by its /mail/u/N/ index).
  const tabs = await chrome.tabs.query({ url: GMAIL_URL_PATTERN });
  await Promise.allSettled(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'unreadCounts', accounts, total }))
  );
}

// Debounce: title changes arrive in bursts while Gmail loads.
let refreshTimer = null;
function scheduleRefresh(delayMs = 500) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh();
  }, delayMs);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.startsWith('https://mail.google.com/')) {
    if ('title' in changeInfo || changeInfo.status === 'complete') scheduleRefresh();
  }
});
chrome.tabs.onRemoved.addListener(() => scheduleRefresh());

chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') refresh();
});

chrome.runtime.onInstalled.addListener(() => refresh());
chrome.runtime.onStartup.addListener(() => refresh());

// Content scripts ask for the current counts when they load.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'getCounts') {
    chrome.storage.session.get(['total', 'accounts']).then(({ total, accounts }) => {
      sendResponse({
        total: typeof total === 'number' ? total : null,
        accounts: Array.isArray(accounts) ? accounts : null,
      });
      if (!Array.isArray(accounts)) refresh();
    });
    return true; // async response
  }
});

// Clicking the icon focuses an existing Gmail tab, or opens Gmail if none.
chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: GMAIL_URL_PATTERN });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://mail.google.com/' });
  }
});
