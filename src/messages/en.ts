/** @file The English messages: the text the CLI always had. */
import type { Messages } from "./es.js";

export const en: Messages = {
  lang: {
    invalid: (source, value) => `${source} expects es or en: ${value}`,
  },
};
