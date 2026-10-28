export const MIN_NUMERATOR = 1;
export const MAX_NUMERATOR = 32;
export const DENOMINATORS = [1, 2, 4, 8, 16, 32] as const;
export type Meter = Readonly<{ numerator: number; denominator: number }>;
export const DEFAULT_METER: Meter = Object.freeze({ numerator: 4, denominator: 4 });

export function isMeter(value: unknown): value is Meter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { numerator, denominator } = value as Record<string, unknown>;
  return typeof numerator === "number" && Number.isInteger(numerator) &&
    numerator >= MIN_NUMERATOR && numerator <= MAX_NUMERATOR &&
    typeof denominator === "number" && DENOMINATORS.some((d) => d === denominator);
}

export function restoreMeter(value: unknown): Meter {
  return isMeter(value) ? { numerator: value.numerator, denominator: value.denominator } : { ...DEFAULT_METER };
}

export function beatIntervalMs(bpm: number, meter: Meter): number {
  if (!Number.isFinite(bpm) || bpm <= 0 || !isMeter(meter)) throw new RangeError("Invalid tempo or meter");
  return (60000 / bpm) * (4 / meter.denominator);
}

export const formatMeter = (meter: Meter) => `${meter.numerator}/${meter.denominator}`;
