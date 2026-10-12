// Local Canvas2D interpretation of the supplied silk/character preset.
// The reference supplies parameters, not GLSL; this field is procedural, not a photo.
type RGB = [number, number, number]
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const linear = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
const srgb = (n: number) => clamp(n <= .0031308 ? n * 12.92 : 1.055 * Math.max(0, n) ** (1 / 2.4) - .055)
function toLab([r, g, b]: RGB): RGB {
  r = linear(r / 255); g = linear(g / 255); b = linear(b / 255)
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b)
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b)
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b)
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s]
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3
  return [srgb(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s) * 255,
    srgb(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s) * 255,
    srgb(-.0041960863 * l - .7034186147 * m + 1.707614701 * s) * 255]
}
const palette = [[20, 11, 46], [60, 2, 164], [109, 74, 255], [60, 2, 164], [20, 11, 46]].map(c => toLab(c as RGB))
const colorTable = Array.from({ length: 256 }, (_, i) => {
  const position = i / 255 * 4, index = Math.min(3, Math.floor(position)), mix = position - index
  return fromLab(palette[index].map((v, k) => v + (palette[index + 1][k] - v) * mix) as RGB)
})

export function silkColor(x: number, y: number, time: number): RGB {
  const u = (x - .5) * 3.3, v = (y - .5) * 2.4, t = time * .6
  const drift = .06 * Math.sin(t * .3)
  const bend = .28 * Math.sin(u * 1.8 + t * .35) + .14 * Math.cos(v * 3.2 - u * .8 - t * .28)
  const wave = .5 + .5 * Math.sin((v + bend + drift) * 7 + u * 1.9 + t * .6 + Math.sin(u * 2.7 - t * .3) * .85)
  const color = colorTable[Math.round(clamp(wave) * 255)]
  const vignette = 1 - .35 * clamp(((x - .5) ** 2 + (y - .5) ** 2) * 2)
  const grain = (Math.sin(x * 127.1 + y * 311.7 + 7) * 43758.5453 % 1) * .025
  return color.map(c => clamp(c / 255 * vignette + grain) * 255) as RGB
}

export function createAsciiWave(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  const source = document.createElement('canvas')
  const sourceContext = source.getContext('2d', { willReadFrequently: true })
  const glyphs = document.createElement('canvas')
  const glyphContext = glyphs.getContext('2d')
  if (!context || !sourceContext || !glyphContext) return null
  const chars = ' .:-=+*#%@', cell = 12, samples = 3
  let width = 0, height = 0
  return (time: number) => {
    const rect = canvas.getBoundingClientRect()
    const w = Math.round(Math.min(1600, rect.width)), h = Math.round(Math.min(600, rect.height))
    if (!w || !h) return
    if (w !== width || h !== height) {
      width = w; height = h
      canvas.width = glyphs.width = w; canvas.height = glyphs.height = h
      source.width = Math.ceil(w / cell) * samples; source.height = Math.ceil(h / cell) * samples
    }
    // Rasterize at three samples per cell, then average all nine source pixels.
    // The reduced source resolution bounds CPU cost regardless of device pixel ratio.
    const pixels = sourceContext.createImageData(source.width, source.height)
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const color = silkColor(x / source.width, y / source.height, time)
      const offset = (y * source.width + x) * 4
      pixels.data.set([...color, 255], offset)
    }
    sourceContext.putImageData(pixels, 0, 0)
    glyphContext.clearRect(0, 0, w, h)
    glyphContext.textAlign = 'center'; glyphContext.textBaseline = 'middle'
    for (let row = 0; row < source.height / samples; row++) for (let col = 0; col < source.width / samples; col++) {
      const rgb: RGB = [0, 0, 0]
      for (let dy = 0; dy < samples; dy++) for (let dx = 0; dx < samples; dx++) {
        const offset = ((row * samples + dy) * source.width + col * samples + dx) * 4
        rgb.forEach((_, channel) => { rgb[channel] += pixels.data[offset + channel] / 9 })
      }
      const luminance = (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]) / 255
      // brightness 90, contrast 30, saturation 100, grayscale 0;
      // multiply tint #6D4AFF at 25%. Coverage 100, density 50, identity tone curve.
      const tint = [109, 74, 255]
      const adjusted = rgb.map((c, i) => clamp((c / 255 * .9 - .5) * 1.3 + .5) * (.75 + .25 * tint[i] / 255) * 255)
      glyphContext.fillStyle = `rgb(${adjusted.join(',')})`
      glyphContext.font = `${9 + luminance * 5}px monospace`
      glyphContext.fillText(chars[Math.min(chars.length - 1, Math.floor(luminance * 2.5 * (chars.length - 1)))], col * cell + 6, row * cell + 6)
    }
    context.fillStyle = '#0a0e1a'; context.fillRect(0, 0, w, h)
    // The selected background is solid; source blur/opacity are inactive in this mode.
    // Bloom 20, then a crisp source-over character layer. Other post-effects are off.
    context.save(); context.filter = 'blur(8px)'; context.globalAlpha = .2
    context.drawImage(glyphs, 0, 0); context.restore()
    context.drawImage(glyphs, 0, 0)
  }
}
