export function timerTime(value: number) {
  const d = new Date();
  const date = new Date(d.setHours(0, 0, 0, 0) - d.getTimezoneOffset() * 60000 + value * 1000);

  return `${date.getHours().toString().padStart(2, "0")}h${
    date.getMinutes() ? date.getMinutes().toString().padStart(2, "0") : ""
  }`;
}

export function niceDate(date: string | Date): string {
  if (!date) {
    return date as any;
  }
  if (typeof date === "string") {
    if (date.length > 10) {
      const ms = Date.parse(date);

      if (ms) {
        return niceDate(new Date(ms));
      }
      return date;
    }
    if (date.length === 8) {
      return date.substr(6, 2) + "/" + date.substr(4, 2) + "/" + date.substr(2, 2);
    } else {
      return date.substr(8, 2) + "/" + date.substr(5, 2) + "/" + date.substr(2, 2);
    }
  } else {
    return (
      String(date.getDate()).padStart(2, "0") +
      "/" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "/" +
      date.getFullYear().toString().substr(2, 2)
    );
  }
}

const timeRanges = [
  {
    name: "second",
    value: 1,
  },
  {
    name: "minute",
    value: 60,
  },
  {
    name: "hour",
    value: 3600,
  },
  {
    name: "day",
    value: 24 * 3600,
  },
];

function pluralize(count: number, str: string, { showCount = true } = { showCount: true }) {
  return showCount ? `${count} ${str}${+count >= 2 ? "s" : ""}` : `${str}${+count >= 2 ? "s" : ""}`;
}

export function duration(seconds: number) {
  for (let i = 0; i < timeRanges.length; i++) {
    if (i === timeRanges.length - 1 || timeRanges[i + 1].value > seconds) {
      const n = seconds / timeRanges[i].value;
      const gap = timeRanges[i].value;
      if (
        gap < seconds &&
        seconds % gap !== 0 &&
        i > 0 &&
        Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) > 0
      ) {
        return (
          pluralize(Math.floor(n), timeRanges[i].name) +
          " " +
          pluralize(Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value), timeRanges[i - 1].name)
        );
      }
      return pluralize(Math.floor(n), timeRanges[i].name);
    }
  }
}
