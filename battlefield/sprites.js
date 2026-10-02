// Procedural silhouettes for the two armies, drawn once into cached sprites.
// Shapes are designed in a 120×70 box, ground at y=0, facing right.

// Tapered leg with knee bend and hoof/paw; `sw` swings the lower leg for the gait.
function leg(p, x, top, w, sw, paw) {
  const b = paw ? w * 0.95 : w * 0.55;
  p.moveTo(x, top);
  p.lineTo(x + w, top);
  p.bezierCurveTo(x + w + 1, top * 0.55, x + w * 0.5 + b * 0.5 + sw, top * 0.3, x + w * 0.5 + b / 2 + sw, -2);
  if (paw) p.quadraticCurveTo(x + w * 0.5 + b / 2 + sw + 3, 0, x + w * 0.5 + b / 2 + sw - 1, 0);
  else p.lineTo(x + w * 0.5 + b / 2 + sw + 0.5, 0);
  p.lineTo(x + w * 0.5 - b / 2 + sw, 0);
  p.lineTo(x + w * 0.5 - b / 2 + sw, -2);
  p.bezierCurveTo(x + w * 0.5 - b * 0.5 + sw, top * 0.3, x - 1, top * 0.55, x, top);
  p.closePath();
}
function bullBody() {
  const p = new Path2D();
  // rump → long back rising into a heavy shoulder hump → thick neck → lowered head
  p.moveTo(12, -46);
  p.bezierCurveTo(26, -54, 46, -58, 62, -64);
  p.bezierCurveTo(72, -68, 82, -66, 88, -58);
  p.bezierCurveTo(92, -52, 96, -49, 101, -48);
  p.bezierCurveTo(107, -46, 113, -41, 117, -33);
  p.bezierCurveTo(119, -29, 116, -25, 111, -26);
  p.bezierCurveTo(105, -27, 99, -29, 94, -28);
  p.bezierCurveTo(90, -22, 85, -19, 78, -19);
  p.bezierCurveTo(64, -18, 50, -17, 38, -19);
  p.bezierCurveTo(26, -20, 16, -24, 12, -31);
  p.bezierCurveTo(9, -36, 9, -42, 12, -46);
  p.closePath();
  return p;
}
function bullLegs(frame) {
  const p = new Path2D();
  const sw = [0, 5, 0, -5][frame % 4];
  leg(p, 72, -26, 9, sw, false); leg(p, 62, -24, 8, -sw, false);
  leg(p, 24, -26, 10, -sw, false); leg(p, 14, -26, 9, sw, false);
  // tail
  p.moveTo(11, -44); p.bezierCurveTo(3, -42, 1, -33, 3, -24); p.lineTo(6, -25); p.bezierCurveTo(5, -32, 7, -38, 12, -41); p.closePath();
  return p;
}
function hornPath(offset = 0) {
  // forward-sweeping horn with a rising tip
  const p = new Path2D();
  p.moveTo(98 + offset, -49);
  p.bezierCurveTo(96 + offset, -60, 104 + offset, -69, 116 + offset, -70);
  p.bezierCurveTo(121 + offset, -70, 124 + offset, -67, 124 + offset, -64);
  p.bezierCurveTo(118 + offset, -66, 108 + offset, -62, 104 + offset, -47);
  p.closePath();
  return p;
}
function bearBody() {
  const p = new Path2D();
  // massive shoulder hump, low head, short snout
  p.moveTo(8, -34);
  p.bezierCurveTo(9, -48, 26, -56, 46, -58);
  p.bezierCurveTo(60, -66, 74, -67, 84, -59);
  p.bezierCurveTo(90, -53, 95, -49, 101, -47);
  p.bezierCurveTo(107, -48, 113, -45, 117, -39);
  p.bezierCurveTo(120, -35, 118, -31, 113, -31);
  p.bezierCurveTo(107, -30, 102, -30, 98, -28);
  p.bezierCurveTo(94, -22, 88, -19, 81, -19);
  p.lineTo(34, -19);
  p.bezierCurveTo(19, -19, 8, -24, 8, -34);
  p.closePath();
  p.moveTo(97, -49); p.arc(99, -51, 3.6, 0, Math.PI * 2); p.closePath();
  return p;
}
function bearLegs(frame) {
  const p = new Path2D();
  const sw = [0, 4, 0, -4][frame % 4];
  leg(p, 74, -24, 13, sw, true); leg(p, 62, -22, 12, -sw, true);
  leg(p, 24, -24, 13, -sw, true); leg(p, 12, -24, 12, sw, true);
  return p;
}

const PALETTE = {
  bull: { dark: '#0b3326', mid: '#1c7a58', light: '#3fd29a', rim: '#8ff5cc', eye: '#ffd27a', horn: ['#efe6cf', '#a99b78'] },
  bear: { dark: '#3a0f13', mid: '#a52f35', light: '#e8565b', rim: '#ffb3a6', eye: '#ffd27a' },
};

// Render one silhouette into an offscreen canvas of height `px`, with a haze
// level (0 = front, crisp; 1 = far, fogged toward the horizon colour).
function render(species, frame, px, haze, champion) {
  const s = px / 70;
  const w = Math.ceil(128 * s) + 8, h = Math.ceil(76 * s) + 8;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d');
  const P = PALETTE[species];
  g.translate(3, h - 3);
  g.scale(s, s);
  const body = species === 'bull' ? bullBody() : bearBody();
  const legs = species === 'bull' ? bullLegs(frame) : bearLegs(frame);
  const lg = g.createLinearGradient(0, -30, 0, 0);
  lg.addColorStop(0, P.mid); lg.addColorStop(1, P.dark);
  g.fillStyle = lg; g.fill(legs);
  const grad = g.createLinearGradient(0, -68, 0, -16);
  grad.addColorStop(0, P.light);
  grad.addColorStop(0.5, P.mid);
  grad.addColorStop(1, P.dark);
  if (champion) { g.shadowColor = P.light; g.shadowBlur = 8; }
  g.fillStyle = grad;
  g.fill(body);
  g.shadowBlur = 0;
  // rim light along the top edge of the body only
  g.save(); g.clip(body);
  g.strokeStyle = P.rim; g.globalAlpha = 0.5; g.lineWidth = (px > 30 ? 2.4 : 1.4) / s;
  g.translate(-1.2, 1.6); g.stroke(body);
  g.restore();
  if (species === 'bull') {
    const hg = g.createLinearGradient(97, -70, 119, -50);
    hg.addColorStop(0, P.horn[0]); hg.addColorStop(1, P.horn[1]);
    g.fillStyle = hg; g.globalAlpha = 0.6; g.fill(hornPath(-7)); g.globalAlpha = 1; g.fill(hornPath(0));
    g.fillStyle = P.eye; g.beginPath(); g.arc(106, -41, 1.5, 0, Math.PI * 2); g.fill();
  } else {
    g.fillStyle = P.eye; g.beginPath(); g.arc(108, -42, 1.4, 0, Math.PI * 2); g.fill();
  }
  if (haze > 0) {
    g.globalCompositeOperation = 'source-atop';
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `rgba(14, 24, 40, ${0.62 * haze})`;
    g.fillRect(0, 0, w, h);
  }
  return { img: c, w, h, ax: 3, ay: h - 3, s };
}

const SIZES = [8, 11, 14, 18, 23, 29, 37, 47, 60, 76, 96, 122, 154];
const HAZE = [0, 0.33, 0.66];
export class Sprites {
  constructor() { this.cache = new Map(); }
  get(species, frame, px, haze, champion = false) {
    let si = 0; while (si < SIZES.length - 1 && SIZES[si] < px) si++;
    const hi = haze < 0.2 ? 0 : haze < 0.55 ? 1 : 2;
    const key = `${species}${frame}${si}${hi}${champion ? 'c' : ''}`;
    let spr = this.cache.get(key);
    if (!spr) { spr = render(species, frame, SIZES[si], HAZE[hi], champion); this.cache.set(key, spr); }
    return { ...spr, scale: px / SIZES[si] };
  }
}
export { PALETTE };
