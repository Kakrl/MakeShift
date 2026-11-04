import { describe, expect, it } from "vitest";
import { beatIntervalMs, isMeter, restoreMeter } from "../../frontend/src/lib/meter";
import { createRecorder, millisecondsToTicks } from "../../frontend/src/app/midi/midiUtils";
describe("bounded meter", () => {
  it.each([1, 32])("accepts numerator %s with every denominator", numerator => {
    for (const denominator of [1,2,4,8,16,32]) expect(isMeter({numerator, denominator})).toBe(true);
  });
  it.each([0,-1,1.5,33,"4",null,NaN])("rejects numerator %s", numerator => {
    expect(isMeter({numerator,denominator:4})).toBe(false);
  });
  it.each([0,3,64,"8",null,1.5])("rejects denominator %s", denominator => {
    expect(isMeter({numerator:4,denominator})).toBe(false);
  });
  it.each([undefined,null,{}, {numerator:0,denominator:4}])("restores legacy/corrupt meter", value => {
    expect(restoreMeter(value)).toEqual({numerator:4,denominator:4});
  });
  it.each([[4,4,500,2000],[3,4,500,1500],[6,8,250,1500],[7,8,250,1750],[2,2,1000,2000]])("times %s/%s at quarter-note 120 BPM", (numerator,denominator,interval,total) => {
    expect(beatIntervalMs(120,{numerator,denominator})).toBe(interval);
    expect(interval*numerator).toBe(total);
    expect(millisecondsToTicks(500,120)).toBe(128);
  });
  it("snapshots meter across pause/resume and returned copies", () => {
    const meter = {numerator:7,denominator:8};
    const recorder = createRecorder();
    recorder.startRecording(120, "Meter", meter);
    meter.numerator=2;
    recorder.pauseRecording(); recorder.resumeRecording();
    const take = recorder.stopRecording()!;
    expect(take.meter).toEqual({numerator:7,denominator:8});
    expect(() => recorder.startRecording(120,"Bad",{numerator:0,denominator:4})).toThrow();
  });
});
