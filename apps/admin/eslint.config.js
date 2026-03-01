import antfu from "@antfu/eslint-config";

export default antfu({
  rules: {
    "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
    "no-debugger": process.env.NODE_ENV === "production" ? "warn" : "off",
    "style/semi": ["error", "always"],
    curly: "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/consistent-type-assertions": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "no-return-assign": "off",
    "style/quotes": "off",
    "style/space-before-function-paren": "off",
    "style/comma-dangle": "off",
  },
});
