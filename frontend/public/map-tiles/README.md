# Map tiles

Drop the GTA V tile pyramid here, as `{z}/{x}/{y}.png`:

```
map-tiles/
  0/0/0.png
  1/0/0.png  1/0/1.png  1/1/0.png  1/1/1.png
  ...
  5/…
```

The map expects 256px tiles and zoom levels 0 to 5 — 8192×8192 at native
size. Both numbers live in `frontend/src/lib/gta-map.ts` (`MAP_TILE_SIZE`,
`MAP_MAX_ZOOM`); change them there if your pack differs.

**No imagery is shipped with this project.** The GTA V map is Rockstar's, and
supplying it is the operator's decision on their own self-hosted instance.

## If pins land in the wrong place

`WORLD` in `gta-map.ts` says which slice of the game world the image covers.
The defaults are what the commonly-used FiveM packs assume and have not been
measured against any particular pyramid.

To correct them: hover the map and read the coordinate in the bottom-left
corner, then compare against a place whose real coordinates you know.

- Legion Square is about `195, -935`
- The airport control tower is about `-1035, -2735`

A constant offset means `minX`/`minY` are shifted. An error that grows the
further you get from the centre means the span between min and max is wrong.
