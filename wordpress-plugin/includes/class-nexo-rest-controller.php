<?php
/** REST routes for public play and authenticated publishing. */

if ( ! defined( 'ABSPATH' ) ) exit;

final class Nexo_REST_Controller {
	private const NS = 'bracket-city/v1';

	public static function register_routes(): void {
		register_rest_route( self::NS, '/puzzles', array(
			array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( self::class, 'public_list' ), 'permission_callback' => '__return_true' ),
			array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( self::class, 'create' ), 'permission_callback' => array( self::class, 'can_publish' ) ),
		) );
		register_rest_route( self::NS, '/puzzles/(?P<date>\d{4}-\d{2}-\d{2})', array(
			array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( self::class, 'public_get' ), 'permission_callback' => '__return_true' ),
			array( 'methods' => 'PUT', 'callback' => array( self::class, 'update' ), 'permission_callback' => array( self::class, 'can_publish' ) ),
		) );
		register_rest_route( self::NS, '/admin/puzzles', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( self::class, 'admin_list' ), 'permission_callback' => array( self::class, 'can_publish' ) ) );
		register_rest_route( self::NS, '/admin/puzzles/(?P<date>\d{4}-\d{2}-\d{2})', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( self::class, 'admin_get' ), 'permission_callback' => array( self::class, 'can_publish' ) ) );
	}

	public static function can_publish(): bool { return current_user_can( Nexo_Capabilities::MANAGE_PUZZLES ); }

	public static function public_list(): WP_REST_Response {
		return rest_ensure_response( array( 'schemaVersion' => 1, 'currentDate' => Nexo_Puzzles::current_date(), 'timeZone' => NEXO_TIME_ZONE, 'puzzles' => Nexo_Puzzles::list_metadata( false ) ) );
	}

	public static function admin_list(): WP_REST_Response {
		return rest_ensure_response( array( 'schemaVersion' => 1, 'currentDate' => Nexo_Puzzles::current_date(), 'timeZone' => NEXO_TIME_ZONE, 'puzzles' => Nexo_Puzzles::list_metadata( true ) ) );
	}

	public static function public_get( WP_REST_Request $request ) {
		$date = self::date( $request );
		if ( is_wp_error( $date ) ) return $date;
		if ( $date > Nexo_Puzzles::current_date() ) return self::error( 'nexo_not_found', 'Puzzle not found.', 404 );
		return self::get_definition( $date );
	}

	public static function admin_get( WP_REST_Request $request ) {
		$date = self::date( $request );
		return is_wp_error( $date ) ? $date : self::get_definition( $date );
	}

	public static function create( WP_REST_Request $request ) {
		$definition = self::body( $request );
		if ( is_wp_error( $definition ) ) return $definition;
		$date = $definition['releaseDate'] ?? '';
		if ( null !== Nexo_Puzzles::find( $date ) ) return self::error( 'nexo_conflict', 'A puzzle already exists for this date.', 409 );
		$post_id = Nexo_Puzzles::insert( $definition );
		if ( is_wp_error( $post_id ) ) return $post_id;
		return new WP_REST_Response( self::saved( $definition, $post_id ), 201 );
	}

	public static function update( WP_REST_Request $request ) {
		$date = self::date( $request );
		if ( is_wp_error( $date ) ) return $date;
		$definition = self::body( $request );
		if ( is_wp_error( $definition ) ) return $definition;
		if ( $definition['releaseDate'] !== $date ) return self::error( 'nexo_date_mismatch', 'releaseDate must match the route date.', 422 );
		$post = Nexo_Puzzles::find( $date );
		if ( null === $post ) return self::error( 'nexo_not_found', 'Puzzle not found.', 404 );
		$old_id = (string) get_post_meta( $post->ID, Nexo_Puzzles::META_ID, true );
		$old_revision = (int) get_post_meta( $post->ID, Nexo_Puzzles::META_REVISION, true );
		$new_revision = (int) ( $definition['revision'] ?? 1 );
		if ( $definition['id'] !== $old_id ) return self::error( 'nexo_id_mismatch', 'Puzzle ID cannot change.', 422 );
		if ( $new_revision <= $old_revision ) return self::error( 'nexo_revision_conflict', 'Revision must increase.', 422 );
		$result = Nexo_Puzzles::update( $post, $definition );
		return is_wp_error( $result ) ? $result : rest_ensure_response( self::saved( $definition, $post->ID ) );
	}

	private static function get_definition( string $date ) {
		$post = Nexo_Puzzles::find( $date );
		if ( null === $post ) return self::error( 'nexo_not_found', 'Puzzle not found.', 404 );
		$definition = Nexo_Puzzles::definition( $post );
		$validation = is_array( $definition ) ? Nexo_Validator::validate( $definition ) : array( 'valid' => false );
		if ( null === $definition || ! $validation['valid'] || ( $definition['releaseDate'] ?? null ) !== $date ) return self::error( 'nexo_invalid_stored_puzzle', 'Stored puzzle is invalid.', 500 );
		return rest_ensure_response( $definition );
	}

	private static function body( WP_REST_Request $request ) {
		$runtime_errors = Nexo_Validator::runtime_errors();
		if ( array() !== $runtime_errors ) return new WP_Error( 'nexo_server_requirements', 'The server cannot safely normalize puzzle answers.', array( 'status' => 500, 'errors' => $runtime_errors ) );
		$definition = $request->get_json_params();
		if ( ! is_array( $definition ) || array_is_list( $definition ) ) return self::error( 'nexo_malformed_json', 'Request body must be a puzzle object.', 400 );
		$result = Nexo_Validator::validate( $definition );
		if ( ! $result['valid'] ) return new WP_Error( 'nexo_invalid_puzzle', 'Puzzle validation failed.', array( 'status' => 422, 'errors' => $result['errors'] ) );
		if ( ! isset( $definition['releaseDate'] ) ) return self::error( 'nexo_missing_release_date', 'releaseDate is required for publishing.', 422 );
		return $definition;
	}

	private static function date( WP_REST_Request $request ) {
		$date = (string) $request['date'];
		return Nexo_Validator::is_date( $date ) ? $date : self::error( 'nexo_invalid_date', 'Date must be a real YYYY-MM-DD date.', 400 );
	}

	private static function saved( array $definition, int $post_id ): array {
		return array( 'date' => $definition['releaseDate'], 'id' => $definition['id'], 'revision' => $definition['revision'] ?? 1, 'postId' => $post_id );
	}

	private static function error( string $code, string $message, int $status ): WP_Error { return new WP_Error( $code, $message, array( 'status' => $status ) ); }

	public static function prevent_private_caching( $response, $server, WP_REST_Request $request ) {
		if ( str_starts_with( $request->get_route(), '/' . self::NS . '/' ) && $response instanceof WP_HTTP_Response ) {
			$response->header( 'Cache-Control', 'no-store, private' );
			$response->header( 'Vary', 'Cookie' );
		}
		return $response;
	}
}
