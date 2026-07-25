# Battlewatch VR Handoff

## Current Status

Battlewatch is a local Three.js/WebXR prototype built around the HMS London asset. It has been pivoted into an early WW2 horde-survival game: enemy assault boats launch from the island beach, cross the water, and damage the ship if they reach it. Desktop and VR input paths remain in place.

## Repository

- GitHub: https://github.com/Angry-TacoZ/battlewatch-vr
- Visibility: public
- Default branch: `master`
- Local remote: `origin` tracks `https://github.com/Angry-TacoZ/battlewatch-vr.git`
- Local server: `npm run dev`, then `http://127.0.0.1:5188`

## Implemented

- HMS London GLB scene with ocean, island, moonlight, bombardment effects, and audio.
- Desktop movement/look, VR button, VR left-stick movement, and VR trigger firing path.
- Mesh-driven ship deck collision with narrow walkway and superstructure checks.
- Survival HUD with wave, score, contacts, hull integrity, crosshair, and status banner.
- Wave director, pooled assault boats, beach launch leg, shooting, hit effects, score, hull damage, and restart with `R`.
- `window.render_game_to_text()` and `window.__battlewatchDebug` hooks for browser verification.

## Verification

The local browser checks confirmed the scene boots, the HUD updates, enemies spawn, and firing/hit state changes. Headless WebGL may emit context-reset/readback warnings during screenshots; no new hard runtime error was observed in the survival pass.

## Next Task

Choose a deliberate combat spawn/view lane that gives the player a clear view of the beach launches. Then retune enemy route endpoints and verify the full first-wave loop from the actual default spawn.

## Risks

- The inherited ship geometry makes some candidate combat viewpoints face bulkheads or turrets.
- The project currently uses a hand-built combat boat proxy rather than a detailed enemy asset.
- WebXR still depends on a real headset/browser runtime; headless browser checks cannot validate immersive VR.
