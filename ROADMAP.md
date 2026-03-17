# PixelTap Roadmap

## v1.0 — Done
- [x] Freemium model (50 Stars PRO pack)
- [x] Promo codes system
- [x] Template library (14 free starter templates)
- [x] Gallery: save/load multiple projects
- [x] PWA support (installable)
- [x] Photo reference (scale + drag/move)
- [x] Collapsible animation timeline
- [x] CloudStorage PRO sync (cross-device)
- [x] Toolbar overflow → "..." more menu

## v1.1 — Distribution (in progress)
- [x] FindMini.app submission
- [x] Android TWA app built (Google Play package ready, 2026-03-15)
- [ ] BotFather media preview (videos/screenshots)
- [ ] TG channel @pixeltap_app for updates
- [ ] Posts in Mini Apps / pixel art channels
- [ ] Promo code giveaways for first users
- [ ] Deploy .well-known/assetlinks.json for TWA verification

## v1.2 — Import & Frame Decomposition
- [ ] GIF import → auto-decompose into timeline frames, map delays to animation timing
- [ ] Video import (MP4/WebM) → extract frames at selectable FPS (8, 12, 15, 24)
  - Workflow: shoot reference video -> get pixel art frame sequence (Mortal Kombat sprite style)
  - Frame limit / duration cap, preview before committing
- [ ] Downscale imported media to canvas size (nearest neighbor for pixel-art look)
- [ ] Photo → pixel art converter (pixelize photo into editable pixels)
- [ ] Photo → pixel outline tracing (extract contours as pixel lines)
- [ ] Export as Telegram sticker
- [ ] Multilingual UI (RU/EN)

## v1.3 — Smart Animation & AI
- [ ] Auto-animation presets: breathing, idle bounce, walk cycle from single keyframe
- [ ] Auto in-between frame generation from 2-3 keyframes
- [ ] AI-powered sprite animation (generate sprite sheet from single pose)
- [ ] Character rigging for pixel art (simple skeleton -> auto-animate)
- [ ] Animation presets library (walk, run, jump, attack, idle)
- [ ] AI pixel art generation from text prompts
- [ ] Style transfer: photo -> pixel art
- [ ] Auto-palette suggestions, smart fill, auto-shading

## v1.4 — Monetization via content packs
- [ ] PRO template packs: Fantasy Creatures, Retro Game Heroes, Emoji Pack etc.
- [ ] Animated templates (sprite animations: run, jump, attack)
- [ ] Each pack 15-25 Stars

## v2.0 — IsoTap (Iso3D Pixel Art Editor)
- [ ] Isometric 3D voxel canvas — draw pixel art in 3D space
- [ ] Layer-by-layer voxel editing (building blocks style)
- [ ] Auto cube faces, light/shadow
- [ ] Rotate, zoom isometric view
- [ ] Export isometric renders as 2D sprite sheets
- [ ] 3D print pipeline:
  - Export as STL/OBJ
  - Preview print dimensions and scale
  - Color mapping for multi-color printers
  - Direct send to printer services or local printer apps
  - All from phone/iPad — no desktop needed
- [ ] Cross-promo from PixelTap

## Separate products
- [ ] PNG converter tool — finish and sell (Gumroad/LemonSqueezy)

## Infrastructure
- Admin secret: change ADMIN_SECRET env var on Railway
- Promo codes: in-memory (resets on redeploy), upgrade to file/DB later
- Backend: pixeltap-bot on Railway
- Frontend: GitHub Pages (yuga1000/pixeltap)
- Android: TWA package (io.github.yuga1000.twa), signing keystore stored in Google Play package zip
