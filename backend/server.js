import { createApp } from './app.js';
import { db } from './db.js';

const port = Number(process.env.PORT || 3000);
const server = createApp().listen(port, process.env.BIND_HOST || '127.0.0.1',
  () => console.log(`Credential API listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => db.end()));
}
