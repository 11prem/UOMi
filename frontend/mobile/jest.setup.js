// AsyncStorage has no native module under jest; use its official in-memory mock everywhere.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Screen tests sign in to an in-memory fake backend (test-support/fake). It is picked when the session's server URL is
// FAKE_SERVER_URL (test-support/server.ts); every other URL gets the real HTTP services. The app itself has no fake.
jest.mock('./src/services/server', () => {
  const actual = jest.requireActual('./src/services/server');
  return {
    ...actual,
    createServerServices: (opts) =>
      opts.baseUrl === 'fake://backend' ? require('./test-support/fake').createFakeServices() : actual.createServerServices(opts),
  };
});
