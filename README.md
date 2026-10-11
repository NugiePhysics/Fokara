# Fokara

Fokara adalah study planner minimalis: jadwal belajar dengan pomodoro otomatis, tracking harian, musik belajar, dan library referensi PDF. Semua data tersimpan di browser (localStorage + IndexedDB), tanpa backend.

## Menjalankan

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # hasil di dist/
```

Tambahkan `?speed=60` di URL untuk mempercepat timer saat testing (1 menit = 1 detik).

## Fitur

- **Jadwal**: tentukan durasi (mis. 3 jam) dan preset (25/5, 50/10, atau custom). Pembagian sesi fokus/istirahat dihitung otomatis dan langsung dipakai timer saat jadwal dimulai.
- **Focus**: ring timer, timeline segmen, panel PDF opsional (bisa diminimize), wallpaper/live wallpaper (preset atau upload gambar/GIF/video), dan layar penuh. Shortcut: `Space` jeda, `N` lewati, `M` musik, `F` layar penuh, `[` sidebar. Saat PDF dibuka, Focus masuk mode baca: sidebar disembunyikan sementara, PDF melebar ±3/4 layar, dan timer jadi ringkas. Timer bisa digeser ke mana saja (klik dua kali judulnya untuk reset posisi).
- **Tracking**: menit fokus per hari, streak, grafik 7 hari, heatmap, dan rincian per mata pelajaran.
- **Musik**: suara ambient (hujan, ombak, noise), upload MP3 sendiri, atau YouTube. Bisa otomatis diputar saat fokus dan dikecilkan/dijeda saat istirahat.
- **Library**: upload PDF lewat drag & drop dan baca langsung di website (halaman terakhir diingat).

## Struktur

```
src/
  main.js            router & shortcut
  store.js, db.js    localStorage + event bus, IndexedDB
  features/          pomodoro, schedule, focus, tracking, today, music, library, pdfViewer, wallpaper
  styles/            base, layout, components
```
