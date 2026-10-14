import type * as Phaser from 'phaser/dist/phaser.esm.js';

type GraphicsRender = (renderer: Phaser.Renderer.WebGL.WebGLRenderer, src: Phaser.GameObjects.Graphics,
  camera: Phaser.Cameras.Scene2D.Camera, parent?: Phaser.GameObjects.Components.TransformMatrix) => void;
type CachedGraphics = Phaser.GameObjects.Graphics & { renderWebGL: GraphicsRender };
type GeometryPipeline = Phaser.Renderer.WebGL.WebGLPipeline & {
  currentBatch: { count: number } | null;
};

/** Phaser 3.90's default Graphics pipeline emits seven-word, color-only vertices.
 * Keep those exact vertices instead of parsing paths and running Earcut every frame.
 * Upload once to scene-owned STATIC_DRAW buffers. No textures, quality settings,
 * masks or display ordering are changed. Phaser wrappers restore a lost context. */
export function cacheGraphicsGeometry(graphics: Phaser.GameObjects.Graphics) {
  const target = graphics as CachedGraphics;
  const original = target.renderWebGL;
  let commands: number[] = [];
  let chunks: { buffer: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper; words: number }[] = [];
  let owner: Phaser.Renderer.WebGL.WebGLRenderer | undefined;
  let key = '';
  let cachedPipeline: GeometryPipeline | undefined;
  let hits = 0;
  let misses = 0;
  const clear = () => {
    for (const chunk of chunks) owner?.deleteBuffer(chunk.buffer);
    commands = []; chunks = []; key = ''; cachedPipeline = undefined; owner = undefined;
  };
  target.renderWebGL = function(renderer, src, camera, parent) {
    if (!src.commandBuffer.length) { clear(); return original.call(this, renderer, src, camera, parent); }
    const pipeline = renderer.pipelines.set(src.pipeline, src) as GeometryPipeline;
    // Fail back to Phaser when a different/custom shader layout is in use.
    if (pipeline.name !== 'MultiPipeline' || pipeline.currentShader.vertexComponentCount !== 7 || src.hasPostPipeline) {
      clear(); return original.call(this, renderer, src, camera, parent);
    }
    const nextKey = [renderer.width, renderer.height, camera.alpha, ...(camera as Phaser.Cameras.Scene2D.Camera & { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix.matrix,
      src.x, src.y, src.scaleX, src.scaleY, src.rotation, src.alpha,
      ...(parent?.matrix ?? [])].join(':');
    const unchanged = pipeline === cachedPipeline && nextKey === key
      && commands.length === src.commandBuffer.length
      && commands.every((value, index) => value === src.commandBuffer[index]);
    if (unchanged) {
      hits++;
      camera.addToRenderList(src);
      renderer.pipelines.preBatch(src);
      pipeline.flush();
      try {
        for (const chunk of chunks) {
          pipeline.setVertexBuffer(chunk.buffer);
          pipeline.currentShader.setAttribPointers();
          renderer.gl.drawArrays(pipeline.topology, 0, chunk.words / 7);
        }
      } finally {
        pipeline.setVertexBuffer();
        pipeline.currentShader.setAttribPointers();
      }
      renderer.pipelines.postBatch(src);
      return;
    }
    misses++;
    // Isolate this Graphics object's vertices from preceding display objects.
    pipeline.flush();
    const flush = pipeline.flush;
    const captured: Uint32Array[] = [];
    let colorOnly = true;
    pipeline.flush = function(...args) {
      if (this.vertexCount) {
        const chunk = this.vertexViewU32.slice(0, this.vertexCount * 7);
        const floats = new Float32Array(chunk.buffer);
        for (let i = 0; i < chunk.length; i += 7) {
          if (floats[i + 5] !== 2) colorOnly = false;
          // Color-only vertices never sample a texture. Normalize the texture slot
          // so later objects' texture-unit assignments cannot leak into this cache.
          chunk[i + 4] = 0;
        }
        captured.push(chunk);
      }
      return flush.apply(this, args);
    };
    try {
      original.call(this, renderer, src, camera, parent);
      pipeline.flush();
    } finally {
      pipeline.flush = flush;
    }
    if (colorOnly) {
      clear();
      owner = renderer;
      try {
        const vertices = new Uint32Array(captured.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of captured) { vertices.set(chunk, offset); offset += chunk.length; }
        if (vertices.length) chunks.push({
          buffer: renderer.createVertexBuffer(vertices.buffer, renderer.gl.STATIC_DRAW), words: vertices.length,
        });
        commands = src.commandBuffer.slice(); key = nextKey; cachedPipeline = pipeline;
      } catch {
        // Native rendering already completed. Failed cache allocation must not lose the frame.
        clear();
      } finally {
        // createVertexBuffer binds ARRAY_BUFFER directly; repair Phaser's binding cache.
        (pipeline as unknown as { activeBuffer: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper | null }).activeBuffer = null;
        pipeline.setVertexBuffer();
        pipeline.currentShader.setAttribPointers();
      }
    } else clear();
  };
  const destroy = () => { clear(); target.renderWebGL = original; };
  graphics.once('destroy', destroy);
  return { clear, destroy, get hits() { return hits; }, get misses() { return misses; },
    get bufferHandles(): readonly Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper[] { return chunks.map(chunk => chunk.buffer); },
    get byteLength() { return chunks.reduce((sum, chunk) => sum + chunk.words * 4, 0); } };
}
