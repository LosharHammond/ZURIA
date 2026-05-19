import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: [
    "<rootDir>/__tests__/**/*.test.ts",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      diagnostics: false,   // suppress type-check noise in test files
      tsconfig: {
        module: "commonjs",
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
      },
    }],
  },
  setupFilesAfterEnv: [],
  testTimeout: 30_000,
  collectCoverageFrom: [
    "lib/**/*.ts",
    "!lib/**/*.d.ts",
    "!lib/firebase/**",
    "!lib/offline/**",
  ],
  coverageThreshold: {
    global: { branches: 70, functions: 80, lines: 80, statements: 80 },
  },
  // Global mocks applied before every test file
  globalSetup: "<rootDir>/__tests__/helpers/global-setup.ts",
};

export default config;
