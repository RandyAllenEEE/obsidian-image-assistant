import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
	// Ignore patterns (replaces .eslintignore)
	{
		ignores: [
			// Dependencies
			"**/node_modules/**",

			// Build outputs
			"main.js",
			"*.js.map",
			"**/build/**",

			// Configuration files that don't need linting
			"esbuild.config.mjs",
			".eslintrc",
			".eslintrc.*",

			// Third-party libraries
			"src/UTIF.js",
			"src/UTIF.d.ts",
			"src/heic-to.d.ts",

			// Documentation and examples
			"*.md",
			"README.*",
			"DISCLAIMER.*",
			"Examples/**",
			"docs/**",

			// Release and version files
			"versions.json",
			"manifest.json",

			// Scripts
			"scripts/**",

			// Temporary and cache files
			"*.tmp",
			"*.temp",
			".cache/**",
			"**/coverage/**",
			"**/*.log",

			// IDE and editor files
			".vscode/**",
			".idea/**",
			"*.swp",
			"*.swo",

			// OS generated files
			"**/.DS_Store",
			"Thumbs.db",

			// Environment files
			"**/.env*",
			"!**/.env.example",
		],
	},

	// Base configuration for all JS/TS files
	{
		files: ["**/*.{js,mjs,cjs,ts,tsx}"],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.node,
				...globals.browser,
				console: "readonly",
				process: "readonly",
				Buffer: "readonly",
				__dirname: "readonly",
				__filename: "readonly",
				global: "readonly",
				module: "readonly",
				require: "readonly",
				exports: "readonly",
			},
		},
		plugins: {
			"@typescript-eslint": typescriptEslint,
		},
		rules: {
			...js.configs.recommended.rules,
			"no-unused-vars": "off",
			"no-useless-assignment": "off",
			"no-prototype-builtins": "off",
			"preserve-caught-error": "off",
			"prefer-const": "error",

			// Airbnb 3.3 & 3.4: Use object method and property shorthand
			"object-shorthand": "off",

			// Airbnb 5.1: Use object destructuring for multiple properties
			"prefer-destructuring": "off",

			// Airbnb 6.3: Use template strings instead of concatenation
			"prefer-template": "off",

			// Airbnb 7.7: Use default parameter syntax rather than mutating function arguments
			"no-param-reassign": "off",
			"default-param-last": "error",

			// Airbnb 7.10: Never use the Function constructor (security vulnerability)
			"no-new-func": "error",

			// Airbnb 8.1: Use arrow function notation for anonymous functions
			"prefer-arrow-callback": "error",

			// Airbnb 9.1: Always use class. Avoid manipulating prototype directly
			"no-useless-constructor": "off",
			"no-dupe-class-members": "error",

			// Airbnb 10.4: Only import from a path in one place
			"no-duplicate-imports": "error",

			// Airbnb 15.7: Avoid unneeded ternary statements
			"no-unneeded-ternary": ["error", { defaultAssignment: false }],

			// Airbnb 16.3: Avoid else after return statement
			"no-else-return": "off",

			// Avoid using new on primitive wrappers
			"no-new-wrappers": "error",

			// Airbnb 23.1: Avoid single letter names - with base exception for well known letter e.g. for errors or iteration/loops etc.
			"id-length": "off",
		},
	},

	// TypeScript-specific rules
	{
		files: ["**/*.{ts,tsx}"],
		rules: {
			"no-undef": "off",
			// Your original TypeScript rules
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",

			// Airbnb 23.2: Naming convention using @typescript-eslint/naming-convention
			"@typescript-eslint/naming-convention": "off",
		},
	},
];
