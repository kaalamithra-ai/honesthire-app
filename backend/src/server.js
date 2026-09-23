'use strict';
const { mongoose, connectDatabase } = require('./db');
const createApp = require('./app');
const port = Number(process.env.PORT || 5000);
async function start() {
  await connectDatabase();
  const server = createApp(mongoose).listen(port, '127.0.0.1', () => {
    console.log(`Honest Hire: http://127.0.0.1:${port}/`);
    console.log('Team sign-in: POST /api/auth/login (see backend/seed.js for the demo accounts).');
  });
  server.on('error', async error => { console.error(error.message); await mongoose.disconnect(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => { await mongoose.disconnect(); process.exit(0); }));
  }
}
start().catch(async error => { console.error('MongoDB startup failed:', error.message); await mongoose.disconnect(); process.exitCode = 1; });

