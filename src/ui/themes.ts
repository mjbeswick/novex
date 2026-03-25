import type { Theme } from "../types";
import { ANSI } from "./terminal";

export interface ColorTheme {
  /** ANSI escape for the background (used via bgXxx codes) */
  background: string;
  /** Normal text colour */
  text: string;
  /** Dimmed / secondary text */
  dim: string;
  /** Accent / highlight colour for interactive elements */
  accent: string;
  /** Highlighted / selected text */
  highlight: string;
  /** Status-bar background */
  statusBar: string;
  /** Status-bar text colour */
  statusText: string;
  /** Border / separator colour */
  border: string;
}

export const themes: Record<Theme, ColorTheme> = {
  dark: {
    background: ANSI.bgBlack,
    text: ANSI.white,
    dim: ANSI.brightBlack,
    accent: ANSI.cyan,
    highlight: ANSI.yellow,
    statusBar: ANSI.bgBlack,
    statusText: ANSI.brightBlack,
    border: ANSI.brightBlack,
  },
  light: {
    background: ANSI.bgWhite,
    text: ANSI.black,
    dim: "\x1b[90m", // bright-black works as dim on white bg
    accent: ANSI.blue,
    highlight: ANSI.magenta,
    statusBar: ANSI.bgWhite,
    statusText: "\x1b[90m",
    border: "\x1b[90m",
  },
};
