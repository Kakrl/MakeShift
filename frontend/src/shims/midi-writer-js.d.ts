// midi-writer-js 3.2.1 ships types but omits them from its package exports.
// Bridge those declarations only; runtime imports must resolve to build/index.js.
declare module "midi-writer-js" {
  const MidiWriter: typeof import("../../node_modules/midi-writer-js/build/types/main").default;
  export default MidiWriter;
}
