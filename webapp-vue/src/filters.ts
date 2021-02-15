import marked from "marked";
import Vue from "vue";
import { dateFromObjectId, niceDate, timerTime } from "./utils";

function pluralize(count: number, str: string, { showCount = true } = { showCount: true }) {
  return showCount ? `${count} ${str}${+count >= 2 ? "s" : ""}` : `${str}${+count >= 2 ? "s" : ""}`;
}

Vue.filter("pluralize", pluralize);

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

Vue.filter("duration", (seconds: number) => {
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
});

Vue.filter("shortDuration", (seconds: number) => {
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
          Math.floor(n) +
          timeRanges[i].name[0] +
          " " +
          Math.floor((seconds - gap * Math.floor(n)) / timeRanges[i - 1].value) +
          timeRanges[i - 1].name[0]
        );
      }
      return pluralize(Math.floor(n), timeRanges[i].name);
    }
  }
});

Vue.filter("marked", (text: string) => marked(text));
Vue.filter("niceDate", niceDate);
Vue.filter("timerTime", timerTime);

Vue.filter("dateFromObjectId", dateFromObjectId);

Vue.filter("sign", (x: number) => (x >= 0 ? "+" : "-"));

Vue.filter("upperFirst", (text: string) => text[0].toUpperCase() + text.slice(1));
