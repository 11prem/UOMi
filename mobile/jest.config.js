module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testTimeout: 30000, // the first renderRouter of a file loads every route module, which can pass 5 s on a busy machine
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
