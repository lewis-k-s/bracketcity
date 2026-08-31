#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

cleanup() {
  docker compose down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

docker compose up --detach --build

attempt=0
until docker compose exec -T wordpress test -f /var/www/html/wp-config.php >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker compose logs wordpress db
    exit 1
  fi
  sleep 2
done

docker compose exec -T wordpress wp core install \
  --allow-root \
  --url=http://localhost:18080 \
  --title=Nexo-Test \
  --admin_user=release-admin \
  --admin_password=release-password \
  --admin_email=release@example.test \
  --skip-email

docker compose exec -T wordpress wp plugin activate bracket-city --allow-root
docker compose exec -T wordpress wp eval-file /nexo-tests/integration.php --allow-root
