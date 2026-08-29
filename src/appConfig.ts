/** App flavour helpers - single branch, no hardcoding.
 *  DEV (vite dev / tauri dev / cargo debug) -> Wisper Dev / wisper-dev (violet)
 *  PROD (vite build / tauri build / cargo release) -> Wisper / wisper (orange)
 *  Lets both installs run side-by-side: separate XDG dirs, localStorage keys, and accent.
 */
export const isDev = import.meta.env.DEV;

export const APP_NAME = isDev ? "Wisper Dev" : "Wisper";
export const APP_DIR = isDev ? "wisper-dev" : "wisper";

/** Prefix for localStorage keys so dev/prod don't clobber each other */
export const storageKey = (key: string) => `${APP_DIR}:${key}`;

export const iconSrc = isDev ? "/dev/wisper-dev.svg" : "/wisper.svg";
