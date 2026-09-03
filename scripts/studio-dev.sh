#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
studio_site_path=${NEXO_STUDIO_SITE_PATH:-/Volumes/HUBSSD/code/mudlarker/wordpress}
studio_registered_path=${NEXO_STUDIO_REGISTERED_PATH:-/Users/lewis/Studio/mudlarker}
asset_port=${NEXO_ASSET_PORT:-4176}
plugin_source="$project_root/wordpress-plugin"
plugin_target="$studio_site_path/wp-content/plugins/bracket-city"
plugin_backup="$studio_site_path/wp-content/plugins/bracket-city.studio-sync"
mu_plugin="$studio_site_path/wp-content/mu-plugins/nexo-local-development.php"
mu_template="$script_dir/studio-local-development.php"

fail() {
	printf '%s\n' "$1" >&2
	exit 1
}

canonical_directory() {
	CDPATH= cd -- "$1" && pwd -P
}

check_paths() {
	case "$asset_port" in
		''|*[!0-9]*) fail 'NEXO_ASSET_PORT must be a port number.' ;;
	esac
	[ -d "$plugin_source" ] || fail "Nexo plugin source is missing: $plugin_source"
	[ -d "$studio_site_path/wp-content/plugins" ] || fail "Studio site is missing: $studio_site_path"
	[ -e "$studio_registered_path" ] || fail "Studio registered path is missing: $studio_registered_path"
	[ "$(canonical_directory "$studio_site_path")" = "$(canonical_directory "$studio_registered_path")" ] || fail 'Studio registered path must resolve to NEXO_STUDIO_SITE_PATH.'
}

install_local_override() {
	mkdir -p "$(dirname -- "$mu_plugin")"
	sed "s/__NEXO_ASSET_PORT__/$asset_port/g" "$mu_template" > "$mu_plugin"
}

set_file_access() {
	desired_file_access=$1
	current_file_access=$(studio config get --path "$studio_registered_path" file-access)
	if [ "$current_file_access" != "$desired_file_access" ]; then
		studio config set --path "$studio_registered_path" --file-access "$desired_file_access"
	fi
}

allow_linked_plugin_source() {
	set_file_access all-files
}

link_plugin() {
	if [ -L "$plugin_target" ]; then
		[ "$(canonical_directory "$plugin_target")" = "$(canonical_directory "$plugin_source")" ] || fail "Refusing to replace unexpected plugin link: $plugin_target"
	else
		[ -d "$plugin_target" ] || fail "Pulled plugin is missing: $plugin_target"
		[ ! -e "$plugin_backup" ] || fail "Plugin backup already exists: $plugin_backup"
		mv "$plugin_target" "$plugin_backup"
		ln -s "$plugin_source" "$plugin_target"
	fi
	install_local_override
	allow_linked_plugin_source
}

start_studio() {
	studio stop --path "$studio_registered_path" >/dev/null 2>&1 || true
	studio start --path "$studio_registered_path" --skip-browser --skip-log-details
}

restore_plugin() {
	studio stop --path "$studio_registered_path"
	[ -L "$plugin_target" ] || fail "Local Nexo plugin link is missing: $plugin_target"
	[ "$(canonical_directory "$plugin_target")" = "$(canonical_directory "$plugin_source")" ] || fail "Refusing to remove unexpected plugin link: $plugin_target"
	[ -d "$plugin_backup" ] || fail "Pulled plugin backup is missing: $plugin_backup"
	rm "$plugin_target"
	mv "$plugin_backup" "$plugin_target"
	rm -f "$mu_plugin"
	set_file_access site-directory
}

check_paths

case "${1:-dev}" in
	dev)
		link_plugin
		start_studio
		if curl --fail --silent --max-time 2 "http://127.0.0.1:$asset_port/loader.js" >/dev/null 2>&1; then
			printf 'Vite assets already run at http://127.0.0.1:%s/loader.js\n' "$asset_port"
			exit 0
		fi
		cd "$project_root"
		exec npm run dev:studio-assets
		;;
	link)
		link_plugin
		;;
	start)
		link_plugin
		start_studio
		;;
	status)
		studio status --path "$studio_registered_path"
		;;
	restore-plugin)
		restore_plugin
		;;
	*)
		fail "Usage: $0 {dev|link|start|status|restore-plugin}"
		;;
esac
