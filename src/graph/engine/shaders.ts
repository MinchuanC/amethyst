/** Uniforms shared by the node and link materials (one object, updated once per frame). */
export const SHARED_UNIFORM_DECLS = /* glsl */ `
  uniform float uTime;
  uniform float uFocusOn;
  uniform float uFocusTime;
  uniform float uFocusDepth;
  uniform float uTimelapseOn;
  uniform float uTimeCursor;
  uniform float uHoverOn;
  uniform float uDim;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uViewportH;
  uniform float uSizeScale;
  uniform float uFlow;
`;

const FOCUS_REVEAL = /* glsl */ `
  float focusLit(float hop, float dimTo) {
    if (uFocusOn < 0.001) return 1.0;
    float reached = (hop >= 0.0 && hop <= uFocusDepth) ? 1.0 : 0.0;
    float arrive = hop * 0.24;
    float revealed = reached * smoothstep(arrive, arrive + 0.28, uFocusTime);
    return mix(1.0, mix(dimTo, 1.0, revealed), uFocusOn);
  }
  float focusWave(float hop) {
    if (uFocusOn < 0.001 || hop < 0.0 || hop > uFocusDepth) return 0.0;
    float arrive = hop * 0.24;
    return exp(-pow((uFocusTime - arrive) * 6.0, 2.0)) * uFocusOn;
  }
`;

export const NODE_VERT = /* glsl */ `
  ${SHARED_UNIFORM_DECLS}
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aKind;
  attribute float aBirth;
  attribute float aHop;
  attribute float aHighlight;
  attribute float aPulse;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vRing;
  varying float vCore;

  ${FOCUS_REVEAL}

  void main() {
    vUv = position.xy + 0.5;
    float vis = 1.0;
    float flash = 0.0;
    if (uTimelapseOn > 0.5) {
      float age = uTimeCursor - aBirth;
      vis = step(0.0, age);
      flash += exp(-max(age, 0.0) * 38.0) * vis * 1.4;
    }
    float since = uTime - aPulse;
    flash += since >= 0.0 ? exp(-since * 2.4) : 0.0;
    flash += focusWave(aHop);

    float lit = focusLit(aHop, 0.07);
    float hoverDim = mix(1.0, aHighlight > 0.01 ? 1.0 : 0.32, uHoverOn);

    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    float depth = max(-mv.z, 0.001);
    float size = aSize * uSizeScale * (1.0 + 0.55 * aHighlight + 0.8 * min(flash, 1.5));
    float minWorld = 1.7 * depth / (projectionMatrix[1][1] * uViewportH * 0.5);
    size = max(size, minWorld) * vis;
    mv.xy += position.xy * size;
    gl_Position = projectionMatrix * mv;

    float fog = smoothstep(uFogNear, uFogFar, depth);
    vColor = aColor;
    vKind = aKind;
    vRing = clamp(aHighlight + flash, 0.0, 1.6);
    vCore = 1.0 + flash * 0.9;
    vAlpha = vis * lit * hoverDim * uDim * (1.0 - fog * 0.86);
  }
`;

export const NODE_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vRing;
  varying float vCore;

  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float core;
    float halo = pow(1.0 - d, 3.2);
    if (vKind < 0.5) {
      core = smoothstep(0.34, 0.16, d);
      halo *= 0.55;
    } else if (vKind < 1.5) {
      core = smoothstep(0.075, 0.0, abs(d - 0.3)) * 0.85;
      halo *= 0.16;
    } else if (vKind < 2.5) {
      float q = max(abs(p.x), abs(p.y)) * 2.0;
      core = smoothstep(0.3, 0.2, q) * 0.8;
      halo *= 0.28;
    } else {
      float q = (abs(p.x) + abs(p.y)) * 2.0;
      core = smoothstep(0.42, 0.3, q);
      halo *= 0.36;
    }
    float ring = smoothstep(0.06, 0.0, abs(d - 0.62)) * min(vRing, 1.0);
    float pin = vKind < 0.5 ? smoothstep(0.12, 0.0, d) : 0.0;
    vec3 hot = mix(vColor, vec3(1.0), 0.3);
    vec3 col = vColor * halo * 2.1 + hot * core * 1.35 * vCore + vec3(1.0) * pin * 0.55 * vCore + vColor * ring * 1.4;
    gl_FragColor = vec4(col * vAlpha, 1.0);
  }
`;

export const EDGE_VERT = /* glsl */ `
  ${SHARED_UNIFORM_DECLS}
  attribute vec3 aColor;
  attribute float aT;
  attribute float aSeed;
  attribute float aKind;
  attribute float aState;
  attribute float aBirth;
  attribute float aBorn;
  attribute float aHop;

  varying vec3 vColor;
  varying float vT;
  varying float vSeed;
  varying float vAlpha;
  varying float vKind;
  varying float vState;
  varying float vBornAge;

  ${FOCUS_REVEAL}

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float vis = uTimelapseOn > 0.5 ? step(aBirth, uTimeCursor) : 1.0;
    float lit = focusLit(aHop, 0.025);
    float hoverDim = mix(1.0, aState > 0.01 ? 1.0 : 0.22, uHoverOn);
    float fog = smoothstep(uFogNear, uFogFar, -mv.z);
    vColor = aColor;
    vT = aT;
    vSeed = aSeed;
    vKind = aKind;
    vState = aState;
    vBornAge = uTime - aBorn;
    vAlpha = vis * lit * hoverDim * uDim * (1.0 - fog * 0.9);
  }
`;

export const EDGE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  varying vec3 vColor;
  varying float vT;
  varying float vSeed;
  varying float vAlpha;
  varying float vKind;
  varying float vState;
  varying float vBornAge;

  void main() {
    float a;
    vec3 col = vColor;
    if (vKind > 2.5) {
      float dots = step(0.55, fract(vT * 26.0 - uTime * 0.5));
      a = dots * 0.26 + vState * 0.3;
      col = mix(col, vec3(0.86, 0.88, 1.0), 0.45);
    } else {
      float base = vKind > 1.5 ? 0.13 : 0.3;
      float phase = fract(vT - uTime * uFlow * (0.22 + vSeed * 0.2) + vSeed);
      float pulse = pow(phase, 14.0) * step(0.001, uFlow);
      a = base + pulse * (1.3 + vState) + vState * 0.7;
    }
    float drawn = 1.0;
    float head = 0.0;
    if (vBornAge >= 0.0 && vBornAge < 2.0) {
      float front = vBornAge * 1.4;
      drawn = step(vT, front);
      head = exp(-abs(vT - front) * 24.0) * step(front, 1.1) * 2.0;
    }
    gl_FragColor = vec4((col * a * drawn + mix(col, vec3(1.0), 0.6) * head) * vAlpha, 1.0);
  }
`;

export const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

export const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float n1 = fbm(d * 2.1 + vec3(0.0, uTime * 0.003, 0.0));
    float n2 = fbm(d * 4.4 + vec3(5.2, 1.3, uTime * 0.005));
    float n3 = fbm(d * 3.1 + 11.0);
    float clouds = smoothstep(0.42, 0.86, n1) + smoothstep(0.55, 0.92, n2) * 0.45;
    vec3 violet = vec3(0.30, 0.17, 0.78);
    vec3 magenta = vec3(0.62, 0.10, 0.58);
    vec3 cyan = vec3(0.08, 0.48, 0.62);
    vec3 col = mix(violet, magenta, smoothstep(0.3, 0.8, n2));
    col = mix(col, cyan, smoothstep(0.55, 0.95, n3) * 0.65);
    float band = exp(-pow(d.y * 2.3 + (n1 - 0.5) * 0.9, 2.0));
    vec3 base = vec3(0.010, 0.008, 0.017);
    gl_FragColor = vec4(base + col * clouds * (0.035 + 0.085 * band) * uIntensity, 1.0);
  }
`;

export const STAR_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio;
    vColor = aColor;
    vTwinkle = 0.65 + 0.35 * sin(uTime * (0.6 + aPhase) + aPhase * 30.0);
  }
`;

export const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 2.4) * vTwinkle;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

export const DUST_VERT = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uViewportH;
  attribute float aSize;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = max(-mv.z, 1.0);
    gl_PointSize = clamp(aSize * uViewportH * 0.6 / depth, 1.0, 6.0) * uPixelRatio;
    vFade = 1.0 - smoothstep(200.0, 2600.0, depth);
  }
`;

export const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor * pow(1.0 - d, 2.0) * 0.16 * vFade, 1.0);
  }
`;

export const BEAM_VERT = /* glsl */ `
  varying float vU;
  void main() {
    vU = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uReveal;
  uniform vec3 uFrom;
  uniform vec3 uTo;
  varying float vU;
  void main() {
    if (vU > uReveal) discard;
    vec3 col = mix(uFrom, uTo, vU);
    float bands = pow(fract(vU * 4.0 - uTime * 0.7), 10.0);
    float tip = exp(-abs(vU - uReveal) * 40.0) * step(uReveal, 0.999);
    gl_FragColor = vec4(col * (0.55 + bands * 1.6) + vec3(1.0) * tip * 1.5, 1.0);
  }
`;
