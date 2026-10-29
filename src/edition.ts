/**
 * True in the API-token edition, which the main branch ships (edition.json there has `"apiOnly": true`): sign-in is by
 * access token only, and the app never looks for or talks to the browser extension. The build replaces the constant,
 * so the extension paths are left out of that bundle. False on dev and in every test run.
 */
export const API_ONLY: boolean = __API_ONLY__;
