// `node scripts/at-wall-clock.ts <HH:MM>` prints the time zone in which the machine's clock now
// reads closest to HH:MM (at most 30 minutes off: zones are at most 30 minutes apart around the
// clock), and on stderr what it reads there. The CI job `layout-audit` puts it into `TZ` to run the
// browser checks just after and just before midnight (#188), which is when a check that read the
// wall clock got another day group: they must pass at any hour, on the checks' own clock
// (`scripts/check-clock.ts`). Time zones stand in for setting the clock, which a runner can't.
import * as Url from "node:url";

/** The whole-hour zones, so that every hour of the day has one. */
const etc = Array.from({ length: 27 }, (_, i) => i - 14).map((offset) =>
  offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "+" : "-"}${Math.abs(offset)}`,
);

export const zones: ReadonlyArray<string> = [...Intl.supportedValuesOf("timeZone"), ...etc];

/** The minutes since midnight in `zone` at `instant`. */
export const minutesIn = (zone: string, instant: number): number => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return part("hour") * 60 + part("minute");
};

const day = 24 * 60;

/** How far apart two times of day are, in minutes, around midnight too. */
const apart = (a: number, b: number) => {
  const d = Math.abs(a - b) % day;
  return Math.min(d, day - d);
};

/** The zone in which the clock reads closest to `hhmm` at `instant`. */
export const zoneAt = (hhmm: string, instant: number): string => {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (match === null) throw new Error(`expected HH:MM, got ${hhmm}`);
  const target = Number(match[1]) * 60 + Number(match[2]);
  let best = { zone: zones[0]!, off: day };
  for (const zone of zones) {
    const off = apart(minutesIn(zone, instant), target);
    if (off < best.off) best = { zone, off };
  }
  return best.zone;
};

if (process.argv[1] === Url.fileURLToPath(import.meta.url)) {
  const zone = zoneAt(process.argv[2] ?? "", Date.now());
  const local = minutesIn(zone, Date.now());
  const clock = `${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}`;
  console.error(`${zone}: the clock reads ${clock}`);
  console.log(zone);
}
