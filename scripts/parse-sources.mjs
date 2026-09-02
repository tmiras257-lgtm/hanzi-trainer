// Inspect helper: prints a few parsed rows from each source
import fs from 'node:fs';
const D = process.argv[2];
const csv = fs.readFileSync(`${D}/hanziDB.csv`, 'utf8').split('\n');
console.log('csv rows', csv.length);
const mmah = fs.readFileSync(`${D}/mmah_dict.txt`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
console.log('mmah entries', mmah.length);
const m = mmah.find(e => e.character === '好');
console.log(JSON.stringify(m));
const m2 = mmah.find(e => e.character === '的');
console.log(JSON.stringify(m2));
