import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// Generated from the original World.serialize() with seed 111. Version 1
// (1e95b43) is at tick zero. Version 2 (735a568) advanced 127 ticks, with
// a +1.25 nutrient pulse at (.2,.4) on tick 13 and light at (.7,.3) on 61.
export function readLegacyWorld(version) {
  const file = new URL("./world-v" + version + ".json.gz", import.meta.url);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
}
