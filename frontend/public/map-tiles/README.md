# Map tiles

The map screen reads `{z}/{x}/{y}.png` from this folder. Nothing is shipped
with the project: the GTA V map is Rockstar's, and supplying it is the
operator's decision on their own self-hosted instance.

## Slicing your own image

One command, from `frontend/`:

```bash
npm run map:tiles -- ../gta5-map.png
```

That stretches the image to 8192×8192 and writes zoom levels 0 to 5 — 1365
tiles. A 8k source takes a couple of minutes.

Options:

```bash
npm run map:tiles -- map.png --format jpg --quality 82   # ~5x smaller
npm run map:tiles -- map.png --max-zoom 6                # sharper, 4x the tiles
npm run map:tiles -- map.png --out /some/other/dir
```

Change `--format` or `--max-zoom` and the script prints the two constants to
update in `src/lib/gta-map.ts`.

**Stretched, not padded.** The image is taken to cover the `WORLD` rectangle
corner to corner. Padding a non-square image to a square would surround the
world with an invisible margin, and every marker would then be off by an amount
written down nowhere.

`gdal2tiles.py --profile=raster --xyz -z 0-5` does the same job if you already
have GDAL, with that padding caveat.

## If markers land in the wrong place

`WORLD` in `src/lib/gta-map.ts` says which slice of the game world the image
covers. The defaults are what the commonly-used FiveM packs assume; they have
not been measured against any particular image.

Hover the map — the game coordinate under the cursor is printed in the
bottom-left corner. Compare against somewhere you know:

- Legion Square, about `195, -935`
- Airport control tower, about `-1035, -2735`

A constant offset means `minX` / `minY` are shifted. An error that grows the
further you go from the centre means the span between min and max is wrong.

## Using a ready-made pack

Community packs exist (search "gta v map leaflet tiles"). Check three things
before pointing the app at one:

1. **Extension** — many ship `.jpg` or `.webp`. Set `MAP_TILE_URL`.
2. **Top zoom level** — count the folders. Set `MAP_MAX_ZOOM`.
3. **Orientation** — if the map is upside down, the pack is TMS rather than
   XYZ. Either re-slice, or flip `y` in the tile URL.
