import { describe, expect, it, vi } from "vitest";
import blockedWords from "../../frontend/src/lib/blockedNameWords.json";
import { hasBlockedWord } from "../../frontend/src/lib/nameFilter";
import { blockedNameMessage, validateUpload } from "../../frontend/src/lib/recordings";
import { uploadRecording, type RecordingsDeps } from "../../frontend/src/server/recordings";

const upload = (fields: { title?: string; authorName?: string }) => ({
  title: "My song",
  authorName: "Jo",
  deviceId: "device",
  bpm: 120,
  notes: [{ pitch: "C4", velocity: 80, startMs: 0, durationMs: 500 }],
  ...fields,
});

describe("name filter (#280)", () => {
  it("blocks listed words, plurals and simple disguises", () => {
    for (const name of [
      "Fuck this song",
      "SHIT",
      "you bitches",
      "Sh1t happens",
      "a55hole",
      "sh!t",
      "f u c k",
      "s.h.i.t",
      "shiiiiit",
      "fuckwit",
      "Fûck",
      "cunts",
      "dumb_ass",
      "Brea5t",
      "Beat-off",
    ])
      expect(hasBlockedWord(name), name).toBe(true);
  });

  it("passes words that only contain a blocked word", () => {
    for (const name of [
      "Scunthorpe",
      "Classic class assignment",
      "Bass line",
      "Spices and herbs",
      "Cumin",
      "Dickens carol",
      "Hello!",
      "Raccoon song",
      "Ms. Rivera",
      "Op. 3 no. 5",
      "Sonata 1",
      "Grandpa Joe",
      "A B C song",
      "Mary's little lamb",
      "Canon in C (both hands!)",
      "Twinkle on paper",
      "Ode to Joy with chords",
      "Jingle Bells, left hand too",
      "Up and down the scale",
      "C, F, G chord practice",
    ])
      expect(hasBlockedWord(name), name).toBe(false);
  });

  it("vendors the whole source list, normalized to sorted unique lowercase letters", () => {
    expect(blockedWords).toHaveLength(1367);
    for (const word of ["god", "kill", "beatoff", "breast", "childrens"]) expect(blockedWords).toContain(word);
    expect([...blockedWords].sort()).toEqual(blockedWords);
    expect(new Set(blockedWords).size).toBe(blockedWords.length);
    for (const word of blockedWords) expect(word).toMatch(/^[a-z]+$/);
  });

  it("refuses blocked titles and author names in the shared upload schema", () => {
    const title = validateUpload(upload({ title: "Shit song" }));
    expect(title).toEqual({ ok: false, issues: [{ field: "title", message: blockedNameMessage("title", "Shit song") }] });
    const author = validateUpload(upload({ authorName: "  b1tch " }));
    expect(author.ok).toBe(false);
    if (!author.ok) expect(author.issues).toEqual([{ field: "authorName", message: blockedNameMessage("authorName", "b1tch") }]);
    expect(validateUpload(upload({ title: "Scunthorpe waltz", authorName: "Dickens" })).ok).toBe(true);
    expect(blockedNameMessage("title", "Bass line")).toBeNull();
  });

  it("returns 400 from the upload route without touching the database", async () => {
    const fetchImpl = vi.fn();
    const deps: RecordingsDeps = {
      env: { SUPABASE_URL: "https://example.supabase.co/", SUPABASE_SECRET_KEY: "sb_secret_test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    };
    const response = await uploadRecording(
      new Request("http://localhost/api/recordings", { method: "POST", body: JSON.stringify(upload({ title: "fuck" })) }),
      deps,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues[0].field).toBe("title");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
