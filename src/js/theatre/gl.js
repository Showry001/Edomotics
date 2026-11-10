// The home theatre, mixed live. Like the bedroom (room/gl.js), each light group is a picture of
// the room lit by that group alone, rendered in Blender (scripts/theatre/), and the shader adds
// them up with the current weights before grading once (exposure, white balance, AgX).
//
// The screen is a roller in a ceiling slot, and the camera is square to it, so on the picture it is
// a rectangle. Dropping it shows the screen-down render inside that rectangle, slid up with the
// cloth so the bar leads the way down. Once it's down, the projector's light is one more layer:
// the cloth glows with whatever it shows (a film frame, the pre-show card) and the room takes the
// picture's average colour.
//
// Pictures are stored 8-bit with a curve: e = (kv / (kv + 1))^(1/2.2), so v = x / (1 - x) / k.

const VERT = `#version 300 es
in vec2 aPos;
uniform vec4 uView;           // the part of the room on screen, in room pixels: x0, y0, x1, y1
out vec2 vRoom;
void main() {
  vec2 t = aPos * 0.5 + 0.5;
  vRoom = vec2(mix(uView.x, uView.z, t.x), mix(uView.w, uView.y, t.y));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uUp, uDown;
uniform sampler2D uScreen, uPic;
uniform vec2 uSize;
uniform vec3 uW[5];
uniform float uK[11];         // screen up 0-4, screen down 5-9, the projector's light 10
uniform vec4 uCrop;           // where the screen-down layers sit: x, y, w, h
uniform vec4 uCloth;          // x0, the slot, x1, the bar's underside when down
uniform vec4 uPicRect;        // the picture: x0, y0, x1, y1
uniform float uS;             // how far down the screen is, 0-1
uniform float uProj;          // the projector's light, 0-1
uniform float uPicMix;        // 0: a black raster (warming up), 1: the picture
uniform float uPicLod;        // the mip level that holds the picture's average
uniform float uDownReady;
uniform float uEV;
uniform vec3 uBal;
in vec2 vRoom;
out vec4 outColor;

const vec3 BLACK = vec3(0.004, 0.0045, 0.006);   // what a projector shows when it shows nothing

vec3 dec(vec3 e, float k) { vec3 x = pow(e, vec3(2.2)); return x / max(1.0 - x, vec3(1e-4)) / k; }
vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// The stars are single bright points: averaged before decoding (as mipmaps do) they all but vanish,
// so that layer is decoded first and averaged over the pixel's footprint, four taps.
vec3 stars(vec2 p) {
  vec2 d = vec2(abs(dFdx(p.x)), abs(dFdy(p.y))) * 0.25;
  vec3 s = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 || i == 2 ? -d.x : d.x, i < 2 ? -d.y : d.y);
    s += dec(textureLod(uUp, vec3((p + o) / uSize, 3.0), 0.0).rgb, uK[3]);
  }
  return s * 0.25;
}
vec3 up(vec2 p) {
  vec2 uv = p / uSize;
  vec3 c = uW[3] * stars(p);
  for (int g = 0; g < 5; g++) if (g != 3) c += uW[g] * dec(texture(uUp, vec3(uv, float(g))).rgb, uK[g]);
  return c;
}
vec3 down(vec2 p) {
  vec2 uv = clamp((p - uCrop.xy) / uCrop.zw, vec2(0.0), vec2(1.0));
  vec3 c = vec3(0.0);
  for (int g = 0; g < 5; g++) c += uW[g] * dec(texture(uDown, vec3(uv, float(g))).rgb, uK[g + 5]);
  return c;
}
float edge(float a, float x) { return clamp(x - a + 0.5, 0.0, 1.0); }      // 0 before a, 1 after (1px soft)

vec3 agx(vec3 v) {
  const mat3 M = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 MI = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float lo = -12.47393, hi = 4.026069;
  vec3 x = clamp(log2(max(M * v, vec3(1e-10))), lo, hi);
  x = (x - lo) / (hi - lo);
  vec3 x2 = x * x, x4 = x2 * x2;
  x = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return clamp(MI * x, 0.0, 1.0);
}

void main() {
  vec2 p = vRoom;
  vec3 col = up(p);

  vec2 local = (p - uCrop.xy) / uCrop.zw;
  if (uS > 0.0 && uDownReady > 0.0 && all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0)))) {
    vec2 e = 10.0 / uCrop.zw;
    vec2 f2 = smoothstep(vec2(0.0), e, local) * smoothstep(vec2(0.0), e, 1.0 - local);
    float feather = f2.x * f2.y;
    vec3 dn = down(p);
    float hem = mix(uCloth.y, uCloth.w, uS);                       // the bar's underside, now
    float inX = edge(uCloth.x, p.x) * (1.0 - edge(uCloth.z, p.x));  // the cloth's columns
    float onCloth = edge(uCloth.y, p.y) * (1.0 - edge(hem, p.y));   // between the slot and the bar
    vec3 cloth = down(p + vec2(0.0, uCloth.w - hem));               // the cloth travels with the bar
    vec3 around = mix(col, dn, uS * feather);                       // the room takes the screen's light as it comes
    vec3 below = mix(col, dn, uS * feather * edge(uCloth.w, p.y));  // under the bar's last place
    col = mix(around, mix(below, cloth, onCloth), inX);
  }

  if (uProj > 0.0) {
    vec3 glow = dec(texture(uScreen, p / uSize).rgb, uK[10]);
    vec2 pl = (p - uPicRect.xy) / (uPicRect.zw - uPicRect.xy);
    float inPic = edge(uPicRect.x, p.x) * (1.0 - edge(uPicRect.z, p.x)) * edge(uPicRect.y, p.y) * (1.0 - edge(uPicRect.w, p.y));
    vec3 pic = lin(texture(uPic, clamp(pl, 0.0, 1.0)).rgb);
    vec3 avg = lin(textureLod(uPic, vec2(0.5), uPicLod).rgb);
    vec3 raster = mix(BLACK, pic, uPicMix), rasterAvg = mix(BLACK, avg, uPicMix);
    col += glow * mix(rasterAvg, raster, inPic) * uProj;
  }

  vec3 c = agx(col * exp2(uEV) * uBal);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(c + (n - 0.5) / 255.0, 1.0);
}`;

async function bitmap(url, signal, raw = true) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  // Layers are data: no colour management, no premultiplying. Pictures (card, film) are sRGB.
  return createImageBitmap(blob, raw
    ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' }
    : { premultiplyAlpha: 'none', imageOrientation: 'none' });
}

/**
 * Draws one framing of the theatre into `canvas`.
 * set: the framing's entry in media-theatre.json; base: where its files are served from.
 * Returns { ready (screen-up room loaded), moves (screen-down layers loaded), picture(source),
 * draw(state), resize(), dispose() }.
 */
export function createTheatreGL(canvas, set, base, onLost) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  const abort = new AbortController();
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; onLost?.(); }, { once: true });

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(prog, k))) });

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  const params = (target, mips) => {
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const levels = (w, h) => Math.floor(Math.log2(Math.max(w, h))) + 1;
  const array = (unit, w, h, layers, mips) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mips ? levels(w, h) : 1, gl.RGBA8, w, h, layers);
    params(gl.TEXTURE_2D_ARRAY, mips);
    return t;
  };
  const flat = (unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    params(gl.TEXTURE_2D, false);
    return t;
  };
  const fill = async (unit, tex, files, mips) => {
    const imgs = await Promise.all(files.map((f) => bitmap(base + f, abort.signal)));
    if (lost || abort.signal.aborted) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    imgs.forEach((img, i) => { gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, img.width, img.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, img); img.close(); });
    if (mips) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  };

  const [W, H] = set.size;
  const up = array(0, W, H, 5, true);
  const down = array(1, set.crop[2], set.crop[3], 5, false);
  const glow = flat(2);
  const pic = flat(3);
  gl.uniform1i(U.uUp, 0);
  gl.uniform1i(U.uDown, 1);
  gl.uniform1i(U.uScreen, 2);
  gl.uniform1i(U.uPic, 3);
  gl.uniform2f(U.uSize, W, H);
  gl.uniform1fv(U.uK, set.k);
  gl.uniform4f(U.uCrop, ...set.crop);
  gl.uniform4f(U.uCloth, ...set.cloth);
  gl.uniform4f(U.uPicRect, ...set.picture);
  gl.uniform1f(U.uDownReady, 0);

  let movesReady = false;
  const ready = fill(0, up, set.up, true);
  // The screen-down layers follow once the room itself is on screen.
  const moves = ready.then(() => Promise.all([
    fill(1, down, set.down, false),
    bitmap(base + set.screen, abort.signal).then((img) => {
      if (lost || abort.signal.aborted) return;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, glow);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      img.close();
    }),
  ])).then(() => { movesReady = true; gl.uniform1f(U.uDownReady, 1); });
  moves.catch(() => {});

  // What the projector shows: an image (the card, a still) or the playing film's current frame.
  // Mipmapped every time, so the smallest level is its average colour, which lights the room.
  async function picture(source) {
    let img = source;
    if (typeof source === 'string') img = await bitmap(source, abort.signal, false);
    if (lost || abort.signal.aborted) return;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, pic);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    const w = img.videoWidth || img.width, h = img.videoHeight || img.height;
    gl.uniform1f(U.uPicLod, levels(w, h) - 1);
    if (img !== source) img.close();
  }

  // Cover the canvas with the room, like object-fit: cover, around a focal point.
  let focus = [0.5, 0.5];
  function resize(fx = focus[0], fy = focus[1]) {
    focus = [fx, fy];
    const r = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (!r.width || !r.height) return;
    const cover = Math.max(r.width / W, r.height / H);
    const density = Math.min(window.devicePixelRatio || 1, 2, 1 / cover);
    canvas.width = Math.round(r.width * density);
    canvas.height = Math.round(r.height * density);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const vw = r.width / cover, vh = r.height / cover;
    const x0 = (W - vw) * fx, y0 = (H - vh) * fy;
    gl.uniform4f(U.uView, x0, y0, x0 + vw, y0 + vh);
  }

  function draw(s) {
    if (lost) return;
    s.w.forEach((w, g) => gl.uniform3fv(U[`uW[${g}]`], w));
    gl.uniform1f(U.uS, s.s);
    gl.uniform1f(U.uProj, movesReady ? s.proj : 0);
    gl.uniform1f(U.uPicMix, s.picMix);
    gl.uniform1f(U.uEV, s.ev);
    gl.uniform3fv(U.uBal, s.balance);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function dispose() {
    abort.abort();
    if (!lost) {
      [up, down, glow, pic].forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  return { ready, moves, get movesReady() { return movesReady; }, picture, draw, resize, dispose };
}
