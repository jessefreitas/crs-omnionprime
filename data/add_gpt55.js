const fs = require('fs');
const F = '/app/src/services/modelService.js';
let src = fs.readFileSync(F, 'utf8');
if (src.includes("'gpt-5.5'")) { console.log('already has gpt-5.5'); process.exit(0); }
// Insert into openai models array (anchor: existing line with gpt-5.4)
const anchor = "          'gpt-5.4',\n          'gpt-5.4-pro'";
if (!src.includes(anchor)) {
  console.log('anchor not found, trying alternative');
  // alternative: insert before gpt-5.4 line wherever it is
  src = src.replace(/(\s*)'gpt-5\.4',/, "$1'gpt-5.5',$1'gpt-5.5-codex',$1'gpt-5.4',");
} else {
  src = src.replace(anchor, "          'gpt-5.5',\n          'gpt-5.5-codex',\n          'gpt-5.4',\n          'gpt-5.4-pro'");
}
fs.writeFileSync(F, src);
console.log('patched');
