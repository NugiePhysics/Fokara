# Fokara

Fokara is a minimalist study planner: schedules with automatic pomodoro, daily tracking, study music, and a PDF reference library. All data stays in the browser (localStorage + IndexedDB) — no backend.

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

## Structure

```
src/
  main.js            router, shortcuts, theme, language toggle
  i18n.js            translations (English default, Bahasa Indonesia)
  store.js, db.js    localStorage + event bus, IndexedDB
  features/          pomodoro, schedule, focus, tracking, today, music, library, pdfViewer, wallpaper, timePicker
  utils/             time, sound, fullscreen, sidebar
  styles/            base, layout, components
```
