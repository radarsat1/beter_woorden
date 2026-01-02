from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import asyncio
import sys

app = FastAPI()

# A demo command to run.
# using "python -i -q" forces interactive mode so we can see prompts
# and test the line buffering logic.
DEFAULT_COMMAND = f"{sys.executable} -i -q"
DEFAULT_COMMAND = "uv run scripts/exercise.py"

html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Terminal Emulator</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm/css/xterm.css" />
    <script src="https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js"></script>
    <style>
        body { font-family: sans-serif; padding: 20px; }
        #terminal {
            width: 50em;
            height: 60em;
            border: 1px solid #ccc;
            background-color: black;
            margin-top: 10px;
        }
        #controls { margin-bottom: 10px; }
        button {
            padding: 10px 20px;
            font-size: 16px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div id="controls">
        <button id="launchBtn">Launch Program</button>
    </div>
    <div id="terminal"></div>

    <script type="module">
        document.addEventListener('DOMContentLoaded', () => {
            const terminalDiv = document.getElementById('terminal');
            const launchBtn = document.getElementById('launchBtn');

            const terminal = new Terminal({
                convertEol: true,
                cols: 100,
                fontFamily: 'Fira Code, monospace',
                cursorBlink: true
            });

            const socket = new WebSocket(`ws://${window.location.host}/ws`);

            terminal.open(terminalDiv);

            let isRunning = false;
            let currentLine = ""; // Local buffer for the line editor

            socket.onmessage = function(event) {
                // Write output from server directly to terminal
                terminal.write(event.data);
            };

            socket.onclose = function() {
                terminal.write('\\r\\nConnection closed.');
                isRunning = false;
                launchBtn.disabled = false;
                launchBtn.style.display = 'inline-block';
            };

            launchBtn.addEventListener('click', () => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send("LAUNCH");
                    launchBtn.disabled = true;
                    launchBtn.style.display = 'none';
                    terminal.focus();
                    isRunning = true;
                    currentLine = ""; // Reset buffer
                }
            });

            terminal.onKey(({ key, domEvent }) => {
                if (!isRunning) return;

                const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.ctrlKey && !domEvent.metaKey;

                if (domEvent.key === 'Enter') {
                    // 1. Send the buffered line to the server
                    socket.send(currentLine + '\\n');

                    // 2. Visual echo of the newline
                    terminal.write('\\r\\n');

                    // 3. Clear the buffer
                    currentLine = "";
                }
                else if (domEvent.key === 'Backspace') {
                    // 1. Check if we have anything to backspace
                    if (currentLine.length > 0) {
                        currentLine = currentLine.slice(0, -1);
                        terminal.write('\\b \\b'); // Destructive backspace visual
                    }
                    // If buffer is empty, we do nothing (protecting the prompt)
                }
                else if (printable && key.length === 1) {
                    // Standard character input
                    currentLine += key;
                    terminal.write(key);
                }
                // We deliberately ignore arrow keys here to keep the line editor simple
                // (append-only) to avoid cursor desynchronization logic.
            });
        });
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def get():
    return html

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            if data == "LAUNCH":
                await execute_command(websocket, DEFAULT_COMMAND)
                break
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

async def execute_command(websocket: WebSocket, command: str):
    process = await asyncio.create_subprocess_shell(
        command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    print(f"Started process: {command}")

    async def read_stdout():
        try:
            while True:
                data = await process.stdout.read(1024)
                if not data:
                    break
                await websocket.send_text(data.decode('utf-8', errors='replace'))
        except Exception:
            pass

    async def read_stderr():
        try:
            while True:
                data = await process.stderr.read(1024)
                if not data:
                    break
                await websocket.send_text(data.decode('utf-8', errors='replace'))
        except Exception:
            pass

    async def write_stdin():
        try:
            while True:
                data = await websocket.receive_text()
                # data already contains \n from the frontend
                process.stdin.write(data.encode('utf-8'))
                await process.stdin.drain()
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    stdout_task = asyncio.create_task(read_stdout())
    stderr_task = asyncio.create_task(read_stderr())
    stdin_task = asyncio.create_task(write_stdin())

    await process.wait()

    stdin_task.cancel()
    await stdout_task
    await stderr_task
    await websocket.close()
    print("Process finished")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
