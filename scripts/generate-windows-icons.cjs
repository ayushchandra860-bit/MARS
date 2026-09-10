const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'resources', 'assets');
const outputFiles = ['app.ico', 'installer.ico', 'tray.ico'];
const sizes = [16, 24, 32, 48, 64, 128, 256];

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function setPixel(buffer, size, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  buffer[offset] = clamp(b);
  buffer[offset + 1] = clamp(g);
  buffer[offset + 2] = clamp(r);
  buffer[offset + 3] = clamp(a);
}

function blendPixel(buffer, size, x, y, r, g, b, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
  const offset = (y * size + x) * 4;
  const a = Math.max(0, Math.min(1, alpha));
  buffer[offset] = clamp(buffer[offset] * (1 - a) + b * a);
  buffer[offset + 1] = clamp(buffer[offset + 1] * (1 - a) + g * a);
  buffer[offset + 2] = clamp(buffer[offset + 2] * (1 - a) + r * a);
  buffer[offset + 3] = 255;
}

function drawLine(buffer, size, x0, y0, x1, y1, width, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.max(1, Math.hypot(dx, dy));
  const radius = width / 2;
  for (let step = 0; step <= Math.ceil(length); step += 0.5) {
    const t = step / length;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const minX = Math.floor(cx - radius - 1);
    const maxX = Math.ceil(cx + radius + 1);
    const minY = Math.floor(cy - radius - 1);
    const maxY = Math.ceil(cy + radius + 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (distance <= radius + 0.5) {
          blendPixel(buffer, size, x, y, color[0], color[1], color[2], Math.max(0, Math.min(1, radius + 0.5 - distance)));
        }
      }
    }
  }
}

function drawMARSIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const planetRadius = size * 0.29;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5 - center) / center;
      const ny = (y + 0.5 - center) / center;
      const edge = Math.max(Math.abs(nx), Math.abs(ny));
      const vignette = Math.max(0, 1 - Math.hypot(nx, ny) * 0.6);
      const base = edge > 0.9 ? 9 : 13;
      setPixel(pixels, size, x, y, base + vignette * 8, base + vignette * 10, base + vignette * 18);

      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const distance = Math.hypot(dx, dy);
      if (Math.abs(distance - size * 0.41) < Math.max(0.8, size * 0.007)) {
        blendPixel(pixels, size, x, y, 255, 87, 68, 0.35);
      }
      if (distance <= planetRadius) {
        const lightX = center - size * 0.09;
        const lightY = center - size * 0.1;
        const light = Math.max(0, 1 - Math.hypot(x + 0.5 - lightX, y + 0.5 - lightY) / (planetRadius * 1.5));
        const rim = Math.max(0, 1 - distance / planetRadius);
        setPixel(pixels, size, x, y, 135 + light * 115 + rim * 5, 16 + light * 66, 29 + light * 45);
      }
    }
  }

  const orange = [255, 149, 0];
  const cyan = [0, 242, 254];
  const lineWidth = Math.max(1, size * 0.025);
  drawLine(pixels, size, size * 0.25, center, size * 0.4, center, lineWidth, orange);
  drawLine(pixels, size, center, size * 0.25, center, size * 0.4, lineWidth, orange);
  drawLine(pixels, size, size * 0.6, center, size * 0.75, center, lineWidth, orange);
  drawLine(pixels, size, center, size * 0.6, center, size * 0.75, lineWidth, orange);
  drawLine(pixels, size, size * 0.25, size * 0.66, size * 0.4, size * 0.57, Math.max(1, size * 0.018), orange);
  drawLine(pixels, size, size * 0.4, size * 0.57, size * 0.55, size * 0.61, Math.max(1, size * 0.028), cyan);
  drawLine(pixels, size, size * 0.55, size * 0.61, size * 0.72, size * 0.37, Math.max(1, size * 0.028), cyan);

  return pixels;
}

function toBitmapDib(size) {
  const source = drawMARSIcon(size);
  const xorBytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    source.copy(xorBytes, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const andMask = Buffer.alloc(maskStride * size); // opaque mask
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND bitmap height
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xorBytes.length, 20);
  return Buffer.concat([header, xorBytes, andMask]);
}

function createIco() {
  const images = sizes.map(toBitmapDib);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map((image, index) => {
    const size = sizes[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

const icon = createIco();
for (const fileName of outputFiles) {
  fs.writeFileSync(path.join(outputDir, fileName), icon);
}
console.log(`Generated valid multi-resolution MARS ICO files (${sizes.join(', ')} px).`);
