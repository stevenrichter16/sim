import { world } from './state.js';

function createFrameBuffers(tileCount){
  return {
    heat: new Float32Array(tileCount),
    o2: new Float32Array(tileCount),
    wall: new Uint8Array(tileCount),
    vent: new Uint8Array(tileCount),
    fireMask: new Uint8Array(tileCount),
    mode: new Int16Array(tileCount),
    tension: new Float32Array(tileCount),
    amplitude: new Float32Array(tileCount),
    phase: new Float32Array(tileCount),
    meta: {
      frame: 0,
      time: 0,
      settings: null,
    },
  };
}

export function createRecorder({ size }){
  const tileCount = world.W * world.H;
  const frames = new Array(size).fill(null).map(()=> createFrameBuffers(tileCount));
  let cursor = 0;
  let count = 0;

  function record({ frame, time, settings }){
    const slot = frames[cursor];
    slot.heat.set(world.heat);
    slot.o2.set(world.o2);
    slot.wall.set(world.wall);
    slot.vent.set(world.vent);
    slot.fireMask.fill(0);

    for(const idx of world.fire){
      slot.fireMask[idx] = 1;
    }

    const modeArr = slot.mode;
    const tensArr = slot.tension;
    const ampArr = slot.amplitude;
    const phaseArr = slot.phase;

    for(let i=0;i<world.strings.length;i++){
      const S = world.strings[i];
      if(!S){
        modeArr[i] = 0;
        tensArr[i] = 0;
        ampArr[i] = 0;
        phaseArr[i] = 0;
      } else {
        modeArr[i] = S.mode;
        tensArr[i] = S.tension;
        ampArr[i] = S.amplitude;
        phaseArr[i] = S.phase;
      }
    }

    slot.meta.frame = frame;
    slot.meta.time = time;
    slot.meta.settings = { ...settings };

    cursor = (cursor + 1) % size;
    if(count < size) count++;
  }

  function getFrames(){
    const results = [];
    for(let i=0;i<count;i++){
      const index = (cursor - 1 - i + size) % size;
      results.push(frames[index]);
    }
    return results;
  }

  function getFrame(offset){
    if(offset == null) return null;
    if(offset < 1 || offset > count) return null;
    const index = (cursor - offset + size) % size;
    return frames[index];
  }

  function clear(){
    cursor = 0;
    count = 0;
  }

  return {
    record,
    getFrames,
    getFrame,
    getCount(){ return count; },
    clear,
    get size(){ return size; },
  };
}
