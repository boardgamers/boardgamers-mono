import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadline, elapsedSeconds, isPaused } from "./time.ts";

const oneMinute = 60;
const oneHour = 3600;
const oneHourMs = oneHour * 1000;
const oneDayMs = oneHourMs * 24;

function assertUTC(date: Date, expected: { year: number; month: number; day: number; hour: number; minute: number }) {
  assert.strictEqual(date.getUTCFullYear(), expected.year);
  assert.strictEqual(date.getUTCMonth() + 1, expected.month);
  assert.strictEqual(date.getUTCDate(), expected.day);
  assert.strictEqual(date.getUTCHours(), expected.hour);
  assert.strictEqual(date.getUTCMinutes(), expected.minute);
}

describe("Time Utils", () => {
  // April 16, 2020 09:47 Europe/Paris (CEST = UTC+2) → UTC 07:47
  const summerDate = new Date("2020-04-16T09:47:00+02:00");
  // March 16, 2020 09:47 Europe/Paris (CET = UTC+1) → UTC 08:47
  const winterDate = new Date("2020-03-16T09:47:00+01:00");

  describe("isPaused", () => {
    it("should be paused when time is before a in [a, b] and a < b", () => {
      assert.strictEqual(isPaused(summerDate, { start: 8 * oneHour, end: 10 * oneHour }), true);
      assert.strictEqual(isPaused(winterDate, { start: 9 * oneHour, end: 10 * oneHour }), true);
    });
    it("should be running when time is between [a, b] and a < b", () => {
      assert.strictEqual(isPaused(summerDate, { start: 7 * oneHour, end: 10 * oneHour }), false);
      assert.strictEqual(isPaused(winterDate, { start: 8 * oneHour, end: 10 * oneHour }), false);
    });
    it("should be paused when time is after b in [a, b] and a < b", () => {
      assert.strictEqual(isPaused(summerDate, { start: 3 * oneHour, end: 7 * oneHour }), true);
      assert.strictEqual(isPaused(winterDate, { start: 4 * oneHour, end: 8 * oneHour }), true);
    });
    it("should be paused when time is before a and after b in [a, b] and a > b", () => {
      assert.strictEqual(isPaused(summerDate, { start: 8 * oneHour, end: 7 * oneHour }), true);
      assert.strictEqual(isPaused(winterDate, { start: 9 * oneHour, end: 8 * oneHour }), true);
    });
    it("should be running when time is before b in [a, b] and a > b", () => {
      assert.strictEqual(isPaused(summerDate, { start: 11 * oneHour, end: 8 * oneHour }), false);
      assert.strictEqual(isPaused(winterDate, { start: 12 * oneHour, end: 9 * oneHour }), false);
    });
    it("should be running when time is after a in [a, b] and a > b", () => {
      assert.strictEqual(isPaused(summerDate, { start: 7 * oneHour, end: 2 * oneHour }), false);
      assert.strictEqual(isPaused(winterDate, { start: 8 * oneHour, end: 1 * oneHour }), false);
    });
  });

  describe("elapsedSeconds", () => {
    it("should work when the timer has always been paused", () => {
      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 10 * oneHour, end: 12 * oneHour }, summerDate.getTime() + oneHourMs * 2),
        0,
      );
    });
    it("should work when the timer is currently paused", () => {
      assert.strictEqual(
        isPaused(new Date(summerDate.getTime() + oneHourMs * 2), { start: 7 * oneHour, end: 9 * oneHour }),
        true,
      );
      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 7 * oneHour, end: 9 * oneHour }, summerDate.getTime() + oneHourMs * 2),
        oneHour + oneMinute * 13,
      );

      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 10 * oneHour, end: 12 * oneHour }, summerDate.getTime() + oneDayMs),
        2 * oneHour,
      );
      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 8 * oneHour, end: 10 * oneHour }, summerDate.getTime() + oneDayMs),
        2 * oneHour,
      );
    });

    it("should work when the timer is currently running", () => {
      assert.strictEqual(
        isPaused(new Date(summerDate.getTime() + oneHourMs * 2), { start: 8 * oneHour, end: 10 * oneHour }),
        false,
      );
      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 8 * oneHour, end: 10 * oneHour }, summerDate.getTime() + oneHourMs * 2),
        oneHour + oneMinute * 47,
      );
      assert.strictEqual(
        elapsedSeconds(
          summerDate,
          { start: 8 * oneHour, end: 10 * oneHour },
          summerDate.getTime() + oneHourMs * 2 + oneDayMs * 10,
        ),
        10 * 2 * oneHour + oneHour + oneMinute * 47,
      );

      assert.strictEqual(
        isPaused(new Date(summerDate.getTime() + oneHourMs * 1), { start: 7 * oneHour, end: 9 * oneHour }),
        false,
      );
      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 7 * oneHour, end: 9 * oneHour }, summerDate.getTime() + oneHourMs * 1),
        oneHour,
      );

      assert.strictEqual(isPaused(summerDate, { start: 7 * oneHour, end: 9 * oneHour }), false);
      assert.strictEqual(
        elapsedSeconds(summerDate, { start: 7 * oneHour, end: 9 * oneHour }, summerDate.getTime() + oneDayMs),
        oneHour * 2,
      );
    });

    it("should return 0 if the given date is in the future", () => {
      assert.strictEqual(
        elapsedSeconds(
          summerDate,
          { start: 10 * oneHour, end: 12 * oneHour },
          summerDate.getTime() - oneHourMs * 24 * 100,
        ),
        0,
      );
    });
  });

  describe("deadline", () => {
    it("should work when timer is currently paused", () => {
      assertUTC(deadline(50 * oneMinute, { start: 8 * oneHour, end: 9 * oneHour }, summerDate), {
        year: 2020,
        month: 4,
        day: 16,
        hour: 8,
        minute: 50,
      });

      assertUTC(deadline(oneHour + 10 * oneMinute, { start: 8 * oneHour, end: 9 * oneHour }, summerDate), {
        year: 2020,
        month: 4,
        day: 17,
        hour: 8,
        minute: 10,
      });

      assertUTC(deadline(oneHour, { start: 8 * oneHour, end: 9 * oneHour }, summerDate), {
        year: 2020,
        month: 4,
        day: 16,
        hour: 9,
        minute: 0,
      });

      assertUTC(
        deadline(
          20 * oneMinute,
          { start: 8 * oneHour, end: 9 * oneHour },
          new Date(summerDate.getTime() + 2 * oneHourMs),
        ),
        { year: 2020, month: 4, day: 17, hour: 8, minute: 20 },
      );

      assertUTC(deadline(20 * oneMinute, { start: 9 * oneHour, end: 5 * oneHour }, summerDate), {
        year: 2020,
        month: 4,
        day: 16,
        hour: 9,
        minute: 20,
      });

      assertUTC(
        deadline(
          20 * oneMinute + 10 * oneHour,
          { start: 8 * oneHour, end: 9 * oneHour },
          new Date(summerDate.getTime() + 2 * oneHourMs),
        ),
        { year: 2020, month: 4, day: 27, hour: 8, minute: 20 },
      );
    });

    it("should work when timer is currently running", () => {
      assertUTC(deadline(50 * oneMinute, { start: 7 * oneHour, end: 9 * oneHour }, summerDate), {
        year: 2020,
        month: 4,
        day: 16,
        hour: 8,
        minute: 37,
      });

      assertUTC(deadline(50 * oneMinute, { start: 7 * oneHour, end: 8 * oneHour }, summerDate), {
        year: 2020,
        month: 4,
        day: 17,
        hour: 7,
        minute: 37,
      });
    });
  });
});
