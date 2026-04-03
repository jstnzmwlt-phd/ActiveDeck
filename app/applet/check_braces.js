const fs = require('fs');
const content = fs.readFileSync('src/components/ChatSidebar.tsx', 'utf8');

let stack = [];
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  for (let j = 0; j < line.length; j++) {
    let char = line[j];
    if (char === '{') stack.push({ char, line: i + 1, col: j + 1 });
    else if (char === '}') {
      if (stack.length === 0) {
        console.log(`Unexpected } at line ${i + 1}, col ${j + 1}`);
      } else {
        let last = stack.pop();
        if (last.char !== '{') {
          console.log(`Mismatched } at line ${i + 1}, col ${j + 1}, expected match for ${last.char} at line ${last.line}`);
        }
      }
    }
  }
}

if (stack.length > 0) {
  console.log(`Unmatched braces:`);
  stack.forEach(s => console.log(`${s.char} at line ${s.line}, col ${s.col}`));
} else {
  console.log('Braces match perfectly.');
}
