// The bedroom, mixed live. Each light group is a picture of the room lit by that group alone
// (rendered in Blender, scripts/room/). Light adds up, so any blend of those pictures is a real
// lighting state: the shader sums them with the current weights and grades the result once
// (exposure, white balance, AgX, the same look the stills were made with). The curtain and the fan
// move through short sequences of frames cropped to just those parts.
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
uniform sampler2DArray uFull, uCurt, uFan;
uniform vec2 uSize;
uniform vec3 uW[4];
uniform float uK[8];
uniform float uC;
uniform float uCurtOn;
uniform vec4 uCurtRect;
uniform vec4 uCurtGrid;       // cell w, cell h, columns, frames
uniform vec2 uCurtAtlas;
uniform float uCurtK[4];
uniform float uFanOn;
uniform float uFanPos;        // where the fan is, in frames (any value; it repeats)
uniform float uFanBlur;       // frames swept while the shutter is open
uniform vec4 uFanRect;
uniform vec4 uFanGrid;
uniform vec2 uFanAtlas;
uniform float uFanK[4];
uniform vec3 uFanClosed[4];
uniform float uEV;
uniform vec3 uBal;
in vec2 vRoom;
out vec4 outColor;

vec3 dec(vec3 e, float k) { vec3 x = pow(e, vec3(2.2)); return x / max(1.0 - x, vec3(1e-4)) / k; }

vec2 cellUv(vec2 local, float i, vec4 grid, vec2 atlas) {
  vec2 cell = grid.xy;
  vec2 origin = vec2(mod(i, grid.z), floor(i / grid.z)) * cell;
  vec2 p = clamp(local * cell, vec2(0.5), cell - 0.5);
  return (origin + p) / atlas;
}

float feather(vec2 local, vec4 rect) {
  vec2 e = 10.0 / rect.zw;
  vec2 a = smoothstep(vec2(0.0), e, local) * smoothstep(vec2(0.0), e, 1.0 - local);
  return a.x * a.y;
}

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
  vec2 uv = vRoom / uSize;
  vec3 open = vec3(0.0), closed = vec3(0.0);
  for (int g = 0; g < 4; g++) {
    if (uC < 1.0) open += uW[g] * dec(texture(uFull, vec3(uv, float(g))).rgb, uK[g]);
    if (uC > 0.0) closed += uW[g] * dec(texture(uFull, vec3(uv, float(g + 4))).rgb, uK[g + 4]);
  }
  vec3 col = mix(open, closed, uC);

  if (uCurtOn > 0.0) {
    vec2 local = (vRoom - uCurtRect.xy) / uCurtRect.zw;
    if (all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0)))) {
      float f = uC * (uCurtGrid.w - 1.0);
      float f0 = floor(f), f1 = min(f0 + 1.0, uCurtGrid.w - 1.0);
      vec2 a = cellUv(local, f0, uCurtGrid, uCurtAtlas), b = cellUv(local, f1, uCurtGrid, uCurtAtlas);
      vec3 seq = vec3(0.0);
      for (int g = 0; g < 4; g++) {
        seq += uW[g] * mix(dec(texture(uCurt, vec3(a, float(g))).rgb, uCurtK[g]),
                           dec(texture(uCurt, vec3(b, float(g))).rgb, uCurtK[g]), f - f0);
      }
      col = mix(col, seq, uCurtOn * feather(local, uCurtRect));
    }
  }

  if (uFanOn > 0.0) {
    vec2 local = (vRoom - uFanRect.xy) / uFanRect.zw;
    if (all(greaterThanEqual(local, vec2(0.0))) && all(lessThanEqual(local, vec2(1.0)))) {
      vec3 seq = vec3(0.0);
      const int TAPS = 8;
      for (int s = 0; s < TAPS; s++) {
        float p = mod(uFanPos - uFanBlur * float(s) / float(TAPS - 1), uFanGrid.w);
        float f0 = floor(p), f1 = mod(f0 + 1.0, uFanGrid.w);
        vec2 a = cellUv(local, f0, uFanGrid, uFanAtlas), b = cellUv(local, f1, uFanGrid, uFanAtlas);
        for (int g = 0; g < 4; g++) {
          vec3 w = uW[g] * mix(vec3(1.0), uFanClosed[g], uC);
          seq += w * mix(dec(texture(uFan, vec3(a, float(g))).rgb, uFanK[g]),
                         dec(texture(uFan, vec3(b, float(g))).rgb, uFanK[g]), p - f0);
        }
      }
      col = mix(col, seq / float(TAPS), uFanOn * feather(local, uFanRect));
    }
  }

  vec3 c = agx(col * exp2(uEV) * uBal);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(c + (n - 0.5) / 255.0, 1.0);
}`;

async function bitmap(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  // Raw values: no colour management, no premultiplying. These are data, not photographs.
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' });
}

/**
 * Draws one framing of the room into `canvas`.
 * set: the framing's entry in media-room.json; base: where its files are served from.
 * Returns { ready (full layers loaded), moves (curtain and fan frames loaded), draw(state), resize(), dispose() }.
 */
export function createRoomGL(canvas, set, base, onLost) {
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

  // One texture array per kind (1×1 when a framing has no such frames); it reads black until filled.
  const array = (unit, w, h, layers, mips) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, gl.RGBA8, w, h, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  const full = array(0, W, H, 8, true);
  const atlasSize = (s) => [s.cell[0] * s.cols, s.cell[1] * Math.ceil(s.frames / s.cols)];
  const curt = array(1, ...(set.curtain ? atlasSize(set.curtain) : [1, 1]), 4, false);
  const fan = array(2, ...(set.fan ? atlasSize(set.fan) : [1, 1]), 4, false);
  gl.uniform1i(U.uFull, 0);
  gl.uniform1i(U.uCurt, 1);
  gl.uniform1i(U.uFan, 2);
  gl.uniform2f(U.uSize, W, H);
  gl.uniform1fv(U.uK, set.k);

  const seq = (s, name) => {
    if (!s) return;
    const [aw, ah] = atlasSize(s);
    gl.uniform4f(U[`u${name}Rect`], ...s.rect);
    gl.uniform4f(U[`u${name}Grid`], s.cell[0], s.cell[1], s.cols, s.frames);
    gl.uniform2f(U[`u${name}Atlas`], aw, ah);
    gl.uniform1fv(U[`u${name}K`], s.k);
  };
  seq(set.curtain, 'Curt');
  seq(set.fan, 'Fan');
  if (set.fan) gl.uniform3fv(U.uFanClosed, set.fan.closed.flat());

  let movesReady = false;
  const ready = fill(0, full, set.full, true);
  // The movement frames follow once the room itself is on screen.
  const moves = ready.then(() => Promise.all([
    set.curtain && fill(1, curt, set.curtain.atlas, false),
    set.fan && fill(2, fan, set.fan.atlas, false),
  ])).then(() => { movesReady = true; });
  moves.catch(() => {});

  // Cover the canvas with the room, like object-fit: cover, around a focal point.
  let focus = [0.5, 0.5];
  function resize(fx = focus[0], fy = focus[1]) {
    focus = [fx, fy];
    const r = { width: canvas.clientWidth, height: canvas.clientHeight };   // layout size, before any transform
    if (!r.width || !r.height) return;
    const cover = Math.max(r.width / W, r.height / H);
    // No more pixels than the pictures have: a sharper buffer would only be upscaled.
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
    gl.uniform1f(U.uC, s.c);
    gl.uniform1f(U.uCurtOn, movesReady && set.curtain ? s.curtOn : 0);
    gl.uniform1f(U.uFanOn, movesReady && set.fan ? s.fanOn : 0);
    gl.uniform1f(U.uFanPos, s.fanPos);
    gl.uniform1f(U.uFanBlur, s.fanBlur);
    gl.uniform1f(U.uEV, s.ev);
    gl.uniform3fv(U.uBal, s.balance);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function dispose() {
    abort.abort();
    if (!lost) {
      [full, curt, fan].forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  return { ready, moves, get movesReady() { return movesReady; }, draw, resize, dispose };
}
