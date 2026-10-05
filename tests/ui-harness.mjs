import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');

// RN and native motion/measurement are unavailable in Node. Keep the real
// component's render branches and handlers, with deterministic hook lifetimes.
export function componentHarness(relative, dependencies = {}, expose = [], runtime = {}) {
  let cursor = 0, effects = [], slots = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    memo: component => component,
    forwardRef: component => props => component(props, props.ref),
    useRef: initial => {const i = cursor++; return slots[i] ??= {current: initial};},
    useState: initial => {const i = cursor++; slots[i] ??= {value: initial}; return [slots[i].value, value => {slots[i].value = typeof value === 'function' ? value(slots[i].value) : value;}];},
    useCallback: (callback, deps) => react.useMemo(() => callback, deps),
    useMemo: (factory, deps) => {const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = {deps, value: factory()}; return slots[i].value;},
    useEffect: (action, deps) => {const i = cursor++; if (changed(slots[i]?.deps, deps)) effects.push(() => {slots[i]?.cleanup?.(); slots[i] = {deps, cleanup: action()};});},
    useImperativeHandle: (ref, create, deps) => react.useEffect(() => {ref.current = create(); return () => {ref.current = null;};}, deps),
    createContext: value => ({value, Provider: 'Provider'}),
    useContext: context => context.value,
  };
  const native = {Pressable: 'Pressable', View: 'View', Text: 'Text', StyleSheet: {create: value => value, absoluteFill: {}, absoluteFillObject: {}}};
  const filename = new URL(relative, import.meta.url), module = {exports: {}};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n${expose.map(name => `exports.${name}=${name};`).join('\n')}})`, {console, setInterval, clearInterval, ...runtime})(name => {
    if (name === 'react') return {...react, ...dependencies.react};
    if (name === 'react-native') return {...native, ...dependencies[name]};
    if (name in dependencies) return dependencies[name];
    throw Error(`Explicit native boundary required: ${name}`);
  }, module, module.exports);
  return {exports: module.exports, render(name, props) {cursor = 0; effects = []; const tree = module.exports[name](props); effects.forEach(effect => effect()); return tree;}, cleanup() {slots.forEach(slot => slot?.cleanup?.());}};
}
export const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(tree.props?.children ?? []).flat(Infinity).flatMap(nodes)];
export const byID = (tree, id) => nodes(tree).find(node => node.props?.testID === id);
