import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unlike Jest, Vitest does not auto-register React Testing Library's
 * cleanup — without this, a component rendered in one test stays mounted
 * into the next, causing false "multiple elements found" failures. Found
 * exactly this way while writing DashboardPage.test.tsx.
 */
afterEach(() => {
  cleanup();
});
