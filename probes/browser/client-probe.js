( function attachBlockCatalogueProbe( global ) {
	'use strict';

	function canonicalise( value ) {
		if ( Array.isArray( value ) ) {
			return value.map( canonicalise );
		}
		if ( value && typeof value === 'object' ) {
			return Object.fromEntries(
				Object.entries( value )
					.filter( ( [ , item ] ) =>
						item !== undefined &&
						typeof item !== 'function' &&
						typeof item !== 'symbol'
					)
					.sort( ( [ left ], [ right ] ) => left.localeCompare( right ) )
					.map( ( [ key, item ] ) => [ key, canonicalise( item ) ] )
			);
		}
		if (
			value === null ||
			typeof value === 'string' ||
			typeof value === 'boolean'
		) {
			return value;
		}
		if ( typeof value === 'number' ) {
			return Number.isFinite( value ) ? value : null;
		}
		return null;
	}

	function stableJson( value ) {
		return JSON.stringify( canonicalise( value ) );
	}

	async function sha256( value ) {
		const bytes = new TextEncoder().encode( value );
		const digest = await global.crypto.subtle.digest( 'SHA-256', bytes );
		return Array.from( new Uint8Array( digest ) )
			.map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) )
			.join( '' );
	}

	async function handlerHash( handler ) {
		return typeof handler === 'function'
			? sha256( Function.prototype.toString.call( handler ) )
			: null;
	}

	function requireBlocks() {
		if ( ! global.wp || ! global.wp.blocks ) {
			throw new Error( 'wp.blocks is not available in this page.' );
		}
		return global.wp.blocks;
	}

	function inserterNames() {
		if ( ! global.wp?.data?.select ) {
			return new Set();
		}
		try {
			const selector = global.wp.data.select( 'core/block-editor' );
			const items = selector?.getInserterItems?.() || [];
			return new Set( items.map( ( item ) => item.name ) );
		} catch ( error ) {
			return new Set();
		}
	}

	async function captureType( type, inserter ) {
		const blocks = requireBlocks();
		const normaliseTransform = ( transform ) => ( {
			type: transform.type || 'block',
			blockNames:
				transform.blocks ||
				( transform.blockName ? [ transform.blockName ] : [] ),
			priority:
				typeof transform.priority === 'number'
					? transform.priority
					: null,
			isMultiBlock:
				typeof transform.isMultiBlock === 'boolean'
					? transform.isMultiBlock
					: null,
			callbacks: {
				transform: typeof transform.transform === 'function',
				isMatch: typeof transform.isMatch === 'function',
			},
		} );
		const transforms = {
			from: ( blocks.getBlockTransforms?.( 'from', type.name ) || [] )
				.map( normaliseTransform ),
			to: ( blocks.getBlockTransforms?.( 'to', type.name ) || [] )
				.map( normaliseTransform ),
		};
		const variations =
			blocks.getBlockVariations?.( type.name, undefined ) ||
			type.variations ||
			[];
		const normalisedVariations = variations
			.filter( ( variation ) => typeof variation.name === 'string' )
			.map( ( variation ) => ( {
				name: variation.name,
				title:
					typeof variation.title === 'string'
						? variation.title
						: null,
				scope: Array.isArray( variation.scope ) ? variation.scope : [],
				isDefault: variation.isDefault === true,
				attributes: variation.attributes || {},
				innerBlocks: variation.innerBlocks || [],
			} ) );
		const deprecations = ( type.deprecated || [] ).map(
			( candidate, index ) => ( {
				index,
				attributes: candidate.attributes || {},
				supports: candidate.supports || {},
				callbacks: {
					save: typeof candidate.save === 'function',
					migrate: typeof candidate.migrate === 'function',
					isEligible: typeof candidate.isEligible === 'function',
				},
			} )
		);

		return canonicalise( {
			name: type.name,
			apiVersion: type.apiVersion ?? null,
			title: type.title ?? null,
			description: type.description ?? null,
			category: type.category ?? null,
			parent: type.parent || [],
			ancestor: type.ancestor || [],
			allowedBlocks: type.allowedBlocks || [],
			providesContext: type.providesContext || {},
			usesContext: type.usesContext || [],
			attributes: type.attributes || {},
			supports: type.supports || {},
			styles: type.styles || [],
			variations: normalisedVariations,
			transforms,
			clientRegistered: true,
			inserterVisible: inserter.has( type.name ),
			callbacks: {
				edit: typeof type.edit === 'function',
				save: typeof type.save === 'function',
			},
			saveHandlerHash: await handlerHash( type.save ),
			deprecations,
			deprecatedHandlerHashes: await Promise.all(
				( type.deprecated || [] ).map( async ( candidate ) => ( {
					save: await handlerHash( candidate.save ),
					migrate: await handlerHash( candidate.migrate ),
					isEligible: await handlerHash( candidate.isEligible ),
				} ) )
			),
		} );
	}

	async function capture( options ) {
		const blocks = requireBlocks();
		if ( ! options?.environmentId ) {
			throw new Error( 'environmentId is required.' );
		}
		if ( ! options?.editorSurface ) {
			throw new Error( 'editorSurface is required.' );
		}

		const profile = canonicalise( {
			...( options.profile || {} ),
			environmentId: options.environmentId,
			editorSurface: options.editorSurface,
		} );
		const inserter = inserterNames();
		const types = [ ...blocks.getBlockTypes() ]
			.sort( ( left, right ) => left.name.localeCompare( right.name ) );
		const captured = [];
		for ( const type of types ) {
			captured.push( await captureType( type, inserter ) );
		}

		return canonicalise( {
			schemaVersion: 1,
			kind: 'client',
			environmentId: options.environmentId,
			editorSurface: options.editorSurface,
			profile,
			profileHash: await sha256( stableJson( profile ) ),
			capturedAt: new Date().toISOString(),
			registryHash: await sha256( stableJson( captured ) ),
			blocks: captured,
		} );
	}

	function createBlockTree( input ) {
		const blocks = requireBlocks();
		return blocks.createBlock(
			input.name,
			input.attributes || {},
			( input.innerBlocks || [] ).map( createBlockTree )
		);
	}

	function validationResult( block ) {
		const blocks = requireBlocks();
		const result = blocks.validateBlock( block );
		if ( Array.isArray( result ) ) {
			return {
				valid: Boolean( result[ 0 ] ),
				issues: canonicalise( result[ 1 ] || [] ),
			};
		}
		return { valid: Boolean( result ), issues: [] };
	}

	async function verifyStatic( input ) {
		const blocks = requireBlocks();
		const block = createBlockTree( input );
		const markup = blocks.serialize( block );
		const parsed = blocks.parse( markup );
		const validation = parsed.length === 1
			? validationResult( parsed[ 0 ] )
			: { valid: false, issues: [ 'Expected exactly one parsed block.' ] };

		return canonicalise( {
			kind: 'static-save',
			name: input.name,
			attributes: input.attributes || {},
			markup,
			markupHash: await sha256( markup ),
			parsedBlockCount: parsed.length,
			...validation,
		} );
	}

	async function verifyMarkup( input ) {
		const blocks = requireBlocks();
		const parsed = blocks.parse( input.markup );
		const validations = parsed.map( ( block ) => ( {
			name: block.name,
			...validationResult( block ),
		} ) );

		return canonicalise( {
			kind: 'markup-validation',
			markupHash: await sha256( input.markup ),
			parsedBlockCount: parsed.length,
			valid: parsed.length > 0 && validations.every( ( item ) => item.valid ),
			blocks: validations,
		} );
	}

	async function verifyDeprecatedFixture( input ) {
		const blocks = requireBlocks();
		const parsed = blocks.parse( input.markup );
		if ( parsed.length !== 1 || parsed[ 0 ].name !== input.name ) {
			return canonicalise( {
				kind: 'deprecated-fixture',
				name: input.name,
				valid: false,
				migrated: false,
				issues: [ 'Fixture did not parse to the expected block.' ],
			} );
		}

		const deprecatedValid = parsed[ 0 ].isValid === true;
		const currentMarkup = blocks.serialize( parsed[ 0 ] );
		const currentParsed = blocks.parse( currentMarkup );
		const validation = currentParsed.length === 1
			? validationResult( currentParsed[ 0 ] )
			: {
				valid: false,
				issues: [ 'Current serialization did not parse to one block.' ],
			};
		return canonicalise( {
			kind: 'deprecated-fixture',
			name: input.name,
			inputMarkupHash: await sha256( input.markup ),
			fixtureMarkup: input.markup,
			currentMarkup,
			currentMarkupHash: await sha256( currentMarkup ),
			attributes: parsed[ 0 ].attributes || {},
			innerBlocks: parsed[ 0 ].innerBlocks || [],
			valid: deprecatedValid && validation.valid,
			issues: deprecatedValid
				? validation.issues
				: parsed[ 0 ].validationIssues || [],
			migrated: currentMarkup !== input.markup,
		} );
	}

	global.wpBlockCatalogProbe = Object.freeze( {
		capture,
		verifyStatic,
		verifyMarkup,
		verifyDeprecatedFixture,
	} );
}( window ) );
