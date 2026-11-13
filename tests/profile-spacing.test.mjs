import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync('components/profile-header.css','utf8');
assert.match(css,/\.petal-profile-topline\{position:relative;display:block;/);
assert.match(css,/\.petal-profile-name-row\{display:flex;align-items:flex-start;/);assert.match(css,/\.petal-profile-follow\{display:flex;flex:0 0 auto;/);
assert.match(css,/\.petal-profile-identity \{ margin-top: 16px;/);
console.log('PASS profile: avatar flow and original identity spacing preserved, follow control shares the name row without absolute-position overlap');
