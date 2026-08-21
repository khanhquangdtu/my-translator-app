/**
 * The summary model id, in its own module because both sides need it: the
 * server to build the request, and the Settings › AI summary screen to print
 * "OpenAI · gpt-5-mini". Importing it from `server/openai.ts` would drag
 * `server-only` into the client bundle and fail the build.
 */

/** Cheap and more than good enough for a meeting summary (~$0.01 per meeting). */
export const OPENAI_SUMMARY_MODEL = 'gpt-5-mini';
