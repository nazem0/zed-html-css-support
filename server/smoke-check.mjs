const SELECTOR_RE =
  /([.#])(-?[_a-zA-Z]+[\\!+_a-zA-Z0-9-]*)(?=[#.,()\s\[\]\^:*"'>=_a-zA-Z0-9-]*{[^}]*})/g;
const text = ".btn { color:red } #main { } .foo-bar { }";
const out = [];
let m;
while ((m = SELECTOR_RE.exec(text))) out.push(m[1] + m[2]);
if (!out.includes(".btn") || !out.includes("#main") || !out.includes(".foo-bar")) {
  console.error("FAIL", out);
  process.exit(1);
}
console.log("ok", out.join(", "));
