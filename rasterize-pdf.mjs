import { pdf } from 'pdf-to-img';
import { writeFileSync } from 'fs';

const doc = await pdf('../1105eastview_Survey - New.PDF', { scale: 3 });
let i = 0;
for await (const page of doc) {
  i++;
  writeFileSync(`survey-page-${i}.png`, page);
  console.log(`wrote survey-page-${i}.png (${page.length} bytes)`);
}
console.log('pages:', i);
