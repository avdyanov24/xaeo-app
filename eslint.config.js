import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/', 'data/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // `x == null` is the one loose comparison the web code uses on purpose: null or undefined.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/server/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/web/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
