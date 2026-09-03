<?php
/** Shortcode and asset loader. */

if ( ! defined( 'ABSPATH' ) ) exit;

final class Nexo_Shortcode {
	private static int $instances = 0;

	public static function register(): void {
		add_shortcode( 'bracket_city', array( self::class, 'render' ) );
		add_filter( 'wp_headers', array( self::class, 'protect_suggestion_headers' ) );
	}

	public static function protect_suggestion_headers( array $headers ): array {
		$mode = self::query_value( 'mode' );
		$key = self::query_value( 'suggestion_key' );
		if ( 'suggest' === $mode && Nexo_Suggestions::valid_key( $key ) ) {
			$headers['Referrer-Policy'] = 'no-referrer';
		}
		return $headers;
	}

	public static function render( array $attributes = array() ): string {
		if ( ! is_singular( 'page' ) || ! ( get_queried_object() instanceof WP_Post ) ) {
			return '<p class="nexo-error">' . esc_html__( 'Nexo must be placed on a normal WordPress Page.', 'nexo' ) . '</p>';
		}
		if ( self::$instances > 0 ) {
			return '<p class="nexo-error">' . esc_html__( 'Only one Nexo game can appear on a Page.', 'nexo' ) . '</p>';
		}

		$attributes = shortcode_atts( array( 'asset_base' => '' ), $attributes, 'bracket_city' );
		$asset_base_value = (string) $attributes['asset_base'];
		if (
			'local' === wp_get_environment_type() &&
			defined( 'NEXO_LOCAL_ASSET_BASE' ) &&
			is_string( NEXO_LOCAL_ASSET_BASE )
		) {
			$asset_base_value = NEXO_LOCAL_ASSET_BASE;
		}
		$asset_base = self::validate_asset_base( $asset_base_value );
		if ( null === $asset_base ) {
			return '<p class="nexo-error">' . esc_html__( 'Nexo needs a secure HTTPS asset_base URL.', 'nexo' ) . '</p>';
		}

		wp_enqueue_script( 'nexo-loader', $asset_base . '/loader.js', array(), NEXO_VERSION, true );
		self::$instances++;
		$can_author = current_user_can( Nexo_Capabilities::MANAGE_PUZZLES );
		$suggestion_key = self::query_value( 'suggestion_key' );
		$can_suggest = 'suggest' === self::query_value( 'mode' ) && Nexo_Suggestions::valid_key( $suggestion_key );
		if ( $can_suggest ) nocache_headers();
		$page_url = esc_url_raw( get_permalink() );
		$config = array(
			'restBase' => esc_url_raw( rest_url( 'bracket-city/v1' ) ),
			'currentDate' => Nexo_Puzzles::current_date(),
			'timeZone' => NEXO_TIME_ZONE,
			'pageUrl' => $page_url,
			'assetBase' => $asset_base,
			'canAuthor' => $can_author,
			'canSuggest' => $can_suggest,
			'acceptingNewPuzzles' => Nexo_Puzzles::has_capacity(),
			'puzzleLimit' => Nexo_Puzzles::max_puzzles(),
			'nonce' => $can_author ? wp_create_nonce( 'wp_rest' ) : '',
		);
		if ( $can_suggest ) $config['suggestionKey'] = $suggestion_key;
		if ( $can_author ) $config['suggestionUrl'] = Nexo_Suggestions::share_url( $page_url );
		$json = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES );
		return '<script id="bracket-city-config" type="application/json">' . $json . '</script><div id="bracket-city-app"></div>';
	}

	private static function validate_asset_base( string $value ): ?string {
		$value = trim( $value );
		$parts = wp_parse_url( $value );
		if ( ! is_array( $parts ) ) {
			return null;
		}
		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );
		$host = strtolower( (string) ( $parts['host'] ?? '' ) );
		$local_http =
			'local' === wp_get_environment_type() &&
			'http' === $scheme &&
			in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true );
		if (
			( 'https' !== $scheme && ! $local_http ) ||
			empty( $parts['host'] ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] )
		) {
			return null;
		}

		$sanitized = esc_url_raw( $value, $local_http ? array( 'http' ) : array( 'https' ) );
		return '' === $sanitized ? null : untrailingslashit( $sanitized );
	}

	private static function query_value( string $name ): string {
		if ( ! isset( $_GET[ $name ] ) || ! is_string( $_GET[ $name ] ) ) return '';
		return sanitize_text_field( wp_unslash( $_GET[ $name ] ) );
	}
}
