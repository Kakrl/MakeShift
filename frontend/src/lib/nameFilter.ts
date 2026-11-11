// Shared-name filter (#280); list source in docs/supabase.md.
import blockedWords from "./blockedNameWords.json";

const BLOCKED: ReadonlySet<string> = new Set(blockedWords);
// No common English word contains these.
const BLOCKED_ROOTS = ["fuck"];
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
};

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/(?<=\p{L})[!|](?=\p{L})/gu, "i")
    .replace(/[0134578@$]/g, (char) => LEET[char]);
}

function variants(word: string): string[] {
  const forms = new Set([word, word.replace(/(.)\1{2,}/g, "$1"), word.replace(/(.)\1{2,}/g, "$1$1")]);
  // Plurals only: "spices" minus "es" is a slur.
  for (const form of [...forms]) if (form.length > 3 && form.endsWith("s")) forms.add(form.slice(0, -1));
  return [...forms];
}

const blockedWord = (word: string) =>
  variants(word).some((form) => BLOCKED.has(form) || BLOCKED_ROOTS.some((root) => form.includes(root)));

/** Whole-word match, so "Scunthorpe" passes; "f u c k" is joined first. */
export function hasBlockedWord(text: string): boolean {
  const words = normalize(text).split(/[^\p{L}]+/u).filter(Boolean);
  const spelled: string[] = [];
  let run = "";
  for (const word of [...words, ""]) {
    if (word.length === 1) {
      run += word;
      continue;
    }
    if (run.length >= 3) spelled.push(run);
    run = "";
  }
  return [...words, ...spelled].some(blockedWord);
}
