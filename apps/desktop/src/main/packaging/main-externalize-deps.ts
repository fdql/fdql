const workspaceRuntimePackages = [
  '@firebase-desk/data-format',
  '@firebase-desk/design-tokens',
  '@firebase-desk/fdql',
  '@firebase-desk/hotkeys',
  '@firebase-desk/ipc-schemas',
  '@firebase-desk/product-ui',
  '@firebase-desk/repo-contracts',
  '@firebase-desk/repo-firebase',
  '@firebase-desk/repo-mocks',
  '@firebase-desk/script-runner',
  '@firebase-desk/ui',
];

const bundledMainPackages = [...workspaceRuntimePackages, 'firebase-admin'];

const mainExternalizeDeps = {
  exclude: bundledMainPackages,
};

export { bundledMainPackages, mainExternalizeDeps, workspaceRuntimePackages };
