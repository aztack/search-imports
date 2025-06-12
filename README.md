# search-imports

A tool to search imports statement in a TypeScriptproject.

## Usage

```bash
npm install -g search-imports
search-imports --searchPath=./packages --targetPkg=@scope/pkg-name --excludePaths=./packages/pkg
```

## Options

- `--searchPath`: The path to search for imports.
- `--targetPkg`: The package name to search for imports.
- `--excludePaths`: The paths to exclude from the search.
- `--json`: Output the results in JSON format.
- `--detailed`: Output the results in detailed format.