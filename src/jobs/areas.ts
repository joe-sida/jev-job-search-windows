/**
 * The places a person will work in, and whether a posting is in one of them.
 *
 * The list is the profile's (`preferences.areas`), never this file's: a state, a city, a metro
 * area in its own words, or "Remote". With no list every posting is in scope, which is how the
 * tool behaves for anyone who has not said otherwise.
 *
 * A posting that names no location at all is not ruled out. The tool cannot tell where it is, and
 * a job the person wanted is worse to lose than a job they did not.
 */

/** The United States by postal code, so "Maryland" and "MD" are one area and either may be written. */
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The state an area names, by its code or by its name, or null when the area is not a state. */
const stateOf = (area: string): string | null =>
  Object.keys(US_STATES).find((c) => c === area.toUpperCase() || US_STATES[c]?.toLowerCase() === area.toLowerCase()) ?? null;

/**
 * Whether one area covers the place a posting names.
 *
 * A state is matched by its code as written, in capitals, and by its full name whatever the case:
 * "VA" is Virginia, and "va" inside a word is not. The District of Columbia also answers to
 * "Washington, DC", and the state of Washington does not answer to it. Anything else is matched as
 * the words it is, so a city or a metro area works as typed.
 */
export function areaMatches(area: string, where: string): boolean {
  const want = area.trim();
  if (want === "") return false;
  if (/^remote$/i.test(want)) return /\bremote\b/i.test(where);
  const code = stateOf(want);
  if (!code) return new RegExp(escape(want), "i").test(where);
  if (new RegExp(`\\b${code}\\b`).test(where)) return true;
  if (code === "DC") return /District of Columbia|Washington,?\s*D\.?C\.?\b/i.test(where);
  // "Washington, DC" is not the state of Washington.
  if (code === "WA") return /\bWashington\b(?!,?\s*D\.?C)/i.test(where);
  // Virginia is the one state whose name sits inside another's, and West Virginia is not it.
  if (code === "VA") return /(?<!\bWest\s)\bVirginia\b/i.test(where);
  return new RegExp(`\\b${escape(US_STATES[code] as string)}\\b`, "i").test(where);
}

/** True when a posting is somewhere the person works, or says nowhere at all, or the person named no areas. */
export function inAreas(locations: readonly string[], areas: readonly string[] = []): boolean {
  if (areas.length === 0) return true;
  // A blank entry says as little as no entry: [] and ["", " "] are both a posting with no place.
  const all = locations.map((l) => l.trim()).filter((l) => l !== "").join(" | ");
  if (all === "") return true;
  return areas.some((a) => areaMatches(a, all));
}
