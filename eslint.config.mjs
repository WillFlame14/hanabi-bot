// import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all
});

export default [{
	ignores: ["src/hanabi-bot.js"],
}, ...compat.extends("eslint:recommended", "plugin:jsdoc/recommended"), {
	// plugins: {
	// 	jsdoc,
	// },
	languageOptions: {
		globals: {
			...globals.node,
			...globals.commonjs,
		},
		ecmaVersion: "latest",
		sourceType: "module",
	},
	settings: {
		jsdoc: {
			tagNamePreference: {
				augments: "extends",
			},
		},
	},
	rules: {
		"indent": ["error", "tab", { SwitchCase: 1, ignoredNodes: ["ConditionalExpression"] }],
		"no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		"semi": "error",
		"eol-last": "warn",
		"no-trailing-spaces": ["warn", { ignoreComments: true }],
		"prefer-const": "warn",
		"curly": ["warn", "multi-or-nest", "consistent"],
		"jsdoc/require-jsdoc": "off",
		"jsdoc/require-property-description": "off",
		"jsdoc/require-param-description": "off",
		"jsdoc/require-returns-description": "off",
		"jsdoc/require-returns": "off",
		"jsdoc/require-returns-type": "off",
		"jsdoc/tag-lines": "off",
		"jsdoc/no-undefined-types": "warn",
		"jsdoc/check-property-names": "off",
		"jsdoc/valid-types": "off"
	}
}];
