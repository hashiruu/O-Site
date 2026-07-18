<div align="center">

<img src="public/logo/circle.png" width="96" alt="O-Site" />

# O-Site

**Your family's private streaming empire.**

Movies · Series · Anime · Musicals · Books · Live TV · Sports — whatever you want to watch, it's already there.

*One server, one domain, the entire entertainment universe for your household.*

<img src="public/fable-5-verified.png" height="40" alt="Fable 5 Verified" />

`Next.js 15` · `React 19` · `Tailwind v4` · `SQLite` · `WebGL` · `Edge TTS` · `DeepSeek`

[中文](README.md) | **English**

</div>

---

## 🎬 Not Another "File Browser with a Play Button"

Most self-hosted media solutions are a file list with playback. O-Site aims for something else: **the big-streaming-service experience on your own hardware** — and then a few steps further, into territory the big services wouldn't dare.

---

## 🏠 Home: A Foyer That Knows You

<img src="docs/shots/home.png" alt="Home" width="100%" />

*AI greeting · Everyday Different banner · daily trending · command deck · continue watching — all in one screen*

| Feature | What it does | How to use |
|---|---|---|
| **AI personalized greeting** | Greets you in a Murakami-esque voice: it reads your last 10 reading/watching records, weaves in local weather and the hour, and writes a paragraph that belongs only to you. Font size auto-fits the card | Works once logged in, refreshes every 3 hours. Requires a DeepSeek key; falls back to a time-of-day greeting without one |
| **Headline float card** | The most watch-worthy title in your library, with mini carousel + instant play/details | Hover to pause; dots to switch |
| **Everyday Different** | The big banner: one themed channel per day (Cozy Family Day / Spirit of Adventure / Rivers of History… 12 rotating themes), high-rated picks refreshed daily, with a GLSL displacement-dissolve transition | Click for a popover with synopsis → pick a platform; falls back to your own library when offline |
| **Daily Trending** | Film/TV trending + Chinese book bestsellers, updated daily | Click an entry → popover with synopsis → choose where to watch (incl. "search this site first") |
| **Command deck** | Three instant cards: Continue Watching / Continue Reading / Feeling Lucky | "Lucky" opens a full-screen card-draw animation — slows down, locks in with an orange glow |
| **Continue watching** | Portrait posters stay portrait, landscape stills stay landscape — native ratios, one row | Click to resume; "All records →" opens History |
| **Section gallery** | Movies/Series/Anime/Albums in a two-row synchronized horizontal scroll with giant outlined issue numbers | "Refresh ↻" per section; no left-edge fade when scrolled to start |

## 🎞️ The Library

**Browse** (`/category/movie|series|anime`)

- TMDB auto-scraping for posters/synopses/ratings; fix mismatches via "Re-scrape" on the detail page
- Sort by date / name / type, asc/desc
- Three item states: **Collected** (episode-count badge) · **Uncollected** (entry without episodes) · **External** (cyan badge, no local file — click to jump to a legal platform)
- **Random Add** (admin): the "+" card offers two modes — 🎲 answer 3 taste questions and get 10 non-duplicate high-rated picks from TMDB/Douban; 🔍 keyword search with poster/synopsis preview, confirm one by one

**Detail page** — cinematic: full-bleed backdrop fading into the page, floating poster, episode grid with stamped numbers, a "you were here" badge, hover play button

**Player** — HLS transcoding, embedded subtitles, shortcuts (space to pause, ←→ to seek), favorites, live progress reporting

<img src="docs/shots/musical.png" alt="Musicals" width="100%" />

**Musicals** (`/category/musical`) — a curated list of 48 Broadway/West End classics (Hamilton, Phantom, Les Mis, Wicked…), 10 daily rotating picks; admin can random-add or keyword-add; cards jump to pro-shot platforms

## 📚 Reader: An AI That Finishes the Book With You

<img src="docs/shots/reader.png" alt="EPUB reader" width="100%" />

*Two-column layout · clickable AI annotations · toolbar: narration / auto-read / focus / temperature / graph / Q&A*

EPUB / PDF / Markdown. Open a cover on the bookshelf and go.

| Feature | What it does | How to use |
|---|---|---|
| 🌡️ **Story thermometer** | AI senses narrative tension (0–100) page by page; the progress bar warms and cools with the plot, tagged with mood words | Toggle "Temperature"; cached per page — zero tokens on revisit |
| 🎻 **Ambient music engine** | Your local music library, catalogued into 10 mood buckets, scored to the plot: strings creep in for suspense, piano for warmth, seamless crossfade, a "switch only when necessary" discipline, no repeats within 20 min | Speaker toggle on the temperature button; current track shown bottom-right |
| 🎙️ **Multi-voice narration** | Narrator and quoted dialogue get separate voices; speaker gender auto-detected; one character keeps one voice for the whole book; karaoke-style highlighting | "Read Aloud" in the toolbar; "Auto-read" measures your pace first |
| 🤖 **Agentic Q&A** | Ask anything — the AI greps only **what you've read** for evidence, spoiler-free. Every search step streams live | Homophone-tolerant names (voice-input friendly); papers get a dedicated mode |
| ✍️ **Term annotations** | Select text to create entries; AI explains and tags gender (feeds narration) | Select → "Add as entry" |
| 🕸️ **Character graph** | Mermaid relationship map up to your current progress | Toolbar "Graph"; minimal tokens |
| 🎯 **Focus mode** | Paragraph spotlight (ADHD-friendly), ↑↓ to advance | Works in PDFs too |
| 📝 **Reading notes** | Highlighter + drag-in images, draggable float window | Auto-synced into the site-wide Notes page |
| 🎨 **Appearance** | Font/size/line-height/bold/themes; **day-night synced with the whole site**, silky slide transitions, never a white flash | Settings panel, instant apply |

<img src="docs/shots/bookshelf.png" alt="Bookshelf" width="100%" />

**Bookshelf** (`/bookshelf`) — Apple-Books-style shelves with real covers, a Reading-Now card with ring progress, a Finished section, instant search; plus an external booklist (Douban picks that open in WeRead / Anna's Archive / etc.)

## 🌐 Fetch Out As We Can

Don't have it locally? **We don't play dead — we find it.**

- **Eight-direction popover**: opens at your cursor, auto-oriented by a 3×3 screen grid, never clipped. Synopsis first, platforms second
- **Platform matrix**: film/TV → Tencent/iQiyi/Bilibili/Youku + JustWatch; anime → Bilibili + Crunchyroll; musicals → Bilibili pro-shots/YouTube/BroadwayHD; books → WeRead/Douban/Anna's Archive/JD + Google Books
<img src="docs/shots/embed.png" alt="Embedded Bilibili" width="100%" />

- **Embedded Bilibili viewing** (`/embed`): search in-site → full-page iframe (**log in to your Bilibili account, unlock high quality**) → heartbeat progress tracking → resume from where you left off

## ✨ The Living Quarters

<table><tr>
<td width="50%"><img src="docs/shots/notes.png" alt="Notes" /><br /><em>Notes: iPad-Notes looks × Markdown core (preview mode)</em></td>
<td width="50%"><img src="docs/shots/history.png" alt="History" /><br /><em>History dashboard: stat cards + a merged video-and-books timeline</em></td>
</tr><tr>
<td width="50%"><img src="docs/shots/missed.png" alt="Missed" /><br /><em>Missed: the catch-up list</em></td>
<td width="50%"><img src="docs/shots/sports.png" alt="Sports" /><br /><em>Sports: World Cup knockout rings, auto-refreshing scores</em></td>
</tr></table>

| Page | What & how |
|---|---|
| **📝 Notes** (`/notes`) | iPad-Notes looks × Markdown core: searchable time-grouped list, first-line-is-title editor with 800ms autosave; toolbar **B/I/strike/H2/H3/lists/quote/code/link/hr** and one-click Preview; reader highlights appear as read-only refs that jump back into the book |
| **📊 History** (`/history`) | A dashboard: five stat cards (watched / books / weekly active / finished / total hours) + a merged timeline of video **and** books (Today/Yesterday/Past 7 days/Earlier), filter tabs, resume/mark/remove |
| **⭐ Favorites** | Everything you've starred in the player |
| **📃 Playlists** | Queue videos to binge in order |
| **🔥 Missed** | Auto-collected hot list (recent movies/shows/books/games); unmarked by default — tap to cycle none→want→watching→done; auto-derived for titles you've actually watched |
| **⚽ Sports** | World Cup knockout rings (R32→Final), ESPN-synced every 60s, winners auto-advance; **gold/silver/bronze** placement rings; click a match to auto-match a stream |
| **📡 Live TV** | Embedded streams + local audio + live danmaku overlay, free-size PiP |
| **💬 Forum** | Reddit-style posts & comments, login-to-use |
| **🔍 Site-wide search** | The header Search button flies a panel out from its own position: media/books/pages, keyboard-first, with an Internet Archive hand-off for books |

## 🛡️ Permissions: The Head of Household Decides

- **Google one-tap login**; logged-out = a blank site (no tracking, no personalization)
- **Per-user section grants** (`/admin/users`): movies/series/anime/books/live/sports/missed/**musicals**/**notes** — tick per user, or open everything; give the kids anime and books, keep the rest for yourself
- Private vaults are boss-only with device-level password trust (verify once, good for a year)
- Progress, favorites, notes, history — fully isolated per user; **random-add and external-item management are admin-only**
- **User activity oversight** + **AI cost dashboard**: every DeepSeek call's tokens and cost, itemized by component

## 🚀 Lift-off

```bash
npm install
npm run build
npm start          # production mode, pick your port (e.g. next start -p 3024)
```

1. **Settings** (`/settings`): add a TMDB API key → scan your media directories, posters and synopses flow in
2. Put a DeepSeek key in `~/.config/deepseek-token` → the whole AI suite lights up
3. Drop music into `~/Music` → catalogue it in the admin panel → ambient reading music is ready
4. Grant sections to your family in `/admin/users` → everyone logs in, everyone sees their own world

> Databases, image caches, and keys all live in `data/` and system config directories — **never in git**. Your library is yours alone.

---

<div align="center">

*Built with obsession, for the living room.*

**O-Site** — turning "what should we watch tonight" into the happiest problem you have.

</div>
