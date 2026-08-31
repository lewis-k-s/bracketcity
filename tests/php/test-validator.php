<?php
define( 'NEXO_TESTING', true );
require_once __DIR__ . '/../../wordpress-plugin/includes/class-nexo-validator.php';

function check( bool $condition, string $message ): void {
	if ( ! $condition ) throw new RuntimeException( $message );
}
function codes( array $result ): array { return array_column( $result['errors'], 'code' ); }

$fixture = json_decode( (string) file_get_contents( __DIR__ . '/../../puzzles/2026-08-31-es.json' ), true );
check( Nexo_Validator::validate( $fixture )['valid'], 'Published Spanish fixture must be valid.' );
check( 'arte' === Nexo_Validator::normalize_answer( 'ÁRTE', array( 'locale' => 'es-ES', 'optionalAcuteVowels' => true ) ), 'Acute vowels must fold.' );
check( 'niño' !== Nexo_Validator::normalize_answer( 'nino', array( 'locale' => 'es-ES', 'optionalAcuteVowels' => true ) ), 'ñ must remain distinct.' );
check( 'ü' !== Nexo_Validator::normalize_answer( 'u', array( 'locale' => 'es-ES', 'optionalAcuteVowels' => true ) ), 'ü must remain distinct.' );

$bad_locale = $fixture;
$bad_locale['locale'] = 'es_es';
check( in_array( 'INVALID_LOCALE', codes( Nexo_Validator::validate( $bad_locale ) ), true ), 'Unsupported or malformed locales must fail.' );

$unsafe_revision = $fixture;
$unsafe_revision['revision'] = 9007199254740992;
check( in_array( 'INVALID_REVISION', codes( Nexo_Validator::validate( $unsafe_revision ) ), true ), 'Revisions above the JavaScript safe integer must fail.' );

$source_html = $fixture;
$source_html['source']['label'] = '<b>unsafe</b>';
check( in_array( 'RAW_HTML', codes( Nexo_Validator::validate( $source_html ) ), true ), 'Raw HTML in source labels must fail.' );

if ( class_exists( 'Normalizer' ) ) {
	$unicode = array(
		'schemaVersion' => 1,
		'id' => 'unicode-es',
		'revision' => 1,
		'locale' => 'es-ES',
		'finalText' => "Un café.",
		'root' => array( 'Un ', array( 'ref' => 'cafe' ), '.' ),
		'clues' => array( 'cafe' => array( 'answer' => "cafe\u{0301}", 'prompt' => array( 'bebida' ) ) ),
	);
	check( Nexo_Validator::validate( $unicode )['valid'], 'NFC-equivalent decomposed Unicode must validate.' );
}

$missing = $fixture;
$missing['root'][] = array( 'ref' => 'absent' );
check( in_array( 'MISSING_REFERENCE', codes( Nexo_Validator::validate( $missing ) ), true ), 'Missing references must fail.' );

$unreachable = $fixture;
$unreachable['clues']['orphan'] = array( 'answer' => 'x', 'prompt' => array( 'letra' ) );
check( in_array( 'UNREACHABLE_CLUE', codes( Nexo_Validator::validate( $unreachable ) ), true ), 'Unreachable clues must fail.' );

$multiple = $fixture;
$multiple['root'][] = array( 'ref' => 'c01' );
check( in_array( 'MULTIPLE_PARENTS', codes( Nexo_Validator::validate( $multiple ) ), true ), 'Multiple parents must fail.' );

$cycle = $fixture;
$cycle['clues']['c07']['prompt'] = array( array( 'ref' => 'c06' ) );
check( in_array( 'CYCLE', codes( Nexo_Validator::validate( $cycle ) ), true ), 'Cycles must fail.' );

$collision = $fixture;
$collision['clues']['c07']['accept'] = array( 'arte' );
check( in_array( 'ANSWER_COLLISION', codes( Nexo_Validator::validate( $collision ) ), true ), 'Normalized answer collisions must fail.' );

$mismatch = $fixture;
$mismatch['finalText'] .= '!';
check( in_array( 'FINAL_TEXT_MISMATCH', codes( Nexo_Validator::validate( $mismatch ) ), true ), 'Final expansion mismatch must fail.' );

$html = $fixture;
$html['clues']['c07']['prompt'] = array( '<b>bad</b>' );
check( in_array( 'RAW_HTML', codes( Nexo_Validator::validate( $html ) ), true ), 'Raw HTML must fail.' );

$unknown = $fixture;
$unknown['scoring']['mystery'] = 3;
check( in_array( 'UNKNOWN_SCORING_KEY', codes( Nexo_Validator::validate( $unknown ) ), true ), 'Unknown scoring fields must fail.' );

echo "validator tests passed\n";
