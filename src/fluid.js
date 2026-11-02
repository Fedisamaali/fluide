'use strict';

class Fluid {
  constructor(context, config) {
    this.gl = context.gl;
    this.ext = context.ext;
    this.config = config;

    const gl = this.gl;
    this.blit = createBlit(gl);
    const vertex = compileShader(gl, gl.VERTEX_SHADER, SHADERS.baseVertex);
    const make = (source) => new Program(gl, vertex, source);

    this.programs = {
      copy: make(SHADERS.copy),
      clear: make(SHADERS.clear),
      splat: make(SHADERS.splat),
      advection: make(SHADERS.advection),
      divergence: make(SHADERS.divergence),
      curl: make(SHADERS.curl),
      vorticity: make(SHADERS.vorticity),
      pressure: make(SHADERS.pressure),
      gradientSubtract: make(SHADERS.gradientSubtract),
      maskDye: make(SHADERS.maskDye),
      maskVelocity: make(SHADERS.maskVelocity),
      bloomPrefilter: make(SHADERS.bloomPrefilter),
      bloomBlur: make(SHADERS.bloomBlur),
      bloomFinal: make(SHADERS.bloomFinal),
      display: make(SHADERS.display),
    };

    this.dye = null;
    this.velocity = null;
    this.divergence = null;
    this.curl = null;
    this.pressure = null;
    this.bloom = null;
    this.bloomFramebuffers = [];
    this.splatQueue = [];
    this.splatPoints = new Float32Array(MAX_SPLATS * 3);
    this.splatColors = new Float32Array(MAX_SPLATS * 3);
    this.initFramebuffers();
  }

  get aspectRatio() {
    return this.gl.drawingBufferWidth / this.gl.drawingBufferHeight;
  }

  getResolution(resolution) {
    const gl = this.gl;
    let aspect = this.aspectRatio;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  initFramebuffers() {
    const gl = this.gl;
    const { halfFloat, formatRGBA, formatRG, formatR } = this.ext;
    const sim = this.getResolution(this.config.SIM_RESOLUTION);
    const dye = this.getResolution(this.config.DYE_RESOLUTION);

    gl.disable(gl.BLEND);

    this.dye = this.resizeDoubleFBO(this.dye, dye.width, dye.height, formatRGBA, halfFloat, gl.LINEAR);
    this.velocity = this.resizeDoubleFBO(this.velocity, sim.width, sim.height, formatRG, halfFloat, gl.LINEAR);

    if (this.divergence) destroyFBO(gl, this.divergence);
    if (this.curl) destroyFBO(gl, this.curl);
    if (this.pressure) {
      destroyFBO(gl, this.pressure.read);
      destroyFBO(gl, this.pressure.write);
    }
    const single = () => createFBO(gl, sim.width, sim.height, formatR.internalFormat, formatR.format, halfFloat, gl.NEAREST);
    this.divergence = single();
    this.curl = single();
    this.pressure = new DoubleFBO(single(), single());

    this.initBloomFramebuffers();
  }

  initBloomFramebuffers() {
    const gl = this.gl;
    const { halfFloat, formatRGBA } = this.ext;
    const res = this.getResolution(this.config.BLOOM_RESOLUTION);
    const make = (w, h) => createFBO(gl, w, h, formatRGBA.internalFormat, formatRGBA.format, halfFloat, gl.LINEAR);

    if (this.bloom) destroyFBO(gl, this.bloom);
    for (const fbo of this.bloomFramebuffers) destroyFBO(gl, fbo);

    this.bloom = make(res.width, res.height);
    this.bloomFramebuffers = [];
    for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
      const w = res.width >> (i + 1);
      const h = res.height >> (i + 1);
      if (w < 2 || h < 2) break;
      this.bloomFramebuffers.push(make(w, h));
    }
  }

  resizeDoubleFBO(target, width, height, fmt, type, filter) {
    const gl = this.gl;
    const make = () => createFBO(gl, width, height, fmt.internalFormat, fmt.format, type, filter);
    if (!target) return new DoubleFBO(make(), make());
    if (target.width === width && target.height === height) return target;

    const read = make();
    const copy = this.programs.copy;
    copy.bind();
    gl.uniform1i(copy.uniforms.uTexture, target.read.attach(0));
    this.blit(read);

    destroyFBO(gl, target.read);
    destroyFBO(gl, target.write);
    return new DoubleFBO(read, make());
  }

  step(dt) {
    const gl = this.gl;
    const c = this.config;
    const p = this.programs;
    const vel = this.velocity;
    gl.disable(gl.BLEND);
    this.flushSplats();

    p.curl.bind();
    gl.uniform2f(p.curl.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
    gl.uniform1i(p.curl.uniforms.uVelocity, vel.read.attach(0));
    this.blit(this.curl);

    p.vorticity.bind();
    gl.uniform2f(p.vorticity.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
    gl.uniform1i(p.vorticity.uniforms.uVelocity, vel.read.attach(0));
    gl.uniform1i(p.vorticity.uniforms.uCurl, this.curl.attach(1));
    gl.uniform1f(p.vorticity.uniforms.curl, c.CURL);
    gl.uniform1f(p.vorticity.uniforms.dt, dt);
    gl.uniform1f(p.vorticity.uniforms.uSmooth, c.GRID_SMOOTHING);
    this.blit(vel.write);
    vel.swap();

    p.divergence.bind();
    gl.uniform2f(p.divergence.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
    gl.uniform1i(p.divergence.uniforms.uVelocity, vel.read.attach(0));
    this.blit(this.divergence);

    p.clear.bind();
    gl.uniform1i(p.clear.uniforms.uTexture, this.pressure.read.attach(0));
    gl.uniform1f(p.clear.uniforms.value, c.PRESSURE);
    this.blit(this.pressure.write);
    this.pressure.swap();

    p.pressure.bind();
    gl.uniform2f(p.pressure.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
    gl.uniform1i(p.pressure.uniforms.uDivergence, this.divergence.attach(0));
    for (let i = 0; i < c.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(p.pressure.uniforms.uPressure, this.pressure.read.attach(1));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    p.gradientSubtract.bind();
    gl.uniform2f(p.gradientSubtract.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
    gl.uniform1i(p.gradientSubtract.uniforms.uPressure, this.pressure.read.attach(0));
    gl.uniform1i(p.gradientSubtract.uniforms.uVelocity, vel.read.attach(1));
    this.blit(vel.write);
    vel.swap();

    p.advection.bind();
    gl.uniform2f(p.advection.uniforms.texelSize, vel.texelSizeX, vel.texelSizeY);
    const velocityId = vel.read.attach(0);
    gl.uniform1i(p.advection.uniforms.uVelocity, velocityId);
    gl.uniform1i(p.advection.uniforms.uSource, velocityId);
    gl.uniform1f(p.advection.uniforms.dt, dt);
    gl.uniform1f(p.advection.uniforms.dissipation, c.VELOCITY_DISSIPATION);
    this.blit(vel.write);
    vel.swap();

    gl.uniform1i(p.advection.uniforms.uVelocity, vel.read.attach(0));
    gl.uniform1i(p.advection.uniforms.uSource, this.dye.read.attach(1));
    gl.uniform1f(p.advection.uniforms.dissipation, c.DENSITY_DISSIPATION);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  correctRadius(radius) {
    const aspect = this.aspectRatio;
    return aspect > 1 ? radius * aspect : radius;
  }

  splat(x, y, dx, dy, color, radiusScale = 1) {
    const radius = this.correctRadius((this.config.SPLAT_RADIUS / 100) * radiusScale);
    this.splatQueue.push({ x, y, radius, dx, dy, color });
  }

  flushSplats() {
    const queue = this.splatQueue;
    if (!queue.length) return;
    this.splatQueue = [];
    for (let i = 0; i < queue.length; i += MAX_SPLATS) {
      const chunk = queue.slice(i, i + MAX_SPLATS);
      this.applySplats(this.velocity, chunk, (s) => [s.dx, s.dy, 0]);
      const dyed = chunk.filter((s) => s.color);
      if (dyed.length) this.applySplats(this.dye, dyed, (s) => [s.color.r, s.color.g, s.color.b]);
    }
  }

  applySplats(target, splats, colorOf) {
    const gl = this.gl;
    const p = this.programs.splat;
    splats.forEach((s, i) => {
      this.splatPoints.set([s.x, s.y, s.radius], i * 3);
      this.splatColors.set(colorOf(s), i * 3);
    });
    p.bind();
    gl.uniform1i(p.uniforms.uTarget, target.read.attach(0));
    gl.uniform1f(p.uniforms.aspectRatio, this.aspectRatio);
    gl.uniform1i(p.uniforms.uCount, splats.length);
    gl.uniform3fv(p.uniforms['uPoints[0]'], this.splatPoints);
    gl.uniform3fv(p.uniforms['uColors[0]'], this.splatColors);
    this.blit(target.write);
    target.swap();
  }

  damp(velocityFactor, dyeFactor) {
    const gl = this.gl;
    const p = this.programs.clear;
    p.bind();
    for (const [target, factor] of [[this.velocity, velocityFactor], [this.dye, dyeFactor]]) {
      gl.uniform1i(p.uniforms.uTexture, target.read.attach(0));
      gl.uniform1f(p.uniforms.value, factor);
      this.blit(target.write);
      target.swap();
    }
  }

  injectMask(maskTexture, strength, colorA, colorB, wobble, time) {
    const gl = this.gl;
    const pd = this.programs.maskDye;
    pd.bind();
    gl.uniform1i(pd.uniforms.uTarget, this.dye.read.attach(0));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, maskTexture);
    gl.uniform1i(pd.uniforms.uMask, 1);
    gl.uniform3f(pd.uniforms.uColorA, colorA.r, colorA.g, colorA.b);
    gl.uniform3f(pd.uniforms.uColorB, colorB.r, colorB.g, colorB.b);
    gl.uniform1f(pd.uniforms.uStrength, strength);
    this.blit(this.dye.write);
    this.dye.swap();

    if (wobble <= 0) return;
    const pv = this.programs.maskVelocity;
    pv.bind();
    gl.uniform1i(pv.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform1i(pv.uniforms.uMask, 1);
    gl.uniform1f(pv.uniforms.uTime, time);
    gl.uniform1f(pv.uniforms.uAmount, wobble);
    this.blit(this.velocity.write);
    this.velocity.swap();
  }

  clear() {
    const gl = this.gl;
    this.splatQueue = [];
    const targets = [this.dye, this.velocity, this.pressure];
    for (const t of targets) {
      for (const fbo of [t.read, t.write]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
        gl.viewport(0, 0, fbo.width, fbo.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
  }

  applyBloom(source, destination, intensity) {
    if (this.bloomFramebuffers.length < 2) return;
    const gl = this.gl;
    const c = this.config;
    const p = this.programs;
    let last = destination;

    gl.disable(gl.BLEND);
    p.bloomPrefilter.bind();
    const knee = c.BLOOM_THRESHOLD * c.BLOOM_SOFT_KNEE + 0.0001;
    gl.uniform3f(p.bloomPrefilter.uniforms.curve, c.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee);
    gl.uniform1f(p.bloomPrefilter.uniforms.threshold, c.BLOOM_THRESHOLD);
    gl.uniform1i(p.bloomPrefilter.uniforms.uTexture, source.attach(0));
    this.blit(last);

    p.bloomBlur.bind();
    for (const dest of this.bloomFramebuffers) {
      gl.uniform2f(p.bloomBlur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(p.bloomBlur.uniforms.uTexture, last.attach(0));
      this.blit(dest);
      last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    for (let i = this.bloomFramebuffers.length - 2; i >= 0; i--) {
      const base = this.bloomFramebuffers[i];
      gl.uniform2f(p.bloomBlur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(p.bloomBlur.uniforms.uTexture, last.attach(0));
      this.blit(base);
      last = base;
    }
    gl.disable(gl.BLEND);

    p.bloomFinal.bind();
    gl.uniform2f(p.bloomFinal.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(p.bloomFinal.uniforms.uTexture, last.attach(0));
    gl.uniform1f(p.bloomFinal.uniforms.intensity, intensity);
    this.blit(destination);
  }

  render(time, background, bloomBoost = 0) {
    const gl = this.gl;
    const c = this.config;
    if (c.BLOOM) this.applyBloom(this.dye.read, this.bloom, c.BLOOM_INTENSITY + bloomBoost);

    gl.disable(gl.BLEND);
    const p = this.programs.display;
    p.bind();
    gl.uniform2f(p.uniforms.texelSize, this.dye.texelSizeX, this.dye.texelSizeY);
    gl.uniform1i(p.uniforms.uTexture, this.dye.read.attach(0));
    gl.uniform1i(p.uniforms.uBloom, this.bloom.attach(1));
    gl.uniform1f(p.uniforms.uShading, c.SHADING ? 1 : 0);
    gl.uniform1f(p.uniforms.uBloomOn, c.BLOOM ? 1 : 0);
    gl.uniform1f(p.uniforms.uExposure, c.EXPOSURE);
    gl.uniform3f(p.uniforms.uBackground, background[0], background[1], background[2]);
    gl.uniform1f(p.uniforms.uTime, time);
    this.blit(null);
  }
}
