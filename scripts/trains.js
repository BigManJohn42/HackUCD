// Live Irish Rail / DART data (no API key needed).
//   npm run trains                    -> trains running right now
//   npm run trains -- connolly        -> live departures board for a station
//   npm run trains -- connolly 30     -> ...only trains due in the next 30 min
import { findStations, getStationBoard, getCurrentTrains } from "../src/irishrail.js";

const args = process.argv.slice(2);
const minutes = /^\d+$/.test(args.at(-1) ?? "") && args.length > 1 ? Number(args.pop()) : 90;
const query = args.join(" ");

const fmtLate = (m) => (m == null ? "" : m > 0 ? `${m} min late` : m < 0 ? `${-m} min early` : "on time");

if (!query) {
  const trains = await getCurrentTrains();
  const running = trains.filter((t) => t.running);
  console.log(`${running.length} trains running now (${trains.length - running.length} more about to start)\n`);
  console.table(running.map((t) => ({ train: t.trainCode, direction: t.direction, status: t.message })));
  process.exit(0);
}

const matches = await findStations(query);
if (!matches.length) {
  console.log(`No station matches "${query}".`);
  process.exit(1);
}
if (matches.length > 1) {
  console.log(`"${query}" matches several stations, showing the first. Others: ${matches.slice(1).map((s) => `${s.name} (${s.code})`).join(", ")}\n`);
}

const station = matches[0];
const board = (await getStationBoard(station.code, minutes)).filter((t) => t.locationType !== "T");

console.log(`${station.name} (${station.code}): next ${minutes} min, ${new Date().toLocaleTimeString("en-IE")}\n`);
if (!board.length) console.log("No trains due.");
else
  console.table(
    board.map((t) => ({
      due: t.dueInMins == null ? "" : `${t.dueInMins} min`,
      train: t.trainCode,
      type: t.type,
      to: t.locationType === "D" ? `${t.destination} (terminates)` : t.destination,
      from: t.origin,
      scheduled: t.schDepart === "00:00" ? t.schArrival : t.schDepart,
      expected: t.expDepart === "00:00" ? t.expArrival : t.expDepart,
      status: fmtLate(t.lateMins),
      last_seen: t.lastLocation ?? t.status,
    })),
  );
