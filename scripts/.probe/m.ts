import { classifyUtterance } from '../../src/lib/intent';
const QUESTION_MARKERS =
  /\b(?:why|how|what\s+(?:is|are|does|do|would|about|if|happens)|which|who|when|where|explain|tell\s+me|give\s+me|example|difference|mean|should\s+i|can\s+i|do\s+i|is\s+it|are\s+we)\b/i;
const attempts = [
  'I mean the client contract one',
  'Tell me if I have got this right, it is the confidential tier',
  'Can I say the second one',
  'the confidential one I think',
  'I would say internal because it is not for clients',
  'you would check the sender address first',
  'probably ring the IT desk, not sure',
  'no idea to be honest',
];
for (const a of attempts) {
  console.log(`${QUESTION_MARKERS.test(a) ? 'SUPPRESSED' : 'emits    '}  classify=${classifyUtterance(a)}  ${a}`);
}
const harness = [
  'sorry, what actually is an ISMS? I got lost',
  'so is it just paperwork then?',
  'can you give me an example of that',
  'what are the four classification tiers',
  'can I use my own laptop for work',
  'what if I lose it at a client site',
  'who do I tell',
  'is tailgating really a problem',
  'what about public wifi',
  'I still do not really get what an ISMS is',
];
console.log('\nharness questions:');
for (const q of harness) {
  console.log(`${QUESTION_MARKERS.test(q) ? 'marker  ' : 'NO MARKER'}  classify=${classifyUtterance(q)}  ${q}`);
}
