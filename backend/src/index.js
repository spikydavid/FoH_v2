const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const helloRoutes = require('./routes/helloRoutes');
const infoRoutes = require('./routes/infoRoutes');
const env = require('./config/env');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', healthRoutes);
app.use('/api', helloRoutes);
app.use('/api', infoRoutes);

app.listen(env.port, () => {
  console.log(`Backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
