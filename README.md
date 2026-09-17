# The Chamber — Procedural Wizard's Chess

A self-contained, cinematic 3D wizard's chess board built with React, Vite, React Three Fiber, Three.js, Rapier, GSAP, and chess.js. The board is inspired by gothic underground wizard's chess without relying on downloaded models, textures, fonts, or audio files.

## Run it

```bash
npm install
npm run dev
```

The Vite server binds to `0.0.0.0` for hosted previews. A production build is available with `npm run build`.

## What is included

- **Procedural Lewis-inspired stone pieces** — six compound piece archetypes with a flat-chiseled custom MeshStandardMaterial. World-space fractal noise adds pitting, moss-dark crevices, and micro-dust to every primitive.
- **Playable chess rules** — chess.js owns legal move validation, turns, checks, checkmate, castling, en passant, and automatic queen promotion. Click a piece and a glowing destination, or drag a piece across the board.
- **Combat choreography** — captures run through an explicit director state, with a delayed impact, camera dolly, camera shake, attacker strike, dust/spark burst, procedural Rapier rigid-body shards, and a temporary rubble field.
- **Cinematic chamber** — torch flicker, cool rim light, fog, ambient motes, depth of field, bloom, vignette, chromatic aberration, film noise, and a gothic HUD with algebraic move log.
- **Zero asset dependency** — audio is synthesized with Web Audio API; all geometry and particles are generated in code. A future production GLB swap can happen at the `PieceModel` boundary.
- **Adaptive renderer hook** — `src/engine/renderer.ts` tries `WebGPURenderer` where the browser exposes a usable adapter and falls back to `WebGLRenderer` without changing scene code.

## Controls

- Click or drag a piece, then choose a glowing legal square.
- `R` resets the chamber.
- `S` toggles procedural sound.
- The Codex button opens the in-world rules note.

## Architecture

```text
src/
├── components/
│   ├── AudioController.ts
│   ├── CameraDirector.tsx
│   ├── ChessBoard.tsx
│   ├── ChessPieceActor.tsx
│   ├── CombatDirector.tsx
│   ├── FracturedPiece.tsx
│   ├── Particles.tsx
│   └── ProceduralChessPieces.tsx
├── engine/renderer.ts
├── hooks/useWizardChess.ts
├── styles/hud.module.css
└── App.tsx
```
