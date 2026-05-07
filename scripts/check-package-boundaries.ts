import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

interface BoundaryRule {
  readonly forbiddenPackages: ReadonlyArray<string>;
  readonly label: string;
  readonly root: string;
}

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

const rules: ReadonlyArray<BoundaryRule> = [
  {
    forbiddenPackages: [
      '@firebase-desk/data-format',
      '@firebase-desk/fdql',
      '@firebase-desk/fdql-firestore',
      '@firebase-desk/hotkeys',
      '@firebase-desk/ipc-schemas',
      '@firebase-desk/product-ui',
      '@firebase-desk/repo-contracts',
      '@firebase-desk/repo-firebase',
      '@firebase-desk/repo-mocks',
      '@firebase-desk/script-runner',
      '@firebase-desk/ui',
      'electron',
      'firebase',
      'firebase-admin',
    ],
    label: '@firebase-desk/fdql-core',
    root: 'packages/fdql-core/src',
  },
  {
    forbiddenPackages: [
      '@firebase-desk/data-format',
      '@firebase-desk/fdql',
      '@firebase-desk/hotkeys',
      '@firebase-desk/ipc-schemas',
      '@firebase-desk/product-ui',
      '@firebase-desk/repo-contracts',
      '@firebase-desk/repo-firebase',
      '@firebase-desk/repo-mocks',
      '@firebase-desk/script-runner',
      '@firebase-desk/ui',
      'electron',
      'firebase',
      'firebase-admin',
    ],
    label: '@firebase-desk/fdql-firestore',
    root: 'packages/fdql-firestore/src',
  },
  {
    forbiddenPackages: [
      '@firebase-desk/data-format',
      '@firebase-desk/hotkeys',
      '@firebase-desk/ipc-schemas',
      '@firebase-desk/product-ui',
      '@firebase-desk/repo-contracts',
      '@firebase-desk/repo-firebase',
      '@firebase-desk/repo-mocks',
      '@firebase-desk/script-runner',
      '@firebase-desk/ui',
      'electron',
      'firebase',
      'firebase-admin',
    ],
    label: '@firebase-desk/fdql',
    root: 'packages/fdql/src',
  },
  {
    forbiddenPackages: [
      '@firebase-desk/data-format',
      '@firebase-desk/hotkeys',
      '@firebase-desk/ipc-schemas',
      '@firebase-desk/product-ui',
      '@firebase-desk/repo-contracts',
      '@firebase-desk/repo-firebase',
      '@firebase-desk/repo-mocks',
      '@firebase-desk/script-runner',
    ],
    label: '@firebase-desk/ui',
    root: 'packages/ui/src',
  },
  {
    forbiddenPackages: [
      '@firebase-desk/data-format',
      '@firebase-desk/hotkeys',
      '@firebase-desk/ipc-schemas',
      '@firebase-desk/product-ui',
      '@firebase-desk/repo-firebase',
      '@firebase-desk/repo-mocks',
      '@firebase-desk/script-runner',
      '@firebase-desk/ui',
    ],
    label: '@firebase-desk/repo-contracts',
    root: 'packages/repo-contracts/src',
  },
];

void main();

async function main(): Promise<void> {
  const violations: string[] = [];

  for (const rule of rules) {
    const files = await sourceFiles(join(workspaceRoot, rule.root));
    const sources = await Promise.all(
      files.map(async (filePath) => ({ filePath, source: await readFile(filePath, 'utf8') })),
    );

    for (const { filePath, source } of sources) {
      for (const specifier of importSpecifiers(source)) {
        const forbiddenPackage = rule.forbiddenPackages.find((packageName) =>
          specifier === packageName || specifier.startsWith(`${packageName}/`)
        );

        if (!forbiddenPackage) continue;

        violations.push(
          `${relative(workspaceRoot, filePath)} imports ${specifier} (forbidden by ${rule.label})`,
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error('Package dependency boundary violations found:\n');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log('Package dependency boundaries OK.');
}

async function sourceFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && isProductionTypeScript(entry.name))
    .map((entry) => join(dir, entry.name));
  const nestedFiles = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) =>
      sourceFiles(join(dir, entry.name))
    ),
  );
  return files.concat(...nestedFiles);
}

function isProductionTypeScript(fileName: string): boolean {
  return /\.(?:ts|tsx)$/.test(fileName)
    && !fileName.endsWith('.d.ts')
    && !fileName.endsWith('.test.ts')
    && !fileName.endsWith('.test.tsx')
    && !fileName.endsWith('.spec.ts')
    && !fileName.endsWith('.spec.tsx')
    && !fileName.endsWith('.stories.ts')
    && !fileName.endsWith('.stories.tsx');
}

function importSpecifiers(source: string): ReadonlyArray<string> {
  const specifiers: string[] = [];
  const importPattern =
    /import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|export\s+(?:type\s+)?(?:[^'"]+\s+from\s+)['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/')) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}
