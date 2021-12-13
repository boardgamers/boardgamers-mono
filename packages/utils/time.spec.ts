import { expect } from "chai";
import { DateTime } from "luxon";
import { deadline, elapsedSeconds, isPaused } from "./time";

const oneMinute = 60;
const oneHour = 3600;
const oneHourMs = oneHour * 1000;
const oneDayMs = oneHourMs * 24;

describe("Time Utils", () => {
  const summerDate = DateTime.fromObject(
    {
      year: 2020,
      month: 4,
      day: 16,
      hour: 9,
      minute: 47,
    },
    { zone: "Europe/Paris" }
  ).toJSDate();
  const winterDate = DateTime.fromObject(
    {
      year: 2020,
      month: 3,
      day: 16,
      hour: 9,
      minute: 47,
    },
    {
      zone: "Europe/Paris",
    }
  ).toJSDate();

  describe("isPaused", () => {
    it("should be paused when time is before a in [a, b] and a < b", () => {
      expect(isPaused(summerDate, { start: 8 * oneHour, end: 10 * oneHour })).to.be.true;
      expect(isPaused(winterDate, { start: 9 * oneHour, end: 10 * oneHour })).to.be.true;
    });
    it("should be running when time is between [a, b] and a < b", () => {
      expect(isPaused(summerDate, { start: 7 * oneHour, end: 10 * oneHour })).to.be.false;
      expect(isPaused(winterDate, { start: 8 * oneHour, end: 10 * oneHour })).to.be.false;
    });
    it("should be paused when time is after b in [a, b] and a < b", () => {
      expect(isPaused(summerDate, { start: 3 * oneHour, end: 7 * oneHour })).to.be.true;
      expect(isPaused(winterDate, { start: 4 * oneHour, end: 8 * oneHour })).to.be.true;
    });
    it("should be paused when time is before a and after b in [a, b] and a > b", () => {
      expect(isPaused(summerDate, { start: 8 * oneHour, end: 7 * oneHour })).to.be.true;
      expect(isPaused(winterDate, { start: 9 * oneHour, end: 8 * oneHour })).to.be.true;
    });
    it("should be running when time is before b in [a, b] and a > b", () => {
      expect(isPaused(summerDate, { start: 11 * oneHour, end: 8 * oneHour })).to.be.false;
      expect(isPaused(winterDate, { start: 12 * oneHour, end: 9 * oneHour })).to.be.false;
    });
    it("should be running when time is after a in [a, b] and a > b", () => {
      expect(isPaused(summerDate, { start: 7 * oneHour, end: 2 * oneHour })).to.be.false;
      expect(isPaused(winterDate, { start: 8 * oneHour, end: 1 * oneHour })).to.be.false;
    });
  });

  describe("elapsedSeconds", () => {
    it("should work when the timer has always been paused", () => {
      expect(
        elapsedSeconds(summerDate, { start: 10 * oneHour, end: 12 * oneHour }, summerDate.getTime() + oneHourMs * 2)
      ).to.equal(0);
    });
    it("should work when the timer is currently paused", () => {
      // Start at 7h47 GMT, now is 9h47 GMT, timer is 7h-9h
      expect(isPaused(new Date(summerDate.getTime() + oneHourMs * 2), { start: 7 * oneHour, end: 9 * oneHour })).to.be
        .true;
      expect(
        elapsedSeconds(summerDate, { start: 7 * oneHour, end: 9 * oneHour }, summerDate.getTime() + oneHourMs * 2)
      ).to.equal(oneHour + oneMinute * 13);

      // One whole day with a 2 hour timer
      expect(
        elapsedSeconds(summerDate, { start: 10 * oneHour, end: 12 * oneHour }, summerDate.getTime() + oneDayMs)
      ).to.equal(2 * oneHour);
      expect(
        elapsedSeconds(summerDate, { start: 8 * oneHour, end: 10 * oneHour }, summerDate.getTime() + oneDayMs)
      ).to.equal(2 * oneHour);
    });

    it("should work when the timer is currently running", () => {
      // Start at 7h47 GMT, now is 9h47, timer is 8h-10h
      expect(isPaused(new Date(summerDate.getTime() + oneHourMs * 2), { start: 8 * oneHour, end: 10 * oneHour })).to.be
        .false;
      expect(
        elapsedSeconds(summerDate, { start: 8 * oneHour, end: 10 * oneHour }, summerDate.getTime() + oneHourMs * 2)
      ).to.equal(oneHour + oneMinute * 47);
      expect(
        elapsedSeconds(
          summerDate,
          { start: 8 * oneHour, end: 10 * oneHour },
          summerDate.getTime() + oneHourMs * 2 + oneDayMs * 10
        )
      ).to.equal(10 * 2 * oneHour + oneHour + oneMinute * 47);

      // Start at 7h47 GMT, now is 8h47, timer is 7h-9h
      expect(isPaused(new Date(summerDate.getTime() + oneHourMs * 1), { start: 7 * oneHour, end: 9 * oneHour })).to.be
        .false;
      expect(
        elapsedSeconds(summerDate, { start: 7 * oneHour, end: 9 * oneHour }, summerDate.getTime() + oneHourMs * 1)
      ).to.equal(oneHour);

      expect(isPaused(summerDate, { start: 7 * oneHour, end: 9 * oneHour })).to.be.false;
      expect(
        elapsedSeconds(summerDate, { start: 7 * oneHour, end: 9 * oneHour }, summerDate.getTime() + oneDayMs)
      ).to.equal(oneHour * 2);
    });

    it("should return 0 if the given date is in the future", () => {
      expect(
        elapsedSeconds(
          summerDate,
          { start: 10 * oneHour, end: 12 * oneHour },
          summerDate.getTime() - oneHourMs * 24 * 100
        )
      ).to.equal(0);
    });
  });

  describe("deadline", () => {
    it("should work when timer is currently paused", () => {
      // Current time is 7h47 GMT, timer is 8h-9h, remaining time 50m, deadline should be 8h50
      const deadline1 = DateTime.fromJSDate(
        deadline(50 * oneMinute, { start: 8 * oneHour, end: 9 * oneHour }, summerDate),
        { zone: "utc" }
      );
      expect(deadline1).to.include({ year: 2020, month: 4, day: 16, hour: 8, minute: 50 });

      // Current time is 7h47 GMT, timer is 8h-9h, remaining time 1h10, deadline should be 8h10 of next day
      const deadline2 = DateTime.fromJSDate(
        deadline(oneHour + 10 * oneMinute, { start: 8 * oneHour, end: 9 * oneHour }, summerDate),
        { zone: "utc" }
      );
      expect(deadline2).to.include({ year: 2020, month: 4, day: 17, hour: 8, minute: 10 });

      // Current time is 7h47 GMT, timer is 8h-9h, remaining time 1h, deadline should be 9h00
      const deadline3 = DateTime.fromJSDate(deadline(oneHour, { start: 8 * oneHour, end: 9 * oneHour }, summerDate), {
        zone: "utc",
      });
      expect(deadline3).to.include({ year: 2020, month: 4, day: 16, hour: 9, minute: 0 });

      // Current time is 9h47 GMT, timer is 8h-9h, remaining time 20m, deadline should be 8h20 of next day
      const deadline4 = DateTime.fromJSDate(
        deadline(
          20 * oneMinute,
          { start: 8 * oneHour, end: 9 * oneHour },
          new Date(summerDate.getTime() + 2 * oneHourMs)
        ),
        { zone: "utc" }
      );
      expect(deadline4).to.include({ year: 2020, month: 4, day: 17, hour: 8, minute: 20 });

      // Current time is 7h47 GMT, timer is 9h-5h, remaining time 20m, deadline should be 9h20
      const deadline5 = DateTime.fromJSDate(
        deadline(20 * oneMinute, { start: 9 * oneHour, end: 5 * oneHour }, summerDate),
        { zone: "utc" }
      );
      expect(deadline5).to.include({ year: 2020, month: 4, day: 16, hour: 9, minute: 20 });

      // Current time is 9h47 GMT, timer is 8h-9h, remaining time 10h20m, deadline should be 8h20 eleven days in the future
      const deadline6 = DateTime.fromJSDate(
        deadline(
          20 * oneMinute + 10 * oneHour,
          { start: 8 * oneHour, end: 9 * oneHour },
          new Date(summerDate.getTime() + 2 * oneHourMs)
        ),
        { zone: "utc" }
      );
      expect(deadline6).to.include({ year: 2020, month: 4, day: 27, hour: 8, minute: 20 });
    });

    it("should work when timer is currently running", () => {
      // Current time is 7h47 GMT, timer is 7h-9h, remaining time 50m, deadline should be 8h37
      const deadline1 = DateTime.fromJSDate(
        deadline(50 * oneMinute, { start: 7 * oneHour, end: 9 * oneHour }, summerDate),
        { zone: "utc" }
      );
      expect(deadline1).to.include({ year: 2020, month: 4, day: 16, hour: 8, minute: 37 });

      // Current time is 7h47 GMT, timer is 7h-8h, remaining time 50m, deadline should be 7h37 of next day
      const deadline2 = DateTime.fromJSDate(
        deadline(50 * oneMinute, { start: 7 * oneHour, end: 8 * oneHour }, summerDate),
        { zone: "utc" }
      );
      expect(deadline2).to.include({ year: 2020, month: 4, day: 17, hour: 7, minute: 37 });
    });
  });
});
