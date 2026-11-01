import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', '.astro/', 'test-results/', 'playwright-report/', 'graphify-out/', 'miscs/', 'tmp/', '**/.wrangler/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  // Browser code, Workers, Node scripts and tests share one repo: one set of globals for all.
  { languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } } },
]);
