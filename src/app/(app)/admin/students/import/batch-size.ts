/**
 * Rows per commit request.
 *
 * Each new student costs a Supabase Auth API call, so a few hundred sequential
 * calls is far past any serverless request limit. Twenty keeps a batch well
 * inside it, gives the progress bar something to move, and means a dropped
 * connection loses one batch rather than the whole import.
 *
 * Its own module because a "use server" file may export nothing but async
 * functions, and both the action and the client component need this number.
 */
export const IMPORT_BATCH_SIZE = 20;
