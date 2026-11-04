/**
 * @file The Spanish messages. Its shape is the shape of every catalog: `en.ts` must match.
 * Messages are strings or functions that build one.
 */
export const es = {
  lang: {
    invalid: (source: string, value: string): string => `${source} espera es o en: ${value}`,
  },
};

/** The shape of a catalog. */
export type Messages = typeof es;
