<?php
/** Local-only Nexo settings installed by scripts/studio-dev.sh. */

if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) ) {
	define( 'WP_ENVIRONMENT_TYPE', 'local' );
}

if ( ! defined( 'NEXO_LOCAL_ASSET_BASE' ) ) {
	define( 'NEXO_LOCAL_ASSET_BASE', 'http://127.0.0.1:__NEXO_ASSET_PORT__' );
}
