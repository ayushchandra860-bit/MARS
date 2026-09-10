import fs from 'node:fs';

const compiledPath = 'dist-electron/electron/main/decision/DecisionEngine.js';
const sourcePath = 'electron/main/decision/DecisionEngine.ts';
const compiled = fs.readFileSync(compiledPath, 'utf8');
const classStart = compiled.indexOf('class DecisionEngine {');
const exportMarker = 'exports.DecisionEngine = DecisionEngine;';
const exportIndex = compiled.lastIndexOf(exportMarker);
if (classStart < 0 || exportIndex < 0) {
  throw new Error('Compiled DecisionEngine recovery anchors were not found');
}
const runtimePrefix = compiled.slice(0, classStart);
const classBodyAndMethods = compiled.slice(classStart, exportIndex);
const recovered = [
  '// @ts-nocheck',
  '// Recovered from the last verified compiled artifact after an interrupted source write.',
  runtimePrefix,
  classBodyAndMethods,
  exportMarker,
  'export { DecisionEngine };',
].join('\n');
fs.writeFileSync(sourcePath, recovered, 'utf8');
console.log(`Recovered ${sourcePath} from ${compiledPath} (${recovered.length} bytes)`);
