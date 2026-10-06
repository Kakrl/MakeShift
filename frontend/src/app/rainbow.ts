/**
 * Rainbow order used for anything numbered or sequential (calibration
 * steps, onboarding steps, count-in beats). `fill` carries white text, so
 * yellow uses the deeper yellow-strong there; `color` is for text-free
 * decoration and keeps the bright yellow. Class names are literal so
 * Tailwind can see them.
 */
export const RAINBOW = [
  { name: "red", fill: "bg-red text-white", soft: "bg-red-soft", color: "var(--color-red)" },
  { name: "yellow", fill: "bg-yellow-strong text-white", soft: "bg-yellow-soft", color: "var(--color-yellow)" },
  { name: "green", fill: "bg-green text-white", soft: "bg-green-soft", color: "var(--color-green)" },
  { name: "blue", fill: "bg-blue text-white", soft: "bg-blue-soft", color: "var(--color-blue)" },
  { name: "purple", fill: "bg-purple text-white", soft: "bg-purple-soft", color: "var(--color-purple)" },
] as const;

export const rainbow = (i: number) => RAINBOW[i % RAINBOW.length];
