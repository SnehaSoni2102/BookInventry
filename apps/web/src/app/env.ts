/** Same-origin by default: Caddy (prod) and the Vite dev proxy forward /api and /rt to the API. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';
/** Origin of the Socket.IO server ('' = the page's own origin). */
export const RT_URL = (import.meta.env.VITE_RT_URL as string | undefined) ?? '';
