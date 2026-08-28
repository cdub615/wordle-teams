/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as authEmails from "../authEmails.js";
import type * as billing from "../billing.js";
import type * as e2ePrune from "../e2ePrune.js";
import type * as e2eSeed from "../e2eSeed.js";
import type * as email from "../email.js";
import type * as fixtures from "../fixtures.js";
import type * as http from "../http.js";
import type * as inviteEmails from "../inviteEmails.js";
import type * as lib_board from "../lib/board.js";
import type * as lib_e2e from "../lib/e2e.js";
import type * as lib_html from "../lib/html.js";
import type * as lib_invite from "../lib/invite.js";
import type * as lib_polarErrors from "../lib/polarErrors.js";
import type * as lib_polarEvents from "../lib/polarEvents.js";
import type * as lib_polarIdentity from "../lib/polarIdentity.js";
import type * as lib_pushErrors from "../lib/pushErrors.js";
import type * as lib_puzzleDay from "../lib/puzzleDay.js";
import type * as lib_reminders from "../lib/reminders.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_scoringSystem from "../lib/scoringSystem.js";
import type * as lib_teamLimits from "../lib/teamLimits.js";
import type * as me from "../me.js";
import type * as migrate from "../migrate.js";
import type * as players from "../players.js";
import type * as polar from "../polar.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as reminderEmails from "../reminderEmails.js";
import type * as scores from "../scores.js";
import type * as scoringSystems from "../scoringSystems.js";
import type * as settings from "../settings.js";
import type * as status from "../status.js";
import type * as teams from "../teams.js";
import type * as testOtps from "../testOtps.js";
import type * as winners from "../winners.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  authEmails: typeof authEmails;
  billing: typeof billing;
  e2ePrune: typeof e2ePrune;
  e2eSeed: typeof e2eSeed;
  email: typeof email;
  fixtures: typeof fixtures;
  http: typeof http;
  inviteEmails: typeof inviteEmails;
  "lib/board": typeof lib_board;
  "lib/e2e": typeof lib_e2e;
  "lib/html": typeof lib_html;
  "lib/invite": typeof lib_invite;
  "lib/polarErrors": typeof lib_polarErrors;
  "lib/polarEvents": typeof lib_polarEvents;
  "lib/polarIdentity": typeof lib_polarIdentity;
  "lib/pushErrors": typeof lib_pushErrors;
  "lib/puzzleDay": typeof lib_puzzleDay;
  "lib/reminders": typeof lib_reminders;
  "lib/scoring": typeof lib_scoring;
  "lib/scoringSystem": typeof lib_scoringSystem;
  "lib/teamLimits": typeof lib_teamLimits;
  me: typeof me;
  migrate: typeof migrate;
  players: typeof players;
  polar: typeof polar;
  push: typeof push;
  pushSend: typeof pushSend;
  reminderEmails: typeof reminderEmails;
  scores: typeof scores;
  scoringSystems: typeof scoringSystems;
  settings: typeof settings;
  status: typeof status;
  teams: typeof teams;
  testOtps: typeof testOtps;
  winners: typeof winners;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
