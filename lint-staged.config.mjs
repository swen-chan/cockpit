const lintStagedConfig = {
  "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": ["eslint --fix --max-warnings=0", "prettier --write"],
  "*.{css,json,jsonc,md,mdx,yaml,yml}": "prettier --write",
};

export default lintStagedConfig;
