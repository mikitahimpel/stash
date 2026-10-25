import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { tryCall, type BrowserError } from "./browser-error.ts";

/** A named alarm. */
export interface Alarm {
  readonly name: string;
  /** When it fires next (or fired), in epoch milliseconds. */
  readonly scheduledTime: number;
  /** Set for repeating alarms. */
  readonly periodInMinutes: number | null;
}

/**
 * When an alarm fires. At least one of `delayInMinutes` and `periodInMinutes` must be set.
 * Firefox clamps both to at least about 30 seconds in released builds.
 */
export interface AlarmSchedule {
  readonly delayInMinutes?: number;
  readonly periodInMinutes?: number;
}

/**
 * Scheduled background work (`browser.alarms`). Use alarms instead of `setInterval`: the browser
 * suspends the event page between events, and an alarm wakes it again.
 */
export class Alarms extends Context.Service<
  Alarms,
  {
    /** Creates the alarm, replacing an existing alarm with the same name. */
    readonly create: (name: string, schedule: AlarmSchedule) => Effect.Effect<void, BrowserError>;
    /** Cancels the alarm. `false` if there was none with that name. */
    readonly clear: (name: string) => Effect.Effect<boolean, BrowserError>;
    readonly list: Effect.Effect<ReadonlyArray<Alarm>, BrowserError>;
    /**
     * Every alarm that fires from now on. Run it when the background page starts, before its
     * first `await`, so the browser sees the listener when it wakes the page for an alarm.
     */
    readonly fired: Stream.Stream<Alarm>;
  }
>()("@stash/ext-platform/Alarms") {}

const fromBrowser = (alarm: browser.alarms.Alarm): Alarm => ({
  name: alarm.name,
  scheduledTime: alarm.scheduledTime,
  periodInMinutes: alarm.periodInMinutes ?? null,
});

/**
 * The live service, backed by `browser.alarms`. Needs the `alarms` permission.
 */
export const layer: Layer.Layer<Alarms> = Layer.succeed(Alarms)({
  create: (name, schedule) =>
    Effect.sync(() => {
      const info: browser.alarms._CreateAlarmInfo = {};
      if (schedule.delayInMinutes !== undefined) info.delayInMinutes = schedule.delayInMinutes;
      if (schedule.periodInMinutes !== undefined) info.periodInMinutes = schedule.periodInMinutes;
      browser.alarms.create(name, info);
    }),
  clear: (name) => tryCall("alarms.clear", () => browser.alarms.clear(name)),
  list: Effect.map(
    tryCall("alarms.getAll", () => browser.alarms.getAll()),
    (alarms) => alarms.map(fromBrowser),
  ),
  fired: Stream.callback<Alarm>((queue) => {
    const listener = (alarm: browser.alarms.Alarm) => Queue.offerUnsafe(queue, fromBrowser(alarm));
    return Effect.acquireRelease(
      Effect.sync(() => browser.alarms.onAlarm.addListener(listener)),
      () => Effect.sync(() => browser.alarms.onAlarm.removeListener(listener)),
    );
  }),
});
