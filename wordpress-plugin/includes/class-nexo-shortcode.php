<?php
/** Shortcode and asset loader. */

if ( ! defined( 'ABSPATH' ) ) exit;

final class Nexo_Shortcode {
	private static bool $assets_enqueued = false;
	private static int $instances = 0;

	public static function register(): void {
		add_shortcode( 'bracket_city', array( self::class, 'render' ) );
		add_action( 'wp_enqueue_scripts', array( self::class, 'enqueue_for_current_page' ) );
	}

	public static function enqueue_for_current_page(): void {
		if ( ! is_singular( 'page' ) ) return;
		$post = get_queried_object();
		if ( $post instanceof WP_Post && 'page' === $post->post_type && has_shortcode( $post->post_content, 'bracket_city' ) ) self::enqueue_assets();
	}

	public static function render(): string {
		if ( ! is_singular( 'page' ) || ! ( get_queried_object() instanceof WP_Post ) ) {
			return '<p class="nexo-error">' . esc_html__( 'Nexo must be placed on a normal WordPress Page.', 'nexo' ) . '</p>';
		}
		if ( self::$instances > 0 ) {
			return '<p class="nexo-error">' . esc_html__( 'Only one Nexo game can appear on a Page.', 'nexo' ) . '</p>';
		}
		if ( ! self::enqueue_assets() ) {
			return '<p class="nexo-error">' . esc_html__( 'Nexo assets are not available.', 'nexo' ) . '</p>';
		}
		self::$instances++;
		$can_author = current_user_can( 'edit_others_posts' );
		$config = array(
			'restBase' => esc_url_raw( rest_url( 'bracket-city/v1' ) ),
			'currentDate' => Nexo_Puzzles::current_date(),
			'timeZone' => NEXO_TIME_ZONE,
			'pageUrl' => esc_url_raw( get_permalink() ),
			'canAuthor' => $can_author,
			'nonce' => $can_author ? wp_create_nonce( 'wp_rest' ) : '',
			'localeUrl' => esc_url_raw( NEXO_URL . 'build/locales/es-ES.json' ),
		);
		$json = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES );
		return '<script id="bracket-city-config" type="application/json">' . $json . '</script><div id="bracket-city-app"></div>';
	}

	public static function enqueue_assets(): bool {
		if ( self::$assets_enqueued ) return true;
		$entry = self::manifest_entry();
		if ( null === $entry ) return false;
		$script = NEXO_URL . 'build/' . ltrim( $entry['file'], '/' );
		if ( function_exists( 'wp_enqueue_script_module' ) ) {
			wp_enqueue_script_module( 'nexo-app', $script, array(), NEXO_VERSION );
		} else {
			wp_enqueue_script( 'nexo-app', $script, array(), NEXO_VERSION, true );
			wp_script_add_data( 'nexo-app', 'type', 'module' );
		}
		foreach ( $entry['css'] ?? array() as $index => $css ) {
			wp_enqueue_style( 'nexo-app-' . $index, NEXO_URL . 'build/' . ltrim( $css, '/' ), array(), NEXO_VERSION );
		}
		self::$assets_enqueued = true;
		return true;
	}

	private static function manifest_entry(): ?array {
		$path = NEXO_DIR . 'build/.vite/manifest.json';
		if ( ! is_readable( $path ) ) return null;
		$manifest = json_decode( (string) file_get_contents( $path ), true );
		if ( ! is_array( $manifest ) ) return null;
		$entry = $manifest['index.html'] ?? null;
		if ( ! is_array( $entry ) ) {
			foreach ( $manifest as $candidate ) {
				if ( is_array( $candidate ) && ! empty( $candidate['isEntry'] ) ) { $entry = $candidate; break; }
			}
		}
		return is_array( $entry ) && isset( $entry['file'] ) ? $entry : null;
	}
}
