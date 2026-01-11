/**
 * MCP Server Test Script
 * Tests the SSE connection and tool execution
 */

import http from 'http';
import axios from 'axios';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_QUERY = process.argv[2] || 'Dude';
const TIMEOUT_MS = 60000; // 60 seconds for direct search

console.log('='.repeat(50));
console.log('Moviesda MCP Server Test');
console.log('='.repeat(50));
console.log(`Server URL: ${BASE_URL}`);
console.log(`Test Query: ${TEST_QUERY}`);
console.log('');

async function runTest() {
    return new Promise((resolve, reject) => {
        console.log('Connecting to SSE endpoint...');

        const req = http.request(`${BASE_URL}/sse`, (res) => {
            console.log(`✓ SSE Connected (Status: ${res.statusCode})\n`);

            res.on('data', async (chunk) => {
                const text = chunk.toString();
                const lines = text.split('\n');

                let event = null;
                let data = '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        event = line.substring(7).trim();
                    } else if (line.startsWith('data: ')) {
                        data = line.substring(6).trim();
                    }
                }

                if (event === 'endpoint') {
                    console.log(`Received endpoint: ${data}`);
                    console.log(`\nSending search_movies request...`);

                    try {
                        const postUrl = `${BASE_URL}${data}`;
                        await axios.post(postUrl, {
                            jsonrpc: "2.0",
                            method: "tools/call",
                            params: {
                                name: "search_movies",
                                arguments: { query: TEST_QUERY }
                            },
                            id: 1
                        });
                        console.log('✓ Request sent\n');
                    } catch (err) {
                        console.error('✗ Request failed:', err.message);
                        reject(err);
                    }
                }

                if (event === 'message') {
                    try {
                        const json = JSON.parse(data);
                        if (json.id === 1 && json.result) {
                            console.log('Response received:');
                            console.log('-'.repeat(40));
                            console.log(json.result.content[0].text);
                            console.log('-'.repeat(40));
                            console.log('\n✓ Test Passed!');
                            resolve(true);
                        }
                    } catch (e) {
                        // Ignore parse errors for partial data
                    }
                }
            });
        });

        req.on('error', (e) => {
            console.error(`✗ Connection error: ${e.message}`);
            console.error('\nMake sure the server is running: npm start');
            reject(e);
        });

        req.end();

        // Timeout handler
        setTimeout(() => {
            console.error('✗ Test timed out');
            reject(new Error('Timeout'));
        }, TIMEOUT_MS);
    });
}

runTest()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
