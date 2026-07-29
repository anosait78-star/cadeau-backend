/**
 * Conventional Commits enforcement (Engineering Standards §2.1).
 * Enables automatic changelog generation and small, focused commits.
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "chore", "docs", "refactor", "test", "perf", "build", "ci", "revert"],
    ],
    "scope-case": [2, "always", "kebab-case"],
    "subject-case": [0],
    "header-max-length": [2, "always", 100],
  },
};
