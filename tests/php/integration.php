<?php
/** Real WordPress release assertions, executed with wp eval-file. */

function nexo_check( bool $condition, string $message ): void {
	if ( ! $condition ) throw new RuntimeException( $message );
}

function nexo_request( string $method, string $route, ?array $body = null ): WP_REST_Response {
	$request = new WP_REST_Request( $method, $route );
	if ( null !== $body ) {
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( $body ) );
	}
	return rest_do_request( $request );
}

function nexo_puzzle( string $date, string $id, int $revision = 1 ): array {
	return array(
		'schemaVersion' => 1,
		'id' => $id,
		'revision' => $revision,
		'locale' => 'es-ES',
		'title' => 'Integración ' . $date,
		'releaseDate' => $date,
		'finalText' => 'Un sol.',
		'root' => array( 'Un ', array( 'ref' => 'sol' ), '.' ),
		'clues' => array( 'sol' => array( 'answer' => 'sol', 'prompt' => array( 'estrella cercana' ) ) ),
	);
}

$type = get_post_type_object( 'bc_puzzle' );
nexo_check( array() === Nexo_Validator::runtime_errors(), 'The release image must provide intl and mbstring.' );
$unicode = nexo_puzzle( '2026-08-28', 'unicode-puzzle-es' );
$unicode['finalText'] = "Un café.";
$unicode['root'] = array( 'Un ', array( 'ref' => 'sol' ), '.' );
$unicode['clues']['sol']['answer'] = "cafe\u{0301}";
nexo_check( Nexo_Validator::validate( $unicode )['valid'], 'NFC-equivalent decomposed Unicode must validate in WordPress.' );
nexo_check( $type instanceof WP_Post_Type, 'bc_puzzle must be registered.' );
nexo_check( ! $type->public && ! $type->publicly_queryable && ! $type->show_ui && ! $type->show_in_rest, 'bc_puzzle must be private and hidden.' );
nexo_check( post_type_supports( 'bc_puzzle', 'revisions' ), 'bc_puzzle must support revisions.' );

$seed_metadata = Nexo_Puzzles::list_metadata( false );
nexo_check( array() !== $seed_metadata, 'Activation must import at least one released bundled seed.' );
$seed_date = $seed_metadata[0]['date'];
$seed = Nexo_Puzzles::find( $seed_date );
nexo_check( $seed instanceof WP_Post, 'The released seed metadata must resolve to a puzzle post.' );
$seed_id = $seed->ID;
$seed_puzzle_id = $seed_metadata[0]['id'];
$seed_result = Nexo_Puzzles::import_seeds();
nexo_check( true === $seed_result && $seed_id === Nexo_Puzzles::find( $seed_date )->ID, 'Seed import must be idempotent.' );

wp_set_current_user( 0 );
$public_list = nexo_request( 'GET', '/bracket-city/v1/puzzles' );
nexo_check( 200 === $public_list->get_status(), 'Anonymous users must read the public archive.' );
$cache_response = Nexo_REST_Controller::prevent_private_caching(
	new WP_REST_Response( array() ),
	null,
	new WP_REST_Request( 'GET', '/bracket-city/v1/puzzles' )
);
nexo_check( false !== strpos( (string) $cache_response->get_headers()['Cache-Control'], 'no-store' ), 'Nexo REST responses intentionally use no-store for correction freshness.' );
$seed_get = nexo_request( 'GET', '/bracket-city/v1/puzzles/' . $seed_date );
nexo_check( 200 === $seed_get->get_status() && $seed_puzzle_id === $seed_get->get_data()['id'], 'Anonymous users must read a released seed.' );
$admin_denied = nexo_request( 'GET', '/bracket-city/v1/admin/puzzles' );
nexo_check( in_array( $admin_denied->get_status(), array( 401, 403 ), true ), 'Anonymous users must not read the admin archive.' );

$roles = array();
foreach ( array( 'editor', 'author', 'subscriber' ) as $role ) {
	$roles[ $role ] = wp_insert_user( array( 'user_login' => 'nexo-' . $role, 'user_pass' => 'test-password', 'user_email' => $role . '@example.test', 'role' => $role ) );
	nexo_check( ! is_wp_error( $roles[ $role ] ), 'Test role creation failed: ' . $role );
}
$administrator = get_user_by( 'login', 'release-admin' );

foreach ( array( 'administrator' => $administrator->ID, 'editor' => $roles['editor'] ) as $role => $user_id ) {
	wp_set_current_user( $user_id );
	nexo_check( Nexo_REST_Controller::can_publish(), $role . ' must pass the REST capability gate.' );
}

// Exercise WordPress core's REST cookie nonce behavior separately from direct dispatch.
wp_set_current_user( $roles['editor'] );
$GLOBALS['wp_rest_auth_cookie'] = true;
unset( $_SERVER['HTTP_X_WP_NONCE'] );
nexo_check( true === rest_cookie_check_errors( null ) && 0 === get_current_user_id(), 'A missing REST nonce must clear cookie authentication.' );
wp_set_current_user( $roles['editor'] );
$GLOBALS['wp_rest_auth_cookie'] = true;
$_SERVER['HTTP_X_WP_NONCE'] = 'invalid';
$invalid_nonce = rest_cookie_check_errors( null );
nexo_check( is_wp_error( $invalid_nonce ) && 'rest_cookie_invalid_nonce' === $invalid_nonce->get_error_code(), 'An invalid REST nonce must fail.' );
wp_set_current_user( $roles['editor'] );
$GLOBALS['wp_rest_auth_cookie'] = true;
$_SERVER['HTTP_X_WP_NONCE'] = wp_create_nonce( 'wp_rest' );
nexo_check( true === rest_cookie_check_errors( null ), 'A valid REST nonce must authenticate.' );
unset( $_SERVER['HTTP_X_WP_NONCE'] );
foreach ( array( 'author', 'subscriber' ) as $role ) {
	wp_set_current_user( $roles[ $role ] );
	nexo_check( ! Nexo_REST_Controller::can_publish(), $role . ' must fail the REST capability gate.' );
	$denied = nexo_request( 'POST', '/bracket-city/v1/puzzles', nexo_puzzle( '2099-01-01', 'denied-' . $role ) );
	nexo_check( in_array( $denied->get_status(), array( 401, 403 ), true ), $role . ' must not create puzzles.' );
}

wp_set_current_user( $roles['editor'] );
$future = nexo_puzzle( '2099-01-01', 'future-puzzle-es' );
$created = nexo_request( 'POST', '/bracket-city/v1/puzzles', $future );
nexo_check( 201 === $created->get_status(), 'Editor must create a puzzle.' );
nexo_check( 409 === nexo_request( 'POST', '/bracket-city/v1/puzzles', $future )->get_status(), 'Duplicate date creation must return 409.' );
nexo_check( 200 === nexo_request( 'GET', '/bracket-city/v1/admin/puzzles/2099-01-01' )->get_status(), 'Editor must preview a future puzzle.' );

wp_set_current_user( 0 );
nexo_check( 404 === nexo_request( 'GET', '/bracket-city/v1/puzzles/2099-01-01' )->get_status(), 'A future public puzzle must return 404.' );

wp_set_current_user( $roles['editor'] );
nexo_check( 422 === nexo_request( 'PUT', '/bracket-city/v1/puzzles/2099-01-01', $future )->get_status(), 'Revision must increase.' );
$wrong_id = nexo_puzzle( '2099-01-01', 'changed-id-es', 2 );
nexo_check( 422 === nexo_request( 'PUT', '/bracket-city/v1/puzzles/2099-01-01', $wrong_id )->get_status(), 'Puzzle ID must not change.' );
$corrected = nexo_puzzle( '2099-01-01', 'future-puzzle-es', 2 );
$corrected['title'] = 'Corrected';
nexo_check( 200 === nexo_request( 'PUT', '/bracket-city/v1/puzzles/2099-01-01', $corrected )->get_status(), 'A same-ID higher revision correction must succeed.' );
$future_post = Nexo_Puzzles::find( '2099-01-01' );
nexo_check( count( wp_get_post_revisions( $future_post->ID ) ) >= 1, 'Correction must create a WordPress revision.' );

$page_id = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Nexo', 'post_content' => '[bracket_city][bracket_city]' ) );
$GLOBALS['wp_query'] = new WP_Query( array( 'page_id' => $page_id ) );
$GLOBALS['wp_query']->the_post();
do_action( 'wp_enqueue_scripts' );
$output = do_shortcode( get_post_field( 'post_content', $page_id ) );
nexo_check( false !== strpos( $output, 'id="bracket-city-config"' ) && false !== strpos( $output, 'id="bracket-city-app"' ), 'The shortcode must emit configuration and one mount.' );
nexo_check( 1 === substr_count( $output, 'id="bracket-city-app"' ), 'The shortcode must never emit duplicate mount IDs.' );
nexo_check( false !== strpos( $output, 'Only one Nexo game' ), 'A second shortcode instance must show a clear error.' );
ob_start();
wp_head();
$head = (string) ob_get_clean();
nexo_check(
	false !== strpos( $head, 'build/assets/' ) &&
	false !== strpos( $head, '.js' ) &&
	false !== strpos( $head, '.css' ),
	'The shortcode Page must enqueue its module and style assets.'
);

echo "WordPress integration tests passed\n";
