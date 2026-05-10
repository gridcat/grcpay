module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'airbnb-base',
    'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint/eslint-plugin
  ],
  rules: {
    'no-plusplus': 0,
    'class-methods-use-this': 0,
    'no-underscore-dangle': 0,
    'no-continue': 0,
    'no-param-reassign': 0,
    'no-bitwise': 0,
    'import/no-unresolved': 0,
    'import/prefer-default-export': 0,
    'import/extensions': 0,
    '@typescript-eslint/interface-name-prefix': 0,
    'func-names': 0,
    'no-console': 0,
    'no-await-in-loop': 0,
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': ['error'],
    'no-useless-constructor': 0,
    '@typescript-eslint/no-useless-constructor': ['error'],
    'no-empty-function': ['error', { allow: ['constructors'] }],
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // airbnb bans for-in/for-of wholesale. for-in stays banned (it's
    // genuinely bug-prone), for-of is removed — it's idiomatic TS and
    // the only clean option when the loop body awaits.
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ForInStatement',
        message: 'for-in iterates the entire prototype chain; use Object.keys/values/entries instead.',
      },
      {
        selector: 'LabeledStatement',
        message: 'Labels are a sign of poorly structured control flow.',
      },
      {
        selector: 'WithStatement',
        message: '`with` is disallowed in strict mode.',
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
    },
    {
      files: '*.spec.js',
      rules: {
        'no-unused-expressions': 'off',
      },
    },
    {
      // Tests mock freely — `any` is explicitly allowed here to keep
      // spec files terse. Formatting / import-order nits also relaxed
      // since they're noise in fixtures.
      files: ['tests/**/*.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-types': 'off',
        'global-require': 'off',
        'import/first': 'off',
        'import/order': 'off',
        'no-promise-executor-return': 'off',
        'max-len': 'off',
        'max-classes-per-file': 'off',
        'object-curly-newline': 'off',
        'object-property-newline': 'off',
        'function-paren-newline': 'off',
        'function-call-argument-newline': 'off',
        'no-multi-spaces': 'off',
      },
    },
  ],
};
