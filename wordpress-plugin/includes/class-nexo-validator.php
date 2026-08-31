<?php
/** Standalone validator for Nexo puzzle definitions. */

if ( ! defined( 'ABSPATH' ) && ! defined( 'NEXO_TESTING' ) ) {
	exit;
}

final class Nexo_Validator {
	private const SLUG = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/D';
	private const HTML = '/(?:<!--|-->|<![^>]*(?:>|$)|<\?[^>]*(?:\?>|$)|<\/?[a-z][^<]*(?:>|$)|&(?:lt|gt|#0*(?:60|62)|#x0*3[ce]);)/iu';
	private const TOP_KEYS = array( 'schemaVersion', 'id', 'revision', 'locale', 'title', 'releaseDate', 'factDate', 'finalText', 'root', 'clues', 'source', 'scoring' );
	private const CLUE_KEYS = array( 'answer', 'prompt', 'rightPrompt', 'accept', 'peek', 'match' );
	private const MATCH_KEYS = array( 'locale', 'foldCase', 'trim', 'collapseWhitespace', 'canonicalizeQuotes', 'canonicalizeHyphens', 'optionalAcuteVowels', 'ignorePunctuation' );
	private const MAX_SAFE_INTEGER = 9007199254740991;
	private const SUPPORTED_LOCALES = array( 'es-ES' );

	public static function validate( $puzzle ): array {
		$errors = array();
		if ( ! self::is_object_array( $puzzle ) ) {
			return self::result( array( self::issue( 'INVALID_PUZZLE', '$', 'Puzzle must be an object.' ) ) );
		}
		foreach ( array_keys( $puzzle ) as $key ) {
			if ( ! in_array( $key, self::TOP_KEYS, true ) ) {
				$errors[] = self::issue( 'UNKNOWN_PUZZLE_KEY', '$.' . $key, 'Unknown puzzle field.' );
			}
		}
		if ( 1 !== ( $puzzle['schemaVersion'] ?? null ) ) {
			$errors[] = self::issue( 'UNSUPPORTED_SCHEMA', '$.schemaVersion', 'schemaVersion must be 1.' );
		}
		if ( ! self::is_slug( $puzzle['id'] ?? null ) ) {
			$errors[] = self::issue( 'INVALID_PUZZLE_ID', '$.id', 'Puzzle ID must be a simple lowercase slug.' );
		}
		if ( isset( $puzzle['revision'] ) && ( ! is_int( $puzzle['revision'] ) || $puzzle['revision'] < 1 || $puzzle['revision'] > self::MAX_SAFE_INTEGER ) ) {
			$errors[] = self::issue( 'INVALID_REVISION', '$.revision', 'Revision must be a positive integer.' );
		}
		if ( ! is_string( $puzzle['locale'] ?? null ) || ! in_array( $puzzle['locale'], self::SUPPORTED_LOCALES, true ) ) {
			$errors[] = self::issue( 'INVALID_LOCALE', '$.locale', 'Locale is not supported by this plugin build.' );
		}
		self::validate_text( $puzzle['finalText'] ?? null, '$.finalText', 'EMPTY_FINAL_TEXT', $errors );
		if ( isset( $puzzle['title'] ) ) {
			self::validate_text( $puzzle['title'], '$.title', 'INVALID_TEXT', $errors );
		}
		foreach ( array( 'releaseDate', 'factDate' ) as $key ) {
			if ( isset( $puzzle[ $key ] ) && ! self::is_date( $puzzle[ $key ] ) ) {
				$errors[] = self::issue( 'INVALID_DATE', '$.' . $key, 'Date must be a real YYYY-MM-DD date.' );
			}
		}
		if ( isset( $puzzle['source'] ) ) {
			if ( ! self::is_object_array( $puzzle['source'] ) || ! self::text( $puzzle['source']['label'] ?? null ) ) {
				$errors[] = self::issue( 'INVALID_SOURCE', '$.source', 'Source needs a non-empty label.' );
			}
			if ( is_array( $puzzle['source'] ) && array_diff( array_keys( $puzzle['source'] ), array( 'label', 'url' ) ) ) {
				$errors[] = self::issue( 'INVALID_SOURCE', '$.source', 'Source contains an unknown field.' );
			}
			if ( self::has_html( $puzzle['source']['label'] ?? null ) ) {
				$errors[] = self::issue( 'RAW_HTML', '$.source.label', 'Raw HTML is not allowed.' );
			}
			if ( isset( $puzzle['source']['url'] ) && ( ! filter_var( $puzzle['source']['url'], FILTER_VALIDATE_URL ) || ! in_array( strtolower( (string) parse_url( $puzzle['source']['url'], PHP_URL_SCHEME ) ), array( 'http', 'https' ), true ) ) ) {
				$errors[] = self::issue( 'INVALID_SOURCE_URL', '$.source.url', 'Source URL must be valid.' );
			}
		}
		if ( isset( $puzzle['scoring'] ) ) self::validate_scoring( $puzzle['scoring'], $errors );

		$clues = $puzzle['clues'] ?? null;
		if ( ! self::is_object_array( $clues ) || array() === $clues ) {
			$errors[] = self::issue( 'EMPTY_CLUES', '$.clues', 'Puzzle must contain clues.' );
			$clues = array();
		}
		foreach ( $clues as $id => $clue ) {
			$path = '$.clues.' . $id;
			if ( ! self::is_slug( $id ) ) {
				$errors[] = self::issue( 'INVALID_CLUE_ID', $path, 'Clue ID must be a simple lowercase slug.' );
			}
			if ( ! self::is_object_array( $clue ) ) {
				$errors[] = self::issue( 'INVALID_CLUE', $path, 'Clue must be an object.' );
				continue;
			}
			foreach ( array_keys( $clue ) as $key ) {
				if ( ! in_array( $key, self::CLUE_KEYS, true ) ) {
					$errors[] = self::issue( 'UNKNOWN_CLUE_KEY', $path . '.' . $key, 'Unknown clue field.' );
				}
			}
			self::validate_text( $clue['answer'] ?? null, $path . '.answer', 'EMPTY_ANSWER', $errors );
			if ( isset( $clue['peek'] ) ) {
				self::validate_text( $clue['peek'], $path . '.peek', 'INVALID_PEEK', $errors );
			}
			if ( isset( $clue['accept'] ) && ! is_array( $clue['accept'] ) ) {
				$errors[] = self::issue( 'INVALID_ALIASES', $path . '.accept', 'Accepted aliases must be an array.' );
			} else {
				foreach ( $clue['accept'] ?? array() as $i => $alias ) {
					self::validate_text( $alias, $path . '.accept[' . $i . ']', 'EMPTY_ALIAS', $errors );
				}
			}
			self::validate_match( $clue['match'] ?? null, $path, $errors );
		}

		$parents = array();
		$children = array_fill_keys( array_keys( $clues ), array() );
		self::segments( $puzzle['root'] ?? null, '$.root', null, $clues, $parents, $children, $errors );
		$roots = self::refs( $puzzle['root'] ?? array() );
		if ( array() === $roots ) {
			$errors[] = self::issue( 'ROOT_WITHOUT_CLUES', '$.root', 'Root must reference at least one clue.' );
		}
		foreach ( $clues as $id => $clue ) {
			if ( ! is_array( $clue ) ) {
				continue;
			}
			self::segments( $clue['prompt'] ?? null, '$.clues.' . $id . '.prompt', $id, $clues, $parents, $children, $errors );
			if ( array_key_exists( 'rightPrompt', $clue ) ) {
				self::segments( $clue['rightPrompt'], '$.clues.' . $id . '.rightPrompt', $id, $clues, $parents, $children, $errors );
			}
		}
		self::graph( $clues, $children, $roots, $errors );
		self::collisions( $puzzle, $clues, $errors );

		if ( is_array( $puzzle['root'] ?? null ) && self::text( $puzzle['finalText'] ?? null ) ) {
			$expanded = '';
			foreach ( $puzzle['root'] as $segment ) {
				$expanded .= is_string( $segment ) ? $segment : ( $clues[ $segment['ref'] ]['answer'] ?? '' );
			}
			if ( self::nfc( $expanded ) !== self::nfc( $puzzle['finalText'] ) ) {
				$errors[] = self::issue( 'FINAL_TEXT_MISMATCH', '$.finalText', 'Root expansion must exactly equal finalText.' );
			}
		}
		return self::result( $errors );
	}

	/** Report extensions required for matching and NFC parity at publish time. */
	public static function runtime_errors(): array {
		$errors = array();
		if ( ! class_exists( 'Normalizer' ) ) $errors[] = self::issue( 'MISSING_INTL', '$', 'PHP intl is required to publish puzzles.' );
		if ( ! function_exists( 'mb_strtolower' ) ) $errors[] = self::issue( 'MISSING_MBSTRING', '$', 'PHP mbstring is required to publish puzzles.' );
		return $errors;
	}

	private static function segments( $segments, string $path, ?string $parent, array $clues, array &$parents, array &$children, array &$errors ): void {
		if ( ! is_array( $segments ) || array() === $segments ) {
			$errors[] = self::issue( 'EMPTY_SEGMENTS', $path, 'Segment list must not be empty.' );
			return;
		}
		$content = false;
		foreach ( $segments as $i => $segment ) {
			$at = $path . '[' . $i . ']';
			if ( is_string( $segment ) ) {
				$content = $content || '' !== $segment;
				if ( self::has_html( $segment ) ) {
					$errors[] = self::issue( 'RAW_HTML', $at, 'Raw HTML is not allowed.' );
				}
				continue;
			}
			if ( ! self::is_object_array( $segment ) || array_diff( array_keys( $segment ), array( 'ref', 'direction' ) ) || ! self::is_slug( $segment['ref'] ?? null ) ) {
				$errors[] = self::issue( 'INVALID_SEGMENT', $at, 'Invalid reference segment.' );
				continue;
			}
			$content = true;
			$child = $segment['ref'];
			if ( isset( $segment['direction'] ) && ! in_array( $segment['direction'], array( 'left', 'right' ), true ) ) {
				$errors[] = self::issue( 'INVALID_DIRECTION', $at . '.direction', 'Direction must be left or right.' );
			}
			if ( ! isset( $clues[ $child ] ) ) {
				$errors[] = self::issue( 'MISSING_REFERENCE', $at . '.ref', 'Unknown clue.' );
				continue;
			}
			if ( array_key_exists( $child, $parents ) ) {
				$errors[] = self::issue( 'MULTIPLE_PARENTS', $at . '.ref', 'Clue is referenced more than once.' );
			} else {
				$parents[ $child ] = $parent;
			}
			if ( null !== $parent ) {
				$children[ $parent ][] = $child;
			}
			if ( isset( $segment['direction'] ) && isset( $clues[ $child ]['rightPrompt'] ) ) {
				$errors[] = self::issue( 'DIRECTION_WITH_RIGHT_PROMPT', $at . '.direction', 'A two-sided clue must not have a direction.' );
			}
		}
		if ( ! $content ) {
			$errors[] = self::issue( 'EMPTY_PROMPT', $path, 'Prompt must contain content.' );
		}
	}

	private static function graph( array $clues, array $children, array $roots, array &$errors ): void {
		$colors = array();
		$visit = function ( string $id, array $trail = array() ) use ( &$visit, &$colors, $children, &$errors ): void {
			if ( 'gray' === ( $colors[ $id ] ?? null ) ) {
				$errors[] = self::issue( 'CYCLE', '$.clues.' . $id . '.prompt', 'Cycle detected: ' . implode( ' -> ', array_merge( $trail, array( $id ) ) ) . '.' );
				return;
			}
			if ( 'black' === ( $colors[ $id ] ?? null ) ) return;
			$colors[ $id ] = 'gray';
			foreach ( $children[ $id ] ?? array() as $child ) $visit( $child, array_merge( $trail, array( $id ) ) );
			$colors[ $id ] = 'black';
		};
		foreach ( array_keys( $clues ) as $id ) $visit( (string) $id );
		$seen = array();
		$mark = function ( string $id ) use ( &$mark, &$seen, $children ): void {
			if ( isset( $seen[ $id ] ) ) return;
			$seen[ $id ] = true;
			foreach ( $children[ $id ] ?? array() as $child ) $mark( $child );
		};
		foreach ( $roots as $id ) if ( isset( $clues[ $id ] ) ) $mark( $id );
		foreach ( array_keys( $clues ) as $id ) if ( ! isset( $seen[ $id ] ) ) $errors[] = self::issue( 'UNREACHABLE_CLUE', '$.clues.' . $id, 'Clue is not reachable from root.' );
	}

	private static function collisions( array $puzzle, array $clues, array &$errors ): void {
		$by_clue = array();
		$raw_values = array();
		foreach ( $clues as $id => $clue ) {
			if ( ! is_array( $clue ) || ! self::text( $clue['answer'] ?? null ) ) continue;
			$policy = array_merge( self::default_policy( $puzzle['locale'] ?? 'en' ), is_array( $clue['match'] ?? null ) ? $clue['match'] : array() );
			$accepted = array();
			foreach ( array_merge( array( $clue['answer'] ), is_array( $clue['accept'] ?? null ) ? $clue['accept'] : array() ) as $raw ) {
				if ( ! self::text( $raw ) ) continue;
				$raw_values[] = $raw;
				$value = self::normalize_answer( $raw, $policy );
				if ( '' === $value ) $errors[] = self::issue( 'EMPTY_NORMALIZED_ANSWER', '$.clues.' . $id, 'Answer is empty after normalization.' );
				else $accepted[ $value ] = true;
			}
			$by_clue[ $id ] = array( 'accepted' => $accepted, 'policy' => $policy );
		}
		$ids = array_keys( $by_clue );
		for ( $left = 0; $left < count( $ids ); $left++ ) {
			for ( $right = $left + 1; $right < count( $ids ); $right++ ) {
				$left_id = $ids[ $left ];
				$right_id = $ids[ $right ];
				foreach ( $raw_values as $raw ) {
					$left_value = self::normalize_answer( $raw, $by_clue[ $left_id ]['policy'] );
					$right_value = self::normalize_answer( $raw, $by_clue[ $right_id ]['policy'] );
					if ( isset( $by_clue[ $left_id ]['accepted'][ $left_value ], $by_clue[ $right_id ]['accepted'][ $right_value ] ) ) {
						$errors[] = self::issue( 'ANSWER_COLLISION', '$.clues.' . $right_id, "Accepted answer collides with clue '{$left_id}'." );
						break;
					}
				}
			}
		}
	}

	public static function normalize_answer( string $raw, array $policy = array() ): string {
		$p = array_merge( self::default_policy( 'en' ), $policy );
		$value = self::nfc( $raw );
		if ( $p['canonicalizeQuotes'] ) $value = str_replace( array( '‘', '’', '‚', '‛', '“', '”', '„', '‟' ), array( "'", "'", "'", "'", '"', '"', '"', '"' ), $value );
		if ( $p['canonicalizeHyphens'] ) $value = str_replace( array( '‐', '‑', '‒', '–', '—', '―', '−' ), '-', $value );
		if ( $p['foldCase'] ) $value = function_exists( 'mb_strtolower' ) ? mb_strtolower( $value, 'UTF-8' ) : strtolower( $value );
		if ( $p['optionalAcuteVowels'] ) $value = str_replace( array( 'á', 'é', 'í', 'ó', 'ú' ), array( 'a', 'e', 'i', 'o', 'u' ), $value );
		if ( $p['ignorePunctuation'] ) $value = preg_replace( '/\p{P}+/u', '', $value ) ?? $value;
		if ( $p['trim'] ) $value = trim( $value );
		if ( $p['collapseWhitespace'] ) $value = preg_replace( '/\s+/u', ' ', $value ) ?? $value;
		return self::nfc( $value );
	}

	public static function is_date( $value ): bool {
		if ( ! is_string( $value ) || 1 !== preg_match( '/^\d{4}-\d{2}-\d{2}$/D', $value ) ) return false;
		$date = DateTimeImmutable::createFromFormat( '!Y-m-d', $value, new DateTimeZone( 'UTC' ) );
		return false !== $date && $date->format( 'Y-m-d' ) === $value;
	}

	private static function validate_match( $match, string $path, array &$errors ): void {
		if ( null === $match ) return;
		if ( ! self::is_object_array( $match ) ) {
			$errors[] = self::issue( 'INVALID_MATCH_POLICY', $path . '.match', 'Match policy must be an object.' );
			return;
		}
		foreach ( $match as $key => $value ) {
			if ( ! in_array( $key, self::MATCH_KEYS, true ) || ( 'locale' === $key ? ! self::text( $value ) : ! is_bool( $value ) ) ) {
				$errors[] = self::issue( 'INVALID_MATCH_OPTION', $path . '.match.' . $key, 'Invalid match option.' );
			}
		}
	}

	private static function validate_scoring( $scoring, array &$errors ): void {
		if ( ! self::is_object_array( $scoring ) ) {
			$errors[] = self::issue( 'INVALID_SCORING', '$.scoring', 'Scoring must be an object.' );
			return;
		}
		foreach ( array_keys( $scoring ) as $key ) if ( ! in_array( $key, array( 'base', 'wrongGuess', 'peek', 'ranks' ), true ) ) $errors[] = self::issue( 'UNKNOWN_SCORING_KEY', '$.scoring.' . $key, 'Unknown scoring field.' );
		foreach ( array( 'base', 'wrongGuess', 'peek' ) as $key ) if ( isset( $scoring[ $key ] ) && ! self::finite_number( $scoring[ $key ] ) ) $errors[] = self::issue( 'INVALID_SCORING_VALUE', '$.scoring.' . $key, 'Scoring value must be finite.' );
		if ( isset( $scoring['ranks'] ) ) {
			if ( ! is_array( $scoring['ranks'] ) ) $errors[] = self::issue( 'INVALID_RANKS', '$.scoring.ranks', 'Ranks must be an array.' );
			else {
				$thresholds = array();
				foreach ( $scoring['ranks'] as $i => $rank ) {
					if ( ! self::is_object_array( $rank ) || ! self::finite_number( $rank['minScore'] ?? null ) || ! self::text( $rank['labelKey'] ?? null ) ) $errors[] = self::issue( 'INVALID_RANK', '$.scoring.ranks[' . $i . ']', 'Rank is invalid.' );
					elseif ( isset( $thresholds[ (string) $rank['minScore'] ] ) ) $errors[] = self::issue( 'DUPLICATE_RANK', '$.scoring.ranks[' . $i . '].minScore', 'Rank thresholds must be unique.' );
					else $thresholds[ (string) $rank['minScore'] ] = true;
				}
			}
		}
	}

	private static function default_policy( string $locale ): array {
		$is_spanish = 1 === preg_match( '/^es(?:-|$)/i', $locale );
		return array( 'locale' => $locale, 'foldCase' => true, 'trim' => true, 'collapseWhitespace' => true, 'canonicalizeQuotes' => true, 'canonicalizeHyphens' => true, 'optionalAcuteVowels' => $is_spanish, 'ignorePunctuation' => false );
	}
	private static function validate_text( $value, string $path, string $code, array &$errors ): void {
		if ( ! self::text( $value ) ) $errors[] = self::issue( $code, $path, 'Text must not be empty.' );
		elseif ( self::has_html( $value ) ) $errors[] = self::issue( 'RAW_HTML', $path, 'Raw HTML is not allowed.' );
	}
	private static function refs( $segments ): array {
		return is_array( $segments ) ? array_values( array_map( fn( $s ) => $s['ref'], array_filter( $segments, fn( $s ) => is_array( $s ) && isset( $s['ref'] ) ) ) ) : array();
	}
	private static function is_object_array( $value ): bool { return is_array( $value ) && ! array_is_list( $value ); }
	private static function is_slug( $value ): bool { return is_string( $value ) && ! in_array( $value, array( '__proto__', 'constructor', 'prototype' ), true ) && 1 === preg_match( self::SLUG, $value ); }
	private static function text( $value ): bool { return is_string( $value ) && '' !== trim( $value ); }
	private static function finite_number( $value ): bool { return ( is_int( $value ) || is_float( $value ) ) && is_finite( (float) $value ); }
	private static function has_html( $value ): bool { return is_string( $value ) && 1 === preg_match( self::HTML, $value ); }
	private static function nfc( string $value ): string { return class_exists( 'Normalizer' ) ? ( Normalizer::normalize( $value, Normalizer::FORM_C ) ?: $value ) : $value; }
	private static function issue( string $code, string $path, string $message ): array { return compact( 'code', 'path', 'message' ); }
	private static function result( array $errors ): array { return array( 'valid' => array() === $errors, 'errors' => $errors ); }
}
