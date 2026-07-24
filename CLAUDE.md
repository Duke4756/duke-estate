# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Condo Lead Finder — a single React + Express app with **two modes** (toggle in the header):
- **ค้นหาโพสต์ (search):** scrapes recent posts from Facebook groups and classifies who is *looking to rent* (renter) vs owner/seller/other.
- **โพสต์อัตโนมัติ (auto-post):** create reusable "post sets" (text + images) and schedule/auto-post them into target groups.

Both features drive real Facebook via **Playwright**, reusing one saved login session. The UI is in Thai; code comments are mixed Thai/English.

## Commands

```bash
npm install
npx playwright install chromium   # once, downloads the browser
npm run login                     # once, opens a real browser to log into FB (BACKUP account) → saves server/fb-session.json
npm run dev                       # runs backend (:8787) + Vite client (:5173) via concurrently
npm run build                     # vite production build (also the fastest way to catch frontend errors)
npm run scrape:test 60            # run the scraper standalone (last 60 min) and print results, no UI
```

There is **no test runner and no lint script**. Verify changes with `npm run build` (frontend) and `node --check server/<file>.js` (backend syntax).

Debugging the Playwright jobs (FB DOM is obfuscated and changes often):
```bash
HEADLESS=false DEBUG_SCRAPER=1 npm run scrape:test 60   # watch the scraper; dumps screenshots/html to scratch-debug/
# For the poster: set HEADLESS=false and DEBUG_POSTER=1 before `npm run dev`
```

**Server files do NOT hot-reload** — after editing anything in `server/`, restart `npm run dev`. The frontend hot-reloads via Vite.

## Architecture

- **ESM throughout** (`"type": "module"`). Backend = Express (`server/index.js`, port 8787). Frontend = React 18 + Vite 6 + **Tailwind v4** (via `@tailwindcss/vite`, not PostCSS). Vite dev-proxies `/api` → `:8787`.
- **Frontend entry:** `src/App.jsx` holds all search-mode state + the top-level `appMode` switch. Search runs **only when the user clicks "ดึงโพสต์ล่าสุด"** — nothing auto-fetches on load or on option changes. `src/components/AutoPostView.jsx` is the whole auto-post UI. `src/api.js` is the single API/SSE client.
- **Playwright + one session:** `npm run login` writes `server/fb-session.json`; `scraper.js` and `poster.js` both build their browser/context the same way (storageState + anti-fingerprint init scripts + `--disable-blink-features=AutomationControlled`) so FB serves the normal DOM.
- **Scraper (`server/scraper.js`):** must use the **plain group feed** — appending `?sorting_setting=CHRONOLOGICAL` makes FB serve an obfuscated DOM with hidden permalinks. The feed virtualizes, so it extracts posts *after each scroll step* and accumulates. FB scrambles the visible timestamp, so it **hovers the time link and reads the tooltip** for the real date, and builds clean `/groups/<id>/posts/<id>/` permalinks (from the `set=pcb.<id>` photo links / real `/posts/` hrefs).
- **Poster (`server/poster.js`):** opens the composer (composer text is FB-language-dependent — the session's account is **English**: "Write something…", "Post"), picks the correct nested dialog (the one containing the file input, not the "Create post" wrapper), types text, attaches images to the **multiple image** file input (there is also a video-only single-file input to avoid), and waits for the Post button to render before clicking. `runSchedule(id, {onStep})` is the entry point; `running` flag prevents concurrent runs.
- **Classification (`server/index.js`):** `classifyPosts(posts, mode)` — `keyword` (rules from `server/keywords.js`, instant, the default) or `ai` (Gemini via REST in parallel batches, falls back to keyword on error). Renter-vs-supply is the key distinction; keyword lists live in `keywords.defaults.json` (shared) + user extras in `keywords.json`.
- **SSE endpoints stream progress:** `GET /api/leads/stream` (scrape % + logs + incremental per-post `leads` events) and `GET /api/schedules/:id/run` (post-now progress). Scraped posts are cached ~15 min (`scrapeCache`) so toggling keyword/AI re-classifies without re-scraping.
- **Scheduler:** a `setInterval` in `index.js` fires due schedules, but **skips any overdue by more than `STALE_MS` (10 min)** so a restart never surprise-posts old pending schedules.

## Local data — never committed, survives `git pull`

All user-entered data is gitignored and read with a fallback, so pulling code updates never wipes it and a fresh clone still runs:

| File / dir | Contains | On missing |
|---|---|---|
| `.env` | `GEMINI_API_KEY`, `FB_GROUP_URLS`, etc. | copy from `.env.example` (tracked) |
| `server/fb-session.json` | FB cookies (from `npm run login`) | app shows "no session" banner + demo data |
| `server/groups.json` | monitored groups `[{url, active}]` | falls back to `FB_GROUP_URLS` / default |
| `server/keywords.json` | user's extra keywords | uses `keywords.defaults.json` (tracked) only |
| `server/autopost/` | `postsets.json`, `schedules.json`, `images/` | start empty |
| `server/history/` | past searches as `.xlsx` (exceljs) | empty list |

Data modules (`groups.js`, `keywords.js`, `postsets.js`, `schedules.js`, `history.js`) normalize old formats on read (e.g. groups may be legacy URL strings or `{url, active}`), so shape changes stay backward-compatible. Keep it that way when changing a data schema.

## Important constraints

- Posting to Facebook is an **irreversible publish** — do not trigger a real post during development unless that is the explicit intent. Read-only selector probes (open composer, inspect, close without clicking Post) are the safe way to validate poster selectors.
- Use a **backup FB account** for the session, never a primary account (automation risks bans).
