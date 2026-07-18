<div align="center">

<img src="public/logo/circle.png" width="96" alt="O-Site" />

# O-Site

**Your family's private streaming empire.**

Movies, series, anime, musicals, books, live TV, sports. Whatever you want to watch, it's already there.

*One server, one domain, the entire entertainment universe for your household.*

<img src="public/fable-5-verified.png" height="40" alt="Fable 5 Verified" />

`Next.js 15` · `React 19` · `Tailwind v4` · `SQLite` · `WebGL` · `Edge TTS` · `DeepSeek`

[中文](README.md) | **English**

</div>

---

Most self-hosted media solutions are a file list with a play button. O-Site aims for something else: the big-streaming-service experience on your own hardware, plus a few things the big services don't do. Like an AI that remembers which page of which book you're on, or strings that fade in when your novel turns suspenseful.

Feature docs are in Chinese with full screenshots for every component; the pictures speak for themselves.

## 🏠 Home

[![Home](docs/shots/home.png)](docs/features/home.md)

A foyer that knows you: a Murakami-voiced AI greeting, an Everyday Different banner with a fresh themed channel daily, trending lists, and one-tap resume cards.

**[→ Home in detail](docs/features/home.md)**

## 🎞️ Library

[![Library](docs/shots/category.png)](docs/features/library.md)

TMDB auto-scraping, cinematic detail pages, an HLS player. Content you don't own can be added by admins via taste quiz or keyword search, becoming jump-to-platform entries.

**[→ Library in detail](docs/features/library.md)**

## 📚 Reader

[![Reader](docs/shots/reader.png)](docs/features/reader.md)

An AI that finishes the book with you: story thermometer, ambient music, multi-voice narration, spoiler-proof Q&A, character graphs, focus mode. EPUB, PDF, Markdown.

**[→ Reader in detail](docs/features/reader.md)**

## 🌐 Fetch Out As We Can

[![Fetch out](docs/shots/fetchout.png)](docs/features/fetch-out.md)

Don't have it locally? We find it: an eight-direction popover shows the synopsis first and platforms second, and Bilibili content plays inside the site with login, high quality, and progress tracking.

**[→ Fetch Out in detail](docs/features/fetch-out.md)**

## 🎭 Musicals

[![Musicals](docs/shots/musical.png)](docs/features/musical.md)

48 curated Broadway and West End classics (Hamilton, Phantom, Les Mis included), rotating daily, one click to pro-shot platforms.

**[→ Musicals in detail](docs/features/musical.md)**

## ✨ Living quarters

[![Notes](docs/shots/notes.png)](docs/features/living.md)

Notes (iPad-Notes looks, Markdown core), a history dashboard, a catch-up list, World Cup knockout rings, live TV, a forum, and site-wide search.

**[→ Living quarters in detail](docs/features/living.md)**

## 🛡️ Permissions

Google one-tap login; the boss grants sections per user. Give the kids anime and books, keep the rest for yourself. Progress, favorites and notes are fully isolated per user.

**[→ Permissions in detail](docs/features/permissions.md)**

## 🚀 Lift-off

```bash
npm install
npm run build
npm start          # production mode, pick your port (e.g. next start -p 3024)
```

1. Add a TMDB API key in Settings; scan your media directories and posters flow in
2. Put a DeepSeek key in `~/.config/deepseek-token`; the whole AI suite lights up
3. Drop music into `~/Music`, catalogue once, and ambient reading music is ready
4. Grant sections to your family in `/admin/users`; everyone sees their own world

> Databases, image caches and keys live in `data/` and system config directories, never in git. Your library is yours alone.

---

<div align="center">

*Built with obsession, for the living room.*

**O-Site**. Turning "what should we watch tonight" into the happiest problem you have.

<sub>License: [CC BY-NC 4.0](LICENSE) · free to share and adapt, no commercial use</sub>

</div>
