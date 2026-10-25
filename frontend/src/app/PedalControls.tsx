"use client";
import { useEffect, useRef, useState } from "react";
import { browserAudio, type PedalState } from "./audio/audioEngine";
import { allowedCode, defaultBindings, pedalIds, PedalController, validBindings, type Bindings, type Pedal } from "../events/pedals";
import { browserStorage, readStored, storageKey, writeStored } from "../lib/storage";

const labels = { sustain: "Sustain (damper)", sostenuto: "Sostenuto", soft: "Soft (una corda)", none: "No pedals" };
export default function PedalControls({ active, clearRef }: { active: boolean; clearRef?: { current: (() => void) | null } }) {
  const [state, setState] = useState<PedalState>({ sustain: false, sostenuto: false, soft: false });
  const [bindings, setBindings] = useState(defaultBindings);
  const [capture, setCapture] = useState<Pedal | null>(null);
  const [feedback, setFeedback] = useState("");
  const controller = useRef<PedalController | null>(null);
  useEffect(() => {
    const loaded = readStored("pedal-bindings", 1, defaultBindings(), validBindings);
    setBindings(loaded);
    try {
      const area = browserStorage();
      const raw = area?.getItem(storageKey("pedal-bindings", 1));
      if (!area || (raw && !validBindings(JSON.parse(raw)))) setFeedback("Saved bindings unavailable or invalid; using unassigned defaults.");
    } catch { setFeedback("Saved bindings could not be read; using unassigned defaults."); }
    const owner = new PedalController(loaded, s => browserAudio.setPedals(s), setState);
    controller.current = owner;
    if (clearRef) clearRef.current = () => owner.clear();
    const unsubscribe = browserAudio.subscribeInvalidation(() => owner.clear(false));
    return () => { owner.clear(); unsubscribe(); controller.current = null; if (clearRef) clearRef.current = null; };
  }, [clearRef]);
  useEffect(() => {
    const owner = controller.current;
    if (!active) owner?.clear();
    const clear = () => owner?.clear();
    const visibility = () => { if (document.hidden) clear(); };
    const down = (e: KeyboardEvent) => {
      if (capture) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.repeat || e.isComposing) return;
        if (e.code === "Escape") { setCapture(null); return; }
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !allowedCode(e.code)) {
          setFeedback("Choose a letter, digit, or numpad digit without modifiers. Browser/OS shortcuts cannot be captured reliably."); return;
        }
        if (pedalIds.some(id => id !== capture && bindings[id].code === e.code)) {
          setFeedback("That key is already assigned to another pedal."); return;
        }
        save({ ...bindings, [capture]: { ...bindings[capture], code: e.code } });
        setCapture(null); return;
      }
      if (!active || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey ||
          (e.target instanceof Element && e.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=dialog]"))) return;
      if (owner?.keydown(e.code, e.repeat)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => owner?.keyup(e.code);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", visibility);
    };
    function save(next: Bindings) {
      owner?.rebind(next); setBindings(next);
      setFeedback(writeStored("pedal-bindings", 1, next).ok ? "Binding saved." : "Storage blocked: binding works for this page only.");
    }
  }, [active, capture, bindings]);
  function save(next: Bindings) {
    controller.current?.rebind(next); setBindings(next);
    setFeedback(writeStored("pedal-bindings", 1, next).ok ? "Bindings saved." : "Storage blocked: bindings work for this page only.");
  }
  return <section aria-label="Piano pedals" className="px-4 py-2 text-ink">
    <div className="flex flex-wrap justify-center gap-2">
      {pedalIds.map(id => {
        const on = id === "none" ? !state.sustain && !state.sostenuto && !state.soft : state[id];
        return <button key={id} type="button" role="switch" aria-checked={on} aria-describedby="pedal-help"
          disabled={!active} onClick={() => controller.current?.toggle(id)} className="ms-key focus-visible:outline-2 focus-visible:outline-offset-2">
          {labels[id]}: {on ? "On" : "Off"}
        </button>;
      })}
    </div>
    <p className="text-sm text-ink-muted">Live sound only: pedals are not recorded or exported. <a className="underline" href="/documentation#pedal-recording">Recording/replay follow-up</a>.</p>
    <details><summary>Pedal keys and hardware setup</summary>
      <p id="pedal-help">No pedals clears all pedal sources and captures, keeping physically held notes sounding. Release and press held pedal keys again after clearing. Losing focus clears pedals.</p>
      <p>Configure keyboard-style USB/Bluetooth hardware with matching keys. Hold uses keydown/keyup; Toggle uses a tap per action. Test while playing. Compatibility depends on the device. Bindings use physical KeyboardEvent.code positions; printed letters may differ by layout. OS/browser intercepted shortcuts may never arrive.</p>
      <p>Pedals affect live sound only; recordings and MIDI exports contain physical notes without pedals. Pedal recording/replay remains a follow-up: <a className="underline" href="/documentation#pedal-recording">pedal recording/replay</a>.</p>
      {pedalIds.map(id => <div key={id} className="flex flex-wrap gap-2 items-center py-1">
        <span>{labels[id]}: {bindings[id].code || "Unassigned"}</span>
        <button type="button" className="ms-key" onClick={() => { controller.current?.clear(); setCapture(id); setFeedback("Press a letter or digit to assign; Escape cancels."); }}>Assign {labels[id]}</button>
        <select aria-label={`${labels[id]} mode`} value={bindings[id].mode} disabled={id === "none"}
          onChange={e => save({ ...bindings, [id]: { ...bindings[id], mode: e.target.value } })}>
          <option value="hold">Hold</option><option value="toggle">Toggle</option>
        </select>
        <button type="button" className="ms-key" onClick={() => save({ ...bindings, [id]: { ...bindings[id], code: "" } })}>Clear {labels[id]} key</button>
      </div>)}
      <button type="button" className="ms-key" onClick={() => { setCapture(null); save(defaultBindings()); }}>Restore unassigned defaults</button>
    </details>
    <p role="status">{capture ? `Assigning ${labels[capture]}. ` : ""}{feedback}</p>
  </section>;
}
