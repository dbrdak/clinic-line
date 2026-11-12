export const TIME_ZONE = "Europe/Warsaw";

export function toUnixMs(date: Date): number {
  const value = date.getTime();

  if (!Number.isFinite(value)) {
    throw new RangeError("Invalid date.");
  }

  return value;
}

export function fromUnixMs(value: number): Date {
  if (!Number.isInteger(value) || Math.abs(value) > 8_640_000_000_000_000) {
    throw new RangeError("Invalid Unix timestamp in milliseconds.");
  }

  return new Date(value);
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(toUnixMs(date) / 1000);
}

export function fromUnixSeconds(value: number): Date {
  if (!Number.isInteger(value)) {
    throw new RangeError("Unix seconds must be an integer.");
  }

  return fromUnixMs(value * 1000);
}

const calendar = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function warsawTime(date: Date): {
  date: string;
  hour: number;
  minute: number;
} {
  const parts = calendar.formatToParts(date);
  const part = (type: string) =>
    parts.find((value) => value.type === type)!.value;

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);

  value.setUTCDate(value.getUTCDate() + days);

  return value.toISOString().slice(0, 10);
}

/** Explicit Warsaw calendar time; rejects missing or ambiguous DST times. */
export function atWarsawTime(date: string, hour: number, minute = 0): Date {
  const localMs = Date.parse(
    `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  );
  const matches = [1, 2]
    .map((offset) => new Date(localMs - offset * 3_600_000))
    .filter((candidate) => {
      if (!Number.isFinite(candidate.getTime())) {
        return false;
      }

      const local = warsawTime(candidate);

      return (
        local.date === date && local.hour === hour && local.minute === minute
      );
    });

  if (matches.length !== 1) {
    throw new RangeError("Invalid or ambiguous Warsaw date and time.");
  }

  return matches[0]!;
}
