<?php
/** WordPress persistence for puzzle posts. */

if ( ! defined( 'ABSPATH' ) ) exit;

final class Nexo_Puzzles {
	public const POST_TYPE = 'bc_puzzle';
	public const META_DATE = '_bc_release_date';
	public const META_ID = '_bc_puzzle_id';
	public const META_SCHEMA = '_bc_schema_version';
	public const META_REVISION = '_bc_revision';

	public static function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels' => array( 'name' => 'Nexo puzzles', 'singular_name' => 'Nexo puzzle' ),
				'public' => false,
				'publicly_queryable' => false,
				'show_ui' => false,
				'show_in_menu' => false,
				'show_in_rest' => false,
				'exclude_from_search' => true,
				'supports' => array( 'title', 'editor', 'revisions' ),
				'rewrite' => false,
				'query_var' => false,
			)
		);
	}

	public static function current_date(): string {
		return ( new DateTimeImmutable( 'now', new DateTimeZone( NEXO_TIME_ZONE ) ) )->format( 'Y-m-d' );
	}

	public static function find( string $date ): ?WP_Post {
		$posts = get_posts(
			array(
				'post_type' => self::POST_TYPE,
				'post_status' => 'private',
				'name' => $date,
				'numberposts' => 1,
				'suppress_filters' => true,
			)
		);
		return $posts[0] ?? null;
	}

	public static function find_trashed( string $date ): ?WP_Post {
		$posts = get_posts(
			array(
				'post_type' => self::POST_TYPE,
				'post_status' => 'trash',
				'meta_key' => self::META_DATE,
				'meta_value' => $date,
				'numberposts' => 1,
				'suppress_filters' => true,
			)
		);
		return $posts[0] ?? null;
	}

	public static function definition( WP_Post $post ): ?array {
		$value = json_decode( $post->post_content, true );
		return is_array( $value ) && ! array_is_list( $value ) ? $value : null;
	}

	public static function list_metadata( bool $include_future = false ): array {
		$posts = get_posts(
			array(
				'post_type' => self::POST_TYPE,
				'post_status' => 'private',
				'numberposts' => -1,
				'orderby' => 'meta_value',
				'meta_key' => self::META_DATE,
				'order' => 'DESC',
				'suppress_filters' => true,
			)
		);
		$today = self::current_date();
		$result = array();
		foreach ( $posts as $post ) {
			$date = (string) get_post_meta( $post->ID, self::META_DATE, true );
			$definition = self::definition( $post );
			if ( ! Nexo_Validator::is_date( $date ) || ! is_array( $definition ) || ( $definition['releaseDate'] ?? null ) !== $date || ! Nexo_Validator::validate( $definition )['valid'] ) continue;
			if ( ! $include_future && $date > $today ) continue;
			$result[] = array(
				'date' => $date,
				'id' => (string) get_post_meta( $post->ID, self::META_ID, true ),
				'revision' => (int) get_post_meta( $post->ID, self::META_REVISION, true ),
			);
		}
		return $result;
	}

	public static function list_trashed_metadata(): array {
		$posts = get_posts(
			array(
				'post_type' => self::POST_TYPE,
				'post_status' => 'trash',
				'numberposts' => -1,
				'orderby' => 'meta_value',
				'meta_key' => self::META_DATE,
				'order' => 'DESC',
				'suppress_filters' => true,
			)
		);
		$result = array();
		foreach ( $posts as $post ) {
			$date = (string) get_post_meta( $post->ID, self::META_DATE, true );
			$definition = self::definition( $post );
			if ( ! Nexo_Validator::is_date( $date ) || ! is_array( $definition ) || ( $definition['releaseDate'] ?? null ) !== $date || ! Nexo_Validator::validate( $definition )['valid'] ) continue;
			$result[] = array(
				'date' => $date,
				'id' => (string) get_post_meta( $post->ID, self::META_ID, true ),
				'revision' => (int) get_post_meta( $post->ID, self::META_REVISION, true ),
			);
		}
		return $result;
	}

	/** @return int|WP_Error */
	public static function insert( array $definition ) {
		$date = $definition['releaseDate'];
		$post_id = wp_insert_post(
			array(
				'post_type' => self::POST_TYPE,
				'post_status' => 'private',
				'post_name' => $date,
				'post_title' => $definition['title'] ?? $date,
				'post_content' => wp_slash( wp_json_encode( $definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ),
			),
			true
		);
		if ( is_wp_error( $post_id ) ) return $post_id;
		if ( ! self::write_meta( $post_id, $definition ) ) {
			wp_delete_post( $post_id, true );
			return new WP_Error( 'nexo_meta_write_failed', 'Puzzle metadata could not be stored.' );
		}
		return $post_id;
	}

	/** @return int|WP_Error */
	public static function update( WP_Post $post, array $definition ) {
		$result = wp_update_post(
			array(
				'ID' => $post->ID,
				'post_title' => $definition['title'] ?? $definition['releaseDate'],
				'post_content' => wp_slash( wp_json_encode( $definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ),
			),
			true
		);
		if ( is_wp_error( $result ) ) return $result;
		if ( ! self::write_meta( $post->ID, $definition ) ) return new WP_Error( 'nexo_meta_write_failed', 'Puzzle metadata could not be stored.' );
		return $result;
	}

	/** Move a puzzle out of the public and administrative catalogs without erasing it. */
	public static function trash( WP_Post $post ) {
		$result = wp_trash_post( $post->ID );
		if ( false === $result ) {
			return new WP_Error( 'nexo_trash_failed', 'Puzzle could not be moved to Trash.' );
		}
		return $result;
	}

	/** Restore a puzzle that was moved to WordPress Trash. */
	public static function restore( WP_Post $post ) {
		$result = wp_untrash_post( $post->ID );
		if ( false === $result ) {
			return new WP_Error( 'nexo_restore_failed', 'Puzzle could not be restored from Trash.' );
		}
		return wp_update_post( array( 'ID' => $post->ID, 'post_status' => 'private' ), true );
	}

	private static function write_meta( int $post_id, array $definition ): bool {
		$values = array(
			self::META_DATE => $definition['releaseDate'],
			self::META_ID => $definition['id'],
			self::META_SCHEMA => $definition['schemaVersion'],
			self::META_REVISION => $definition['revision'] ?? 1,
		);
		foreach ( $values as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
			if ( (string) get_post_meta( $post_id, $key, true ) !== (string) $value ) return false;
		}
		return true;
	}

	/** Insert valid bundled seeds atomically, without replacing existing dates. */
	public static function import_seeds() {
		$inserted = array();
		if ( array() !== Nexo_Validator::runtime_errors() ) return new WP_Error( 'nexo_server_requirements', 'PHP intl and mbstring are required to import seed puzzles.' );
		foreach ( glob( NEXO_DIR . 'seed/*.json' ) ?: array() as $file ) {
			$raw = file_get_contents( $file );
			$definition = false === $raw ? null : json_decode( $raw, true );
			$validation = is_array( $definition ) ? Nexo_Validator::validate( $definition ) : array( 'valid' => false, 'errors' => array() );
			if ( ! $validation['valid'] ) {
				self::rollback( $inserted );
				return new WP_Error( 'nexo_invalid_seed', 'Invalid seed puzzle: ' . basename( $file ), array( 'errors' => $validation['errors'] ?? array() ) );
			}
			$date = $definition['releaseDate'] ?? '';
			if ( ! Nexo_Validator::is_date( $date ) ) {
				self::rollback( $inserted );
				return new WP_Error( 'nexo_invalid_seed_date', 'Seed releaseDate is missing or invalid: ' . basename( $file ) );
			}
			if ( null !== self::find( $date ) || null !== self::find_trashed( $date ) ) continue;
			$post_id = self::insert( $definition );
			if ( is_wp_error( $post_id ) ) {
				self::rollback( $inserted );
				return $post_id;
			}
			$inserted[] = $post_id;
		}
		return true;
	}

	private static function rollback( array $post_ids ): void {
		foreach ( array_reverse( $post_ids ) as $post_id ) wp_delete_post( $post_id, true );
	}
}
