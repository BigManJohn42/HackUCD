// Plan a journey on buses, trains and Luas, optionally with stopovers.
// Options work with or without dashes, and names don't need quotes, so this works the
// same from PowerShell, cmd and bash (PowerShell + npm mangle "--" and quoted args):
//   npm run plan ucd heuston
//   npm run plan ucd galway via athlone              (2 hour stopover in Athlone)
//   npm run plan ucd galway via athlone stay 90      (90 minute stopover)
//   npm run plan ucd cork via kildare stay 60 via limerick junction stay 30   (several stopovers)
//   npm run plan ucd eyre square depart 08:30 date 2026-10-12
//   npm run plan ucd heuston json                    (raw result for the frontend)
import { planJourney, matchQuality, fmt } from "../src/planner.js";

const KEYWORDS = new Set(["via", "stay", "depart", "date", "json"]);
const keyword = (tok) => {
  const k = tok.replace(/^-+/, "").toLowerCase();
  return KEYWORDS.has(k) ? k : null;
};

const words = [];
const vias = [];
const stays = [];
let defaultStay = 120;
const opts = {};
const argv = process.argv.slice(2).filter((a) => a !== "--");
for (let i = 0; i < argv.length; i++) {
  const k = keyword(argv[i]);
  if (!k) words.push(argv[i]);
  else if (k === "json") opts.json = true;
  // "stay" applies to the via just before it; before any via it's the default for all of them
  else if (k === "stay") {
    const mins = Number(argv[++i]);
    if (vias.length) stays[vias.length - 1] = mins;
    else defaultStay = mins;
  }
  else if (k === "depart") opts.depart = argv[++i];
  else if (k === "date") opts.date = argv[++i];
  else {
    // via takes every word up to the next option, so "via dun laoghaire" works unquoted
    const place = [];
    while (i + 1 < argv.length && !keyword(argv[i + 1])) place.push(argv[++i]);
    vias.push(place.join(" "));
  }
}

const usage = () => {
  if (["via", "stay", "depart", "date", "json"].some((k) => process.env[`npm_config_${k}`] !== undefined)) {
    console.error("npm swallowed the --options (PowerShell drops the \"--\"). Write them without dashes instead:");
  }
  console.error("Usage: npm run plan <from> <to> [via <place>]... [stay <minutes>] [depart HH:MM] [date YYYY-MM-DD] [json]");
  console.error("Example: npm run plan ucd eyre square via athlone stay 90 depart 08:00");
  process.exit(1);
};
if (words.length < 2 || vias.some((v) => !v)) usage();

// Split the words into from/to: try every split and keep the one where both sides best name a stop.
let from, to, bestScore = Infinity;
for (let cut = 1; cut < words.length; cut++) {
  const a = words.slice(0, cut).join(" "), b = words.slice(cut).join(" ");
  const score = matchQuality(a) + matchQuality(b);
  if (score < bestScore) [from, to, bestScore] = [a, b, score];
}
if (!from) {
  console.error(`Couldn't find two places in "${words.join(" ")}".`);
  usage();
}
const positional = [from, to];

const started = Date.now();
let result;
try {
  opts.stayMins = vias.map((_, k) => stays[k] ?? defaultStay);
  result = planJourney({ from: positional[0], to: positional[1], vias, ...opts, log: (msg) => console.error(msg) });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const mins = (secs) => `${Math.max(1, Math.round(secs / 60))} min`;
const duration = (secs) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
};

result.segments.forEach((seg, k) => {
  console.log(`\n${seg.from}  ->  ${seg.to}`);
  console.log(`Leave ${fmt(seg.leaveAt)}, arrive ${fmt(seg.arriveAt)} (${duration(seg.arriveAt - seg.leaveAt)})\n`);
  if (seg.originWalk.secs > 60) console.log(`  ${fmt(seg.leaveAt)}  Walk ${mins(seg.originWalk.secs)} to ${seg.originWalk.toName}`);
  for (const leg of seg.legs) {
    if (leg.type === "walk") {
      console.log(`  ${fmt(leg.arrive - leg.secs)}  Walk ${mins(leg.secs)} to ${leg.toName}${leg.toCode ? ` (stop ${leg.toCode})` : ""}`);
    } else {
      const label = leg.mode === "Bus" ? `Bus ${leg.route}` : `${leg.mode} ${leg.route}`;
      console.log(`  ${fmt(leg.depart)}  ${label}${leg.headsign ? ` towards ${leg.headsign}` : ""}`);
      console.log(`           from ${leg.fromName}${leg.fromCode ? ` (stop ${leg.fromCode})` : ""}`);
      console.log(`  ${fmt(leg.arrive)}  get off at ${leg.toName}${leg.toCode ? ` (stop ${leg.toCode})` : ""}`);
    }
  }
  if (seg.destWalk.secs > 60) console.log(`  ${fmt(seg.arriveAt - seg.destWalk.secs)}  Walk ${mins(seg.destWalk.secs)} to ${seg.to} (arrive)`);
  if (k < result.segments.length - 1) {
    const stay = result.stays[k] * 60;
    console.log(`\n  -- Stopover in ${seg.to}: ${duration(stay)} (${fmt(seg.arriveAt)} - ${fmt(seg.arriveAt + stay)}) --`);
  }
});

if (!result.ok) {
  console.log(`\n${result.error}`);
  process.exit(1);
}
console.log(`\nTotal: leave ${fmt(result.leaveAt)}, arrive ${fmt(result.arriveAt)} (${duration(result.arriveAt - result.leaveAt)})`);
console.error(`(${from} -> ${to}, planned in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
