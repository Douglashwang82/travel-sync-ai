/**
 * @travel-sync/shared — framework-agnostic API contracts and a typed,
 * token-aware client for the `/api/app/*` surface. Consumed by the native
 * mobile app today; the web `/app` client can migrate onto it as part of the
 * full workspace restructure.
 */
export * from "./errors.js";
export * from "./auth.js";
export * from "./session.js";
export * from "./endpoints.js";
export * from "./client.js";
