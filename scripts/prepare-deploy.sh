#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$project_root"
npm run build:pages
npm run package:plugin
printf '%s\n' 'Prepared GitHub Pages assets in dist-pages/ and the Nexo bridge ZIP in release/.'
printf '%s\n' 'Commit and push the reviewed change to main to deploy Pages, then upload the ZIP in WordPress.com.'
