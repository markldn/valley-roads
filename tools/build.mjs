#!/usr/bin/env node
// Builds the smallest plain version of the game into dist/: index.html, game.js, engine-worklet.js.
//
//   npm install && npm run build
//
// The source tree stays runnable as it is. Stages:
//   1. Bundle against the unminified three.js of the same release as src/vendor/.
//   2. Remove renderer features the game never uses (GLSL branches, WebXR, morph targets).
//   3. Remove every class method that nothing in the bundle can reach.
//   4. Minify JS, GLSL, CSS and HTML.
//
// If the game starts using a feature listed in UNUSED_MACROS or UNUSED_CHUNKS
// (a normal map, say), delete it from the list or the feature renders as nothing.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as esbuild from 'esbuild';
import { minify as terser } from 'terser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = path.join(ROOT, 'node_modules/three');
const DIST = path.join(ROOT, 'dist');

const UNUSED_MACROS = new Set(`USE_SKINNING USE_MORPHTARGETS USE_MORPHNORMALS USE_MORPHCOLORS USE_BATCHING
  USE_BATCHING_COLOR USE_LIGHTMAP USE_AOMAP USE_BUMPMAP USE_NORMALMAP USE_NORMALMAP_TANGENTSPACE
  USE_NORMALMAP_OBJECTSPACE USE_DISPLACEMENTMAP USE_IRIDESCENCE USE_IRIDESCENCEMAP
  USE_IRIDESCENCE_THICKNESSMAP USE_ANISOTROPY USE_ANISOTROPYMAP USE_SHEEN USE_SHEEN_COLORMAP
  USE_SHEEN_ROUGHNESSMAP USE_TRANSMISSION USE_TRANSMISSIONMAP USE_THICKNESSMAP USE_DISPERSION
  USE_ALPHAHASH USE_ALPHAMAP USE_ROUGHNESSMAP USE_METALNESSMAP USE_SPECULARMAP USE_SPECULAR_COLORMAP
  USE_SPECULAR_INTENSITYMAP USE_CLEARCOATMAP USE_CLEARCOAT_ROUGHNESSMAP USE_CLEARCOAT_NORMALMAP
  USE_GRADIENTMAP USE_MATCAP USE_TANGENT USE_POINTS_UV USE_REVERSED_DEPTH_BUFFER
  SHADOWMAP_TYPE_VSM SHADOWMAP_TYPE_BASIC`.split(/\s+/));

// Shader programs for material types the game never creates.
const UNUSED_CHUNKS = new Set(`meshphong_vert meshphong_frag meshtoon_vert meshtoon_frag meshmatcap_vert
  meshmatcap_frag meshnormal_vert meshnormal_frag sprite_vert sprite_frag linedashed_vert linedashed_frag
  points_vert points_frag vsm_vert vsm_frag`.split(/\s+/));

const kb = n => (n / 1024).toFixed(1).padStart(8) + ' KB';
const report = (label, bytes) => console.log(label.padEnd(34) + kb(bytes));

// ---- GLSL ------------------------------------------------------------------

// Value of a preprocessor condition: false, true, or null when it depends on the program.
function evaluate(condition) {
  let text = condition.trim();
  for (;;) {
    let depth = 0, wraps = text.startsWith('(') && text.endsWith(')');
    for (let i = 0; wraps && i < text.length - 1; i++) {
      depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
      if (depth === 0) wraps = false;
    }
    if (!wraps) break;
    text = text.slice(1, -1).trim();
  }
  const split = operator => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
      if (depth === 0 && text.startsWith(operator, i)) { parts.push(text.slice(start, i)); start = i + 2; i++; }
    }
    parts.push(text.slice(start));
    return parts;
  };
  const any = split('||');
  if (any.length > 1) {
    const values = any.map(evaluate);
    return values.includes(true) ? true : values.every(value => value === false) ? false : null;
  }
  const all = split('&&');
  if (all.length > 1) {
    const values = all.map(evaluate);
    return values.includes(false) ? false : values.every(value => value === true) ? true : null;
  }
  const negated = text.match(/^!\s*(.+)$/s);
  if (negated) { const value = evaluate(negated[1]); return value === null ? null : !value; }
  const defined = text.match(/^defined\s*\(?\s*(\w+)\s*\)?$/);
  if (defined && UNUSED_MACROS.has(defined[1])) return false;
  if (/^NUM_CLIPPING_PLANES\s*>\s*0$/.test(text)) return false;
  return null;
}

// Drops the conditional branches that can never be compiled.
function pruneBranches(source) {
  const output = [];
  const stack = [];
  const live = () => stack.every(frame => frame.emit);
  for (const line of source.split('\n')) {
    const directive = line.trim().match(/^#\s*(ifdef|ifndef|if|elif|else|endif)\b\s*(.*)$/);
    if (!directive) { if (live()) output.push(line); continue; }
    const [, keyword, rest] = directive;
    if (keyword === 'if' || keyword === 'ifdef' || keyword === 'ifndef') {
      const value = keyword === 'if' ? evaluate(rest)
        : UNUSED_MACROS.has(rest.trim()) ? keyword === 'ifndef' : null;
      const frame = { emit: value !== false, taken: value === true, open: false };
      const parentLive = live();
      stack.push(frame);
      if (value === null && parentLive) { output.push(line); frame.open = true; }
    } else if (keyword === 'elif' || keyword === 'else') {
      const frame = stack.at(-1);
      const value = frame.taken ? false : keyword === 'else' ? true : evaluate(rest);
      const parentLive = stack.slice(0, -1).every(item => item.emit);
      frame.emit = value !== false;
      if (value !== false && parentLive) {
        if (frame.open) output.push(value === true ? '#else' : line);
        else if (value === null) { output.push('#if ' + rest); frame.open = true; }
      }
      if (value === true) frame.taken = true;
    } else {
      const frame = stack.pop();
      if (frame.open && live()) output.push(line);
    }
  }
  return output.join('\n');
}

// Removes comments and spacing. Directive lines stay on their own line, unchanged.
function squeezeGlsl(source) {
  const lines = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
  let output = '', directive = true;
  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('#')) { output += (directive ? '' : '\n') + line + '\n'; directive = true; continue; }
    const tight = line.replace(/\s+/g, ' ').replace(/ ?([{}();,=*/<>!?:&|[\]]) ?/g, '$1');
    output += (!directive && /\w$/.test(output) && /^\w/.test(tight) ? ' ' : '') + tight;
    directive = false;
  }
  return output;
}

const looksLikeGlsl = text => text.includes('\n') && text.includes(';')
  && /\b(vec[234]|mat[34]|uniform|varying|gl_\w+|#include)\b|#include/.test(text);

// ---- three.js patches ------------------------------------------------------

// Text range of a top-level `class Name` or `function Name`.
function declarationRange(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`three.js patch no longer applies: ${marker}`);
  const node = acorn.parseExpressionAt(source, start, { ecmaVersion: 'latest', sourceType: 'module' });
  return [start, node.end];
}

function patchRenderer(source) {
  const chunkNames = new Map();
  for (const [, chunk, variable] of source.matchAll(/^\s*(\w+): ([\w$]+),?$/gm)) chunkNames.set(variable, chunk);
  let patched = source.replace(/^var ([\w$]+) = ("(?:[^"\\\n]|\\.)*");$/gm, (whole, name, literal) => {
    if (UNUSED_CHUNKS.has(chunkNames.get(name))) return `var ${name} = "";`;
    const text = JSON.parse(literal);
    return text.includes('\n') && (looksLikeGlsl(text) || text.startsWith('#')) ? `var ${name} = ${JSON.stringify(squeezeGlsl(pruneBranches(text)))};` : whole;
  });
  const [xrStart, xrEnd] = declarationRange(patched, 'class WebXRManager extends EventDispatcher');
  patched = patched.slice(0, xrStart) + `class WebXRManager extends EventDispatcher {
    enabled = false; isPresenting = false; cameraAutoUpdate = false;
    getEnvironmentBlendMode() {} setAnimationLoop() {} dispose() {}
    updateCamera() {} getCamera() {} getDepthSensingMesh() {} hasDepthSensing() { return false; }
  }` + patched.slice(xrEnd);
  const [morphStart, morphEnd] = declarationRange(patched, 'function WebGLMorphtargets(');
  patched = patched.slice(0, morphStart) + 'function WebGLMorphtargets() { return { update() {} }; }' + patched.slice(morphEnd);
  return patched;
}

// ---- Dead method removal ---------------------------------------------------

function walk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else if (value && typeof value.type === 'string') walk(value, visit, node);
  }
}

// A method survives if its name is mentioned anywhere reachable, as a property or a string.
function removeDeadMethods(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const methods = [];
  const collect = (node, into) => walk(node, child => {
    if (child.type === 'MemberExpression' && !child.computed) into.add(child.property.name);
    else if (child.type === 'Property' && !child.computed) into.add(child.key.name ?? String(child.key.value));
    else if (child.type === 'Literal' && typeof child.value === 'string') into.add(child.value);
    else if (child.type === 'MethodDefinition' && child !== node && isCandidate(child)) {
      methods.push(child);
      return false;
    }
  });
  const isCandidate = node => node.kind === 'method' && !node.computed && node.key.type === 'Identifier'
    && !['toString', 'valueOf', 'toJSON', 'handleEvent', 'then'].includes(node.key.name);
  const alive = new Set();
  collect(ast, alive);
  const references = new Map();
  for (let index = 0; index < methods.length; index++) {
    const names = new Set();
    collect(methods[index].value, names);
    references.set(methods[index], names);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const method of methods) {
      if (!alive.has(method.key.name)) continue;
      for (const name of references.get(method)) if (!alive.has(name)) { alive.add(name); changed = true; }
    }
  }
  const dead = methods.filter(method => !alive.has(method.key.name)).sort((a, b) => b.start - a.start);
  let output = source;
  for (const method of dead) output = output.slice(0, method.start) + output.slice(method.end);
  return { output, removed: dead.length };
}

// Minifies GLSL held in the game's own strings and templates.
function squeezeEmbeddedGlsl(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const edits = [];
  const light = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line, index) => {
    const bare = line.replace(/\/\/.*$/, '');
    const trimmed = index ? bare.trim() : bare.trimEnd();
    return trimmed.trim().startsWith('#') ? trimmed
      : trimmed.replace(/[ \t]+/g, ' ').replace(/ ?([{}();,=*/<>!?:&|[\]]) ?/g, '$1');
  }).filter((line, index, all) => line || index === 0 || index === all.length - 1).join('\n');
  walk(ast, node => {
    if (node.type === 'Literal' && typeof node.value === 'string' && looksLikeGlsl(node.value)) {
      edits.push([node.start, node.end, JSON.stringify(light(node.value))]);
    } else if (node.type === 'TemplateLiteral') {
      const text = node.quasis.map(quasi => quasi.value.raw).join('');
      const unsafe = node.quasis.slice(0, -1).some(quasi => quasi.value.raw.split('\n').at(-1).includes('//'));
      if (looksLikeGlsl(text) && !unsafe) {
        for (const quasi of node.quasis) edits.push([quasi.start, quasi.end, light(quasi.value.raw)]);
      }
    }
  });
  let output = source;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) output = output.slice(0, start) + text + output.slice(end);
  return output;
}

// ---- Bundle ----------------------------------------------------------------

async function bundle() {
  const three = path.join(THREE, 'build/three.module.js');
  const plugin = {
    name: 'valley-roads',
    setup(build) {
      build.onResolve({ filter: /^three$|vendor\/three\.module\.js$/ }, () => ({ path: three }));
      build.onResolve({ filter: /^three\/addons\// }, args => ({ path: path.join(THREE, 'examples/jsm', args.path.slice(13)) }));
      build.onResolve({ filter: /vendor\/jsm\// }, args => ({ path: path.join(THREE, 'examples/jsm', args.path.split('vendor/jsm/')[1]) }));
      build.onLoad({ filter: /three\.module\.js$/ }, args => ({ contents: patchRenderer(fs.readFileSync(args.path, 'utf8')), loader: 'js' }));
      // The worklet stays a separate file next to game.js.
      build.onLoad({ filter: /drive\/audio\/audio\.js$/ }, args => {
        const source = fs.readFileSync(args.path, 'utf8');
        const from = "import('./engine-worklet.js')";
        if (!source.includes(from)) throw new Error(`audio.js patch no longer applies: ${from}`);
        return { contents: source.replace(from, "import(new URL('./engine-worklet.js', import.meta.url).href)"), loader: 'js' };
      });
    },
  };
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/game.js')], bundle: true, write: false, format: 'esm', target: 'es2022',
    treeShaking: true, legalComments: 'none', plugins: [plugin],
  });
  return result.outputFiles[0].text;
}

async function shrink(source) {
  const { output, removed } = removeDeadMethods(source);
  console.log(`  ${removed} unreachable methods removed`);
  return (await esbuild.transform(output, { format: 'esm', target: 'es2022', treeShaking: true, legalComments: 'none' })).code;
}

// ---- Page ------------------------------------------------------------------

async function buildPage() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = (await esbuild.transform(html.match(/<style>([\s\S]*?)<\/style>/)[1], { loader: 'css', minify: true })).code.trim();
  const start = (await terser(`import('./game.js').catch(e=>{const m=document.querySelector('#error');m.hidden=false;m.textContent=location.protocol==='file:'?'Open the game through an HTTP server.':'The driving view could not start. '+(e?.message||String(e));console.error(e)})`, { module: true })).code;
  // The page keeps its small loading script; the import map goes away (the bundle needs none) and the
  // module script becomes the bundled start-up.
  const loader = html.match(/<script>([\s\S]*?)<\/script>/);
  const loaderMin = loader ? (await terser(loader[1], { ecma: 2022, compress: true, mangle: true })).code : '';
  return html.replace(/<style>[\s\S]*?<\/style>/, () => `<style>${css}</style>`)
    .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
    .replace(/<script>[\s\S]*?<\/script>/, () => `<script>${loaderMin}</script>`)
    .replace(/<script type="module">[\s\S]*?<\/script>/, () => `<script type=module>${start}</script>`)
    .replace(/>\s*\n\s*</g, '><').trim();
}

// ---- Main ------------------------------------------------------------------

const started = Date.now();
const bundled = await bundle();
report('Bundled, renderer trimmed', Buffer.byteLength(bundled));
const reduced = await shrink(bundled);
report('Unreachable methods removed', Buffer.byteLength(reduced));
const embedded = squeezeEmbeddedGlsl(reduced);
const minified = await terser(embedded, {
  module: true, ecma: 2022, toplevel: true,
  compress: { passes: 3, unsafe_arrows: false, pure_getters: false, keep_fargs: false },
  mangle: { toplevel: true, properties: { regex: /^_[a-zA-Z]/, keep_quoted: true } },
  format: { comments: false, ascii_only: false },
});
const worklet = (await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/drive/audio/engine-worklet.js')],
  bundle: true, minify: true, write: false, format: 'esm', target: 'es2022', legalComments: 'none',
})).outputFiles[0].text;
const version = crypto.createHash('sha1').update(minified.code).update(worklet).digest('hex').slice(0, 10);
const page = (await buildPage()).replace(/import\((['"])\.\/game\.js\1\)/, `import("./game.js?v=${version}")`);
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'game.js'), minified.code);
fs.writeFileSync(path.join(DIST, 'engine-worklet.js'), worklet);
fs.writeFileSync(path.join(DIST, 'index.html'), page);
report('dist/game.js', Buffer.byteLength(minified.code));
report('dist/engine-worklet.js', Buffer.byteLength(worklet));
report('dist/index.html', Buffer.byteLength(page));
report('Total', Buffer.byteLength(minified.code) + Buffer.byteLength(worklet) + Buffer.byteLength(page));
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
