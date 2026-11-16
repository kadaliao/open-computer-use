// Connects to an MCP server over stdio and reports the size of what a caller gets up front: instructions + tool schemas.
const SDK = new URL("../../../../core/node_modules/@modelcontextprotocol/sdk/dist/esm", import.meta.url).pathname;
const { Client } = await import(`${SDK}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);
const [command, ...args] = process.argv.slice(2);
const env = { ...process.env, DEEPSEEK_API_KEY: "", OCU_API_KEY: "", STEPFUN_API_KEY: "", OCU_VISION_API_KEY: "", OCU_SHELL_ENV: "0" } as Record<string, string>;
const c = new Client({ name: "probe", version: "0" });
await c.connect(new StdioClientTransport({ command, args, env }));
const instr = c.getInstructions() ?? "";
const { tools } = await c.listTools();
const schema = JSON.stringify(tools);
console.log(JSON.stringify({ server: command.split("/").pop(), tools: tools.length, instructions_chars: instr.length, tool_schema_chars: schema.length, names: tools.map((t: any) => t.name).slice(0, 80) }));
await c.close();
process.exit(0);
