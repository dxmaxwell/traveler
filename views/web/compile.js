/*
 * Compile templates into JavaScript fragments
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

const pug = require('pug');

const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const writeFile = util.promisify(fs.writeFile);

function main() {

  return readdir(process.argv[3]).then((files) => {
    let first = true;
    let compiled = [
      '// Generated from by script: ' + __filename + ' ' + process.argv[2] + ' ' +process.argv[3] + ' ' + process.argv[4],
      'let ' + process.argv[2] + ' = {};'
    ];
    
    for (f of files.sort()) {
      compiled.push(pug.compileFileClient(path.join(process.argv[3], f), { inlineRuntimeFunctions: first, compileDebug: false })
        .replace('function template(', process.argv[2] + '.' + f.split('.')[0] + ' = function('));
      first = false;
    }

    return mkdir(path.dirname(process.argv[4])).catch((err) => {
      if (err && err.code !== 'EEXIST') {
        throw err;
      }
    })
    .then(() => {
      return writeFile(process.argv[4], compiled.join('\n\n'));
    })
  });
}

main().catch((err) => {
  process.exitCode = 1;
  console.error(err);
});
