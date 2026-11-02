import stylistic from '@stylistic/eslint-plugin'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

export default [
    { ignores: ['node_modules/**', 'test/results/**'] },
    {
        files: ['**/*.js', '**/*.cjs'],
        plugins: { '@stylistic': stylistic, 'simple-import-sort': simpleImportSort },
        rules: {
            curly: ['error', 'all'],
            'max-lines': ['error', 500],
            '@stylistic/block-spacing': ['error', 'always'],
            '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
            '@stylistic/comma-spacing': 'error',
            '@stylistic/key-spacing': 'error',
            '@stylistic/keyword-spacing': 'error',
            '@stylistic/no-multi-spaces': 'error',
            '@stylistic/no-trailing-spaces': 'error',
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
            '@stylistic/space-before-blocks': 'error',
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/indent': ['error', 4, { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *'] }],
            '@stylistic/linebreak-style': ['error', 'unix'],
            '@stylistic/max-len': ['error', { code: 150, ignoreUrls: true, ignoreRegExpLiterals: true }],
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/semi': ['error', 'never'],
            'simple-import-sort/imports': ['error', { groups: [['^node:'], ['^@?\\w'], ['^\\.']] }],
        },
    },
]
