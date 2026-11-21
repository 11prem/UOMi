import { currentServices } from '../src/services/useServices';
import type { FakeDebug, FakeServices } from './fake';

/**
 * TEST ONLY. Set `serverUrl` to this and the app's services are the in-memory fake backend (`./fake`) instead of HTTP.
 * Any other URL gets the real server services, so a test can spy on them or answer `fetch`. jest.setup.js does the swap.
 */
export const FAKE_SERVER_URL = 'fake://backend';

/** The fake backend's controls (act as someone, simulated errors, reset). Only valid while `serverUrl` is `FAKE_SERVER_URL`. */
export const fakeDebug = (): FakeDebug => (currentServices() as FakeServices).debug;
