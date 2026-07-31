<?php
/**
 * Read-only WP-CLI runtime probe for the WordPress block catalogue.
 *
 * Load with:
 * wp --require=probes/php/wp-block-catalog-probe.php block-catalog snapshot ...
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

/**
 * Captures block registry and render evidence without exposing callbacks.
 */
final class WP_Block_Catalog_Probe_Command {
	/**
	 * Capture the final server block registry.
	 *
	 * ## OPTIONS
	 *
	 * --environment=<id>
	 * : Exact catalogue environment identifier.
	 *
	 * [--profile=<path>]
	 * : JSON profile file.
	 *
	 * [--editor-context=<name>]
	 * : Block editor context name. Defaults to core/edit-post.
	 *
	 * [--post-id=<id>]
	 * : Existing post used only to construct editor context.
	 *
	 * [--output=<path>]
	 * : Write JSON to this path instead of stdout.
	 *
	 * @param array<int, string>   $args Positional arguments.
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	public function snapshot( $args, $assoc_args ) {
		unset( $args );

		$environment_id = isset( $assoc_args['environment'] )
			? (string) $assoc_args['environment']
			: '';
		if ( '' === $environment_id ) {
			WP_CLI::error( '--environment is required.' );
		}

		$profile = $this->read_profile(
			isset( $assoc_args['profile'] ) ? (string) $assoc_args['profile'] : ''
		);
		$editor_context = isset( $assoc_args['editor-context'] )
			? (string) $assoc_args['editor-context']
			: 'core/edit-post';
		$theme = wp_get_theme();
		$profile = array(
			'environmentId'  => $environment_id,
			'productVersions' => isset( $profile['productVersions'] )
				? $profile['productVersions']
				: array( 'wordpress' => get_bloginfo( 'version' ) ),
			'editorSurface'  => $editor_context,
			'locale'         => isset( $profile['locale'] )
				? (string) $profile['locale']
				: get_locale(),
			'theme'          => isset( $profile['theme'] )
				? $profile['theme']
				: array(
					'kind' => wp_is_block_theme() ? 'block' : 'classic',
					'slug' => $theme->get_stylesheet(),
				),
			'featureFlags'   => isset( $profile['featureFlags'] )
				? $this->object_map( $profile['featureFlags'] )
				: new stdClass(),
		);

		$allowed = $this->capture_allowed_block_types(
			$editor_context,
			isset( $assoc_args['post-id'] ) ? (int) $assoc_args['post-id'] : 0
		);
		$registered = WP_Block_Type_Registry::get_instance()->get_all_registered();
		ksort( $registered );

		$blocks = array();
		foreach ( $registered as $name => $type ) {
			$blocks[] = $this->capture_block( (string) $name, $type, $allowed );
		}

		$payload = array(
			'schemaVersion'    => 1,
			'kind'             => 'server',
			'environmentId'    => $environment_id,
			'profile'          => $profile,
			'profileHash'      => $this->hash_value( $profile ),
			'capturedAt'       => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'wordpressVersion' => get_bloginfo( 'version' ),
			'phpVersion'       => PHP_VERSION,
			'timezone'         => wp_timezone_string(),
			'registryHash'     => $this->hash_value( $blocks ),
			'blocks'           => $blocks,
		);

		$this->emit(
			$payload,
			isset( $assoc_args['output'] ) ? (string) $assoc_args['output'] : ''
		);
	}

	/**
	 * Render one registered block in the active PHP runtime.
	 *
	 * ## OPTIONS
	 *
	 * <name>
	 * : Registered block name.
	 *
	 * [--attributes=<json>]
	 * : Block attributes JSON object.
	 *
	 * [--inner-html=<html>]
	 * : Inner HTML for dynamic blocks that consume it.
	 *
	 * [--post-id=<id>]
	 * : Existing post context.
	 *
	 * [--output=<path>]
	 * : Write JSON to this path instead of stdout.
	 *
	 * @param array<int, string>   $args Positional arguments.
	 * @param array<string, mixed> $assoc_args Named arguments.
	 */
	public function render( $args, $assoc_args ) {
		$name = isset( $args[0] ) ? (string) $args[0] : '';
		if ( '' === $name ) {
			WP_CLI::error( 'A block name is required.' );
		}

		$type = WP_Block_Type_Registry::get_instance()->get_registered( $name );
		if ( ! $type ) {
			WP_CLI::error( sprintf( 'Block %s is not registered.', $name ) );
		}

		$attributes = array();
		if ( isset( $assoc_args['attributes'] ) ) {
			$attributes = json_decode(
				(string) $assoc_args['attributes'],
				true,
				512,
				JSON_THROW_ON_ERROR
			);
			if ( ! is_array( $attributes ) || array_is_list( $attributes ) ) {
				WP_CLI::error( '--attributes must decode to a JSON object.' );
			}
		}

		$inner_html = isset( $assoc_args['inner-html'] )
			? (string) $assoc_args['inner-html']
			: '';
		$post_id = isset( $assoc_args['post-id'] )
			? (int) $assoc_args['post-id']
			: 0;

		$previous_post = isset( $GLOBALS['post'] ) ? $GLOBALS['post'] : null;
		if ( $post_id > 0 ) {
			$post = get_post( $post_id );
			if ( ! $post ) {
				WP_CLI::error( sprintf( 'Post %d was not found.', $post_id ) );
			}
			$GLOBALS['post'] = $post;
		}

		try {
			$markup = render_block(
				array(
					'blockName'    => $name,
					'attrs'        => $attributes,
					'innerBlocks'  => array(),
					'innerHTML'    => $inner_html,
					'innerContent' => array( $inner_html ),
				)
			);
		} finally {
			if ( null === $previous_post ) {
				unset( $GLOBALS['post'] );
			} else {
				$GLOBALS['post'] = $previous_post;
			}
		}

		$this->emit(
			array(
				'schemaVersion'         => 1,
				'kind'                  => 'server-render',
				'name'                  => $name,
				'attributes'            => $attributes,
				'postId'                => $post_id > 0 ? $post_id : null,
				'isDynamic'             => $type->is_dynamic(),
				'callbacks'             => array(
					'render' => is_callable( $type->render_callback ),
				),
				'markup'                => $markup,
				'markupHash'            => hash( 'sha256', $markup ),
			),
			isset( $assoc_args['output'] ) ? (string) $assoc_args['output'] : ''
		);
	}

	/**
	 * @param string               $name Block name.
	 * @param WP_Block_Type        $type Registered block type.
	 * @param true|false|string[]  $allowed Allowed block types.
	 * @return array<string, mixed>
	 */
	private function capture_block( $name, $type, $allowed ) {
		$allowed_for_context = null;
		if ( true === $allowed ) {
			$allowed_for_context = true;
		} elseif ( false === $allowed ) {
			$allowed_for_context = false;
		} elseif ( is_array( $allowed ) ) {
			$allowed_for_context = in_array( $name, $allowed, true );
		}

		return $this->canonicalise(
			array(
				'name'                  => $name,
				'apiVersion'            => $type->api_version,
				'title'                 => $type->title,
				'description'           => $type->description,
				'category'              => $type->category,
				'parent'                => $type->parent,
				'ancestor'              => $type->ancestor,
				'allowedBlocks'         => $type->allowed_blocks,
				'providesContext'       => $this->object_map( $type->provides_context ),
				'usesContext'           => $type->uses_context,
				'attributes'            => $this->object_map( $type->attributes ),
				'supports'              => $this->object_map( $type->supports ),
				'styles'                => $type->styles,
				'variations'            => $type->variations,
				'blockHooks'            => $this->object_map( $type->block_hooks ),
				'dynamic'               => $type->is_dynamic(),
				'renderCallbackPresent' => is_callable( $type->render_callback ),
				'editorScriptHandles'   => $type->editor_script_handles,
				'scriptHandles'         => $type->script_handles,
				'viewScriptHandles'     => $type->view_script_handles,
				'editorStyleHandles'    => $type->editor_style_handles,
				'styleHandles'          => $type->style_handles,
				'viewStyleHandles'      => $type->view_style_handles,
				'allowedForContext'     => $allowed_for_context,
			)
		);
	}

	/**
	 * @param string $editor_context Editor context name.
	 * @param int    $post_id Existing post ID.
	 * @return true|false|string[]
	 */
	private function capture_allowed_block_types( $editor_context, $post_id ) {
		if ( ! class_exists( 'WP_Block_Editor_Context' ) ) {
			return true;
		}

		$settings = array( 'name' => $editor_context );
		if ( $post_id > 0 ) {
			$post = get_post( $post_id );
			if ( $post ) {
				$settings['post'] = $post;
			}
		}
		$context = new WP_Block_Editor_Context( $settings );

		if ( function_exists( 'get_allowed_block_types' ) ) {
			return get_allowed_block_types( $context );
		}

		return apply_filters( 'allowed_block_types_all', true, $context );
	}

	/**
	 * @param string $path Profile JSON path.
	 * @return array<string, mixed>
	 */
	private function read_profile( $path ) {
		if ( '' === $path ) {
			return array();
		}
		if ( ! is_readable( $path ) ) {
			WP_CLI::error( sprintf( 'Profile is not readable: %s', $path ) );
		}

		$profile = json_decode(
			(string) file_get_contents( $path ),
			true,
			512,
			JSON_THROW_ON_ERROR
		);
		if ( ! is_array( $profile ) || array_is_list( $profile ) ) {
			WP_CLI::error( 'Profile JSON must be an object.' );
		}
		return $profile;
	}

	/**
	 * @param mixed $value Value to normalise.
	 * @return mixed
	 */
	private function canonicalise( $value ) {
		if ( is_array( $value ) ) {
			if ( array_is_list( $value ) ) {
				return array_map( array( $this, 'canonicalise' ), $value );
			}
			ksort( $value );
			foreach ( $value as $key => $item ) {
				$value[ $key ] = $this->canonicalise( $item );
			}
			return $value;
		}
		if ( $value instanceof stdClass ) {
			$properties = get_object_vars( $value );
			ksort( $properties );
			$result = new stdClass();
			foreach ( $properties as $key => $item ) {
				$result->{$key} = $this->canonicalise( $item );
			}
			return $result;
		}
		if ( is_object( $value ) ) {
			return null;
		}
		if ( is_resource( $value ) ) {
			return null;
		}
		return $value;
	}

	/**
	 * Preserve associative map semantics when PHP receives an empty array.
	 *
	 * @param mixed $value Candidate map.
	 * @return mixed
	 */
	private function object_map( $value ) {
		if ( is_array( $value ) && array() === $value ) {
			return new stdClass();
		}
		return $value;
	}

	/**
	 * @param mixed $value Value to hash.
	 * @return string
	 */
	private function hash_value( $value ) {
		return hash(
			'sha256',
			wp_json_encode(
				$this->canonicalise( $value ),
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
			)
		);
	}

	/**
	 * @param array<string, mixed> $payload Output payload.
	 * @param string               $path Optional path.
	 */
	private function emit( $payload, $path ) {
		$json = wp_json_encode(
			$this->canonicalise( $payload ),
			JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
		);
		if ( false === $json ) {
			WP_CLI::error( 'Could not encode probe output.' );
		}

		if ( '' !== $path ) {
			$written = file_put_contents( $path, $json . PHP_EOL );
			if ( false === $written ) {
				WP_CLI::error( sprintf( 'Could not write probe output: %s', $path ) );
			}
			WP_CLI::success( sprintf( 'Wrote block catalogue probe to %s.', $path ) );
			return;
		}

		WP_CLI::line( $json );
	}
}

WP_CLI::add_command( 'block-catalog', 'WP_Block_Catalog_Probe_Command' );
