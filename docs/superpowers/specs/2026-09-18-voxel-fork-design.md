# box3d.js fork: voxel field support and `@liamdon/box3d.js` publishing

Date: 2026-09-18
Status: approved design, awaiting implementation plan

## Goal

Build this repository against the `liamdon/box3d` fork (which adds a voxel
field shape to the engine), expose that shape through the JS/TypeScript
bindings with a generic public API, and publish the result to npm as
`@liamdon/box3d.js`.

The API is designed as a public library surface, not for any single consumer.

## Non-goals

- Upstreaming any of this to `isaac-mason/box3d.js` or `erincatto/box3d`.
- Materials on mesh or height-field shapes. The voxel design defines the
  shape of that API (an optional `materials` array on the shape-creation
  call); wiring it into `b3CreateMeshShape` / `b3CreateHeightFieldShape` is
  deferred.
- A CI publish workflow. Publishing stays manual.

## Current state (as of this design)

- `vendor/box3d` is a git submodule pinned to `erincatto/box3d` at `8441b4a`.
- `liamdon/box3d` branch `voxel-field` contains that commit as an ancestor,
  23 newer upstream commits, and 10 voxel commits.
- `scripts/build.mjs` pins Emscripten to 6.0.2 and refuses other versions.
  The locally installed em++ is 6.0.9.
- `dist/` is committed to git and is what `npm publish` ships. CI only builds
  the examples for GitHub Pages; it does not build wasm.
- Nothing voxel-related exists in `src/bindings.cpp`. `b3ShapeDef.materials`
  and `materialCount` are not bound for any shape type. No shape type has
  local-space (field-level) queries bound; queries go through world, body,
  or shape-level functions.

## 1. Toolchain and engine source

- Bump `REQUIRED_EMSDK` in `scripts/build.mjs` to `6.0.9`. The ESM
  post-processing in `validateESModule()` pattern-matches Emscripten output
  and throws on any missed rewrite, so a clean build is the verification.
- Change `.gitmodules` so `vendor/box3d` points at
  `https://github.com/liamdon/box3d.git`, tracking branch `voxel-field`,
  pinned at that branch's current head.
- Fix any existing binding breakage caused by the 23 upstream commits.
- Gate: `pnpm build` and `pnpm test` pass on all four variants (separate
  wasm, inline, MT, MT inline) before voxel work begins.

## 2. Voxel field data API

Mirrors the existing mesh and height-field binding pattern.

| Binding | Notes |
|---|---|
| `class b3VoxelFieldData` | Opaque. JS owns it; call `.delete()` after destroying. Must outlive any shape that references it (same rule as meshes and height fields). |
| `b3CreateVoxelField(voxels, materialIndices, scale, countX, countY, countZ, hasBorder): b3VoxelFieldData` | `voxels`: `Uint8Array`, one byte per voxel, non-zero = solid, index `x + countX * (y + countY * z)`. `materialIndices`: `Uint8Array` or `null`, one byte per voxel indexing the shape's material table. Both are copied into wasm during the call; the caller's arrays are free afterwards. `scale` is `b3Vec3`. |
| `b3DestroyVoxelField(field)` | |
| `b3CreateVoxelWave(countX, countY, countZ, offsetX, offsetZ, scale, frequencyX, frequencyZ, hasBorder): b3VoxelFieldData` | Test terrain generator from the engine. |
| `b3ComputeVoxelFieldAABB(out, field, transform): b3AABB` | Out-param reader, per the existing `out_function` DSL. |
| `b3GetVoxelFieldInfo(field): VoxelFieldInfo` | Plain object `{ countX, countY, countZ, solidCount, hasBorder, scale: b3Vec3, aabb: b3AABB }`. Allocating; intended for setup, not per-frame use. |
| `b3GetVoxelFieldBits(field): Uint8Array` | Copy of the packed occupancy bits (one bit per voxel, LSB first). |
| `b3GetVoxelFieldMaterialIndices(field): Uint8Array` | Copy of the per-voxel material indices, or an empty array if the field has none. |
| `b3IsVoxelSolid(field, x, y, z): boolean` | Out-of-range coordinates return false. |

## 3. Shape API

- `b3ShapeType` enum gains `b3_voxelShape`.
- `b3CreateVoxelFieldShape(bodyId, shapeDef, field, materials?): b3ShapeId`.
  `materials` is an optional array of `b3SurfaceMaterial`. When provided it
  is copied into a local vector and set as `def.materials` /
  `def.materialCount` before calling the engine; the engine clones the
  definition, so the vector is a temporary. When omitted the shape uses
  `shapeDef.baseMaterial` for every voxel and material indices are ignored.
  Voxel shapes are only valid on static bodies (engine rule; not re-checked
  in the bindings).
- `b3Shape_GetVoxelField(shapeId): b3VoxelFieldData` so renderers and tools
  can reach the field from a shape.

The optional `materials` argument is the intended shape for mesh and
height-field materials later; those call sites are not changed here.

## 4. Local-space queries

A self-contained set operating on the raw field, independent of any world.
Point clouds use the existing `Float32Array` of local points plus radius
convention (`b3ShapeProxy`).

| Binding | Returns |
|---|---|
| `b3RayCastVoxelField(field, origin, translation, maxFraction)` | `b3CastOutput` (already registered) |
| `b3ShapeCastVoxelField(field, points, radius, translation, maxFraction, canEncroach)` | `b3CastOutput` |
| `b3OverlapVoxelField(field, transform, points, radius)` | `boolean` |
| `b3QueryVoxelField(field, aabb, callback)` | `void`. `callback(a: b3Vec3, b: b3Vec3, c: b3Vec3, triangleIndex: number) => boolean`; return `false` to stop. Each exposed face yields two triangles. |

World, body, and shape-level queries (`b3World_CastRay`, `b3Shape_RayCast`,
etc.) work on voxel shapes with no binding changes.

## 5. Examples, renderer, docs

- `examples/src/box3d-three.ts`: add a `b3_voxelShape` case to
  `geometryFor()`. Read the field back via `b3Shape_GetVoxelField` +
  `b3GetVoxelFieldInfo` + `b3GetVoxelFieldBits`, and build a merged
  `BufferGeometry` of exposed faces (skip faces whose neighbour is solid,
  and skip border voxels when `hasBorder`). Rendering stays static; fields
  are immutable once created.
- New example `example-voxel-field`: a `b3CreateVoxelWave` terrain with a
  hand-built field showing a hole and per-voxel materials, dynamic shapes
  dropped onto it, and a ray cast drawn against it. Registered in
  `examples/src/examples.json`; screenshot produced with the existing
  screenshot script.
- `docs/shapes.ts`: a `voxel` snippet. `docs/README.template.md`: a voxel
  entry after the height-field entry, plus the lifetime rule extended to
  `b3VoxelFieldData`.

## 6. Package identity and publishing

- `package.json`: `name` → `@liamdon/box3d.js`; `repository`, `homepage`,
  `bugs` → `liamdon/box3d.js`; `version` → `0.2.0`. `exports`, `files`, and
  scripts unchanged. Keep the upstream author credited (add a `contributors`
  entry rather than replacing `author`).
- `examples/package.json`: depend on
  `"box3d.js": "workspace:@liamdon/box3d.js@*"` so example and docs imports
  of `box3d.js` stay untouched and upstream merges stay clean.
- `docs/build.js`: `EXAMPLES_BASE_URL` → `https://liamdon.github.io/box3d.js/`.
- `CHANGELOG.md`: a `v0.2.0` entry noting the fork, the engine source, the
  Emscripten bump, and the voxel API.
- Publishing: `pnpm build`, `pnpm test`, commit `dist/`, then
  `pnpm publish --access public`. Manual.
- Ongoing sync: merge upstream into the fork's `voxel-field` branch, bump
  the submodule pin here, rebuild, commit `dist/`, publish.

## 7. Testing

`test/smoke.mjs` gains a voxel case run on all four variants:

- Build a small field (for example 4×3×4 with a border) with one interior
  column removed. Drop a sphere over a solid column and assert its rest
  height is within tolerance of the voxel top. Drop a sphere over the hole
  and assert it falls below the field.
- Create a wave field. Cast a ray at it locally with
  `b3RayCastVoxelField` and through the world with `b3World_CastRay`, and
  assert the two hit fractions agree.
- Create a shape with a two-entry `materials` array and per-voxel indices;
  assert creation succeeds and `b3GetVoxelFieldMaterialIndices` round-trips.
- Assert `b3IsVoxelSolid` and `b3GetVoxelFieldInfo` agree with the input.
- Destroy the field, `.delete()` the handle, and confirm the world still
  steps and destroys cleanly.

## Error handling

- Mismatched array lengths (`voxels.length !== countX*countY*countZ`,
  or a non-null `materialIndices` of the wrong length) throw a JS `Error`
  from the binding before touching the engine.
- Non-positive counts or scale components throw likewise.
- Everything else defers to the engine's own validation.
