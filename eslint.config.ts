import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
    globalIgnores([
        '.cache/**',
        'coverage/**',
        'dist/**',
        'dist-examples/**',
        'docs/**',
        'node_modules/**',
        'playwright-report/**',
        'reports/**',
        'test-results/**'
    ]),
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        extends: [
            eslint.configs.recommended,
            tseslint.configs.strictTypeChecked,
            tseslint.configs.stylisticTypeChecked
        ],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error'
        },
        rules: {
            '@typescript-eslint/ban-ts-comment': [
                'error',
                {
                    'ts-check': false,
                    'ts-expect-error': true,
                    'ts-ignore': true,
                    'ts-nocheck': true
                }
            ],
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { fixStyle: 'inline-type-imports', prefer: 'type-imports' }
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
            '@typescript-eslint/no-shadow': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
            ],
            '@typescript-eslint/prefer-readonly': 'error',
            eqeqeq: ['error', 'always'],
            'no-duplicate-imports': ['error', { includeExports: true }],
            'no-var': 'error',
            'object-shorthand': 'error',
            'prefer-const': 'error',
            'prefer-template': 'error',
            'no-shadow': 'off'
        }
    },
    {
        files: ['src/**/*.ts'],
        rules: {
            'no-console': 'error'
        }
    },
    eslintConfigPrettier
);
