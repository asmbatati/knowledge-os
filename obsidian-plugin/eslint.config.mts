import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'docs',
		'test/.build',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// The product's own name, kept as it is written.
		rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: [...DEFAULT_BRANDS, 'Knowledge OS'] }] },
	},
	{
		// The tests run in Node, never in Obsidian: Node's modules are theirs to use, and test() returns a promise
		// the runner awaits.
		files: ['test/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			// the stub vault has a fixed config folder, and Node has no window
			'obsidianmd/hardcoded-config-path': 'off',
			'obsidianmd/no-global-this': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
			// the end-to-end test talks to the real backend from Node, where requestUrl does not exist
			'no-restricted-globals': 'off',
		},
	},
);
