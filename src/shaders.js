'use strict';

const FRAG_HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 fragColor;
`;

const frag = (body) => FRAG_HEADER + body;

const MAX_SPLATS = 32;

const SHADERS = {
  baseVertex: `#version 300 es
precision highp float;
in vec2 aPosition;
uniform vec2 texelSize;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,

  copy: frag(`
uniform sampler2D uTexture;
void main () {
  fragColor = texture(uTexture, vUv);
}`),

  clear: frag(`
uniform sampler2D uTexture;
uniform float value;
void main () {
  fragColor = value * texture(uTexture, vUv);
}`),

  splat: frag(`
#define MAX_SPLATS ${MAX_SPLATS}
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform int uCount;
uniform vec3 uPoints[MAX_SPLATS];
uniform vec3 uColors[MAX_SPLATS];
void main () {
  vec3 base = texture(uTarget, vUv).xyz;
  for (int i = 0; i < MAX_SPLATS; i++) {
    if (i >= uCount) break;
    vec2 p = vUv - uPoints[i].xy;
    p.x *= aspectRatio;
    base += exp(-dot(p, p) / uPoints[i].z) * uColors[i];
  }
  fragColor = vec4(base, 1.0);
}`),

  advection: frag(`
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
void main () {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
  vec4 result = texture(uSource, coord);
  float decay = 1.0 + dissipation * dt;
  fragColor = result / decay;
}`),

  divergence: frag(`
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  fragColor = vec4(div, 0.0, 0.0, 1.0);
}`),

  curl: frag(`
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`),

  vorticity: frag(`
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
uniform float uSmooth;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;

  // Collocated grids let a checkerboard velocity mode slip through the projection; damp it here.
  vec2 velocity = texture(uVelocity, vUv).xy;
  vec2 neighbours = 0.25 * (texture(uVelocity, vL).xy + texture(uVelocity, vR).xy
                          + texture(uVelocity, vT).xy + texture(uVelocity, vB).xy);
  velocity = mix(velocity, neighbours, uSmooth);
  velocity += force * dt;
  velocity = clamp(velocity, -1000.0, 1000.0);
  fragColor = vec4(velocity, 0.0, 1.0);
}`),

  pressure: frag(`
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  fragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`),

  gradientSubtract: frag(`
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity -= vec2(R - L, T - B);
  fragColor = vec4(velocity, 0.0, 1.0);
}`),

  maskDye: frag(`
uniform sampler2D uTarget;
uniform sampler2D uMask;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uStrength;
void main () {
  float m = texture(uMask, vUv).r;
  vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.85, vUv.x));
  vec3 base = texture(uTarget, vUv).rgb;
  fragColor = vec4(base + col * m * uStrength, 1.0);
}`),

  maskVelocity: frag(`
uniform sampler2D uTarget;
uniform sampler2D uMask;
uniform float uTime;
uniform float uAmount;
void main () {
  float m = texture(uMask, vUv).r;
  vec2 f = vec2(
    sin(vUv.y * 23.0 + uTime * 3.1) + 0.5 * sin(vUv.x * 41.0 - uTime * 2.3),
    cos(vUv.x * 19.0 - uTime * 2.7) + 0.5 * cos(vUv.y * 37.0 + uTime * 1.9)
  );
  vec2 v = texture(uTarget, vUv).xy;
  fragColor = vec4(v + f * m * uAmount, 0.0, 1.0);
}`),

  bloomPrefilter: frag(`
uniform sampler2D uTexture;
uniform vec3 curve;
uniform float threshold;
void main () {
  vec3 c = texture(uTexture, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - curve.x, 0.0, curve.y);
  rq = curve.z * rq * rq;
  c *= max(rq, br - threshold) / max(br, 0.0001);
  fragColor = vec4(c, 0.0);
}`),

  bloomBlur: frag(`
uniform sampler2D uTexture;
uniform vec2 texelSize;
void main () {
  vec4 sum = texture(uTexture, vUv + texelSize * vec2(-1.0, -1.0));
  sum += texture(uTexture, vUv + texelSize * vec2( 1.0, -1.0));
  sum += texture(uTexture, vUv + texelSize * vec2(-1.0,  1.0));
  sum += texture(uTexture, vUv + texelSize * vec2( 1.0,  1.0));
  fragColor = sum * 0.25;
}`),

  bloomFinal: frag(`
uniform sampler2D uTexture;
uniform vec2 texelSize;
uniform float intensity;
void main () {
  vec4 sum = texture(uTexture, vUv + texelSize * vec2(-1.0, -1.0));
  sum += texture(uTexture, vUv + texelSize * vec2( 1.0, -1.0));
  sum += texture(uTexture, vUv + texelSize * vec2(-1.0,  1.0));
  sum += texture(uTexture, vUv + texelSize * vec2( 1.0,  1.0));
  fragColor = sum * 0.25 * intensity;
}`),

  display: frag(`
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform vec2 texelSize;
uniform float uShading;
uniform float uBloomOn;
uniform float uExposure;
uniform vec3 uBackground;
uniform float uTime;

float hash12 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces (vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main () {
  vec3 c = texture(uTexture, vUv).rgb;

  if (uShading > 0.5) {
    vec3 lc = texture(uTexture, vL).rgb;
    vec3 rc = texture(uTexture, vR).rgb;
    vec3 tc = texture(uTexture, vT).rgb;
    vec3 bc = texture(uTexture, vB).rgb;
    float dx = length(rc) - length(lc);
    float dy = length(tc) - length(bc);
    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
    c *= diffuse;
  }

  if (uBloomOn > 0.5) {
    c += texture(uBloom, vUv).rgb;
  }

  vec3 col = aces(c * uExposure);

  vec2 q = vUv - 0.5;
  float vignette = 1.0 - dot(q, q) * 1.2;
  col += uBackground * vignette;
  col *= mix(0.82, 1.0, vignette);

  col += (hash12(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}`),
};
