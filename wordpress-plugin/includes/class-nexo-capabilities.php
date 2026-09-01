<?php
/** WordPress capabilities for puzzle administration. */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Nexo_Capabilities {
	public const MANAGE_PUZZLES = 'manage_nexo_puzzles';
	public const MANAGER_ROLE = 'nexo_puzzle_manager';

	public static function register(): void {
		$manager = get_role( self::MANAGER_ROLE );
		if ( null === $manager ) {
			$manager = add_role(
				self::MANAGER_ROLE,
				'Nexo Puzzle Manager',
				array(
					'read' => true,
					self::MANAGE_PUZZLES => true,
				)
			);
		}

		if ( $manager instanceof WP_Role && ! $manager->has_cap( self::MANAGE_PUZZLES ) ) {
			$manager->add_cap( self::MANAGE_PUZZLES );
		}

		$administrator = get_role( 'administrator' );
		if ( $administrator instanceof WP_Role && ! $administrator->has_cap( self::MANAGE_PUZZLES ) ) {
			$administrator->add_cap( self::MANAGE_PUZZLES );
		}
	}
}
