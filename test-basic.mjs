#!/usr/bin/env node

/**
 * Basic test script to verify the MCP server works
 * This simulates what Claude Desktop does
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Testing Minecraft Dev MCP Server...\n');

// Start the server
const serverPath = join(__dirname, 'dist', 'index.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let jsonRpcId = 1;

// Send JSON-RPC request
function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id: jsonRpcId++,
    method,
    params,
  };

  server.stdin.write(JSON.stringify(request) + '\n');
}

// Handle server output
server.stdout.on('data', (data) => {
  const text = data.toString();
  console.log('📥 Server response:', text);

  try {
    const response = JSON.parse(text);
    console.log('✅ Valid JSON-RPC response received');
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.log('ℹ️  Non-JSON output (expected during initialization)');
  }
});

server.stderr.on('data', (data) => {
  console.log('⚠️  Server stderr:', data.toString());
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

server.on('close', (code) => {
  console.log(`\n🏁 Server exited with code ${code}`);
  process.exit(code);
});

// Wait a bit for server to initialize
setTimeout(() => {
  console.log('📤 Sending initialize request...\n');

  sendRequest('initialize', {
    protocolVersion: '1.0.0',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0',
    },
  });

  // After initialization, list tools
  setTimeout(() => {
    console.log('📤 Sending tools/list request...\n');
    sendRequest('tools/list');

    // Cleanup after test
    setTimeout(() => {
      console.log('\n✅ Basic test completed!');
      server.kill();
    }, 2000);
  }, 1000);
}, 1000);
