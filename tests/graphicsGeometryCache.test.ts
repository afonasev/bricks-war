import {describe,it,expect,vi} from 'vitest';
import {cacheGraphicsGeometry} from '../src/rendering/graphicsGeometryCache';

function fixture() {
  const output: number[][]=[];
  const pipeline={name:'MultiPipeline',currentShader:{vertexComponentCount:7,setAttribPointers:vi.fn()},vertexViewU32:new Uint32Array(21),vertexCount:0,currentBatch:null as {count:number}|null,
    activeBuffer:null as {data:ArrayBuffer}|null,topology:4,setVertexBuffer(buffer?:{data:ArrayBuffer}){this.activeBuffer=buffer??null;return true;},
    setTexture2D(){this.currentBatch={count:0};return 0;},
    flush(){if(this.vertexCount)output.push(Array.from(this.vertexViewU32.slice(0,this.vertexCount*7)));this.vertexCount=0;this.currentBatch=null;}};
  const camera={alpha:1,matrix:{matrix:[1,0,0,1,0,0]},addToRenderList:vi.fn()};
  const buffers=new Set<{data:ArrayBuffer}>();
  const renderer={gl:{STATIC_DRAW:35044,drawArrays:vi.fn(()=>{if(pipeline.activeBuffer)output.push(Array.from(new Uint32Array(pipeline.activeBuffer.data)))})},
    createVertexBuffer(data:ArrayBuffer){const b={data};buffers.add(b);return b;},deleteBuffer(b:{data:ArrayBuffer}){buffers.delete(b);},
    width:1600,height:950,whiteTexture:{},pipelines:{set:()=>pipeline,preBatch:vi.fn(),postBatch:vi.fn()}};
  let onDestroy=()=>{};
  const native=vi.fn(function(this: typeof graphics){
    camera.addToRenderList(this);
    for(let chunk=0;chunk<2;chunk++){
      pipeline.setTexture2D();
      const f=new Float32Array(pipeline.vertexViewU32.buffer);
      for(let vertex=0;vertex<3;vertex++){
        const i=vertex*7;f[i]=this.x+vertex+chunk+camera.matrix.matrix[4]!;f[i+1]=this.y+vertex;
        f[i+2]=0;f[i+3]=0;f[i+4]=0;f[i+5]=2;
        pipeline.vertexViewU32[i+6]=this.commandBuffer[0]!;
      }
      pipeline.vertexCount=3;pipeline.currentBatch!.count=3;pipeline.flush();
    }
  });
  const graphics={commandBuffer:[0xffaabbcc],x:0,y:0,scaleX:1,scaleY:1,rotation:0,alpha:1,pipeline:'MultiPipeline',renderWebGL:native,
    once(_event:string,fn:()=>void){onDestroy=fn;}};
  const cache=cacheGraphicsGeometry(graphics as never);
  const render=()=>(graphics.renderWebGL as (...args: unknown[]) => void)(renderer,graphics,camera);
  return {graphics,pipeline,renderer,camera,native,cache,render,output,buffers,destroy:()=>onDestroy()};
}

describe('native Graphics vertex cache',()=>{
 it('replays exact ordered native vertex words without re-running geometry',()=>{
  const f=fixture();f.render();const first=f.output.slice();f.output.length=0;f.render();
  expect(f.output.flat()).toEqual(first.flat());expect(f.native).toHaveBeenCalledTimes(1);expect(f.cache.hits).toBe(1);
  expect(f.cache.byteLength).toBe(2*21*4);expect(f.cache.bufferHandles).toHaveLength(1);expect(f.camera.addToRenderList).toHaveBeenCalledTimes(2);
 });
 it('rebuilds changed geometry, camera, object alpha/position, renderer dimensions and pipeline',()=>{
  const f=fixture();f.render();
  for(const mutate of [()=>f.graphics.commandBuffer[0]=(f.graphics.commandBuffer[0]??0)+1,()=>f.camera.matrix.matrix[4]=(f.camera.matrix.matrix[4]??0)+1,()=>f.graphics.alpha=.5,()=>f.graphics.x++,()=>f.camera.alpha=.5,()=>f.renderer.width++]){
   const before=f.native.mock.calls.length;mutate();f.render();expect(f.native.mock.calls.length).toBe(before+1);f.render();expect(f.native.mock.calls.length).toBe(before+1);
  }
  const replacement={...f.pipeline};f.renderer.pipelines.set=()=>replacement;f.render();expect(f.cache.misses).toBe(8);
 });
 it('keeps native rendering for custom pipelines and unsupported shader formats',()=>{
  const f=fixture();f.pipeline.name='Custom';f.render();f.render();expect(f.native).toHaveBeenCalledTimes(2);expect(f.cache.byteLength).toBe(0);
  f.pipeline.name='MultiPipeline';f.pipeline.currentShader.vertexComponentCount=8;f.render();expect(f.cache.byteLength).toBe(0);
 });
 it('restores the pipeline hook if native rendering fails',()=>{
  const f=fixture(),flush=f.pipeline.flush;f.native.mockImplementationOnce(()=>{throw new Error('failure')});
  expect(f.render).toThrow('failure');expect(f.pipeline.flush).toBe(flush);f.render();f.render();expect(f.cache.hits).toBe(1);
 });
 it('releases cached storage on empty geometry and on object destruction',()=>{
  const f=fixture();f.render();expect(f.cache.byteLength).toBeGreaterThan(0);f.graphics.commandBuffer=[];f.native.mockImplementation(()=>{});f.render();expect(f.cache.byteLength).toBe(0);
  const g=fixture();g.render();g.destroy();expect(g.cache.byteLength).toBe(0);expect(g.buffers.size).toBe(0);expect(g.graphics.renderWebGL).toBe(g.native);
 });
});

it('handles GPU allocation failure and restores bindings while retaining native output',()=>{
 const f=fixture();
 f.renderer.createVertexBuffer=()=>{throw new Error('allocation failure')};
 f.render();expect(f.output.length).toBe(2);expect(f.buffers.size).toBe(0);expect(f.cache.byteLength).toBe(0);expect(f.pipeline.activeBuffer).toBeNull();
});
