# Fokara

Fokara is a minimalist study planner: schedules with automatic pomodoro, daily tracking, study music, and a PDF reference library. All data stays in the browser (localStorage + IndexedDB). An optional Google login syncs your data across devices.

The interface is in English by default; switch to Bahasa Indonesia with the **EN/ID** button in the sidebar.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output in dist/
```

Add `?speed=60` to the URL to speed up the timer while testing (1 minute = 1 second).

## Features

- **Schedule**: set a duration (e.g. 3 hours) and a preset (25/5, 50/10, or custom). The focus/break split is calculated automatically and used by the timer as soon as the schedule starts.
- **Focus**: ring timer, segment timeline, optional PDF panel (can be minimized), wallpapers/live wallpapers (presets or your own image/GIF/video), and fullscreen. Opening a PDF switches to reading mode: the sidebar hides temporarily, the PDF takes about 3/4 of the screen, and the timer becomes compact. The timer can be dragged anywhere (double-click its title to reset). Shortcuts: `Space` pause, `N` skip, `M` music, `F` fullscreen, `[` sidebar.
- **Tracking**: focus minutes per day (logged live, so stopping early still counts), streak, 7-day chart, heatmap, per-subject totals, and a daily goal.
- **Music**: ambient sounds (rain, waves, noise), your own MP3 uploads, or saved YouTube videos/playlists. Can play automatically during focus and lower/pause during breaks.
- **Library**: drag & drop PDFs with cover thumbnails and a continuous-scroll reader (remembers the last page).

## Optional: Google login & sync

Signing in is optional. When it isn't configured, the account button is hidden and the app runs fully local. When you sign in, **schedules, tracking, settings, music preferences and saved YouTube links** sync through Supabase. PDFs, uploaded MP3s and wallpapers stay on each device.

1. Create a [Supabase](https://supabase.com) project and run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
2. In Google Cloud Console, create an OAuth Client ID (Web application) with the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase → Authentication → Providers → Google, enable it and enter the client ID and secret. Under Authentication → URL Configuration, add `http://localhost:5173` and your production URL to the redirect URLs.
4. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API).

Conflicts are resolved by last write wins. If a device with existing data signs in to an account that already has cloud data, you choose which copy to keep.

## Structure

```
src/
  main.js            router, shortcuts, theme, language toggle
  i18n.js            translations (English default, Bahasa Indonesia)
  store.js, db.js    localStorage + event bus, IndexedDB
  features/          account (login & sync), pomodoro, schedule, focus, tracking, today, music, library, pdfViewer, wallpaper, timePicker
  utils/             time, sound, fullscreen, sidebar
  styles/            base, layout, components
```
