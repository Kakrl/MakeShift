import type { PedalState } from "../app/audio/audioEngine";

export const pedalIds = ["sustain", "sostenuto", "soft", "none"] as const;
export type Pedal = typeof pedalIds[number];
export type Binding = { code: string; mode: "hold" | "toggle" };
export type Bindings = Record<Pedal, Binding>;
export const defaultBindings = (): Bindings => Object.fromEntries(
  pedalIds.map(id => [id, { code: "", mode: "hold" }]),
) as Bindings;
// Navigation/dialog keys and modifier combinations remain application/browser owned.
export const allowedCode = (code: string) => /^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(code);
export function validBindings(value: unknown): value is Bindings {
  if (!value || typeof value !== "object") return false;
  const codes = new Set<string>();
  return pedalIds.every(id => {
    const b = (value as Bindings)[id];
    if (!b || !["hold", "toggle"].includes(b.mode) || typeof b.code !== "string") return false;
    if (b.code && (!allowedCode(b.code) || codes.has(b.code))) return false;
    if (b.code) codes.add(b.code);
    return true;
  });
}

/** Synchronous owner: audio dispatch precedes UI observation. Storage is bounded to four keys. */
export class PedalController {
  private latch = { sustain: false, sostenuto: false, soft: false };
  private down = new Set<string>();
  private suppressed = new Set<string>();
  private held = new Set<Pedal>();
  state: PedalState = { ...this.latch };
  constructor(public bindings: Bindings, private send: (state: PedalState) => boolean,
    private observe: (state: PedalState) => void) {}
  private publish() {
    const next = {
      sustain: this.latch.sustain || this.held.has("sustain"),
      sostenuto: this.latch.sostenuto || this.held.has("sostenuto"),
      soft: this.latch.soft || this.held.has("soft"),
    };
    if (Object.keys(next).every(k => next[k as keyof PedalState] === this.state[k as keyof PedalState])) return;
    if (!this.send(next)) { this.clear(false); return; }
    this.state = next;
    this.observe(next);
  }
  toggle(id: Pedal) {
    if (id === "none") { this.clear(); return; }
    this.latch[id] = !this.latch[id];
    this.publish();
  }
  clear(dispatch = true) {
    for (const code of this.down) this.suppressed.add(code);
    this.held.clear();
    this.latch = { sustain: false, sostenuto: false, soft: false };
    if (dispatch) this.publish();
    else { this.state = { ...this.latch }; this.observe(this.state); }
  }
  rebind(bindings: Bindings) { this.clear(); this.bindings = bindings; }
  keydown(code: string, repeat: boolean) {
    const id = pedalIds.find(id => this.bindings[id].code === code);
    if (!id) return false;
    if (repeat || this.down.has(code) || this.suppressed.has(code)) return true;
    this.down.add(code);
    if (id === "none") this.clear();
    else if (this.bindings[id].mode === "toggle") this.toggle(id);
    else { this.held.add(id); this.publish(); }
    return true;
  }
  keyup(code: string) {
    this.down.delete(code);
    this.suppressed.delete(code);
    const id = pedalIds.find(id => this.bindings[id].code === code);
    if (id) this.held.delete(id);
    this.publish();
  }
}
