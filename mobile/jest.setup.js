// AsyncStorage has no native module under jest; use its official in-memory mock everywhere.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
