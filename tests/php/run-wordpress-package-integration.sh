#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/to/nexo.zip" >&2
  exit 2
fi

archive_dir=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)
archive="$archive_dir/$(basename -- "$1")"
if [ ! -f "$archive" ]; then
  echo "Plugin ZIP not found: $archive" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"
export NEXO_PLUGIN_ZIP="$archive"

compose() {
  docker compose -f docker-compose.package.yml "$@"
}

cleanup() {
  compose down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

compose up --detach --build

attempt=0
until compose exec -T wordpress test -f /var/www/html/wp-config.php >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    compose logs wordpress db
    exit 1
  fi
  sleep 2
done

compose exec -T wordpress wp core install \
  --allow-root \
  --url=http://localhost:18080 \
  --title=Nexo-Package-Test \
  --admin_user=release-admin \
  --admin_password=release-password \
  --admin_email=release@example.test \
  --skip-email

compose exec -T wordpress wp plugin install /nexo-tests/nexo.zip --activate --allow-root
compose exec -T wordpress wp eval-file /nexo-tests/integration.php --allow-root
