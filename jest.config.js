/** @type {import('@ts-jest/dist/types').InitialOptionsTsJest} */
export default {
  verbose: true,
  maxWorkers: 1,
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
  transform: {
    '^.+\\.(t)s$': 'ts-jest',
    '^.+\\.(j)s$': 'babel-jest',
  },
  resolver: '<rootDir>/jest-resolver.cjs',
  transformIgnorePatterns: [
    '<rootDir>/node_modules/(?!(tslib|snarkyjs/node_modules/tslib))',
  ],
  modulePathIgnorePatterns: ['<rootDir>/build/'],
  moduleNameMapper: {
    '../../../node_modules/snarkyjs/dist/(.*)':
      '<rootDir>/node_modules/snarkyjs/dist/$1',
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
};
