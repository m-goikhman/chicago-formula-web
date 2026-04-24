# Teach Week Manifest (Hybrid Model)

This folder defines week sequencing and exercise composition.

## What lives where

- Week order and item order: `data/teach-manifest/weekN.json`
- Exercise text: `data/exercises/weekN/*.md`
- Story source: legacy week sections (`content.json` or markdown parser fallback)

## Manifest schema

Each week manifest is a JSON object:

- `id`: week id (`week1`, `week2`, ...)
- `title`: display title
- `order`: week order in selector
- `source`: optional source markdown file name
- `items`: ordered list of content blocks

Each `items[]` entry supports:

- `id` (required): stable section/exercise id
- `kind` (required): `story` or `exercise`
- `fromLegacySectionId` (story): reuse an existing parsed section by id
- `contentSource` (exercise): markdown file path (relative to `Teach/frontend/`)
- `heading`, `image`, `type`, `category`: explicit metadata
- `renderer` (optional): interactive renderer key (type-level UI mapping)

## Inserting an exercise between existing ones

1. Create a new markdown file in `data/exercises/weekN/`.
2. Add a new entry into `items` at the desired position.
3. Keep `id` stable; do not encode positions in ids.
4. If custom interaction is needed, set `renderer` and wire it in `ui.js`.

## Inserting a story block between existing story blocks

1. Create a markdown file in `data/stories/weekN/`.
2. Add a new `kind: "story"` item into `items` exactly where it should appear.
3. Use `contentSource` for the story text (and optional `image`).
4. Keep ids stable (`week1-part-2b`, `week1-bridge-scene-v1`, etc.).
