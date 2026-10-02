#!/usr/bin/env node
/**
 * Meshopt-compress the shipping GLBs in place (EXT_meshopt_compression,
 * FILTER method). Positions and UVs stay float32 and normals become
 * normalized int8 (declared via KHR_mesh_quantization). There is no
 * node-transform rewrite: the 42 part nodes
 * keep translation [0, baseY, 0] and unit scale, which the runtime
 * explode/spring code drives directly.
 *
 * Run after build_pencil.py:  node scripts/asset-processing/compress_glb.mjs [file.glb ...]
 * Decode mode (used by validate_glb.py):  ... --decode <in.glb> <out.glb>
 * The runtime registers MeshoptDecoder in src/three/assembly.ts.
 */
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization, ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { reorder } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import { statSync } from 'node:fs'

if (process.argv[2] === '--decode') {
  await MeshoptDecoder.ready
  const dio = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  const doc = await dio.read(process.argv[3])
  doc.getRoot().listExtensionsUsed().forEach((e) => {
    if (e.extensionName === 'EXT_meshopt_compression') e.dispose()
  })
  await dio.write(process.argv[4], doc)
  process.exit(0)
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['public/models/desktop/mechanical-pencil.glb', 'public/models/mobile/mechanical-pencil-mobile.glb']

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

for (const f of files) {
  const before = statSync(f).size
  const doc = await io.read(f)
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) {
    console.log(`${f}: already compressed, skipped`)
    continue
  }
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }))
  // the FILTER encoder stores normals as normalized int8
  doc.createExtension(KHRMeshQuantization).setRequired(true)
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
  await io.write(f, doc)
  console.log(`${f}: ${(before / 1048576).toFixed(2)} MB -> ${(statSync(f).size / 1048576).toFixed(2)} MB`)
}
