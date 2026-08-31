<?php
define( 'ABSPATH', __DIR__ . '/' );
define( 'NEXO_DIR', __DIR__ . '/../../wordpress-plugin/' );
define( 'NEXO_URL', 'https://example.test/wp-content/plugins/bracket-city/' );
define( 'NEXO_VERSION', 'test' );
define( 'NEXO_TIME_ZONE', 'Europe/Madrid' );

$GLOBALS['nexo_calls'] = array( 'post_types' => array(), 'routes' => array(), 'shortcodes' => array(), 'modules' => array(), 'styles' => array() );
function add_action() {}
function register_post_type( $name, $args ) { $GLOBALS['nexo_calls']['post_types'][ $name ] = $args; }
function register_rest_route( $namespace, $route, $args ) { $GLOBALS['nexo_calls']['routes'][ $namespace . $route ] = $args; }
function add_shortcode( $name, $callback ) { $GLOBALS['nexo_calls']['shortcodes'][ $name ] = $callback; }
function current_user_can( $capability ) { return 'edit_others_posts' === $capability; }
function wp_enqueue_script_module( $handle, $source ) { $GLOBALS['nexo_calls']['modules'][ $handle ] = $source; }
function wp_enqueue_style( $handle, $source ) { $GLOBALS['nexo_calls']['styles'][ $handle ] = $source; }
function rest_url( $path ) { return 'https://example.test/wp-json/' . $path; }
function get_permalink() { return 'https://example.test/nexo/'; }
function wp_create_nonce() { return 'nonce'; }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
function esc_url_raw( $value ) { return $value; }
function esc_html__( $value ) { return $value; }
function get_posts() { return $GLOBALS['nexo_test_posts'] ?? array(); }
function rest_ensure_response( $value ) { return new WP_REST_Response( $value ); }
function __return_true() { return true; }
function is_wp_error( $value ) { return $value instanceof WP_Error; }
class WP_Post { public $ID = 1; public $post_title = ''; public $post_content = ''; }
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

require_once NEXO_DIR . 'includes/class-nexo-validator.php';
require_once NEXO_DIR . 'includes/class-nexo-puzzles.php';
require_once NEXO_DIR . 'includes/class-nexo-rest-controller.php';
require_once NEXO_DIR . 'includes/class-nexo-shortcode.php';

function check( bool $condition, string $message ): void { if ( ! $condition ) throw new RuntimeException( $message ); }

Nexo_Puzzles::register_post_type();
$type = $GLOBALS['nexo_calls']['post_types']['bc_puzzle'];
check( false === $type['public'] && false === $type['publicly_queryable'] && false === $type['show_ui'] && false === $type['show_in_rest'], 'Puzzle CPT must stay private and hidden.' );
check( in_array( 'revisions', $type['supports'], true ), 'Puzzle CPT must preserve revisions.' );

Nexo_REST_Controller::register_routes();
check( isset( $GLOBALS['nexo_calls']['routes']['bracket-city/v1/puzzles'] ), 'Public collection route must register.' );
check( isset( $GLOBALS['nexo_calls']['routes']['bracket-city/v1/admin/puzzles'] ), 'Admin collection route must register.' );
check( Nexo_REST_Controller::can_publish(), 'Editor capability must permit publishing.' );
$item_routes = $GLOBALS['nexo_calls']['routes']['bracket-city/v1/puzzles/(?P<date>\d{4}-\d{2}-\d{2})'];
check( 'PUT' === $item_routes[1]['methods'], 'Correction route must accept PUT only.' );

$invalid_post = new WP_Post();
$invalid_post->post_content = '{"schemaVersion":1,"releaseDate":"' . Nexo_Puzzles::current_date() . '"}';
$GLOBALS['nexo_test_posts'] = array( $invalid_post );
$invalid_response = Nexo_REST_Controller::public_get( new WP_REST_Request( array( 'date' => Nexo_Puzzles::current_date() ) ) );
check( $invalid_response instanceof WP_Error && 'nexo_invalid_stored_puzzle' === $invalid_response->code, 'Stored definitions must pass full validation before delivery.' );
$GLOBALS['nexo_test_posts'] = array();

Nexo_Shortcode::register();
check( isset( $GLOBALS['nexo_calls']['shortcodes']['bracket_city'] ), 'Shortcode must register.' );
check( 'Europe/Madrid' === NEXO_TIME_ZONE, 'Canonical time zone must be Europe/Madrid.' );

echo "WordPress stub tests passed\n";
