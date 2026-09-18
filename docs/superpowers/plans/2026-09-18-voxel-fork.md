# Voxel Field Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build box3d.js against the `liamdon/box3d` fork, expose its voxel field shape through generic JS/TypeScript bindings, and prepare the package for publishing as `@liamdon/box3d.js`.

**Architecture:** The engine is a git submodule compiled to a static lib by Emscripten; `src/bindings.cpp` declares embind bindings whose emitted `.d.ts` is post-processed by `scripts/build.mjs`. Voxel support is added as a new binding block mirroring the existing height-field block, a smoke test per binding group, a three.js geometry helper plus an example, and docs snippets. Package identity changes last, with a pnpm alias so the examples keep importing `box3d.js`.

**Tech Stack:** Emscripten 6.0.9 (embind, `--emit-tsd`), CMake, Node 20+, pnpm 10, three.js, Vite, Biome.

**Spec:** `docs/superpowers/specs/2026-09-18-voxel-fork-design.md`

## Global Constraints

- Emscripten pin: `REQUIRED_EMSDK = '6.0.9'` in `scripts/build.mjs`.
- Engine source: submodule `vendor/box3d` → `https://github.com/liamdon/box3d.git`, branch `voxel-field`.
- Package name: `@liamdon/box3d.js`, version `0.2.0`.
- Voxel index layout: `x + countX * (y + countY * z)`; occupancy input is one byte per voxel, non-zero = solid.
- Voxel shapes are static-body only (engine rule; not re-checked in bindings).
- All new binding names use the engine's C names verbatim (`b3CreateVoxelField`, `b3RayCastVoxelField`, …).
- Validation errors in `b3CreateVoxelField` throw a JS `Error` before the engine is called.
- C++ exceptions are not enabled in the build. Never `throw` a C++ exception from a binding; use the `jsThrow` helper defined in Task 2.
- Code style: tabs, `function( args )` spacing in C++ and `.mjs` as in the existing files; examples/docs use the Biome config (tabs, single quotes).
- Never commit `build/`. Commit `dist/` only in Task 7.
- No Claude session links in commits or PRs.

## Build and test commands

```bash
# from repo root
pnpm build          # ~2-4 min; builds ST + MT libs, probe, four variants, d.ts
pnpm test           # runs test/smoke.mjs against dist/box3d.mjs and dist/box3d.inline.mjs
pnpm docs:build     # regenerates README.md from docs/README.template.md
pnpm docs:check     # type-checks docs/*.ts snippets against dist/box3d.d.ts
pnpm check          # biome lint+format for examples/src
```

`pnpm test` needs a fresh `pnpm build` after any change to `src/bindings.cpp`, `src/facade.js`, or `scripts/build.mjs`. A failing test written before the build is expected to fail with `b3.<name> is not a function` (TypeError).

---

### Task 1: Toolchain bump and engine fork submodule

**Files:**
- Modify: `scripts/build.mjs:34` (`REQUIRED_EMSDK`)
- Modify: `.gitmodules`
- Modify: `vendor/box3d` (submodule pointer)
- Possibly modify: `src/bindings.cpp` (only where upstream engine changes break compilation)

**Interfaces:**
- Consumes: nothing.
- Produces: a building, passing tree whose engine headers include `b3VoxelFieldData`, `b3CreateVoxelField`, `b3CreateVoxelFieldShape`, `b3_voxelShape`, and the `*VoxelField` query functions used by Tasks 2–4.

- [ ] **Step 1: Bump the Emscripten pin**

In `scripts/build.mjs` change:

```js
const REQUIRED_EMSDK = '6.0.2';
```
to
```js
const REQUIRED_EMSDK = '6.0.9';
```

- [ ] **Step 2: Repoint the submodule to the fork**

```bash
git submodule set-url vendor/box3d https://github.com/liamdon/box3d.git
git submodule set-branch --branch voxel-field vendor/box3d
git submodule sync
git -C vendor/box3d fetch origin voxel-field
git -C vendor/box3d checkout --detach origin/voxel-field
git -C vendor/box3d log --oneline -1
```

Expected: `.gitmodules` now reads

```
[submodule "vendor/box3d"]
	path = vendor/box3d
	url = https://github.com/liamdon/box3d.git
	branch = voxel-field
```

and the last command prints `4ed6e57 Voxel field documentation` (or a newer voxel-field head; record the hash you got).

- [ ] **Step 3: Confirm the voxel API is present in the vendored headers**

```bash
grep -n "b3CreateVoxelFieldShape\|b3_voxelShape\|b3RayCastVoxelField" vendor/box3d/include/box3d/*.h
```

Expected: three matches (box3d.h, types.h, collision.h).

- [ ] **Step 4: Build**

```bash
pnpm build 2>&1 | tail -40
```

Expected: ends with the `Build artifacts:` table listing seven files with sizes. If it fails:

- `emsdk 6.0.9 detected but this build is pinned…` → Step 1 was not saved.
- `em++ not found` or LLVM-version errors from the Homebrew emscripten → install the official SDK instead: `git clone https://github.com/emscripten-core/emsdk ~/emsdk && ~/emsdk/emsdk install 6.0.9 && ~/emsdk/emsdk activate 6.0.9 && source ~/emsdk/emsdk_env.sh`, then re-run.
- `require() still present after rewrite` / `still present after strip` → Emscripten 6.0.9 changed its output. Open the named dist file, find the construct the regex in `validateESModule()` missed, widen that regex minimally, and re-run.
- C++ errors in `src/bindings.cpp` → the 23 upstream engine commits renamed or changed a function. For each error, open the engine header, adapt the binding lambda to the new C signature, and keep the JS-visible name and argument list unchanged where possible. If an engine function was removed, delete its binding and note the JS name in a list for the Task 7 changelog.

- [ ] **Step 5: Run the existing smoke test**

```bash
pnpm test
```

Expected:
```
box3d.js smoke test
  separate-wasm: box3d v… — sphere fell … and settled; read … contact(s)…
  inline       : box3d v… — …
OK
```

- [ ] **Step 6: Commit (source only, not dist)**

```bash
git add .gitmodules vendor/box3d scripts/build.mjs src/bindings.cpp
git commit -m "build: emsdk 6.0.9, engine from liamdon/box3d voxel-field"
```

If `src/bindings.cpp` was unchanged, drop it from the `git add`.

---

### Task 2: Voxel field data bindings

**Files:**
- Modify: `src/bindings.cpp` (helper near line 63; new block after `b3CreateWave` binding, ~line 1000)
- Modify: `scripts/build.mjs` (`facadeTypes` string; param retype block)
- Modify: `test/smoke.mjs`

**Interfaces:**
- Consumes: engine functions `b3CreateVoxelField`, `b3DestroyVoxelField`, `b3CreateVoxelWave`, `b3ComputeVoxelFieldAABB`, `b3GetVoxelFieldBits`, `b3GetVoxelFieldMaterialIndices`, `b3IsVoxelSolid`.
- Produces (JS):
  - `b3CreateVoxelField(voxels: Uint8Array, materialIndices: Uint8Array | null, scale: b3Vec3, countX: number, countY: number, countZ: number, hasBorder: boolean): b3VoxelFieldData | null`
  - `b3DestroyVoxelField(field: b3VoxelFieldData | null): void`
  - `b3CreateVoxelWave(countX, countY, countZ, offsetX, offsetZ, scale: b3Vec3, frequencyX, frequencyZ, hasBorder): b3VoxelFieldData | null`
  - `b3ComputeVoxelFieldAABB(field, transform: b3Transform): b3AABB`
  - `b3GetVoxelFieldInfo(field): VoxelFieldInfo` where `VoxelFieldInfo = { countX, countY, countZ, solidCount, hasBorder: boolean, scale: b3Vec3, aabb: b3AABB }`
  - `b3GetVoxelFieldBits(field): Uint8Array` (packed, bit `index & 7` of byte `index >> 3`)
  - `b3GetVoxelFieldMaterialIndices(field): Uint8Array` (empty if none)
  - `b3IsVoxelSolid(field, x, y, z): boolean`
  - C++ helper `jsThrow(const char*)` for later tasks.

- [ ] **Step 1: Write the failing test**

Add to `test/smoke.mjs` before `async function check(`:

```js
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

	// no materials → empty array
	const plain = b3.b3CreateVoxelField( voxels, null, [ 1, 1, 1 ], countX, countY, countZ, false );
	assert.equal( b3.b3GetVoxelFieldMaterialIndices( plain ).length, 0, 'no materials → empty Uint8Array' );
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
```

And inside `check()` after the `eventsAndPlanes` line:

```js
	const { solidCount } = voxelFieldData( b3 );
	assert.equal( solidCount, 15, 'voxel field data round-trip' );
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test 2>&1 | tail -5
```

Expected: `TypeError: b3.b3CreateVoxelField is not a function`.

- [ ] **Step 3: Add the `jsThrow` helper**

In `src/bindings.cpp`, inside the anonymous namespace right after `writeAABB` (before the `// A b3Transform out is read as TWO out params` comment), add:

```cpp
// Raise a JS Error from a binding. C++ exceptions are compiled out, so this is the
// only way to reject bad input without aborting the wasm instance. Control never
// returns: the JS exception unwinds straight through the wasm frames.
[[noreturn]] inline void jsThrow( const char* message )
{
	val::global( "Error" ).new_( std::string( message ) ).throw_();
	__builtin_unreachable();
}
```

- [ ] **Step 4: Add the voxel data bindings**

In `src/bindings.cpp`, immediately after the `b3CreateWave(...)` binding (the line ending `{ return b3CreateWave( rowCount, columnCount, scale, rowFrequency, columnFrequency, makeHoles ); }, allow_raw_pointers() );`), add:

```cpp
	// ---- voxel field --------------------------------------------------------
	// A grid of unit cubes for block worlds (liamdon/box3d fork). The field is
	// immutable once created and, like meshes and height fields, is referenced
	// (not copied) by the shape: keep it alive until the shape is destroyed.
	class_<b3VoxelFieldData>( "b3VoxelFieldData" );

	// voxels: Uint8Array, one byte per voxel, non-zero = solid, index x + countX*(y + countY*z).
	// materialIndices: Uint8Array (one byte per voxel, indexes the materials array given to
	// b3CreateVoxelFieldShape) or null. Both are copied during the call; the caller's arrays
	// are free to reuse afterwards.
	function( "b3CreateVoxelField(voxels, materialIndices, scale, countX, countY, countZ, hasBorder)",
		+[]( val voxels, val materialIndices, b3Vec3 scale, int countX, int countY, int countZ, bool hasBorder ) -> b3VoxelFieldData*
	{
		if ( countX <= 0 || countY <= 0 || countZ <= 0 ) jsThrow( "b3CreateVoxelField: countX, countY and countZ must be positive" );
		if ( !( scale.x > 0.0f && scale.y > 0.0f && scale.z > 0.0f ) ) jsThrow( "b3CreateVoxelField: scale components must be positive" );
		const size_t n = (size_t)countX * (size_t)countY * (size_t)countZ;
		std::vector<uint8_t> v = convertJSArrayToNumberVector<uint8_t>( voxels );
		if ( v.size() != n ) jsThrow( "b3CreateVoxelField: voxels.length must equal countX * countY * countZ" );
		std::vector<uint8_t> m;
		const bool hasMaterials = !materialIndices.isNull() && !materialIndices.isUndefined();
		if ( hasMaterials )
		{
			m = convertJSArrayToNumberVector<uint8_t>( materialIndices );
			if ( m.size() != n ) jsThrow( "b3CreateVoxelField: materialIndices.length must equal countX * countY * countZ" );
		}
		b3VoxelFieldDef def = {};
		def.voxels = v.data();
		def.materialIndices = hasMaterials ? m.data() : nullptr;
		def.scale = scale;
		def.countX = countX;
		def.countY = countY;
		def.countZ = countZ;
		def.hasBorder = hasBorder;
		return b3CreateVoxelField( &def );
	}, allow_raw_pointers() );
	function( "b3DestroyVoxelField(field)", &b3DestroyVoxelField, allow_raw_pointers() );
	function( "b3CreateVoxelWave(countX, countY, countZ, offsetX, offsetZ, scale, frequencyX, frequencyZ, hasBorder)",
		+[]( int countX, int countY, int countZ, int offsetX, int offsetZ, b3Vec3 scale, float frequencyX, float frequencyZ, bool hasBorder )
		{ return b3CreateVoxelWave( countX, countY, countZ, offsetX, offsetZ, scale, frequencyX, frequencyZ, hasBorder ); }, allow_raw_pointers() );
	function( "b3ComputeVoxelFieldAABB(field, transform)",
		+[]( b3VoxelFieldData* f, b3Transform t ) { return b3ComputeVoxelFieldAABB( f, t ); }, allow_raw_pointers() );
	// Field metadata as a plain object. Allocates; intended for setup / tooling, not per-frame.
	ret_function( "b3GetVoxelFieldInfo(field): VoxelFieldInfo", +[]( b3VoxelFieldData* f ) -> val
	{
		val info = val::object();
		info.set( "countX", f->countX );
		info.set( "countY", f->countY );
		info.set( "countZ", f->countZ );
		info.set( "solidCount", f->solidCount );
		info.set( "hasBorder", f->hasBorder != 0 );
		info.set( "scale", val( f->scale ) );
		info.set( "aabb", val( f->aabb ) );
		return info;
	}, allow_raw_pointers() );
	// Packed occupancy bits, copied out: voxel i is bit (i & 7) of byte (i >> 3).
	ret_function( "b3GetVoxelFieldBits(field): Uint8Array", +[]( b3VoxelFieldData* f ) -> val
	{
		const size_t n = (size_t)f->countX * (size_t)f->countY * (size_t)f->countZ;
		val view = val( typed_memory_view( ( n + 7 ) / 8, b3GetVoxelFieldBits( f ) ) );
		return view.call<val>( "slice" );
	}, allow_raw_pointers() );
	// Per-voxel material indices, copied out (empty Uint8Array if the field has none).
	ret_function( "b3GetVoxelFieldMaterialIndices(field): Uint8Array", +[]( b3VoxelFieldData* f ) -> val
	{
		const uint8_t* mi = b3GetVoxelFieldMaterialIndices( f );
		if ( mi == nullptr ) return val::global( "Uint8Array" ).new_( 0 );
		const size_t n = (size_t)f->countX * (size_t)f->countY * (size_t)f->countZ;
		val view = val( typed_memory_view( n, mi ) );
		return view.call<val>( "slice" );
	}, allow_raw_pointers() );
	function( "b3IsVoxelSolid(field, x, y, z)",
		+[]( b3VoxelFieldData* f, int x, int y, int z ) { return b3IsVoxelSolid( f, x, y, z ); }, allow_raw_pointers() );
```

- [ ] **Step 5: Add the `VoxelFieldInfo` type and retype the `any` params in `scripts/build.mjs`**

In the `facadeTypes` template string, after the `export interface PlaneResult { … }` line, add:

```ts
/** Metadata of a voxel field, read back with b3GetVoxelFieldInfo. */
export interface VoxelFieldInfo {
  countX: number;
  countY: number;
  countZ: number;
  solidCount: number;
  hasBorder: boolean;
  scale: b3Vec3;
  aabb: b3AABB;
}
```

Then, directly after the `for ( const { method, tsType } of retMeta ) { … }` loop, add a param retype pass (the `val` params emit as `any`; give the voxel API real types):

```js
// val-typed params emit as `any`; retype the voxel API's typed-array/object params so the
// public surface is precise. Each entry must match or the build fails, like retMeta above.
const paramRetypes = [
	{ method: 'b3CreateVoxelField', from: 'voxels: any', to: 'voxels: Uint8Array' },
	{ method: 'b3CreateVoxelField', from: 'materialIndices: any', to: 'materialIndices: Uint8Array | null' },
];
for ( const { method, from, to } of paramRetypes )
{
	const re = new RegExp( `^(\\s*${method}\\([^)]*)${from.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' )}` , 'm' );
	if ( !re.test( tsd ) ) throw new Error( `tsd: no \`${from}\` param on ${method} to retype — binding renamed or param order changed?` );
	tsd = tsd.replace( re, `$1${to}` );
}
```

- [ ] **Step 6: Build and run the test**

```bash
pnpm build 2>&1 | tail -12 && pnpm test
```

Expected: build table, then the smoke test prints both variant lines and `OK`. Then confirm the types:

```bash
grep -n "b3CreateVoxelField\|VoxelFieldInfo\|b3GetVoxelFieldBits" dist/box3d.d.ts
```

Expected: `b3CreateVoxelField(voxels: Uint8Array, materialIndices: Uint8Array | null, scale: b3Vec3, countX: number, countY: number, countZ: number, hasBorder: boolean): b3VoxelFieldData | null;`, `b3GetVoxelFieldInfo(field: b3VoxelFieldData | null): VoxelFieldInfo;`, `b3GetVoxelFieldBits(field: b3VoxelFieldData | null): Uint8Array;`.

- [ ] **Step 7: Commit**

```bash
git add src/bindings.cpp scripts/build.mjs test/smoke.mjs
git commit -m "feat: voxel field data bindings"
```

---

### Task 3: Voxel shape bindings and materials

**Files:**
- Modify: `src/bindings.cpp` (`b3ShapeType` enum ~line 568; shape block after Task 2's block; `b3Shape_GetVoxelField` next to `b3Shape_GetHullVertices` ~line 1476)
- Modify: `scripts/build.mjs` (`paramRetypes`)
- Modify: `test/smoke.mjs`

**Interfaces:**
- Consumes: Task 2's `b3CreateVoxelField`, `b3GetVoxelFieldMaterialIndices`, `b3DestroyVoxelField`; engine `b3CreateVoxelFieldShape`, `b3Shape_GetVoxelField`, `b3_voxelShape`.
- Produces (JS):
  - `b3ShapeType.b3_voxelShape`
  - `b3CreateVoxelFieldShape(bodyId: b3BodyId, shapeDef: b3ShapeDef, field: b3VoxelFieldData | null, materials?: b3SurfaceMaterial[] | null): b3ShapeId`
  - `b3Shape_GetVoxelField(shapeId: b3ShapeId): b3VoxelFieldData | null`

- [ ] **Step 1: Write the failing test**

Add to `test/smoke.mjs` before `async function check(`:

```js
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
	const ray = b3.b3World_CastRayClosest( world, [ 1.5, 5, 1.5 ], [ 0, -10, 0 ], b3.b3DefaultQueryFilter() );
	assert.equal( ray.hit, true, 'world ray hits the voxel floor' );
	assert.equal( ray.userMaterialId, 42n, 'world ray reports the per-voxel material' );

	b3.b3DestroyWorld( world );
	b3.b3DestroyVoxelField( field );
	field.delete();
	return { restY, holeY };
}
```

And inside `check()` after the `voxelFieldData` lines:

```js
	const { restY, holeY } = voxelShape( b3 );
```

and extend the final `console.log` message with `; voxel: rest ${restY.toFixed( 2 )} / hole ${holeY.toFixed( 2 )}`.


- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test 2>&1 | tail -5
```

Expected: `TypeError: b3.b3CreateVoxelFieldShape is not a function`.

- [ ] **Step 3: Add the enum value**

In the `enum_<b3ShapeType>( "b3ShapeType" )` block, after `.value( "b3_sphereShape", b3_sphereShape )` change the trailing `;` to add:

```cpp
		.value( "b3_sphereShape", b3_sphereShape )
		.value( "b3_voxelShape", b3_voxelShape );
```

- [ ] **Step 4: Add the shape bindings**

Directly after the `b3IsVoxelSolid` binding from Task 2, add:

```cpp
	// materials: optional array of b3SurfaceMaterial. When given it becomes the shape's
	// material table (the engine clones the def, so the vector is a temporary) and the
	// field's per-voxel material indices select from it. Omitted → baseMaterial everywhere.
	// Voxel shapes are only valid on static bodies (engine rule).
	function( "b3CreateVoxelFieldShape(bodyId, shapeDef, field, materials)",
		+[]( b3BodyId bodyId, b3ShapeDef def, b3VoxelFieldData* field, val materials ) -> b3ShapeId
	{
		std::vector<b3SurfaceMaterial> mats;
		if ( !materials.isNull() && !materials.isUndefined() )
		{
			mats = vecFromJSArray<b3SurfaceMaterial>( materials );
			def.materials = mats.data();
			def.materialCount = (int)mats.size();
		}
		return b3CreateVoxelFieldShape( bodyId, &def, field );
	}, allow_raw_pointers() );
```

Then next to `b3Shape_GetHullVertices` (after its closing `} );`), add:

```cpp
	function( "b3Shape_GetVoxelField(shapeId)", +[]( b3ShapeId shapeId ) -> b3VoxelFieldData*
		{ return const_cast<b3VoxelFieldData*>( b3Shape_GetVoxelField( shapeId ) ); }, allow_raw_pointers() );
```

- [ ] **Step 5: Make `materials` optional in the emitted types**

In `scripts/build.mjs` add to `paramRetypes`:

```js
	{ method: 'b3CreateVoxelFieldShape', from: 'materials: any', to: 'materials?: b3SurfaceMaterial[] | null' },
```

- [ ] **Step 6: Build and run the test**

```bash
pnpm build 2>&1 | tail -12 && pnpm test
```

Expected: `OK`, with the voxel rest/hole numbers in the per-variant line. Then:

```bash
grep -n "b3CreateVoxelFieldShape\|b3_voxelShape\|b3Shape_GetVoxelField" dist/box3d.d.ts
```

Expected: the shape function shows `materials?: b3SurfaceMaterial[] | null`, and the enum literal type includes `b3_voxelShape: b3ShapeTypeValue<6>`.

- [ ] **Step 7: Commit**

```bash
git add src/bindings.cpp scripts/build.mjs test/smoke.mjs
git commit -m "feat: voxel field shape bindings with optional materials"
```

---

### Task 4: Local-space voxel queries

**Files:**
- Modify: `src/bindings.cpp` (after the `b3CreateVoxelFieldShape` binding)
- Modify: `scripts/build.mjs` (`paramRetypes`)
- Modify: `test/smoke.mjs`

**Interfaces:**
- Consumes: Task 2's `b3CreateVoxelField`; engine `b3RayCastVoxelField`, `b3ShapeCastVoxelField`, `b3OverlapVoxelField`, `b3QueryVoxelField`.
- Produces (JS):
  - `b3RayCastVoxelField(field, origin: b3Vec3, translation: b3Vec3, maxFraction: number): b3WorldCastOutput`
  - `b3ShapeCastVoxelField(field, points: Float32Array, radius: number, translation: b3Vec3, maxFraction: number, canEncroach: boolean): b3WorldCastOutput`
  - `b3OverlapVoxelField(field, transform: b3Transform, points: Float32Array, radius: number): boolean`
  - `b3QueryVoxelField(field, aabb: b3AABB, callback: (a: b3Vec3, b: b3Vec3, c: b3Vec3, triangleIndex: number) => boolean | void): void`

- [ ] **Step 1: Write the failing test**

Add to `test/smoke.mjs` before `async function check(`:

```js
// Local-space voxel queries on a raw field (no world), cross-checked against the
// engine's own unit test expectations and against the world-level ray cast.
function voxelQueries( b3 )
{
	// 8x4x8 floor two voxels thick (top at y = 2), no border — the engine's test fixture.
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
	assert.ok( Math.abs( cast.fraction - 0.375 ) < 1e-4, `shape cast fraction 0.375 (got ${cast.fraction})` );

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
```

And inside `check()` after the `voxelShape` line:

```js
	const { tris } = voxelQueries( b3 );
	assert.equal( tris, 2, 'voxel triangle query' );
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test 2>&1 | tail -5
```

Expected: `TypeError: b3.b3RayCastVoxelField is not a function`.

- [ ] **Step 3: Add the query bindings**

Directly after the `b3CreateVoxelFieldShape` binding, add:

```cpp
	// Local-space queries on a raw field (no world needed). Point clouds follow the
	// b3ShapeProxy convention used elsewhere: Float32Array of local points + radius.
	function( "b3RayCastVoxelField(field, origin, translation, maxFraction)",
		+[]( b3VoxelFieldData* f, b3Vec3 origin, b3Vec3 translation, float maxFraction ) -> b3CastOutput
	{
		b3RayCastInput input{ origin, translation, maxFraction };
		return b3RayCastVoxelField( f, &input );
	}, allow_raw_pointers() );
	function( "b3ShapeCastVoxelField(field, points, radius, translation, maxFraction, canEncroach)",
		+[]( b3VoxelFieldData* f, val points, float radius, b3Vec3 translation, float maxFraction, bool canEncroach ) -> b3CastOutput
	{
		std::vector<float> p = convertJSArrayToNumberVector<float>( points );
		b3ShapeCastInput input = {};
		input.proxy = b3ShapeProxy{ reinterpret_cast<const b3Vec3*>( p.data() ), (int)( p.size() / 3 ), radius };
		input.translation = translation;
		input.maxFraction = maxFraction;
		input.canEncroach = canEncroach;
		return b3ShapeCastVoxelField( f, &input );
	}, allow_raw_pointers() );
	function( "b3OverlapVoxelField(field, transform, points, radius)",
		+[]( b3VoxelFieldData* f, b3Transform transform, val points, float radius ) -> bool
	{
		std::vector<float> p = convertJSArrayToNumberVector<float>( points );
		b3ShapeProxy proxy{ reinterpret_cast<const b3Vec3*>( p.data() ), (int)( p.size() / 3 ), radius };
		return b3OverlapVoxelField( f, transform, &proxy );
	}, allow_raw_pointers() );
	// callback(a, b, c, triangleIndex) per exposed-face triangle; return false to stop.
	function( "b3QueryVoxelField(field, aabb, callback)", +[]( b3VoxelFieldData* f, b3AABB aabb, val cb )
	{
		b3QueryVoxelField( f, aabb,
			[]( b3Vec3 a, b3Vec3 b, b3Vec3 c, int triangleIndex, void* ctx ) -> bool
			{
				val r = ( *static_cast<val*>( ctx ) )( a, b, c, triangleIndex );
				return r.isUndefined() ? true : r.as<bool>();
			},
			&cb );
	}, allow_raw_pointers() );
```

- [ ] **Step 4: Retype the `any` params**

In `scripts/build.mjs` add to `paramRetypes`:

```js
	{ method: 'b3ShapeCastVoxelField', from: 'points: any', to: 'points: Float32Array' },
	{ method: 'b3OverlapVoxelField', from: 'points: any', to: 'points: Float32Array' },
	{ method: 'b3QueryVoxelField', from: 'callback: any', to: 'callback: (a: b3Vec3, b: b3Vec3, c: b3Vec3, triangleIndex: number) => boolean | void' },
```

- [ ] **Step 5: Build and run the test**

```bash
pnpm build 2>&1 | tail -12 && pnpm test
```

Expected: `OK`. Then:

```bash
grep -n "VoxelField(" dist/box3d.d.ts
```

Expected: the four query functions with the retyped params and `b3WorldCastOutput` / `boolean` / `void` returns.

- [ ] **Step 6: Commit**

```bash
git add src/bindings.cpp scripts/build.mjs test/smoke.mjs
git commit -m "feat: local-space voxel field queries"
```

---

### Task 5: Renderer support and the Voxel Field example

**Files:**
- Create: `examples/src/voxel-geometry.ts`
- Modify: `examples/src/box3d-three.ts:99-103` (the `return null` fallthrough) and the material creation at `:112-116`
- Create: `examples/src/example-voxel-field.ts`
- Create: `examples/example-voxel-field.html`
- Modify: `examples/src/examples.json` (insert after the `example-triangle-mesh` entry)
- Create: `examples/public/screenshots/example-voxel-field.png` (generated)

**Interfaces:**
- Consumes: `b3Shape_GetVoxelField`, `b3GetVoxelFieldInfo`, `b3GetVoxelFieldBits`, `b3GetVoxelFieldMaterialIndices`, `b3CreateVoxelWave`, `b3CreateVoxelField`, `b3CreateVoxelFieldShape`, `b3RayCastVoxelField`.
- Produces: `voxelFieldGeometry(b3: Box3DModule, field: b3VoxelFieldData, palette?: number[]): THREE.BufferGeometry` (exposed faces only; adds a `color` attribute when the field has material indices).

- [ ] **Step 1: Create the geometry helper**

`examples/src/voxel-geometry.ts`:

```ts
// Build a three.js geometry for a box3d voxel field by reading the field back
// (b3GetVoxelFieldInfo / Bits / MaterialIndices). Only exposed faces are
// emitted, matching what the engine collides with. With a border, the outer
// layer is skipped (it never collides) but still hides its neighbours' faces.

import type { Box3DModule, b3VoxelFieldData } from 'box3d.js';
import * as THREE from 'three';

// +x, -x, +y, -y, +z, -z: normal, then the four corners (CCW seen from outside)
const FACES: Array<{ n: [number, number, number]; c: Array<[number, number, number]> }> = [
	{ n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
	{ n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
	{ n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
	{ n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
	{ n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
	{ n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

export function voxelFieldGeometry(
	b3: Box3DModule,
	field: b3VoxelFieldData,
	palette: number[] = [0x9a9a9a, 0x6bcb77, 0x4d96ff, 0xffd93d, 0xff6b6b, 0xc78bff],
): THREE.BufferGeometry {
	const info = b3.b3GetVoxelFieldInfo(field);
	const bits = b3.b3GetVoxelFieldBits(field);
	const materials = b3.b3GetVoxelFieldMaterialIndices(field);
	const { countX, countY, countZ } = info;
	const [sx, sy, sz] = info.scale;
	const border = info.hasBorder ? 1 : 0;

	const index = (x: number, y: number, z: number) => x + countX * (y + countY * z);
	const solid = (x: number, y: number, z: number): boolean => {
		if (x < 0 || y < 0 || z < 0 || x >= countX || y >= countY || z >= countZ) return false;
		const i = index(x, y, z);
		return ((bits[i >> 3] >> (i & 7)) & 1) === 1;
	};

	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const color = new THREE.Color();

	for (let z = border; z < countZ - border; z++) {
		for (let y = border; y < countY - border; y++) {
			for (let x = border; x < countX - border; x++) {
				if (!solid(x, y, z)) continue;
				const mat = materials.length > 0 ? materials[index(x, y, z)] : 0;
				color.setHex(palette[mat % palette.length]);
				for (const face of FACES) {
					if (solid(x + face.n[0], y + face.n[1], z + face.n[2])) continue;
					const base = positions.length / 3;
					for (const [cx, cy, cz] of face.c) {
						positions.push((x + cx) * sx, (y + cy) * sy, (z + cz) * sz);
						normals.push(face.n[0], face.n[1], face.n[2]);
						colors.push(color.r, color.g, color.b);
					}
					indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
				}
			}
		}
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	if (materials.length > 0) {
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	}
	geometry.setIndex(indices);
	return geometry;
}
```

- [ ] **Step 2: Teach the renderer about voxel shapes**

In `examples/src/box3d-three.ts`, add the import after the `ConvexGeometry` import:

```ts
import { voxelFieldGeometry } from './voxel-geometry';
```

Replace the fallthrough comment block and `return null;` at the end of `geometryFor()` with:

```ts
		if (type === b3.b3ShapeType.b3_voxelShape.value) {
			const field = b3.b3Shape_GetVoxelField(shapeId);
			return field === null ? null : voxelFieldGeometry(b3, field);
		}

		// mesh / heightfield / compound: no generic geometry (can't introspect a
		// compound shape, and mesh/height data isn't read back) — the example that
		// created these draws its own meshes.
		return null;
```

Then, where the material is created in `update()`, make vertex colors take over when the geometry carries them:

```ts
				const vertexColors = geometry.hasAttribute('color');
				const material = new THREE.MeshStandardMaterial({
					color: vertexColors ? 0xffffff : colorFor(b3, body, colorIdx),
					vertexColors,
					roughness: 0.5,
					metalness: 0.05,
				});
```

- [ ] **Step 3: Create the example**

`examples/example-voxel-field.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Voxel Field — box3d.js</title>
		<link rel="stylesheet" href="./src/example.css" />
	</head>
	<body>
		<script type="module" src="./src/example-voxel-field.ts"></script>
	</body>
</html>
```

`examples/src/example-voxel-field.ts`:

```ts
// Voxel Field — a block-world terrain from b3CreateVoxelWave, plus a hand-built
// platform with a hole and per-voxel materials, with dynamic shapes dropped on
// top. The generic renderer draws voxel shapes by reading the field back, and a
// local-space ray cast (b3RayCastVoxelField) is drawn against the terrain.

import type { Box3DModule, b3Vec3 } from 'box3d.js';
import Box3D from 'box3d.js/inline';
import * as THREE from 'three';
import { createWorldRenderer } from './box3d-three';
import { createHarness } from './harness';

const b3: Box3DModule = await Box3D();
const app = createHarness({ camera: [0, 30, 42], target: [0, 6, 0] });

const worldDef = b3.b3DefaultWorldDef();
worldDef.gravity = [0, -10, 0];
const world = b3.b3CreateWorld(worldDef);

// --- wave terrain: 32x12x32 voxels, centred on the origin ---
const SIZE = 32;
const HEIGHT = 12;
const terrainOrigin: b3Vec3 = [-SIZE / 2, 0, -SIZE / 2];
const terrain = b3.b3CreateVoxelWave(SIZE, HEIGHT, SIZE, 0, 0, [1, 1, 1], 0.25, 0.4, false)!;
const terrainDef = b3.b3DefaultBodyDef();
terrainDef.position = terrainOrigin;
const terrainBody = b3.b3CreateBody(world, terrainDef); // static
b3.b3CreateVoxelFieldShape(terrainBody, b3.b3DefaultShapeDef(), terrain);

// --- hand-built platform: 8x2x8 floor with a 2x2 hole, checkerboard materials ---
const PX = 8, PY = 2, PZ = 8;
const voxels = new Uint8Array(PX * PY * PZ);
const materialIndices = new Uint8Array(PX * PY * PZ);
const idx = (x: number, y: number, z: number) => x + PX * (y + PY * z);
for (let z = 0; z < PZ; z++) {
	for (let x = 0; x < PX; x++) {
		const hole = x >= 3 && x <= 4 && z >= 3 && z <= 4;
		voxels[idx(x, 0, z)] = hole ? 0 : 1;
		materialIndices[idx(x, 0, z)] = (x + z) % 2; // 0 = rough, 1 = ice
	}
}
const platform = b3.b3CreateVoxelField(voxels, materialIndices, [1, 1, 1], PX, PY, PZ, false)!;
const rough = b3.b3DefaultSurfaceMaterial();
rough.friction = 0.8;
const ice = b3.b3DefaultSurfaceMaterial();
ice.friction = 0.02;
const platformDef = b3.b3DefaultBodyDef();
platformDef.position = [-PX / 2, 14, -PZ / 2];
const platformBody = b3.b3CreateBody(world, platformDef); // static
b3.b3CreateVoxelFieldShape(platformBody, b3.b3DefaultShapeDef(), platform, [rough, ice]);

// --- dynamic shapes dropped over the platform; some fall through the hole ---
const renderer = createWorldRenderer(b3, world);
app.scene.add(renderer.object3d);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
for (let i = 0; i < 40; i++) {
	const def = b3.b3DefaultBodyDef();
	def.type = b3.b3BodyType.b3_dynamicBody;
	def.position = [rand(-3.5, 3.5), 18 + i * 0.6, rand(-3.5, 3.5)];
	const body = b3.b3CreateBody(world, def);
	const shapeDef = b3.b3DefaultShapeDef();
	shapeDef.baseMaterial.restitution = 0.2;
	if (i % 2 === 0) {
		b3.b3CreateSphereShape(body, shapeDef, { center: [0, 0, 0], radius: rand(0.35, 0.5) });
	} else {
		b3.b3CreateBoxShape(body, shapeDef, 0.4, 0.4, 0.4);
	}
}

// --- local-space ray cast against the terrain field, drawn each frame ---
const rayOrigin: b3Vec3 = [14, 20, 14];
const rayTranslation: b3Vec3 = [-28, -20, -28];
const rayLine = new THREE.Line(
	new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
	new THREE.LineBasicMaterial({ color: 0xffd93d }),
);
const hitMarker = new THREE.Mesh(
	new THREE.SphereGeometry(0.3, 12, 8),
	new THREE.MeshStandardMaterial({ color: 0xff6b6b }),
);
app.scene.add(rayLine, hitMarker);

function castRay(): void {
	// the terrain body sits at terrainOrigin with identity rotation, so local = world - origin
	const localOrigin: b3Vec3 = [
		rayOrigin[0] - terrainOrigin[0],
		rayOrigin[1] - terrainOrigin[1],
		rayOrigin[2] - terrainOrigin[2],
	];
	const hit = b3.b3RayCastVoxelField(terrain, localOrigin, rayTranslation, 1);
	const f = hit.hit ? hit.fraction : 1;
	const end = new THREE.Vector3(
		rayOrigin[0] + rayTranslation[0] * f,
		rayOrigin[1] + rayTranslation[1] * f,
		rayOrigin[2] + rayTranslation[2] * f,
	);
	rayLine.geometry.setFromPoints([new THREE.Vector3(...rayOrigin), end]);
	hitMarker.visible = hit.hit;
	hitMarker.position.copy(end);
}

app.onFrame(() => {
	app.step(() => b3.b3World_Step(world, 1 / 60, 4));
	renderer.update();
	castRay();
});
app.start();
```

- [ ] **Step 4: Register the example**

In `examples/src/examples.json`, after the `"example-triangle-mesh": { … },` entry, insert:

```json
  "example-voxel-field": {
    "title": "Voxel Field",
    "description": "shapes drop onto a block-world terrain and a voxel platform with a hole",
    "tags": [
      "world",
      "physics",
      "voxel",
      "voxel-field",
      "terrain",
      "materials"
    ]
  },
```

- [ ] **Step 5: Type-check, lint, and run it**

```bash
pnpm install
pnpm check
pnpm --filter @box3d/examples exec tsc --noEmit -p tsconfig.json
```

Expected: Biome reports no errors (run `pnpm format` if it reports formatting diffs, then re-check), and `tsc` exits 0. If Biome complains about the `FACES` literal formatting, accept its formatting.

Then start the dev server and open the example in a browser:

```bash
pnpm --filter @box3d/examples dev
```

Open `http://localhost:5173/example-voxel-field.html`. Expected: a grey wavy block terrain, a checkerboard grey/green platform floating above it with a square hole, spheres and cubes landing on the platform (sliding on the green ice voxels) with some falling through the hole onto the terrain, a yellow ray line ending in a red marker on the terrain surface. Stop the server with Ctrl-C.

- [ ] **Step 6: Screenshot**

```bash
cd examples && pnpm run screenshot example-voxel-field && cd ..
ls -la examples/public/screenshots/example-voxel-field.png
```

Expected: the PNG exists. If Playwright's browser is missing, run `pnpm --filter @box3d/examples exec playwright install chromium` first.

- [ ] **Step 7: Commit**

```bash
git add examples/src/voxel-geometry.ts examples/src/box3d-three.ts examples/src/example-voxel-field.ts examples/example-voxel-field.html examples/src/examples.json examples/public/screenshots/example-voxel-field.png
git commit -m "feat(examples): voxel field renderer support and example"
```

---

### Task 6: Docs snippet and README section

**Files:**
- Modify: `docs/shapes.ts` (after the `mesh` snippet)
- Modify: `docs/README.template.md:72` and the Shapes section (after the Triangle Mesh subsection)
- Regenerate: `README.md`

**Interfaces:**
- Consumes: the JS API from Tasks 2–4.
- Produces: README content only.

- [ ] **Step 1: Add the snippet**

In `docs/shapes.ts`, after `/* SNIPPET_END: mesh */`, add:

```ts
/* SNIPPET_START: voxel */
// Voxel field: a grid of unit cubes for block worlds. Static bodies only.
// voxels: Uint8Array, one byte per voxel, non-zero = solid,
// index = x + countX * (y + countY * z). Only exposed faces collide.
const countX = 8, countY = 4, countZ = 8;
const voxels = new Uint8Array(countX * countY * countZ);
const materialIndices = new Uint8Array(countX * countY * countZ);
for (let z = 0; z < countZ; z++) {
    for (let x = 0; x < countX; x++) {
        for (let y = 0; y < 2; y++) {
            const i = x + countX * (y + countY * z);
            voxels[i] = 1;                    // two-voxel-thick floor
            materialIndices[i] = y === 1 ? 1 : 0; // top layer uses material 1
        }
    }
}
// Inputs are copied; pass null for materialIndices to use baseMaterial everywhere.
const voxelField = b3.b3CreateVoxelField(voxels, materialIndices, [1, 1, 1], countX, countY, countZ, false)!;

const voxelBody = b3.b3CreateBody(world, b3.b3DefaultBodyDef()); // static
const ice = b3.b3DefaultSurfaceMaterial();
ice.friction = 0.05;
// The optional materials array is the table the per-voxel indices select from.
b3.b3CreateVoxelFieldShape(voxelBody, b3.b3DefaultShapeDef(), voxelField, [b3.b3DefaultSurfaceMaterial(), ice]);

// Local-space queries work on the field itself, without a world:
const hit = b3.b3RayCastVoxelField(voxelField, [3.5, 10, 5.5], [0, -20, 0], 1);
console.log(hit.hit, hit.point, hit.materialIndex); // true, [3.5, 2, 5.5], 1

// Read the field back (e.g. to build render geometry):
const info = b3.b3GetVoxelFieldInfo(voxelField); // { countX, countY, countZ, solidCount, hasBorder, scale, aabb }
const solid = b3.b3IsVoxelSolid(voxelField, 3, 1, 5); // true
console.log(info.solidCount, solid);

// Keep the field alive while the shape exists; destroy it after the shape/world.
// b3.b3DestroyVoxelField(voxelField); voxelField.delete();
/* SNIPPET_END: voxel */
```

- [ ] **Step 2: Update the README template**

Replace line 72 of `docs/README.template.md`:

```
**Mesh, compound, and heightfield data are not copied** - the world stores a raw pointer. `b3MeshData`, `b3CompoundData`, and `b3HeightFieldData` must be kept alive for as long as the shape (or world) exists, and destroyed only after.
```
with
```
**Mesh, compound, heightfield, and voxel field data are not copied** - the world stores a raw pointer. `b3MeshData`, `b3CompoundData`, `b3HeightFieldData`, and `b3VoxelFieldData` must be kept alive for as long as the shape (or world) exists, and destroyed only after.
```

After the `<ExamplesTable ids="example-triangle-mesh" />` line (end of the Triangle Mesh subsection), insert:

```markdown
### Voxel Field (Static Only)

Voxel fields describe block worlds as a grid of unit cubes. Only the faces of solid voxels that touch empty space collide, and coplanar faces never generate edge contacts, so bodies slide cleanly across flat voxel floors. Fields are immutable: to edit a block world, rebuild the affected chunk's field, destroy the old shape, and create a new one (set `invokeContactCreation` on the shape def so resting bodies wake). Keep chunks around 16–64 voxels per axis and tile them; with `hasBorder`, the outer layer never collides but hides its neighbours' faces so seams stay smooth.

This shape is a fork addition (from [liamdon/box3d](https://github.com/liamdon/box3d)); it is not in upstream box3d.

<Snippet source="./shapes.ts" select="voxel" />

<ExamplesTable ids="example-voxel-field" />
```

- [ ] **Step 3: Type-check the snippet and regenerate the README**

```bash
pnpm docs:check && pnpm docs:build && grep -n "Voxel Field" README.md | head
```

Expected: `tsc` exits 0; README.md contains the new section, the voxel snippet, and the example card.

- [ ] **Step 4: Commit**

```bash
git add docs/shapes.ts docs/README.template.md README.md
git commit -m "docs: voxel field shape section"
```

---

### Task 7: Package identity, changelog, dist, release prep

**Files:**
- Modify: `package.json`
- Modify: `examples/package.json`, `docs/package.json`
- Modify: `docs/build.js:19` and the README write step
- Modify: `docs/README.template.md` (intro, install line, Builds table)
- Modify: `CHANGELOG.md`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)
- Commit: `dist/*`

**Interfaces:**
- Consumes: everything above.
- Produces: a publishable package.

- [ ] **Step 1: Rename the package**

In `package.json` set:

```json
  "name": "@liamdon/box3d.js",
  "version": "0.2.0",
  "description": "WebAssembly bindings for box3d, Erin Catto's 3D physics engine — fork with voxel field shapes",
```

and replace the repository fields and author block:

```json
  "repository": "github:liamdon/box3d.js",
  "homepage": "https://github.com/liamdon/box3d.js",
  "bugs": {
    "url": "https://github.com/liamdon/box3d.js/issues"
  },
  "author": "Isaac Mason",
  "contributors": [
    "Liam Don"
  ],
  "publishConfig": {
    "access": "public"
  },
```

Add `"voxel"` to `keywords`. Leave `exports`, `files`, `scripts`, and `license` unchanged.

- [ ] **Step 2: Alias the workspace dependency**

In both `examples/package.json` and `docs/package.json` change

```json
    "box3d.js": "workspace:*"
```
to
```json
    "box3d.js": "workspace:@liamdon/box3d.js@*"
```

Then:

```bash
pnpm install
git diff --stat pnpm-lock.yaml
```

Expected: the lockfile updates and `examples/node_modules/box3d.js` still resolves (`ls -la examples/node_modules/box3d.js` shows a symlink to the repo root).

- [ ] **Step 3: Point the docs builder at the fork and rewrite import specifiers in the README**

In `docs/build.js` change

```js
const EXAMPLES_BASE_URL = 'https://isaac-mason.github.io/box3d.js/';
```
to
```js
const EXAMPLES_BASE_URL = 'https://liamdon.github.io/box3d.js/';
```

Find the line that writes `outPath` (`fs.writeFileSync(outPath, …)`) and, immediately before it, add:

```js
// The workspace packages import the unscoped alias `box3d.js`; consumers install the
// scoped package, so the published README shows the scoped specifier.
text = text.replaceAll("from 'box3d.js", "from '@liamdon/box3d.js");
```

- [ ] **Step 4: Update the README intro**

In `docs/README.template.md`, change the `npm install box3d.js` line to `npm install @liamdon/box3d.js`, change the four `box3d.js…` cells in the **Builds** table to `@liamdon/box3d.js`, `@liamdon/box3d.js/inline`, `@liamdon/box3d.js/mt`, `@liamdon/box3d.js/mt-inline`, and insert this paragraph directly after the first paragraph (the one starting `WebAssembly bindings for`):

```markdown
> This is a fork of [isaac-mason/box3d.js](https://github.com/isaac-mason/box3d.js) built against [liamdon/box3d](https://github.com/liamdon/box3d), a fork of the engine that adds a **voxel field** shape for block worlds. Everything else matches upstream; see the [Voxel Field](#voxel-field-static-only) section for the addition.
```

- [ ] **Step 5: Changelog**

Prepend to `CHANGELOG.md` under the `# Changelog` heading:

```markdown
## v0.2.0 (`@liamdon/box3d.js`)

First release of the fork. Published as `@liamdon/box3d.js`; the API is a superset of `box3d.js` v0.1.1.

- Engine built from [liamdon/box3d](https://github.com/liamdon/box3d) `voxel-field` (upstream box3d through `f555ee4` "Optimize Broad-Phase (#159)" plus the voxel field shape).
- **New:** voxel field shapes. `b3CreateVoxelField`, `b3DestroyVoxelField`, `b3CreateVoxelWave`, `b3CreateVoxelFieldShape` (with an optional per-shape `materials` array), `b3Shape_GetVoxelField`, `b3ShapeType.b3_voxelShape`, readback via `b3GetVoxelFieldInfo` / `b3GetVoxelFieldBits` / `b3GetVoxelFieldMaterialIndices` / `b3IsVoxelSolid`, and local-space queries `b3RayCastVoxelField`, `b3ShapeCastVoxelField`, `b3OverlapVoxelField`, `b3QueryVoxelField`, `b3ComputeVoxelFieldAABB`.
- Emscripten pinned to 6.0.9 (was 6.0.2).
- Examples: a Voxel Field example; the generic renderer draws voxel shapes.
```

If Task 1 removed any bindings because the engine dropped them, add a `- **Breaking:** removed …` bullet listing them.

- [ ] **Step 6: Full rebuild, test, docs, lint**

```bash
pnpm build 2>&1 | tail -12 && pnpm test && pnpm docs:check && pnpm docs:build && pnpm check
pnpm --filter @box3d/examples build 2>&1 | tail -5
git status --short
```

Expected: all pass; README.md shows `npm install @liamdon/box3d.js` and `from '@liamdon/box3d.js'` in snippets; `git status` lists `dist/*`, `README.md`, and the edited files, nothing under `build/` or `examples/dist/`.

- [ ] **Step 7: Dry-run the publish**

```bash
pnpm publish --dry-run --no-git-checks 2>&1 | tail -25
```

Expected: the tarball contents list only `dist/*`, `package.json`, `README.md`, `LICENSE`, `LICENSE-box3d`, `CHANGELOG.md`, with the name `@liamdon/box3d.js@0.2.0`.

- [ ] **Step 8: Commit dist and metadata**

```bash
git add package.json examples/package.json docs/package.json pnpm-lock.yaml docs/build.js docs/README.template.md README.md CHANGELOG.md dist
git commit -m "feat: v0.2.0 — publish as @liamdon/box3d.js"
```

- [ ] **Step 9: Hand off**

Report to the user:
- the submodule hash pinned in Task 1,
- any bindings removed in Task 1,
- that publishing is manual: `npm login` (account must own the `@liamdon` scope), then `pnpm publish` from the repo root, then `git tag v0.2.0 && git push origin voxel-fork --tags`,
- that GitHub Pages must be enabled on the fork for the example links in the README to resolve.

Do not publish or push without the user's go-ahead.

---

## Self-review notes

- Spec §1 → Task 1. §2 → Task 2. §3 → Task 3. §4 → Task 4. §5 → Task 5 (renderer, example, screenshot) and Task 6 (docs). §6 → Task 7. §7 → tests in Tasks 2–4. Error handling section → Task 2 Step 4 validations and the `assert.throws` cases.
- Deviation from spec §2: `b3ComputeVoxelFieldAABB(field, transform)` returns the AABB by value instead of using the out-param DSL, matching the existing `b3ComputeHullAABB` binding (the out-param DSL cannot take raw-pointer arguments).
- Deviation from spec §7: the smoke test runs on the two variants the existing test runs (separate-wasm, inline). The MT variants are not exercised by `pnpm test` today and adding Node worker setup is out of scope.
- Names used across tasks: `jsThrow` (T2, used T2 only), `VoxelFieldInfo` (T2 type, T5 consumer), `voxelFieldGeometry` (T5), `paramRetypes` (T2, extended T3/T4).
