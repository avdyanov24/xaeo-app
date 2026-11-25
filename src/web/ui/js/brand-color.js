// Agency colour -> readable report tokens. The raw colour stays where it is decoration (the band); text, fills behind
// text and data graphics get a same-hue shade that passes WCAG 2.2. Darkening scales R, G and B by one factor k
// (keeps hue and saturation), binary-searched to the lightest shade that meets the target contrast.
// Imported by the white-label report: this file must never name the product.
const lin = (v) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');
export const luminance = (h) => {
  const [r, g, b] = rgb(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const toHex = (c) =>
  '#' +
  c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();
export function darkenTo(h, bg, min) {
  if (contrast(h, bg) >= min) return h.toUpperCase();
  const c = rgb(h);
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 24; i++) {
    const k = (lo + hi) / 2;
    if (contrast(toHex(c.map((v) => v * k)), bg) >= min) lo = k;
    else hi = k;
  }
  let k = lo,
    out = toHex(c.map((v) => v * k));
  while (contrast(out, bg) < min && k > 0) {
    k -= 1 / 255;
    out = toHex(c.map((v) => v * k));
  } // rounding guard
  return out;
}
export function brandTokens(color) {
  const brand = isHex(color) ? color.toUpperCase() : '#1F3BFF';
  const ink = darkenTo(brand, '#FFFFFF', 4.5); // text on white
  const graphic = darkenTo(brand, '#EEF1FF', 3); // bars, line, dots on the mist track
  const onWhite = contrast(brand, '#FFFFFF') >= 4.5,
    onInk = contrast(brand, '#0A0F33') >= 4.5;
  // Fill behind text: the raw colour when white or ink reads on it; otherwise the darkened shade with white text.
  const fill = onWhite || onInk ? brand : ink;
  const on = onWhite ? '#FFFFFF' : onInk ? '#0A0F33' : '#FFFFFF';
  return {
    brand,
    ink,
    graphic,
    fill,
    on,
    ratio: Math.round(contrast(brand, '#FFFFFF') * 10) / 10,
    corrected: ink !== brand,
  };
}
