<?php
/**
 * Plugin Name: Nexo
 * Description: A daily nested-clue word game and its private puzzle publisher.
 * Version: 1.2.1
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: Nexo
 * Text Domain: nexo
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'NEXO_VERSION', '1.2.1' );
define( 'NEXO_FILE', __FILE__ );
define( 'NEXO_DIR', plugin_dir_path( __FILE__ ) );
define( 'NEXO_TIME_ZONE', 'Europe/Madrid' );
if ( ! defined( 'NEXO_MAX_PUZZLES' ) ) define( 'NEXO_MAX_PUZZLES', 1000 );
if ( ! defined( 'NEXO_TRASH_RETENTION_DAYS' ) ) define( 'NEXO_TRASH_RETENTION_DAYS', 30 );

require_once NEXO_DIR . 'includes/class-nexo-capabilities.php';
require_once NEXO_DIR . 'includes/class-nexo-validator.php';
require_once NEXO_DIR . 'includes/class-nexo-puzzles.php';
require_once NEXO_DIR . 'includes/class-nexo-suggestions.php';
require_once NEXO_DIR . 'includes/class-nexo-rest-controller.php';
require_once NEXO_DIR . 'includes/class-nexo-shortcode.php';

final class Nexo_Plugin {
	public static function init(): void {
		add_action( 'init', array( 'Nexo_Capabilities', 'register' ) );
		add_action( 'init', array( 'Nexo_Puzzles', 'register_post_type' ) );
		add_action( 'init', array( 'Nexo_Puzzles', 'schedule_cleanup' ) );
		add_action( Nexo_Puzzles::PURGE_HOOK, array( 'Nexo_Puzzles', 'purge_old_trash' ) );
		add_action( 'rest_api_init', array( 'Nexo_REST_Controller', 'register_routes' ) );
		add_action( 'init', array( 'Nexo_Shortcode', 'register' ) );
		add_filter( 'rest_post_dispatch', array( 'Nexo_REST_Controller', 'prevent_private_caching' ), 10, 3 );
	}

	public static function activate(): void {
		Nexo_Capabilities::register();
		Nexo_Puzzles::register_post_type();
		Nexo_Suggestions::ensure_key();
		$result = Nexo_Puzzles::import_seeds();
		if ( is_wp_error( $result ) ) {
			throw new RuntimeException( esc_html( $result->get_error_message() ) );
		}
		Nexo_Puzzles::schedule_cleanup();
	}

	public static function deactivate(): void {
		Nexo_Puzzles::unschedule_cleanup();
	}
}

Nexo_Plugin::init();
register_activation_hook( __FILE__, array( 'Nexo_Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Nexo_Plugin', 'deactivate' ) );
