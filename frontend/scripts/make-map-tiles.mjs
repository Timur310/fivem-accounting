// Slice one high-resolution GTA V map image into the tile pyramid the map
// screen expects: public/map-tiles/{z}/{x}/{y}.<ext>
//
//   node scripts/make-map-tiles.mjs ../gta5-map.png
//   node scripts/make-map-tiles.mjs map.png --format jpg --quality 82
//   node scripts/make-map-tiles.mjs map.png --max-zoom 6
//   node scripts/make-map-tiles.mjs satellite.png --theme satellite
//
// Without --theme the pyramid goes to public/map-tiles/{z}/{x}/{y}, which is
// where the first one lives. With it, to public/map-tiles/<theme>/{z}/{x}/{y},
// so several styles sit side by side and the map can switch between them.
//
// The image is stretched to a square of 256 * 2^maxZoom pixels, and that
// square is taken to cover exactly the WORLD rectangle in src/lib/gta-map.ts.
// Stretching rather than padding is deliberate: padding puts an unknown margin
// of empty pixels around the world, and every marker is then offset by an
// amount nobody has written down. A stretch keeps the mapping stated in one
// place — the image is the world, corner to corner.
//
// gdal2tiles does the same job, but needs GDAL installed, and its
// `--profile=raster` pads to a power of two, which is the offset problem
// above. This uses sharp, which is one npm install and behaves the same on
// Windows as on Linux.
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const TILE_SIZE = 256;

function parseArgs(argv) {
  const [input, ...rest] = argv;
  const options = { input, format: 'png', quality: 90, maxZoom: 5, out: null, theme: null };

  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (key === '--format') options.format = value;
    else if (key === '--quality') options.quality = Number(value);
    else if (key === '--max-zoom') options.maxZoom = Number(value);
    else if (key === '--out') options.out = value;
    else if (key === '--theme') options.theme = value;
    else {
      console.error(`Unknown option: ${key}`);
      process.exit(1);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (!options.input) {
  console.error('Usage: node scripts/make-map-tiles.mjs <image> [--theme name] [--format png|jpg|webp] [--quality 90] [--max-zoom 5] [--out dir]');
  process.exit(1);
}
if (!existsSync(options.input)) {
  console.error(`No such file: ${options.input}`);
  process.exit(1);
}
if (!['png', 'jpg', 'jpeg', 'webp'].includes(options.format)) {
  console.error(`Unsupported format: ${options.format}`);
  process.exit(1);
}
if (!Number.isInteger(options.maxZoom) || options.maxZoom < 0 || options.maxZoom > 8) {
  console.error('--max-zoom must be a whole number between 0 and 8');
  process.exit(1);
}

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('This script needs sharp:  npm install --save-dev sharp');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
if (options.theme && !/^[a-z0-9-]+$/.test(options.theme)) {
  console.error('--theme must be lowercase letters, digits and dashes — it becomes a folder and a URL');
  process.exit(1);
}

const outRoot = options.out
  ? resolve(options.out)
  : join(here, '..', 'public', 'map-tiles', ...(options.theme ? [options.theme] : []));

const ext = options.format === 'jpeg' ? 'jpg' : options.format;
const nativeSize = TILE_SIZE * 2 ** options.maxZoom;

const meta = await sharp(options.input).metadata();
console.log(`[tiles] source  ${meta.width}x${meta.height}`);
console.log(`[tiles] native  ${nativeSize}x${nativeSize}  (zoom 0-${options.maxZoom})`);
console.log(`[tiles] output  ${outRoot}`);

if (meta.width !== meta.height) {
  console.log(
    `[tiles] note: the source is not square, so it is being stretched. If markers\n` +
    `        land consistently off after this, that stretch is why — correct WORLD\n` +
    `        in src/lib/gta-map.ts rather than re-slicing.`,
  );
}

function encode(pipeline) {
  if (ext === 'jpg') return pipeline.jpeg({ quality: options.quality });
  if (ext === 'webp') return pipeline.webp({ quality: options.quality });
  // PNG ignores quality; compressionLevel is the knob that matters.
  return pipeline.png({ compressionLevel: 9 });
}

let written = 0;

for (let z = 0; z <= options.maxZoom; z += 1) {
  const levelSize = TILE_SIZE * 2 ** z;
  const tilesPerSide = 2 ** z;

  // The whole level is rendered once to a temporary file, then cut up. Doing
  // the resize per tile would redo it for every tile on the level — 1024 times
  // over at zoom 5.
  const levelFile = join(tmpdir(), `gta-map-level-${z}-${process.pid}.png`);
  await sharp(options.input)
    .resize(levelSize, levelSize, { fit: 'fill' })
    .png({ compressionLevel: 1 })
    .toFile(levelFile);

  for (let x = 0; x < tilesPerSide; x += 1) {
    mkdirSync(join(outRoot, String(z), String(x)), { recursive: true });

    for (let y = 0; y < tilesPerSide; y += 1) {
      await encode(
        sharp(levelFile).extract({
          left: x * TILE_SIZE,
          top: y * TILE_SIZE,
          width: TILE_SIZE,
          height: TILE_SIZE,
        }),
      ).toFile(join(outRoot, String(z), String(x), `${y}.${ext}`));
      written += 1;
    }
  }

  console.log(`[tiles] zoom ${z}: ${tilesPerSide * tilesPerSide} tiles`);
}

console.log(`[tiles] done — ${written} tiles`);

const urlPath = options.theme
  ? `/map-tiles/${options.theme}/{z}/{x}/{y}.${ext}`
  : `/map-tiles/{z}/{x}/{y}.${ext}`;

if (options.theme) {
  console.log('');
  console.log('Add this to MAP_THEMES in src/lib/gta-map.ts:');
  console.log('');
  console.log('  {');
  console.log(`    id: '${options.theme}',`);
  console.log(`    label: '${options.theme[0].toUpperCase()}${options.theme.slice(1)}',`);
  console.log(`    url: '${urlPath}',`);
  console.log(`    maxNativeZoom: ${options.maxZoom},`);
  console.log('  },');
} else if (ext !== 'png' || options.maxZoom !== 5) {
  console.log('');
  console.log('Update the first entry of MAP_THEMES in src/lib/gta-map.ts:');
  if (ext !== 'png') console.log(`  url: '${urlPath}'`);
  if (options.maxZoom !== 5) console.log(`  maxNativeZoom: ${options.maxZoom}`);
}
