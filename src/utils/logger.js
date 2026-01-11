/**
 * Simple Logger Utility
 * Provides structured logging with levels
 */

import { LOG_LEVEL } from '../config.js';

const LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
    debug(message, ...args) {
        if (currentLevel <= LEVELS.debug) {
            console.log(formatMessage('debug', message), ...args);
        }
    },

    info(message, ...args) {
        if (currentLevel <= LEVELS.info) {
            console.log(formatMessage('info', message), ...args);
        }
    },

    warn(message, ...args) {
        if (currentLevel <= LEVELS.warn) {
            console.warn(formatMessage('warn', message), ...args);
        }
    },

    error(message, ...args) {
        if (currentLevel <= LEVELS.error) {
            console.error(formatMessage('error', message), ...args);
        }
    }
};

export default logger;
