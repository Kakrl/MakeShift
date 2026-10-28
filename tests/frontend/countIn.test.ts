import { expect, it, vi } from "vitest";
import { scheduleCountInClicks } from "../../frontend/src/app/audio/countIn";

function contextFixture() {
  const oscillators: ReturnType<typeof oscillator>[] = [];
  const gains: ReturnType<typeof gain>[] = [];
  function oscillator() {
    return { frequency: {value:0}, type:"", connect:vi.fn(), disconnect:vi.fn(), start:vi.fn(), stop:vi.fn(), onended:null as null | (() => void) };
  }
  function gain() {
    return {connect:vi.fn(), disconnect:vi.fn(), gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()}};
  }
  const ctx = {
    currentTime:10, destination:{},
    createOscillator:() => { const node=oscillator(); oscillators.push(node); return node; },
    createGain:() => { const node=gain(); gains.push(node); return node; },
  };
  return {ctx,oscillators,gains};
}

it.each([[4,4,0.5],[3,4,0.5],[6,8,0.25],[7,8,0.25],[2,2,1],[32,32,0.0625]])(
  "schedules every %s/%s click on one audio origin, interval %s seconds", (numerator,denominator,interval) => {
    const {ctx,oscillators,gains}=contextFixture();
    const cancel=scheduleCountInClicks(ctx as unknown as AudioContext,120,{numerator,denominator});
    expect(oscillators).toHaveLength(numerator);
    for(let beat=0;beat<numerator;beat++) {
      const time=10+beat*interval;
      expect(oscillators[beat].start).toHaveBeenCalledExactlyOnceWith(time);
      expect(oscillators[beat].stop).toHaveBeenCalledExactlyOnceWith(time+0.06);
      expect(oscillators[beat].frequency.value).toBe(beat===0?1050:820);
      expect(gains[beat].gain.setValueAtTime).toHaveBeenCalledWith(beat===0?0.65:0.38,time);
    }
    // Simulated UI/CV work cannot change already-submitted audio times.
    ctx.currentTime+=0.137;
    expect(oscillators[1].start).toHaveBeenCalledExactlyOnceWith(10+interval);
    cancel(); cancel();
    for(const node of oscillators) {
      expect(node.stop).toHaveBeenLastCalledWith();
      expect(node.stop).toHaveBeenCalledTimes(2);
      expect(node.disconnect).toHaveBeenCalled();
    }
  });

it("disconnects completed click graphs", () => {
  const {ctx,oscillators,gains}=contextFixture();
  const cancel=scheduleCountInClicks(ctx as unknown as AudioContext,120,{numerator:1,denominator:4});
  oscillators[0].onended!();
  expect(oscillators[0].disconnect).toHaveBeenCalledOnce();
  expect(gains[0].disconnect).toHaveBeenCalledOnce();
  cancel();
});

it("cleans partially scheduled nodes when audio allocation fails", () => {
  const {ctx,oscillators,gains}=contextFixture();
  const create=ctx.createOscillator;
  ctx.createOscillator=() => {
    if(oscillators.length===2) throw new Error("allocation failed");
    return create();
  };
  expect(() => scheduleCountInClicks(ctx as unknown as AudioContext,120,{numerator:4,denominator:4})).toThrow("allocation failed");
  for(let i=0;i<2;i++) {
    expect(oscillators[i].stop).toHaveBeenLastCalledWith();
    expect(oscillators[i].disconnect).toHaveBeenCalled();
    expect(gains[i].disconnect).toHaveBeenCalled();
  }
});
