/**
 * Who made this and which build you are looking at.
 *
 * The version is injected from `package.json` by `next.config.ts`, so a
 * release is a single edit there and the footer cannot fall out of step with
 * the package. The fallback only shows if that injection is ever missing,
 * which makes the failure legible instead of rendering an empty string.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

/** Displayed version, prefixed the way people say it out loud. */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

/** The person the work belongs to. */
export const APP_OWNER = 'Mustafa Yildiz';

/**
 * Fixed rather than `new Date().getFullYear()`: a copyright year is a fact
 * about the work, not about when someone happened to open the page, and a
 * server/client mismatch around New Year would hydrate inconsistently.
 */
export const APP_COPYRIGHT_YEAR = 2026;

/** "© 2026 Mustafa Yildiz" — the rights line follows it, translated. */
export const APP_COPYRIGHT = `© ${APP_COPYRIGHT_YEAR} ${APP_OWNER}`;
