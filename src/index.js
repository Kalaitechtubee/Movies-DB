import express from 'express';
import cors from 'cors';
import catalyst from 'zcatalyst-sdk-node';
import { PORT } from './config.js';
import routes from './routes/index.js';
import logger from './utils/logger.js';

const app = express();

// Middleware
app.use(cors());

// Catalyst Initialization Middleware (Optional but helpful)
app.use((req, res, next) => {
    try {
        req.catalystApp = catalyst.initialize(req);
    } catch (e) {
        // Not in Catalyst environment or missing headers
    }
    next();
});

// Mount routes
app.use('/', routes);

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
    logger.info(`Moviesda MCP Server running on port ${PORT}`);
    if (!process.env.ZOHO_CATALYST_LISTEN_PORT) {
        logger.info(`REST API: http://localhost:${PORT}/api/search?q=movie_name`);
        logger.info(`MCP SSE: http://localhost:${PORT}/sse`);
        logger.info(`Health: http://localhost:${PORT}/health`);
    }
});

export default app;

