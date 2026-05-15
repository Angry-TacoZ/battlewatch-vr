# Battlewatch VR

A small dual-mode Three.js experience: desktop monitor play plus a VR toggle via WebXR.

## Run locally

Install dependencies once:

```powershell
npm install
```

Then start the local dev server:

```powershell
npm run dev
```

Then open [http://127.0.0.1:5188](http://127.0.0.1:5188).

You do not need to host this on the public web. The demo runs locally on your machine through a localhost dev server.

## Controls

- `WASD`: move around the deck
- Hold left mouse: look around
- `Shift`: sprint
- `B`: binocular zoom
- `F`: fullscreen
- VR left stick: move while in headset
- `Enter VR`: switch into headset mode when WebXR is available

## Current slice

- HMS London as the primary ship model
- One large playable deck with desktop and VR locomotion
- Moonlit ocean, ship sway, and a procedural island coastline
- Distant shore bombardment, tracers, searchlights, and anti-air bursts
- Shared scene for desktop and VR

## Attribution

- `HMS London` by `philano`
- License shown by the source page: `CC Attribution`
- The creator must be credited if the demo is shared or published
