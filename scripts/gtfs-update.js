// Download and unzip a static GTFS feed from Transport for Ireland into data/gtfs/.
//   npm run gtfs:update                    -> feed from GTFS_FEED in .env (default GTFS_Irish_Rail)
//   npm run gtfs:update -- GTFS_Realtime   -> a specific feed
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import { GTFS_DIR } from "../src/gtfs.js";

const feed = process.argv[2] ?? process.env.GTFS_FEED ?? "GTFS_Irish_Rail";
const url = `https://www.transportforireland.ie/transitData/Data/${feed}.zip`;
const zipPath = path.join(GTFS_DIR, "..", `${feed}.zip`);

fs.mkdirSync(GTFS_DIR, { recursive: true });

console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipPath));
console.log(`Saved ${(fs.statSync(zipPath).size / 1e6).toFixed(1)} MB`);

// Replace the previous feed's files so feeds are never mixed.
for (const f of fs.readdirSync(GTFS_DIR)) fs.rmSync(path.join(GTFS_DIR, f));

const zip = await new Promise((resolve, reject) =>
  yauzl.open(zipPath, { lazyEntries: true }, (err, z) => (err ? reject(err) : resolve(z))),
);
await new Promise((resolve, reject) => {
  zip.on("error", reject);
  zip.on("end", resolve);
  zip.on("entry", (entry) => {
    const name = path.basename(entry.fileName); // GTFS is flat; basename also blocks path traversal
    if (!name.endsWith(".txt")) return zip.readEntry();
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      pipeline(stream, fs.createWriteStream(path.join(GTFS_DIR, name)))
        .then(() => {
          console.log(`  ${name.padEnd(22)} ${(entry.uncompressedSize / 1e6).toFixed(1)} MB`);
          zip.readEntry();
        })
        .catch(reject);
    });
  });
  zip.readEntry();
});

fs.writeFileSync(path.join(GTFS_DIR, "FEED"), `${feed}\n${new Date().toISOString()}\n`);
console.log(`Extracted to ${GTFS_DIR}`);
