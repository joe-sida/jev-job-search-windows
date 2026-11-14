/**
 * Pure-code filters that run before JEV so the model never sees a job we
 * would refuse anyway. Each returns a reason string or null. The reasons
 * end up in the CSV so a skipped job is explainable.
 */
import { DISCOVER } from "../config.js";
import { inAreas } from "./areas.js";
import { wantsTitle } from "./wanted.js";
import { ageDays, destinationOf, type Job } from "./normalize.js";
import { isWalled } from "./walled.js";

const FRENCH_TITLE = /\b(stagiaire|développeur|developpeur|ingénieur|ingenieur|stage\b|alternance|poste)\b/i;

const US_STATE = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const US_CITY = /united states|\bUSA?\b|\bSF\b|\bNYC\b|\bLA\b|new york|san francisco|south san francisco|seattle|austin|boston|chicago|los angeles|bay area|palo alto|menlo park|mountain view|sunnyvale|san jose|redwood city|san mateo|santa clara|cupertino|oakland|berkeley|denver|atlanta|dallas|houston|miami|washington|arlington|bellevue|redmond|kirkland|portland|phoenix|philadelphia|pittsburgh|detroit|minneapolis|salt lake|las vegas|san diego|irvine|raleigh|durham|charlotte|nashville|columbus|cambridge, ma|jersey city|brooklyn|manhattan/i;
const CA_PROVINCE = /\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b|\bCanada\b|Toronto|Vancouver|Montreal|Montréal|Calgary|Edmonton|Ottawa|Waterloo|Kitchener|Victoria|Winnipeg|Halifax|Québec|Quebec|Mississauga|Burnaby|Markham/i;

export type LocationTier = "vancouver" | "canada" | "remote" | "us" | "international" | "unclear";

/** The country a posting's locations name, when one of them does: "San Francisco, Remote" is the United States, "KOHO (CAN), Remote" is Canada. */
export function countryOfLocations(locations: string[]): "Canada" | "United States" | null {
  const all = locations.join(" | ");
  if (CA_PROVINCE.test(all) || /\bCAN\b/.test(all)) return "Canada";
  if (US_STATE.test(all) || US_CITY.test(all)) return "United States";
  return null;
}

export function locationTier(locations: string[]): LocationTier {
  const all = locations.join(" | ");
  if (/vancouver|burnaby|richmond, bc|surrey, bc/i.test(all)) return "vancouver";
  if (CA_PROVINCE.test(all)) return "canada";
  if (/remote/i.test(all) && !/remote.*(us|united states|usa)\b/i.test(all)) return "remote";
  if (US_STATE.test(all) || US_CITY.test(all)) return "us";
  if (/remote/i.test(all)) return "remote";
  if (all.trim() === "") return "unclear";
  return "international";
}

/** us: the candidate's standing in the United States. A candidate who may work there is not ruled out by "no sponsorship". */
export function preFilter(
  job: Job,
  now = new Date(),
  walled: (url: string) => boolean = isWalled,
  us: { authorized: boolean; citizen: boolean } = { authorized: false, citizen: false },
  maxAgeDays: number = DISCOVER.maxAgeDays,
  /** True for a job on an account board where the person has an account, or let the tool make one. */
  mayApplyWithAccount: (url: string) => boolean = () => false,
  /** What the person asked their search to cover, from the profile. Everything empty narrows nothing. */
  wants: { areas?: readonly string[]; roleWords?: readonly string[] } = {},
): string | null {
  const link = destinationOf(job);
  if (job.ats === "workday" && !mayApplyWithAccount(link)) return "workday (needs an account per company)";
  if (job.ats === "taleo" || job.ats === "oracle" || job.ats === "successfactors" || job.ats === "icims" || job.ats === "amazon") {
    return `${job.ats} (needs an account)`;
  }
  if (job.ats === "indeed") return "indeed (apply on the employer's own site, by hand)";
  if (walled(link)) return "careers site needs an account";
  if ((DISCOVER.unreadableAts as readonly string[]).includes(job.ats)) return `${job.ats} (its form cannot be read yet)`;
  if (!inAreas(job.locations, wants.areas ?? [])) return "not in the places you work in";
  const age = ageDays(job, now);
  if (age !== null && age > maxAgeDays) return `posted ${age} days ago`;
  if (!wantsTitle(job.title, wants.roleWords ?? [])) return "title is not the kind of work you asked for";
  if (FRENCH_TITLE.test(job.title)) return "non-English posting";
  if (job.degrees.length && !job.degrees.some((d) => /bachelor|associate|bootcamp|certificate/i.test(d))) {
    return "advanced degree required";
  }
  const tier = locationTier(job.locations);
  if (tier === "us" && job.sponsorship === "none" && !us.authorized) return "US role, no sponsorship";
  if (tier === "us" && job.sponsorship === "citizenship" && !us.citizen) return "US citizenship required";
  if (/\bunpaid\b|volunteer/i.test(job.title)) return "unpaid";
  return null;
}
