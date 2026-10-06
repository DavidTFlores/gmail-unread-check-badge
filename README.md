# Gmail Unread Badge

A minimal Chrome extension that shows your Gmail unread count **directly on the tab's favicon** -
a little number bubble on the tab icon itself. This is especially useful for **pinned tabs**,
which show no title at all. The toolbar icon also shows the total as a badge.

## How it works

- **Multi-account counting** (`background.js`): the background worker fetches
  Gmail's per-account Atom feed (`mail.google.com/mail/u/N/feed/atom`) for every
  account signed into this Chrome profile, using the browser's existing session.
  The feed returns only the inbox unread count. Totals are summed across accounts
  and shown on the toolbar badge (hover for the per-account breakdown).
- **Favicon badge** (`favicon-badge.js`): a content script on `mail.google.com`
  redraws the tab favicon (the Gmail "M") with a yellow count bubble showing the
  unread count of **that tab's own account** (matched by its `/mail/u/N/` URL
  index). Works on pinned tabs, which show no title.
- **Real-time**: a change in any open Gmail tab's title triggers an immediate
  refresh; a 30-second poll covers accounts that have no tab open. If the feed
  is unreachable, it falls back to counting from open tab titles.

Privacy properties:

- **No Gmail API, no OAuth** - the only network requests are to
  `mail.google.com`'s own unread feed, authenticated by your existing session.
  Nothing is sent to any third party.
- It never reads your email content - the feed exposes only the unread count
  (and the account address, used for the tooltip).
- Permissions: `tabs`, `alarms`, `storage`, host access to `mail.google.com` only.
- Clicking the toolbar icon focuses your Gmail tab (or opens Gmail if none is open).

## Install (unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle, top right).
3. Click **Load unpacked** and select this folder.
4. Open Gmail in a tab - the badge appears as soon as there is unread mail.

## Limitations

- The favicon badge needs a Gmail tab open (it draws onto that tab's icon); the
  toolbar badge works regardless, since the feed is fetched in the background.
- Counts above 99 are shown as `99+`. The badge is always visible, showing `0`
  when there is no unread mail.
- The Atom feed counts the **inbox** (like Gmail's own tab-title count); mail
  that skips the inbox via filters is not counted.
- If you also use Gmail's built-in "Unread message icon" setting
  (Settings → Advanced), disable it to avoid the two fighting over the favicon.
