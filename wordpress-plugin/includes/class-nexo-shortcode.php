<?php
/** Shortcode and asset loader. */

if ( ! defined( 'ABSPATH' ) ) exit;

final class Nexo_Shortcode {
	private static int $instances = 0;

	public static function register(): void {
		add_shortcode( 'bracket_city', array( self::class, 'render' ) );
	}

	public static function render( array $attributes = array() ): string {
		if ( ! is_singular( 'page' ) || ! ( get_queried_object() instanceof WP_Post ) ) {
			return '<p class="nexo-error">' . esc_html__( 'Nexo must be placed on a normal WordPress Page.', 'nexo' ) . '</p>';
		}
		if ( self::$instances > 0 ) {
			return '<p class="nexo-error">' . esc_html__( 'Only one Nexo game can appear on a Page.', 'nexo' ) . '</p>';
		}

		$attributes = shortcode_atts( array( 'asset_base' => '' ), $attributes, 'bracket_city' );
		$asset_base = self::validate_asset_base( (string) $attributes['asset_base'] );
		if ( null === $asset_base ) {
			return '<p class="nexo-error">' . esc_html__( 'Nexo needs a secure HTTPS asset_base URL.', 'nexo' ) . '</p>';
		}

		wp_enqueue_script( 'nexo-loader', $asset_base . '/loader.js', array(), NEXO_VERSION, true );
		self::$instances++;
		$can_author = current_user_can( Nexo_Capabilities::MANAGE_PUZZLES );
		$config = array(
			'restBase' => esc_url_raw( rest_url( 'bracket-city/v1' ) ),
			'currentDate' => Nexo_Puzzles::current_date(),
			'timeZone' => NEXO_TIME_ZONE,
			'pageUrl' => esc_url_raw( get_permalink() ),
			'assetBase' => $asset_base,
			'canAuthor' => $can_author,
			'nonce' => $can_author ? wp_create_nonce( 'wp_rest' ) : '',
		);
		$json = wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES );
		return '<script id="bracket-city-config" type="application/json">' . $json . '</script><div id="bracket-city-app"></div>';
	}

	private static function validate_asset_base( string $value ): ?string {
		$value = trim( $value );
		$parts = wp_parse_url( $value );
		if (
			! is_array( $parts ) ||
			'https' !== strtolower( (string) ( $parts['scheme'] ?? '' ) ) ||
			empty( $parts['host'] ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] )
		) {
			return null;
		}

		$sanitized = esc_url_raw( $value, array( 'https' ) );
		return '' === $sanitized ? null : untrailingslashit( $sanitized );
	}
}
