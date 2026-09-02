<?php
define( 'ABSPATH', __DIR__ . '/' );
define( 'NEXO_DIR', __DIR__ . '/../../wordpress-plugin/' );
define( 'NEXO_VERSION', 'test' );
define( 'NEXO_TIME_ZONE', 'Europe/Madrid' );

$GLOBALS['nexo_calls'] = array(
	'post_types' => array(),
	'routes' => array(),
	'shortcodes' => array(),
	'scripts' => array(),
);
$GLOBALS['nexo_current_capabilities'] = array();

function add_action() {}
function register_post_type( $name, $args ) { $GLOBALS['nexo_calls']['post_types'][ $name ] = $args; }
function register_rest_route( $namespace, $route, $args ) { $GLOBALS['nexo_calls']['routes'][ $namespace . $route ] = $args; }
function add_shortcode( $name, $callback ) { $GLOBALS['nexo_calls']['shortcodes'][ $name ] = $callback; }
function current_user_can( $capability ) { return in_array( $capability, $GLOBALS['nexo_current_capabilities'], true ); }
function wp_enqueue_script( $handle, $source, $dependencies = array(), $version = false, $footer = false ) {
	$GLOBALS['nexo_calls']['scripts'][ $handle ] = compact( 'source', 'dependencies', 'version', 'footer' );
}
function rest_url( $path ) { return 'https://example.test/wp-json/' . $path; }
function get_permalink() { return 'https://example.test/nexo/'; }
function wp_create_nonce() { return 'nonce'; }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
function esc_url_raw( $value, $protocols = null ) { return $value; }
function esc_html__( $value ) { return $value; }
function shortcode_atts( $defaults, $attributes ) { return array_merge( $defaults, $attributes ); }
function wp_parse_url( $value ) { return parse_url( $value ); }
function untrailingslashit( $value ) { return rtrim( $value, '/\\' ); }
function is_singular( $type ) { return 'page' === $type; }
function get_queried_object() { $post = new WP_Post(); $post->post_type = 'page'; return $post; }
function get_posts() { return $GLOBALS['nexo_test_posts'] ?? array(); }
function rest_ensure_response( $value ) { return new WP_REST_Response( $value ); }
function __return_true() { return true; }
function is_wp_error( $value ) { return $value instanceof WP_Error; }

class WP_Role {
	public array $capabilities;
	public function __construct( array $capabilities = array() ) { $this->capabilities = $capabilities; }
	public function has_cap( $capability ) { return ! empty( $this->capabilities[ $capability ] ); }
	public function add_cap( $capability ) { $this->capabilities[ $capability ] = true; }
}
$GLOBALS['nexo_roles'] = array(
	'administrator' => new WP_Role( array( 'read' => true ) ),
	'editor' => new WP_Role( array( 'read' => true, 'edit_others_posts' => true ) ),
);
function get_role( $name ) { return $GLOBALS['nexo_roles'][ $name ] ?? null; }
function add_role( $name, $label, $capabilities ) {
	$GLOBALS['nexo_roles'][ $name ] = new WP_Role( $capabilities );
	return $GLOBALS['nexo_roles'][ $name ];
}

class WP_Post { public $ID = 1; public $post_title = ''; public $post_content = ''; public $post_type = 'post'; }
class WP_REST_Request implements ArrayAccess {
	private $params;
	public function __construct( array $params = array() ) { $this->params = $params; }
	public function get_route() { return ''; }
	public function offsetExists( mixed $offset ): bool { return isset( $this->params[ $offset ] ); }
	public function offsetGet( mixed $offset ): mixed { return $this->params[ $offset ] ?? null; }
	public function offsetSet( mixed $offset, mixed $value ): void { $this->params[ $offset ] = $value; }
	public function offsetUnset( mixed $offset ): void { unset( $this->params[ $offset ] ); }
}
class WP_REST_Response { public $data; public function __construct( $data = null ) { $this->data = $data; } }
class WP_HTTP_Response { public function header() {} }
class WP_Error { public $code; public $message; public $data; public function __construct( $code = '', $message = '', $data = null ) { $this->code = $code; $this->message = $message; $this->data = $data; } }
class WP_REST_Server { public const READABLE = 'GET'; public const CREATABLE = 'POST'; public const EDITABLE = 'PUT,PATCH'; }

require_once NEXO_DIR . 'includes/class-nexo-capabilities.php';
require_once NEXO_DIR . 'includes/class-nexo-validator.php';
require_once NEXO_DIR . 'includes/class-nexo-puzzles.php';
require_once NEXO_DIR . 'includes/class-nexo-rest-controller.php';
require_once NEXO_DIR . 'includes/class-nexo-shortcode.php';

function check( bool $condition, string $message ): void { if ( ! $condition ) throw new RuntimeException( $message ); }

Nexo_Capabilities::register();
$manager = get_role( Nexo_Capabilities::MANAGER_ROLE );
check( $manager instanceof WP_Role && $manager->has_cap( 'read' ) && $manager->has_cap( Nexo_Capabilities::MANAGE_PUZZLES ), 'Puzzle Manager role must have only the required access.' );
check( get_role( 'administrator' )->has_cap( Nexo_Capabilities::MANAGE_PUZZLES ), 'Administrator must receive the puzzle capability.' );
check( ! get_role( 'editor' )->has_cap( Nexo_Capabilities::MANAGE_PUZZLES ), 'Editor must not receive the puzzle capability.' );

Nexo_Puzzles::register_post_type();
$type = $GLOBALS['nexo_calls']['post_types']['bc_puzzle'];
check( false === $type['public'] && false === $type['publicly_queryable'] && false === $type['show_ui'] && false === $type['show_in_rest'], 'Puzzle CPT must stay private and hidden.' );
check( in_array( 'revisions', $type['supports'], true ), 'Puzzle CPT must preserve revisions.' );

Nexo_REST_Controller::register_routes();
check( isset( $GLOBALS['nexo_calls']['routes']['bracket-city/v1/puzzles'] ), 'Public collection route must register.' );
check( isset( $GLOBALS['nexo_calls']['routes']['bracket-city/v1/admin/puzzles'] ), 'Admin collection route must register.' );
check( isset( $GLOBALS['nexo_calls']['routes']['bracket-city/v1/admin/puzzles/trash'] ), 'Admin Trash collection route must register.' );
check( ! Nexo_REST_Controller::can_publish(), 'A user without the custom capability must not publish.' );
$GLOBALS['nexo_current_capabilities'] = array( Nexo_Capabilities::MANAGE_PUZZLES );
check( Nexo_REST_Controller::can_publish(), 'The custom capability must permit publishing.' );
$item_routes = $GLOBALS['nexo_calls']['routes']['bracket-city/v1/puzzles/(?P<date>\d{4}-\d{2}-\d{2})'];
check( 'PUT' === $item_routes[1]['methods'], 'Correction route must accept PUT only.' );
check( 'DELETE' === $item_routes[2]['methods'], 'Puzzle removal route must accept DELETE only.' );
$trash_item_routes = $GLOBALS['nexo_calls']['routes']['bracket-city/v1/admin/puzzles/trash/(?P<date>\d{4}-\d{2}-\d{2})'];
check( 'POST' === $trash_item_routes[1]['methods'], 'Puzzle restore route must accept POST only.' );

$invalid_post = new WP_Post();
$invalid_post->post_content = '{"schemaVersion":1,"releaseDate":"' . Nexo_Puzzles::current_date() . '"}';
$GLOBALS['nexo_test_posts'] = array( $invalid_post );
$invalid_response = Nexo_REST_Controller::public_get( new WP_REST_Request( array( 'date' => Nexo_Puzzles::current_date() ) ) );
check( $invalid_response instanceof WP_Error && 'nexo_invalid_stored_puzzle' === $invalid_response->code, 'Stored definitions must pass full validation before delivery.' );
$GLOBALS['nexo_test_posts'] = array();

Nexo_Shortcode::register();
check( isset( $GLOBALS['nexo_calls']['shortcodes']['bracket_city'] ), 'Shortcode must register.' );
foreach ( array( '', 'http://owner.github.io/repo', 'https://user@owner.github.io/repo', 'https://owner.github.io/repo?x=1', 'https://owner.github.io/repo#x' ) as $invalid_base ) {
	$output = Nexo_Shortcode::render( array( 'asset_base' => $invalid_base ) );
	check( false !== strpos( $output, 'secure HTTPS asset_base' ), 'Unsafe asset_base values must fail.' );
}
check( array() === $GLOBALS['nexo_calls']['scripts'], 'Invalid shortcodes must not enqueue scripts.' );

$output = Nexo_Shortcode::render( array( 'asset_base' => 'https://owner.github.io/bracketcity/' ) );
check( false !== strpos( $output, 'id="bracket-city-app"' ), 'A valid shortcode must emit the mount.' );
check( 'https://owner.github.io/bracketcity/loader.js' === $GLOBALS['nexo_calls']['scripts']['nexo-loader']['source'], 'The shortcode must enqueue the external loader.' );
check( true === $GLOBALS['nexo_calls']['scripts']['nexo-loader']['footer'], 'The loader must be in the footer.' );
$config_start = strpos( $output, '>' ) + 1;
$config_end = strpos( $output, '</script>' );
$config = json_decode( substr( $output, $config_start, $config_end - $config_start ), true );
check( 'https://owner.github.io/bracketcity' === $config['assetBase'], 'The shortcode must normalize the asset base.' );
check( true === $config['canAuthor'] && 'nonce' === $config['nonce'], 'Authorized users must receive a REST nonce.' );
check( false !== strpos( Nexo_Shortcode::render( array( 'asset_base' => 'https://owner.github.io/bracketcity' ) ), 'Only one Nexo game' ), 'Only one shortcode instance is allowed.' );
check( 'Europe/Madrid' === NEXO_TIME_ZONE, 'Canonical time zone must be Europe/Madrid.' );

echo "WordPress stub tests passed\n";
