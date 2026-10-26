// A formula as written on paper, parsed into a tree and evaluated without eval: numbers, + - * / ^, brackets, a
// number written before a name or a bracket (2x, 3(x - 1)), a few functions and constants, and variables given by the
// caller. A name that is none of these is an error: no object's property is ever reached. Pure.

const FUNCS = Object.assign(Object.create(null), {
  sin: [Math.sin, 1], cos: [Math.cos, 1], tan: [Math.tan, 1], asin: [Math.asin, 1], acos: [Math.acos, 1],
  atan: [Math.atan, 1], atan2: [Math.atan2, 2], sinh: [Math.sinh, 1], cosh: [Math.cosh, 1], tanh: [Math.tanh, 1],
  exp: [Math.exp, 1], ln: [Math.log, 1], log: [Math.log, 1], log10: [Math.log10, 1], log2: [Math.log2, 1],
  sqrt: [Math.sqrt, 1], abs: [Math.abs, 1], floor: [Math.floor, 1], ceil: [Math.ceil, 1], round: [Math.round, 1],
  sign: [Math.sign, 1], pow: [Math.pow, 2], min: [Math.min, -1], max: [Math.max, -1], hypot: [Math.hypot, -1],
});
export const CONSTANTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E, tau: 2 * Math.PI });
export const FUNCTION_NAMES = Object.keys(FUNCS);

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]), at: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0], at: i }); i += id[0].length; continue; }
    if ("+-*/^(),".includes(c)) { out.push({ t: c, at: i }); i++; continue; }
    throw new SyntaxError(`'${c}' at position ${i} is not part of a formula`);
  }
  return out;
}

export function parse(src) {
  const toks = tokenize(String(src));
  let k = 0;
  const peek = () => toks[k];
  const take = (t) => {
    const tok = toks[k];
    if (!tok) throw new SyntaxError(t ? `the formula ends where '${t}' was expected` : "the formula ends too soon");
    if (t && tok.t !== t) throw new SyntaxError(`expected '${t}' at position ${tok.at}`);
    k++;
    return tok;
  };
  const expr = () => {
    let a = term();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = take().t;
      a = { type: "bin", op, a, b: term() };
    }
    return a;
  };
  const startsOperand = (tok) => tok && (tok.t === "num" || tok.t === "id" || tok.t === "(");
  const term = () => {
    let a = unary();
    for (;;) {
      const tok = peek();
      if (tok && (tok.t === "*" || tok.t === "/")) {
        take();
        a = { type: "bin", op: tok.t, a, b: unary() };
      } else if (startsOperand(tok)) {
        a = { type: "bin", op: "*", a, b: unary() };      // 2x, 3(x - 1), a b
      } else return a;
    }
  };
  const unary = () => {
    const tok = peek();
    if (tok && (tok.t === "-" || tok.t === "+")) {
      take();
      const a = unary();
      return tok.t === "-" ? { type: "neg", a } : a;
    }
    return power();
  };
  const power = () => {
    const base = primary();
    if (peek() && peek().t === "^") {
      take();
      return { type: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  };
  const primary = () => {
    const tok = take();
    if (tok.t === "num") return { type: "num", value: tok.v };
    if (tok.t === "id") {
      if (FUNCS[tok.v] && peek() && peek().t === "(") {
        take("(");
        const args = [expr()];
        while (peek() && peek().t === ",") { take(","); args.push(expr()); }
        take(")");
        const arity = FUNCS[tok.v][1];
        if (arity > 0 && args.length !== arity) {
          throw new SyntaxError(`${tok.v} takes ${arity} argument${arity > 1 ? "s" : ""}, not ${args.length}`);
        }
        return { type: "call", name: tok.v, args };
      }
      return { type: "var", name: tok.v };
    }
    if (tok.t === "(") {
      const a = expr();
      take(")");
      return a;
    }
    throw new SyntaxError(`unexpected '${tok.t}' at position ${tok.at}`);
  };
  if (!toks.length) throw new SyntaxError("the formula is empty");
  const tree = expr();
  if (k < toks.length) throw new SyntaxError(`unexpected '${toks[k].v ?? toks[k].t}' at position ${toks[k].at}`);
  return tree;
}

function value(node, vars) {
  switch (node.type) {
    case "num": return node.value;
    case "neg": return -value(node.a, vars);
    case "var": {
      const n = node.name;
      if (vars && Object.prototype.hasOwnProperty.call(vars, n) && typeof vars[n] === "number") return vars[n];
      if (CONSTANTS[n] !== undefined) return CONSTANTS[n];
      throw new ReferenceError(`'${n}' has no value`);
    }
    case "call": return FUNCS[node.name][0](...node.args.map((a) => value(a, vars)));
    case "bin": {
      const a = value(node.a, vars), b = value(node.b, vars);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        default: return a ** b;
      }
    }
    default: throw new Error("not a formula");
  }
}

export function evaluate(src, vars = {}) {
  return value(parse(src), vars);
}

export function compile(src) {
  const tree = parse(src);
  return (vars = {}) => value(tree, vars);
}

// The names a formula leaves free, without its constants: these become the sliders.
export function freeVars(tree) {
  const out = new Set();
  const walk = (n) => {
    if (n.type === "var" && CONSTANTS[n.name] === undefined) out.add(n.name);
    if (n.a) walk(n.a);
    if (n.b) walk(n.b);
    if (n.args) n.args.forEach(walk);
  };
  walk(tree);
  return [...out].sort();
}
