const fs = require('fs');
const path = require('path');

const files = ['src/cli.js', 'src/config.js', 'src/models.js', 'src/proxy.js', 'src/health-checker.js', 'src/admin.js', 'src/db.js', 'src/sync.js'];
const issues = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
  
  for (const match of requireMatches) {
    const moduleName = match.match(/require\(['"]([^'"]+)['"]\)/)[1];
    
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const resolvedPath = path.resolve(path.dirname(file), moduleName);
      const pathsToCheck = [resolvedPath, resolvedPath + '.js'];
      
      let found = false;
      for (const p of pathsToCheck) {
        if (fs.existsSync(p)) {
          found = true;
          break;
        }
      }
      
      if (!found) {
        issues.push(file + ' requires missing module: ' + moduleName);
      }
    }
  }
}

if (issues.length === 0) {
  console.log('All local module references are valid');
} else {
  console.log('Missing dependencies found:');
  issues.forEach(i => console.log('  - ' + i));
}
