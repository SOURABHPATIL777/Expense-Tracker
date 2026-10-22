#!/usr/bin/env bash
# Generates a thin Next.js route file that delegates to a backend controller.
# Usage: scripts/mkroute.sh <api path under /api/v1> <controller file> <METHOD=handler>...
# Example: scripts/mkroute.sh "imports/[id]" imports GET=get DELETE=remove
set -euo pipefail
dir="$1"; file="$2"; shift 2
ctrl="${file//-/_}"
ctrl="$(echo "$ctrl" | awk -F_ '{for(i=1;i<=NF;i++) printf "%s%s", (i==1?$i:toupper(substr($i,1,1)) substr($i,2)), ""}')Controller"
mkdir -p "src/app/api/v1/$dir"
{
  echo "import { $ctrl } from \"@/backend/controllers/$file.controller\";"
  echo
  for m in "$@"; do echo "export const ${m%%=*} = $ctrl.${m#*=};"; done
} > "src/app/api/v1/$dir/route.ts"
echo "src/app/api/v1/$dir/route.ts"
