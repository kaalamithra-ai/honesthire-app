const net = require('net');
const path = require('node:path');
function checkMongo() {
  return new Promise(resolve => {
    const s = net.connect(27017, '127.0.0.1');
    s.on('connect', () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}
(async () => {
  const root = path.resolve(__dirname, '..');
  const up = await checkMongo();
  console.log('mongo reachable on 27017:', up);
  try {
    const app = require(path.join(root, 'backend', 'src', 'app'))();
    const adminMount = app._router.stack.some(l => l.regexp && /admin/.test(l.regexp.toString()));
    console.log('app boot ok; admin-mounted:', adminMount);
  } catch (e) {
    console.log('app boot FAILED:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();
