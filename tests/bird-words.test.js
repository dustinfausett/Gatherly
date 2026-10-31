import {test} from 'node:test';import assert from 'node:assert/strict';import {birdWords,cleanMessageBody} from '../shared/bird-words.js';
test('bird terms replace whole profanity and phrases without damaging ordinary words, URLs or emails',()=>{
 assert.equal(birdWords('What the hell? This is bullshit!'),'What in the feathers? This is goose feathers!');assert.equal(birdWords('fucking shit'),'flapping birdseed');assert.equal(birdWords('SHIT'),'BIRDSEED');
 const safe='Scunthorpe needs assistance. https://example.com/shit dick@example.com';assert.equal(birdWords(safe),safe);assert.equal(birdWords(birdWords('damn bullshit')),birdWords('damn bullshit'));
 assert.equal(JSON.parse(cleanMessageBody(JSON.stringify({title:'Damn picnic',questions:[{id:'shit',label:'What the hell?'}]}),'poll')).questions[0].id,'shit');
});
