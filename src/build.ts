/** True in the single-file demo build (`npm run build:demo`): no file downloads, no calls to this site's functions. */
export const IS_DEMO_BUILD = import.meta.env.MODE === 'demo'
