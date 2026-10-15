import type { RequestHandler } from 'msw';

/**
 * Initial MSW handlers for all stories. Intentionally empty until @friday/mock-data exports its
 * handler list; then: `export const initialHandlers = mockHandlers;`.
 */
export const initialHandlers: RequestHandler[] = [];
