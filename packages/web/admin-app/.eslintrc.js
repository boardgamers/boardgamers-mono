module.exports = {
  root: true,
  extends: ["@antfu"],
  rules: {
    "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
    "no-debugger": process.env.NODE_ENV === "production" ? "warn" : "off",
    "semi": ["error", "always"],
    "curly": "off",
    "@typescript-eslint/member-delimiter-style": ["error", {
      multiline: {
        delimiter: "semi",
        requireLast: true
      },
      singleline: {
        delimiter: "semi",
        requireLast: false
      },
      multilineDetection: "brackets"
    }],
    "@typescript-eslint/semi": ["error", "always"],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/consistent-type-assertions": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "no-return-assign": "off",
    "quotes": "off",
    "space-before-function-paren": "off",
    "comma-dangle": "off",
  },
};
