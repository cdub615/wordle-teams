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
import type * as e2eSeed from "../e2eSeed.js";
import type * as email from "../email.js";
import type * as fixtures from "../fixtures.js";
import type * as http from "../http.js";
import type * as lib_board from "../lib/board.js";
import type * as lib_player from "../lib/player.js";
import type * as lib_puzzleDay from "../lib/puzzleDay.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_scoringSystem from "../lib/scoringSystem.js";
import type * as me from "../me.js";
import type * as migrate from "../migrate.js";
import type * as scores from "../scores.js";
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
  e2eSeed: typeof e2eSeed;
  email: typeof email;
  fixtures: typeof fixtures;
  http: typeof http;
  "lib/board": typeof lib_board;
  "lib/player": typeof lib_player;
  "lib/puzzleDay": typeof lib_puzzleDay;
  "lib/scoring": typeof lib_scoring;
  "lib/scoringSystem": typeof lib_scoringSystem;
  me: typeof me;
  migrate: typeof migrate;
  scores: typeof scores;
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
