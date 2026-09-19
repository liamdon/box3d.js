// Smoke test: base API + a real "falling box" simulation, run against both
// build variants (separate-wasm and inlined single-file).

import assert from 'node:assert/strict';

function fallingBox( b3 )
{
	// world with downward gravity
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );
	assert.ok( b3.b3World_IsValid( world ), 'world is valid' );

	// static ground: a wide, thin box centered at the origin
	const groundBodyDef = b3.b3DefaultBodyDef();
	groundBodyDef.type = b3.b3BodyType.b3_staticBody;
	groundBodyDef.position = [ 0, 0, 0 ];
	const ground = b3.b3CreateBody( world, groundBodyDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	// dynamic body: a sphere dropped from y = 10
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.type = b3.b3BodyType.b3_dynamicBody;
	bodyDef.position = [ 0, 10, 0 ];
	const body = b3.b3CreateBody( world, bodyDef );
	const shapeDef = b3.b3DefaultShapeDef();
	b3.b3CreateSphereShape( body, shapeDef, { center: [ 0, 0, 0 ], radius: 0.5 } );

	// out-param reader: fill a caller-owned [x,y,z], read component 1 (y)
	const pos = [ 0, 0, 0 ];
	const startY = b3.b3Body_GetPosition( pos, body )[ 1 ];

	// simulate ~2.5 s at 60 Hz
	for ( let i = 0; i < 150; i++ )
	{
		b3.b3World_Step( world, 1 / 60, 4 );
	}

	const endY = b3.b3Body_GetPosition( pos, body )[ 1 ];

	// multi-out reader: a transform reads as two out params (position + rotation),
	// and returns them as a [position, rotation] tuple.
	const tp = [ 0, 0, 0 ], tq = [ 0, 0, 0, 1 ];
	const [ tPos, tRot ] = b3.b3Body_GetTransform( tp, tq, body );
	assert.ok( tPos === tp && tRot === tq, 'GetTransform fills the caller arrays and returns them' );
	assert.ok( Math.abs( tPos[ 1 ] - endY ) < 1e-6, 'transform position matches GetPosition' );
	assert.ok( Math.abs( Math.hypot( tRot[ 0 ], tRot[ 1 ], tRot[ 2 ], tRot[ 3 ] ) - 1 ) < 1e-3, 'transform rotation is a unit quaternion' );

	b3.b3DestroyWorld( world );
	return { startY, endY };
}

// Drop a box onto the ground, let it settle, then read the resulting contact via
// the packed buffer + facade readers (createContact/getContactAt/getManifoldAt).
function contactRead( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );

	const groundDef = b3.b3DefaultBodyDef();
	groundDef.type = b3.b3BodyType.b3_staticBody;
	const ground = b3.b3CreateBody( world, groundDef );
	b3.b3CreateBoxShape( ground, b3.b3DefaultShapeDef(), 25, 0.5, 25 );

	const boxDef = b3.b3DefaultBodyDef();
	boxDef.type = b3.b3BodyType.b3_dynamicBody;
	boxDef.position = [ 0, 5, 0 ];
	const box = b3.b3CreateBody( world, boxDef );
	const boxShape = b3.b3CreateBoxShape( box, b3.b3DefaultShapeDef(), 0.5, 0.5, 0.5 );

	// events buffer: one step while the box is falling reliably produces a body
	// move event — read it back through the reusable, wasm-backed events buffer.
	const eb = b3.createEventsBuffer();
	const move = b3.createBodyMoveEvent();
	b3.b3World_Step( world, 1 / 60, 4 );
	b3.getEvents( eb, world );
	const moveCount = b3.getNumBodyMoveEvents( eb );
	assert.ok( moveCount >= 1, `body move events reported while falling (got ${moveCount})` );
	b3.getBodyMoveEventAt( move, eb, 0 );
	assert.ok( Number.isFinite( move.position[ 1 ] ), 'body move event decodes a finite position' );
	const q = move.rotation;
	assert.ok( Math.abs( Math.hypot( q[ 0 ], q[ 1 ], q[ 2 ], q[ 3 ] ) - 1 ) < 1e-3, 'move event rotation is a unit quaternion' );

	for ( let i = 0; i < 150; i++ ) b3.b3World_Step( world, 1 / 60, 4 );

	// reusable contacts buffer: fill it, read it, then refill after another step to
	// exercise reuse + the growth-safe view refresh.
	const cb = b3.createContactsBuffer();
	const contact = b3.createContact();
	const manifold = b3.createManifold();

	function summarize()
	{
		b3.getShapeContactData( cb, boxShape );
		const n = b3.getNumContacts( cb );
		let totalPoints = 0;
		let worstNormalErr = 0;
		for ( let i = 0; i < n; i++ )
		{
			b3.getContactAt( contact, cb, i );
			// the queried shape is one side of the contact (box3d picks the A/B order)
			assert.ok(
				contact.shapeIdA.index1 === boxShape.index1 || contact.shapeIdB.index1 === boxShape.index1,
				'queried shape id round-trips as one side of the contact',
			);
			for ( let m = 0; m < contact.manifoldCount; m++ )
			{
				b3.getManifoldAt( manifold, contact, m );
				const nrm = manifold.normal;
				worstNormalErr = Math.max( worstNormalErr, Math.abs( Math.hypot( nrm[ 0 ], nrm[ 1 ], nrm[ 2 ] ) - 1 ) );
				totalPoints += manifold.pointCount;
			}
		}
		return { n, totalPoints, worstNormalErr };
	}

	const first = summarize();
	b3.b3World_Step( world, 1 / 60, 4 );
	const second = summarize(); // still valid after a refill following a step

	assert.ok( first.n >= 1, `resting box reports a contact (got ${first.n})` );
	assert.ok( first.totalPoints >= 1, `contact has at least one manifold point (got ${first.totalPoints})` );
	assert.ok( first.worstNormalErr < 1e-3, `manifold normal is unit-length (err ${first.worstNormalErr.toExponential( 1 )})` );
	assert.ok( second.n >= 1, 'reusable buffer still valid after a refill following a step' );

	b3.destroyContactsBuffer( cb );
	b3.destroyEventsBuffer( eb );
	b3.b3DestroyWorld( world );
	return { n: first.n, totalPoints: first.totalPoints, worstNormalErr: first.worstNormalErr };
}

// Exercise the sensor-touch, and CollideMover plane-result readers — the
// browser-facing buffer paths the examples use but the contact scene doesn't hit.
function eventsAndPlanes( b3 )
{
	const world = b3.b3CreateWorld( b3.b3DefaultWorldDef() );

	// sensor box at the origin with a dynamic visitor overlapping it
	const sensorBody = b3.b3CreateBody( world, b3.b3DefaultBodyDef() );
	const sensorShapeDef = b3.b3DefaultShapeDef();
	sensorShapeDef.isSensor = true;
	sensorShapeDef.enableSensorEvents = true;
	b3.b3CreateBoxShape( sensorBody, sensorShapeDef, 2, 2, 2 );

	const visitorDef = b3.b3DefaultBodyDef();
	visitorDef.type = b3.b3BodyType.b3_dynamicBody;
	visitorDef.position = [ 0, 0, 0 ];
	const visitorBody = b3.b3CreateBody( world, visitorDef );
	const visitorShapeDef = b3.b3DefaultShapeDef();
	visitorShapeDef.enableSensorEvents = true;
	const visitorShape = b3.b3CreateBoxShape( visitorBody, visitorShapeDef, 0.5, 0.5, 0.5 );

	const eb = b3.createEventsBuffer();
	const touch = b3.createSensorTouchEvent();
	let sawSensor = false;
	for ( let i = 0; i < 10 && !sawSensor; i++ )
	{
		b3.b3World_Step( world, 1 / 60, 4 );
		b3.getEvents( eb, world );
		for ( let k = 0, n = b3.getNumSensorBeginEvents( eb ); k < n; k++ )
		{
			b3.getSensorBeginEventAt( touch, eb, k );
			if ( touch.visitorShapeId.index1 === visitorShape.index1 ) sawSensor = true;
		}
	}
	b3.destroyEventsBuffer( eb );
	assert.ok( sawSensor, 'sensor begin-touch event decoded via the events buffer' );

	// CollideMover: a mover capsule overlapping a static sphere yields collision
	// planes (placed clear of the sensor bodies above).
	const obstacleDef = b3.b3DefaultBodyDef();
	obstacleDef.position = [ 10, 1, 0 ];
	const obstacle = b3.b3CreateBody( world, obstacleDef );
	b3.b3CreateSphereShape( obstacle, b3.b3DefaultShapeDef(), { center: [ 0, 0, 0 ], radius: 0.6 } );
	b3.b3World_Step( world, 1 / 60, 4 ); // put the new shape into the broadphase
	const capsule = { center1: [ 0, -0.5, 0 ], center2: [ 0, 0.5, 0 ], radius: 0.35 };
	const planeResult = b3.createPlaneResult();
	let planeCount = 0;
	let worstNormalErr = 0;
	b3.b3World_CollideMover( world, [ 10, 1, 0 ], capsule, b3.b3DefaultQueryFilter(), ( _s, buf ) =>
	{
		for ( let i = 0, n = b3.getNumPlaneResults( buf ); i < n; i++ )
		{
			b3.getPlaneResultAt( planeResult, buf, i );
			const nrm = planeResult.plane.normal;
			worstNormalErr = Math.max( worstNormalErr, Math.abs( Math.hypot( nrm[ 0 ], nrm[ 1 ], nrm[ 2 ] ) - 1 ) );
			planeCount++;
		}
		return true;
	} );
	assert.ok( planeCount >= 1, `CollideMover reported plane results via the buffer (got ${planeCount})` );
	assert.ok( worstNormalErr < 1e-3, 'plane-result normal is unit-length' );

	b3.b3DestroyWorld( world );
	return { sawSensor, planeCount };
}

// Voxel field data: create from a Uint8Array, read it back, validate inputs.
function voxelFieldData( b3 )
{
	// 4x3x4, no border: a one-voxel-thick floor with the (2, 0, 2) voxel removed.
	const countX = 4, countY = 3, countZ = 4;
	const voxels = new Uint8Array( countX * countY * countZ );
	const idx = ( x, y, z ) => x + countX * ( y + countY * z );
	for ( let z = 0; z < countZ; z++ ) for ( let x = 0; x < countX; x++ ) voxels[ idx( x, 0, z ) ] = 1;
	voxels[ idx( 2, 0, 2 ) ] = 0;
	const materialIndices = new Uint8Array( countX * countY * countZ );
	materialIndices[ idx( 1, 0, 1 ) ] = 1;

	const field = b3.b3CreateVoxelField( voxels, materialIndices, [ 1, 1, 1 ], countX, countY, countZ, false );
	assert.ok( field, 'voxel field created' );

	const info = b3.b3GetVoxelFieldInfo( field );
	assert.deepEqual( [ info.countX, info.countY, info.countZ ], [ 4, 3, 4 ], 'info counts' );
	assert.equal( info.solidCount, 15, 'info solidCount (16 floor voxels minus the hole)' );
	assert.equal( info.hasBorder, false, 'info hasBorder' );
	assert.deepEqual( info.scale, [ 1, 1, 1 ], 'info scale' );
	assert.deepEqual( info.aabb, [ 0, 0, 0, 4, 3, 4 ], 'info aabb covers the whole field' );

	assert.equal( b3.b3IsVoxelSolid( field, 1, 0, 1 ), true, 'floor voxel solid' );
	assert.equal( b3.b3IsVoxelSolid( field, 2, 0, 2 ), false, 'hole voxel empty' );
	assert.equal( b3.b3IsVoxelSolid( field, 1, 1, 1 ), false, 'air above floor empty' );
	assert.equal( b3.b3IsVoxelSolid( field, -1, 0, 0 ), false, 'out of range is empty' );

	const bits = b3.b3GetVoxelFieldBits( field );
	assert.ok( bits instanceof Uint8Array, 'bits is a Uint8Array' );
	assert.equal( bits.length, Math.ceil( countX * countY * countZ / 8 ), 'bits length' );
	const bit = ( i ) => ( bits[ i >> 3 ] >> ( i & 7 ) ) & 1;
	assert.equal( bit( idx( 1, 0, 1 ) ), 1, 'bit set for solid voxel' );
	assert.equal( bit( idx( 2, 0, 2 ) ), 0, 'bit clear for hole' );

	const mi = b3.b3GetVoxelFieldMaterialIndices( field );
	assert.ok( mi instanceof Uint8Array && mi.length === voxels.length, 'material indices round-trip length' );
	assert.equal( mi[ idx( 1, 0, 1 ) ], 1, 'material index round-trips' );

	const aabb = b3.b3ComputeVoxelFieldAABB( field, { position: [ 10, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] } );
	assert.deepEqual( aabb, [ 10, 0, 0, 14, 3, 4 ], 'transformed aabb' );

	b3.b3DestroyVoxelField( field );
	field.delete();

	// no materials -> empty array
	const plain = b3.b3CreateVoxelField( voxels, null, [ 1, 1, 1 ], countX, countY, countZ, false );
	assert.equal( b3.b3GetVoxelFieldMaterialIndices( plain ).length, 0, 'no materials -> empty Uint8Array' );
	b3.b3DestroyVoxelField( plain );
	plain.delete();

	// wave generator
	const wave = b3.b3CreateVoxelWave( 8, 6, 8, 0, 0, [ 1, 1, 1 ], 0.25, 0.4, true );
	const waveInfo = b3.b3GetVoxelFieldInfo( wave );
	assert.ok( waveInfo.solidCount > 0 && waveInfo.hasBorder === true, 'wave field has solid voxels and a border' );
	b3.b3DestroyVoxelField( wave );
	wave.delete();

	// validation
	assert.throws( () => b3.b3CreateVoxelField( new Uint8Array( 7 ), null, [ 1, 1, 1 ], 2, 2, 2, false ), /voxels\.length/, 'wrong voxel length throws' );
	assert.throws( () => b3.b3CreateVoxelField( new Uint8Array( 8 ), new Uint8Array( 3 ), [ 1, 1, 1 ], 2, 2, 2, false ), /materialIndices\.length/, 'wrong material length throws' );
	assert.throws( () => b3.b3CreateVoxelField( new Uint8Array( 8 ), null, [ 1, 0, 1 ], 2, 2, 2, false ), /scale/, 'zero scale throws' );
	assert.throws( () => b3.b3CreateVoxelField( new Uint8Array( 0 ), null, [ 1, 1, 1 ], 0, 2, 2, false ), /count/, 'zero count throws' );

	return { solidCount: info.solidCount };
}

// Voxel shape: a sphere rests on a voxel floor, another falls through a hole,
// per-voxel materials attach through the optional materials array.
function voxelShape( b3 )
{
	const worldDef = b3.b3DefaultWorldDef();
	worldDef.gravity = [ 0, -10, 0 ];
	const world = b3.b3CreateWorld( worldDef );

	// 6x3x6 floor, one voxel thick, with (3, 0, 3) removed. Top of the floor is y = 1.
	const countX = 6, countY = 3, countZ = 6;
	const idx = ( x, y, z ) => x + countX * ( y + countY * z );
	const voxels = new Uint8Array( countX * countY * countZ );
	const materialIndices = new Uint8Array( countX * countY * countZ );
	for ( let z = 0; z < countZ; z++ ) for ( let x = 0; x < countX; x++ )
	{
		voxels[ idx( x, 0, z ) ] = 1;
		materialIndices[ idx( x, 0, z ) ] = 1; // every floor voxel uses material 1
	}
	voxels[ idx( 3, 0, 3 ) ] = 0;
	const field = b3.b3CreateVoxelField( voxels, materialIndices, [ 1, 1, 1 ], countX, countY, countZ, false );

	const ground = b3.b3CreateBody( world, b3.b3DefaultBodyDef() ); // static
	const rough = b3.b3DefaultSurfaceMaterial();
	const slick = b3.b3DefaultSurfaceMaterial();
	slick.friction = 0.05;
	slick.userMaterialId = 42n;
	const shapeId = b3.b3CreateVoxelFieldShape( ground, b3.b3DefaultShapeDef(), field, [ rough, slick ] );
	assert.ok( b3.b3Shape_IsValid( shapeId ), 'voxel shape created' );
	assert.equal( b3.b3Shape_GetType( shapeId ).value, b3.b3ShapeType.b3_voxelShape.value, 'shape type is voxel' );
	assert.equal( b3.b3GetVoxelFieldMaterialIndices( b3.b3Shape_GetVoxelField( shapeId ) )[ idx( 1, 0, 1 ) ], 1, 'field read back from the shape' );

	// the optional materials argument may be omitted
	const plainShape = b3.b3CreateVoxelFieldShape( ground, b3.b3DefaultShapeDef(), field );
	assert.ok( b3.b3Shape_IsValid( plainShape ), 'voxel shape without materials created' );
	b3.b3DestroyShape( plainShape, false );

	function dropSphere( x, z )
	{
		const def = b3.b3DefaultBodyDef();
		def.type = b3.b3BodyType.b3_dynamicBody;
		def.position = [ x, 4, z ];
		const body = b3.b3CreateBody( world, def );
		b3.b3CreateSphereShape( body, b3.b3DefaultShapeDef(), { center: [ 0, 0, 0 ], radius: 0.4 } );
		return body;
	}
	const onFloor = dropSphere( 1.5, 1.5 );
	const overHole = dropSphere( 3.5, 3.5 );
	for ( let i = 0; i < 240; i++ ) b3.b3World_Step( world, 1 / 60, 4 );

	const pos = [ 0, 0, 0 ];
	const restY = b3.b3Body_GetPosition( pos, onFloor )[ 1 ];
	const holeY = b3.b3Body_GetPosition( pos, overHole )[ 1 ];
	assert.ok( Math.abs( restY - 1.4 ) < 0.05, `sphere rests on the voxel top (y=${restY.toFixed( 3 )}, expected 1.4)` );
	assert.ok( holeY < 0, `sphere over the hole fell through (y=${holeY.toFixed( 3 )})` );

	// the world-level ray cast sees the voxel shape and reports the per-voxel material
	// (aimed at an empty floor column, away from the resting sphere)
	const ray = b3.b3World_CastRayClosest( world, [ 4.5, 5, 4.5 ], [ 0, -10, 0 ], b3.b3DefaultQueryFilter() );
	assert.equal( ray.hit, true, 'world ray hits the voxel floor' );
	assert.equal( ray.userMaterialId, 42n, 'world ray reports the per-voxel material' );

	b3.b3DestroyWorld( world );
	b3.b3DestroyVoxelField( field );
	field.delete();
	return { restY, holeY };
}

// Local-space voxel queries on a raw field (no world), cross-checked against the
// engine's own unit test expectations and against the world-level ray cast.
function voxelQueries( b3 )
{
	// 8x4x8 floor two voxels thick (top at y = 2), no border - the engine's test fixture.
	const countX = 8, countY = 4, countZ = 8;
	const voxels = new Uint8Array( countX * countY * countZ );
	for ( let z = 0; z < countZ; z++ ) for ( let x = 0; x < countX; x++ ) for ( let y = 0; y < 2; y++ )
		voxels[ x + countX * ( y + countY * z ) ] = 1;
	const field = b3.b3CreateVoxelField( voxels, null, [ 1, 1, 1 ], countX, countY, countZ, false );

	// ray straight down onto the top of voxel (3, 1, 5)
	const down = b3.b3RayCastVoxelField( field, [ 3.5, 10, 5.5 ], [ 0, -20, 0 ], 1 );
	assert.equal( down.hit, true, 'local ray hits the floor' );
	assert.ok( Math.abs( down.fraction - 0.4 ) < 1e-5, `ray fraction 0.4 (got ${down.fraction})` );
	assert.ok( Math.abs( down.point[ 1 ] - 2 ) < 1e-4, 'ray hit point on the floor top' );
	assert.ok( Math.abs( down.normal[ 1 ] - 1 ) < 1e-5, 'ray normal is +y' );
	assert.equal( down.materialIndex, 0, 'ray material index 0 without materials' );

	// sideways into the -x wall from outside
	const side = b3.b3RayCastVoxelField( field, [ -5, 1.5, 2.5 ], [ 10, 0, 0 ], 1 );
	assert.ok( side.hit && Math.abs( side.fraction - 0.5 ) < 1e-5 && Math.abs( side.normal[ 0 ] + 1 ) < 1e-5, 'side ray hits the -x wall' );

	// miss: horizontal, above the floor; and maxFraction limits the cast
	assert.equal( b3.b3RayCastVoxelField( field, [ -5, 3, 2.5 ], [ 20, 0, 0 ], 1 ).hit, false, 'ray above the floor misses' );
	assert.equal( b3.b3RayCastVoxelField( field, [ 3.5, 10, 5.5 ], [ 0, -20, 0 ], 0.3 ).hit, false, 'maxFraction stops the ray short' );

	// shape cast: a sphere (one point + radius) dropped onto the top; center stops at y = 2.5
	const sphere = new Float32Array( [ 3.5, 10, 5.5 ] );
	const cast = b3.b3ShapeCastVoxelField( field, sphere, 0.5, [ 0, -20, 0 ], 1, false );
	assert.equal( cast.hit, true, 'shape cast hits' );
	assert.ok( Math.abs( cast.fraction - 0.375 ) < 1e-3, `shape cast fraction ~0.375 (got ${cast.fraction}; the engine stops a linear-slop short of contact)` );

	// overlap: sphere touching the top vs. clear of it
	const identity = { position: [ 0, 0, 0 ], quaternion: [ 0, 0, 0, 1 ] };
	assert.equal( b3.b3OverlapVoxelField( field, identity, new Float32Array( [ 3.5, 2.3, 5.5 ] ), 0.5 ), true, 'overlap touching the floor' );
	assert.equal( b3.b3OverlapVoxelField( field, identity, new Float32Array( [ 3.5, 3.0, 5.5 ] ), 0.5 ), false, 'no overlap above the floor' );

	// triangle query: a box inside one column's top face reports that face's two triangles
	let tris = 0, upFacing = 0;
	b3.b3QueryVoxelField( field, [ 2.25, 1.9, 2.25, 2.75, 2.5, 2.75 ], ( a, b, c, triangleIndex ) =>
	{
		tris++;
		// all three corners on the top plane
		if ( Math.abs( a[ 1 ] - 2 ) < 1e-6 && Math.abs( b[ 1 ] - 2 ) < 1e-6 && Math.abs( c[ 1 ] - 2 ) < 1e-6 ) upFacing++;
		assert.ok( Number.isInteger( triangleIndex ), 'triangle index is an integer' );
		return true;
	} );
	assert.equal( tris, 2, `one exposed face = two triangles (got ${tris})` );
	assert.equal( upFacing, 2, 'both triangles lie on the floor top' );

	// returning false stops the query
	let seen = 0;
	b3.b3QueryVoxelField( field, [ -1, -1, -1, 9, 5, 9 ], () => { seen++; return false; } );
	assert.equal( seen, 1, 'returning false stops the query after one triangle' );

	// local vs world: a static body at [10, 0, 0] carrying the field
	const world = b3.b3CreateWorld( b3.b3DefaultWorldDef() );
	const bodyDef = b3.b3DefaultBodyDef();
	bodyDef.position = [ 10, 0, 0 ];
	const body = b3.b3CreateBody( world, bodyDef );
	b3.b3CreateVoxelFieldShape( body, b3.b3DefaultShapeDef(), field );
	b3.b3World_Step( world, 1 / 60, 1 ); // broad-phase update
	const worldRay = b3.b3World_CastRayClosest( world, [ 13.5, 10, 5.5 ], [ 0, -20, 0 ], b3.b3DefaultQueryFilter() );
	assert.ok( Math.abs( worldRay.fraction - down.fraction ) < 1e-5, `world ray agrees with local ray (${worldRay.fraction} vs ${down.fraction})` );
	b3.b3DestroyWorld( world );

	b3.b3DestroyVoxelField( field );
	field.delete();
	return { tris };
}

async function check( label, importPath )
{
	const { default: Box3D } = await import( importPath );
	const b3 = await Box3D();

	const v = b3.b3GetVersion();
	const { startY, endY } = fallingBox( b3 );

	assert.ok( endY < startY - 5, `body fell (start=${startY.toFixed( 2 )} end=${endY.toFixed( 2 )})` );
	assert.ok( endY > 0.5, `body rests above the ground, not through it (end=${endY.toFixed( 2 )})` );

	const { n, totalPoints, worstNormalErr } = contactRead( b3 );
	assert.ok( n >= 1, `resting box reports a contact (got ${n})` );
	assert.ok( totalPoints >= 1, `contact has at least one manifold point (got ${totalPoints})` );
	assert.ok( worstNormalErr < 1e-3, `manifold normal is unit-length (err ${worstNormalErr.toExponential( 1 )})` );

	const { planeCount } = eventsAndPlanes( b3 );

	const { solidCount } = voxelFieldData( b3 );
	assert.equal( solidCount, 15, 'voxel field data round-trip' );

	const { restY, holeY } = voxelShape( b3 );

	const { tris } = voxelQueries( b3 );
	assert.equal( tris, 2, 'voxel triangle query' );

	console.log( `  ${label}: box3d v${v.major}.${v.minor}.${v.revision} — ` +
		`sphere fell ${startY.toFixed( 2 )} -> ${endY.toFixed( 2 )} and settled; ` +
		`read ${n} contact(s)/${totalPoints} point(s), a sensor touch, and ${planeCount} mover plane(s) from the buffers; ` +
		`voxel: rest ${restY.toFixed( 2 )} / hole ${holeY.toFixed( 2 )}` );
}

console.log( 'box3d.js smoke test' );
await check( 'separate-wasm', '../dist/box3d.mjs' );
await check( 'inline       ', '../dist/box3d.inline.mjs' );
console.log( 'OK' );
