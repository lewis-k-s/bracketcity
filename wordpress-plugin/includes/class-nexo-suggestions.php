<?php
/** Private suggestion-link access and pending puzzle persistence. */

if ( ! defined( 'ABSPATH' ) ) exit;

final class Nexo_Suggestions {
	private const OPTION_KEY = 'nexo_suggestion_key';

	/** Create the shared-link key once and return it. */
	public static function ensure_key(): string {
		$key = (string) get_option( self::OPTION_KEY, '' );
		if ( '' !== $key ) return $key;
		$key = bin2hex( random_bytes( 24 ) );
		add_option( self::OPTION_KEY, $key, '', false );
		return (string) get_option( self::OPTION_KEY, $key );
	}

	public static function valid_key( string $candidate ): bool {
		$key = (string) get_option( self::OPTION_KEY, '' );
		return '' !== $key && '' !== $candidate && hash_equals( $key, $candidate );
	}

	public static function share_url( string $page_url ): string {
		return add_query_arg(
			array( 'mode' => 'suggest', 'suggestion_key' => self::ensure_key() ),
			$page_url
		);
	}

	/** @return int|WP_Error */
	public static function insert( array $definition ) {
		$capacity = Nexo_Puzzles::ensure_capacity();
		if ( is_wp_error( $capacity ) ) return $capacity;
		$definition['revision'] = 1;
		$post_id = wp_insert_post(
			array(
				'post_type' => Nexo_Puzzles::POST_TYPE,
				'post_status' => 'pending',
				'post_title' => $definition['title'] ?? $definition['id'],
				'post_content' => wp_slash( wp_json_encode( $definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ),
			),
			true
		);
		if ( is_wp_error( $post_id ) ) return $post_id;
		if ( ! self::write_meta( $post_id, $definition ) ) {
			wp_delete_post( $post_id, true );
			return new WP_Error( 'nexo_meta_write_failed', 'Suggestion metadata could not be stored.' );
		}
		return $post_id;
	}

	public static function find( int $suggestion_id ): ?WP_Post {
		$post = get_post( $suggestion_id );
		return $post instanceof WP_Post &&
			Nexo_Puzzles::POST_TYPE === $post->post_type &&
			'pending' === $post->post_status ? $post : null;
	}

	public static function definition( WP_Post $post ): ?array {
		$value = json_decode( $post->post_content, true );
		return is_array( $value ) && ! array_is_list( $value ) ? $value : null;
	}

	public static function list_metadata(): array {
		$posts = get_posts(
			array(
				'post_type' => Nexo_Puzzles::POST_TYPE,
				'post_status' => 'pending',
				'numberposts' => -1,
				'orderby' => 'date',
				'order' => 'DESC',
				'suppress_filters' => true,
			)
		);
		$result = array();
		foreach ( $posts as $post ) {
			$definition = self::definition( $post );
			if ( ! is_array( $definition ) || ! Nexo_Validator::validate( $definition )['valid'] ) continue;
			$item = array(
				'suggestionId' => $post->ID,
				'id' => $definition['id'],
				'title' => $definition['title'] ?? $definition['id'],
				'submittedAt' => mysql_to_rfc3339( $post->post_date_gmt ),
			);
			if ( isset( $definition['releaseDate'] ) ) $item['requestedDate'] = $definition['releaseDate'];
			$result[] = $item;
		}
		return $result;
	}

	/** Publish a reviewed definition by converting its pending post in place. */
	public static function approve( WP_Post $post, array $definition ) {
		$definition['revision'] = 1;
		$result = wp_update_post(
			array(
				'ID' => $post->ID,
				'post_status' => 'private',
				'post_name' => $definition['releaseDate'],
				'post_title' => $definition['title'] ?? $definition['releaseDate'],
				'post_content' => wp_slash( wp_json_encode( $definition, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ),
			),
			true
		);
		if ( is_wp_error( $result ) ) return $result;
		if ( ! self::write_meta( $post->ID, $definition ) ) return new WP_Error( 'nexo_meta_write_failed', 'Puzzle metadata could not be stored.' );
		return $result;
	}

	public static function reject( WP_Post $post ) {
		$result = wp_trash_post( $post->ID );
		return false === $result ? new WP_Error( 'nexo_reject_failed', 'Suggestion could not be rejected.' ) : $result;
	}

	private static function write_meta( int $post_id, array $definition ): bool {
		$values = array(
			Nexo_Puzzles::META_ID => $definition['id'],
			Nexo_Puzzles::META_SCHEMA => $definition['schemaVersion'],
			Nexo_Puzzles::META_REVISION => $definition['revision'] ?? 1,
		);
		if ( isset( $definition['releaseDate'] ) ) $values[ Nexo_Puzzles::META_DATE ] = $definition['releaseDate'];
		else delete_post_meta( $post_id, Nexo_Puzzles::META_DATE );
		foreach ( $values as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
			if ( (string) get_post_meta( $post_id, $key, true ) !== (string) $value ) return false;
		}
		return true;
	}
}
